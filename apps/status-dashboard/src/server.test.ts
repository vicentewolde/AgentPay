import type { AddressInfo } from "node:net";

import type { MandateRecord, Tenant } from "@agentpay/directory";
import type { VaultRecord } from "@agentpay/vault";
import { afterEach, describe, expect, it } from "vitest";

import { createStatusServer } from "./server.js";
import type { StatusDirectory, VaultReader } from "./status.js";

const createdAt = new Date("2026-09-11T12:00:00.000Z");
const tenant: Tenant = {
  id: "tenant_01J7QW8VQEJPAXEPAYSTATUS01",
  partnerId: "partner_01J7QW8VQEJPAXEPAYSTATUS01",
  externalRef: "status-test",
  label: "Status test tenant",
  status: "active",
  createdAt,
  updatedAt: createdAt,
};

const mandate: MandateRecord = {
  id: "mandate_01J7QW8VQEJPAXEPAYSTATUS01",
  tenantId: tenant.id,
  agentId: "agent_01J7QW8VQEJPAXEPAYSTATUS01",
  principalId: "principal_01J7QW8VQEJPAXEPAYSTATUS01",
  mandateHash: "a".repeat(64),
  signatureKind: "platform-jws",
  document: { version: 1 },
  signature: null,
  jws: "test-jws",
  validFrom: createdAt,
  validUntil: new Date("2026-09-12T12:00:00.000Z"),
  anchorTx: "anchor-transaction",
  supersedesId: null,
  revokedAt: null,
  revokeTx: null,
  createdAt,
};

const records: readonly VaultRecord[] = [
  {
    seq: 0,
    prevHash: "",
    hash: "b".repeat(64),
    entry: {
      kind: "granted",
      subject: "did:stellar:testnet:GSTATUS",
      intentId: "intent-granted",
      currency: "USDC",
      amount: "1.25",
      at: "2026-09-11T12:00:00.000Z",
    },
  },
  {
    seq: 1,
    prevHash: "b".repeat(64),
    hash: "c".repeat(64),
    entry: {
      kind: "refused",
      subject: "did:stellar:testnet:GSTATUS",
      intentId: "intent-refused",
      code: "MandateAmountExceeded",
      reason: "amount exceeds per-transaction limit",
      details: {},
      at: "2026-09-11T12:01:00.000Z",
    },
  },
];

const vault: VaultReader = {
  list: () => records,
  verify: () => ({ ok: true }),
};

function readOnlyDirectory(): StatusDirectory {
  return {
    findTenant: async (id) => (id === tenant.id ? tenant : undefined),
    listMandates: async (id) => (id === tenant.id ? [mandate] : []),
  };
}

const servers: ReturnType<typeof createStatusServer>[] = [];

async function start() {
  const server = createStatusServer({ directory: readOnlyDirectory(), vaultFactory: async () => vault });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))));
});

describe("status dashboard HTTP server", () => {
  it("shows a seeded mandate and a healthy, readable vault chain", async () => {
    const baseUrl = await start();

    const mandates = await fetch(`${baseUrl}/api/status/mandates?tenantId=${tenant.id}`);
    expect(mandates.status).toBe(200);
    await expect(mandates.json()).resolves.toMatchObject({
      tenant: { id: tenant.id },
      mandates: [{ id: mandate.id, hash: mandate.mandateHash }],
    });

    const vaultResponse = await fetch(`${baseUrl}/api/status/vault/${tenant.id}`);
    expect(vaultResponse.status).toBe(200);
    await expect(vaultResponse.json()).resolves.toMatchObject({
      verification: { ok: true, brokenAtSeq: null },
      records: [
        { kind: "refused", detail: "MandateAmountExceeded: amount exceeds per-transaction limit" },
        { kind: "granted", amount: "1.25 USDC" },
      ],
    });

    const page = await fetch(`${baseUrl}/?tenantId=${tenant.id}`);
    expect(page.status).toBe(200);
    await expect(page.text()).resolves.toContain("Vault chain: <span class=\"ok\">healthy</span>");
  });

  it("rejects every non-GET method on every dashboard route", async () => {
    const baseUrl = await start();
    const routes = ["/", `/api/status/mandates?tenantId=${tenant.id}`, `/api/status/vault/${tenant.id}`];
    const methods = ["POST", "PUT", "PATCH", "DELETE"] as const;

    for (const route of routes) {
      for (const method of methods) {
        const response = await fetch(`${baseUrl}${route}`, { method });
        expect(response.status, `${method} ${route}`).toBe(405);
        expect(response.headers.get("allow")).toBe("GET");
      }
    }
  });

  it("requires a tenant ID for the mandates API and never turns it into a write", async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/status/mandates`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
  });
});
