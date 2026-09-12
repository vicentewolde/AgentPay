import { AgentPassError } from "@agentpass/core";
import { verifyWebhookSignature, webhookEventSchema } from "@agentpey/partner-api";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { createFailedDeliveryQueue, deliverWebhook } from "./index.js";

const SECRET = "partner-endpoint-secret";
const event = webhookEventSchema.parse({
  id: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  type: "mandate.activated",
  created_at: "2026-09-10T00:00:00.000Z",
  data: { mandate_id: "mdt_01ARZ3NDEKTSV4RRFFQ69G5FAV" },
});

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

interface TestServer {
  readonly url: string;
  close(): Promise<void>;
}

async function startServer(handler: Handler): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new AgentPassError("NetworkError", "test server did not receive a TCP address");
  }

  return {
    url: `http://127.0.0.1:${address.port}/webhooks`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
    },
  };
}

function respond(response: ServerResponse, status: number): void {
  response.writeHead(status);
  response.end();
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

describe("deliverWebhook", () => {
  it("retries 5xx responses with increasing backoff until a partner returns 2xx", async () => {
    const attemptedAt: number[] = [];
    let calls = 0;
    const server = await startServer((_request, response) => {
      calls += 1;
      attemptedAt.push(Date.now());
      respond(response, calls < 3 ? 503 : 200);
    });

    try {
      await expect(deliverWebhook({ url: server.url, secret: SECRET, event, maxAttempts: 3 })).resolves.toEqual({
        delivered: true,
        attempts: 3,
        status: 200,
      });
      expect(calls).toBe(3);
      expect(attemptedAt[1]! - attemptedAt[0]!).toBeGreaterThanOrEqual(950);
      expect(attemptedAt[2]! - attemptedAt[1]!).toBeGreaterThanOrEqual(1_950);
    } finally {
      await server.close();
    }
  });

  it("does not retry a partner 4xx response", async () => {
    let calls = 0;
    const server = await startServer((_request, response) => {
      calls += 1;
      respond(response, 422);
    });

    try {
      await expect(deliverWebhook({ url: server.url, secret: SECRET, event })).resolves.toEqual({
        delivered: false,
        attempts: 1,
        lastError: "HTTP 422",
      });
      expect(calls).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("retries a network failure through an injected fetch implementation", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("offline");
      return new Response(null, { status: 202 });
    };

    await expect(deliverWebhook({ url: "https://partner.test/webhooks", secret: SECRET, event, maxAttempts: 2, fetchImpl })).resolves.toEqual({
      delivered: true,
      attempts: 2,
      status: 202,
    });
    expect(calls).toBe(2);
  });

  it("signs the exact payload with the partner-api signature contract", async () => {
    let verification: ReturnType<typeof verifyWebhookSignature> | undefined;
    const server = await startServer((request, response) => {
      void readBody(request).then((body) => {
        const header = request.headers["agentpay-signature"];
        verification = typeof header === "string"
          ? verifyWebhookSignature(SECRET, header, body)
          : { ok: false, reason: "malformed-header" };
        respond(response, 204);
      });
    });

    try {
      await expect(deliverWebhook({ url: server.url, secret: SECRET, event })).resolves.toEqual({
        delivered: true,
        attempts: 1,
        status: 204,
      });
      expect(verification).toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });
});

describe("createFailedDeliveryQueue", () => {
  it("records exhausted delivery attempts without retaining the endpoint secret", async () => {
    const server = await startServer((_request, response) => respond(response, 500));
    const queue = createFailedDeliveryQueue();

    try {
      await expect(queue.deliver({ url: server.url, secret: SECRET, event, maxAttempts: 1 })).resolves.toEqual({
        delivered: false,
        attempts: 1,
        lastError: "HTTP 500",
      });
      expect(queue.list()).toHaveLength(1);
      expect(queue.list()[0]).toMatchObject({ url: server.url, event, attempts: 1, lastError: "HTTP 500" });
      expect(JSON.stringify(queue.list())).not.toContain(SECRET);

      queue.clear();
      expect(queue.list()).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
