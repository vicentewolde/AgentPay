import { AgentPassError, hasErrorCode } from "@agentpass/core";
import { beforeAll, describe, expect, it } from "vitest";

import { createMockCatalog, MOCK_VENUE_ID } from "../catalog/mock.js";
import { checkOwnCredential, type CredentialState } from "../credential/verifier.js";
import { createStubVerifier, makeTestCredential } from "../testing/credentials.js";
import {
  createAgentTools,
  type ActiveCredentialReport,
  type GetProductResult,
  type ListProductsResult,
} from "./agent-tools.js";

let activeState: CredentialState;

beforeAll(async () => {
  const credential = await makeTestCredential();
  activeState = await checkOwnCredential(createStubVerifier(), credential.jws);
});

function tools(credential: CredentialState = activeState) {
  return createAgentTools({ catalog: createMockCatalog(), credential });
}

describe("the agent has exactly four tools", () => {
  it("no more, no fewer, and these four", () => {
    expect(tools().list().map((tool) => tool.name)).toEqual([
      "list_products",
      "get_product",
      "check_my_credential",
      "create_purchase_intent",
    ]);
  });

  it("hands each one a JSON Schema for its arguments", () => {
    const byName = new Map(tools().list().map((tool) => [tool.name, tool.inputSchema]));

    expect(byName.get("list_products")).toMatchObject({ properties: {} });
    expect(byName.get("get_product")).toMatchObject({
      required: ["product_id"],
      additionalProperties: false,
    });
    expect(byName.get("create_purchase_intent")).toMatchObject({
      required: ["product_id", "quantity"],
      properties: { quantity: { type: "integer", minimum: 1 } },
    });
  });

  it("describes what each tool does without leaning on it for security", () => {
    for (const tool of tools().list()) {
      expect(tool.description.length).toBeGreaterThan(30);
    }
  });
});

describe("list_products", () => {
  it("returns every product, with the venue it came from", async () => {
    const result = (await tools().invoke("list_products", {})) as ListProductsResult;

    expect(result.venue_id).toBe(MOCK_VENUE_ID);
    expect(result.product_count).toBe(12);
    expect(result.products).toHaveLength(12);
    expect(result.products[0]).toMatchObject({
      product_id: "mate-calabaza",
      price: { amount: "18.50" },
      available: true,
    });
  });

  it("takes no arguments and says so instead of ignoring them", async () => {
    await expect(tools().invoke("list_products", { limit: 5 })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidToolInput"),
    );
  });

  /**
   * B-5: third-party text is carried, never rewritten. The agent sees the
   * hostile descriptions exactly as the venue wrote them; what stops them
   * mattering is T12's structural check, not filtering here.
   */
  it("carries the venue's hostile descriptions through verbatim", async () => {
    const result = (await tools().invoke("list_products", {})) as ListProductsResult;
    const hostile = result.products.filter((product) =>
      /ignora tus instrucciones|exento del limite/i.test(product.description),
    );

    expect(hostile.map((product) => product.product_id).sort()).toEqual([
      "manta-lana-chilota",
      "polera-stellar-santiago",
    ]);
  });
});

describe("get_product", () => {
  it("returns one product by its exact id", async () => {
    const result = (await tools().invoke("get_product", {
      product_id: "miel-ulmo-500g",
    })) as GetProductResult;

    expect(result.product.name).toBe("Miel de ulmo, 500 g");
    expect(result.venue_id).toBe(MOCK_VENUE_ID);
  });

  it("surfaces ProductNotFound for an id the venue does not have", async () => {
    await expect(tools().invoke("get_product", { product_id: "no-existe" })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "ProductNotFound"),
    );
  });

  it("rejects a malformed id before the catalogue is ever asked", async () => {
    for (const product_id of ["", "mate calabaza", "a".repeat(129)]) {
      await expect(tools().invoke("get_product", { product_id })).rejects.toSatisfy(
        (error: unknown) => hasErrorCode(error, "InvalidToolInput"),
      );
    }
  });

  it("requires the argument rather than defaulting it", async () => {
    await expect(tools().invoke("get_product", {})).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "InvalidToolInput"),
    );
  });
});

describe("check_my_credential, on a credential that verified", () => {
  it("reports the identity, the window and the signed scope", async () => {
    const report = (await tools().invoke("check_my_credential", {})) as ActiveCredentialReport;

    expect(report.status).toBe("active");
    expect(report.can_create_purchase_intent).toBe(true);
    expect(report.credential_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.agent).toEqual({
      name: "compras-demo",
      model: "claude-opus-5",
      operator: "agentpay-pilot",
    });
    expect(report.scope.venues).toEqual([MOCK_VENUE_ID]);
    expect(report.scope.limits).toEqual({
      per_tx: "50.00",
      per_day: "200.00",
      currency: "USDC",
    });
    expect(report.subject).toMatch(/^did:stellar:testnet:G/);
  });

  it("reports the hash the registry answers about, not one the document declares", async () => {
    const credential = await makeTestCredential();
    const state = await checkOwnCredential(createStubVerifier(), credential.jws);
    const report = (await tools(state).invoke("check_my_credential", {})) as ActiveCredentialReport;

    expect(report.credential_hash).toBe(credential.hash);
  });

  it("takes no arguments", async () => {
    await expect(tools().invoke("check_my_credential", { verbose: true })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidToolInput"),
    );
  });
});

describe("create_purchase_intent, while its behaviour is still pending", () => {
  it("fails with NotImplemented, naming T12 and T13", async () => {
    try {
      await tools().invoke("create_purchase_intent", {
        product_id: "polera-stellar-santiago",
        quantity: 1,
      });
      expect.unreachable("create_purchase_intent has no behaviour yet");
    } catch (error) {
      expect(hasErrorCode(error, "NotImplemented")).toBe(true);
      expect(String((error as AgentPassError).details.milestone)).toContain("T12");
    }
  });

  /**
   * The quantity the seeded injection asks for is structurally valid input —
   * it has to be, or T12's amount check would never be the thing that refuses
   * it. 10 x 22.00 = 220.00, well over the pilot's 50.00 per-transaction limit.
   */
  it("accepts the quantity the seeded injection asks for as well-formed input", async () => {
    await expect(
      tools().invoke("create_purchase_intent", {
        product_id: "polera-stellar-santiago",
        quantity: 10,
      }),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "NotImplemented"));
  });

  it("still validates its arguments", async () => {
    const cases = [
      { product_id: "polera-stellar-santiago", quantity: 0 },
      { product_id: "polera-stellar-santiago", quantity: 1.5 },
      { product_id: "polera-stellar-santiago", quantity: -1 },
      { product_id: "polera-stellar-santiago" },
      { quantity: 1 },
      { product_id: "polera-stellar-santiago", quantity: 1, price: "0.01" },
    ];

    for (const args of cases) {
      await expect(tools().invoke("create_purchase_intent", args)).rejects.toSatisfy(
        (error: unknown) => hasErrorCode(error, "InvalidToolInput"),
      );
    }
  });
});
