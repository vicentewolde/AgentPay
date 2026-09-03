import { hasErrorCode, stellarAddressToDid } from "@agentpass/core";
import { createMandate, signMandate, type AgentPayMandate } from "@agentpay/mandate";
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";

import { EURC_MOCK, MOCK_VENUE_ID, USDC_TESTNET } from "../catalog/mock.js";
import type { PurchaseIntent } from "../intent/intent.js";
import { checkMandate, mandateCheckError } from "./check-mandate.js";

const principal = Keypair.random();
const agent = Keypair.random();
const stranger = Keypair.random();

const PRINCIPAL_DID = stellarAddressToDid(principal.publicKey(), "testnet");
const AGENT_DID = stellarAddressToDid(agent.publicKey(), "testnet");
const STRANGER_DID = stellarAddressToDid(stranger.publicKey(), "testnet");

const OTHER_VENUE = "otro-bazaar:CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";
const REGISTRY = "CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";

function mandateFor(overrides: Partial<Parameters<typeof createMandate>[0]> = {}): AgentPayMandate {
  return createMandate({
    principal: PRINCIPAL_DID,
    agent: AGENT_DID,
    grant: {
      actions: ["catalog:read", "intent:create"],
      venues: [MOCK_VENUE_ID],
      assets: [USDC_TESTNET],
      limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" },
    },
    registry: REGISTRY,
    validFrom: "2026-09-01T00:00:00.000Z",
    validUntil: "2026-12-01T00:00:00.000Z",
    ...overrides,
  });
}

function intentFor(overrides: Partial<PurchaseIntent> = {}): PurchaseIntent {
  return {
    type: ["AgentPayIntent", "PurchaseIntent"],
    intentId: "8b0851b3-94e9-45b0-ba36-d6e9e32541d2",
    issuedAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-01T00:15:00.000Z",
    agent: AGENT_DID,
    principal: PRINCIPAL_DID,
    credential: { hash: "a".repeat(64), registry: REGISTRY },
    venue: MOCK_VENUE_ID,
    purchase: {
      productId: "mate-calabaza",
      quantity: 1,
      unitAmount: "18.50",
      totalAmount: "18.50",
      asset: USDC_TESTNET,
    },
    authorisation: { perTx: "50.00", currency: "USDC" },
    ...overrides,
  };
}

function decide(mandateOverrides = {}, intentOverrides = {}) {
  return checkMandate(mandateFor(mandateOverrides), intentFor(intentOverrides));
}

describe("a purchase the mandate authorises", () => {
  it("is allowed, with the total worked out exactly", () => {
    const decision = decide(
      {},
      { purchase: { productId: "mate-calabaza", quantity: 2, unitAmount: "18.50", totalAmount: "37.00", asset: USDC_TESTNET } },
    );

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) expect.unreachable("expected an allowed decision");
    expect(decision.total).toBe("37.0000000");
    expect(decision.limit).toBe("50.00");
  });

  it("also verifies against a mandate signed for real, not just an unsigned document", async () => {
    const mandate = mandateFor();
    const signed = await signMandate(mandate, principal);

    expect(checkMandate(signed.mandate, intentFor()).allowed).toBe(true);
  });

  /** Inclusive, matching how the credential and the contract treat their edges. */
  it("allows a total that lands exactly on perTx", () => {
    const at = decide(
      {},
      { purchase: { productId: "mate-calabaza", quantity: 1, unitAmount: "50.00", totalAmount: "50.00", asset: USDC_TESTNET } },
    );
    expect(at.allowed).toBe(true);
  });

  it("refuses one unit past it", () => {
    const decision = decide(
      {},
      { purchase: { productId: "mate-calabaza", quantity: 1, unitAmount: "50.0000001", totalAmount: "50.0000001", asset: USDC_TESTNET } },
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateAmountExceeded");
  });
});

describe("the arithmetic is exact where a float would refuse a legal purchase", () => {
  it.each([
    ["0.1 x 3 against 0.3", "0.1", 3, "0.3"],
    ["0.07 x 3 against 0.21", "0.07", 3, "0.21"],
    ["0.035 x 3 against 0.105", "0.035", 3, "0.105"],
  ])("allows %s", (_label, unitAmount, quantity, perTx) => {
    const decision = decide(
      { grant: { actions: ["intent:create"], venues: [MOCK_VENUE_ID], assets: [USDC_TESTNET], limits: { perTx, perDay: "999999.00", currency: "USDC" } } },
      { purchase: { productId: "x", quantity, unitAmount, totalAmount: perTx, asset: USDC_TESTNET } },
    );

    expect(decision.allowed).toBe(true);
  });
});

describe("identity: does this mandate even apply to these two parties", () => {
  it("refuses an intent from a different agent", () => {
    const decision = decide({}, { agent: STRANGER_DID });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateAgentMismatch");
  });

  it("refuses an intent naming a different principal than the one who signed", () => {
    const decision = decide({}, { principal: STRANGER_DID });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandatePrincipalMismatch");
  });

  it("an agent cannot use a mandate meant for another agent, even at a trivial amount", () => {
    const decision = decide(
      { agent: STRANGER_DID },
      { purchase: { productId: "x", quantity: 1, unitAmount: "0.0000001", totalAmount: "0.0000001", asset: USDC_TESTNET } },
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateAgentMismatch");
  });
});

describe("fail-closed, per B-1", () => {
  it("an empty venues list permits no venue at all", () => {
    const decision = decide({ grant: { actions: ["intent:create"], venues: [], assets: [USDC_TESTNET], limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" } } });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateVenueNotAllowed");
    expect(decision.details.permitsNothing).toBe(true);
  });

  it("an empty assets list permits no asset at all", () => {
    const decision = decide({ grant: { actions: ["intent:create"], venues: [MOCK_VENUE_ID], assets: [], limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" } } });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateAssetNotAllowed");
    expect(decision.details.permitsNothing).toBe(true);
  });
});

describe("byte-for-byte matching, per B-3", () => {
  it.each([
    ["a different venue", { venue: OTHER_VENUE }],
    ["a padded venue", { venue: ` ${MOCK_VENUE_ID}` }],
    ["an uppercased venue", { venue: MOCK_VENUE_ID.toUpperCase() }],
  ])("refuses %s", (_label, overrides) => {
    expect(decide({}, overrides).allowed).toBe(false);
  });
});

describe("the action must be permitted", () => {
  it("refuses when the mandate grants only catalogue reads", () => {
    const decision = decide({ grant: { actions: ["catalog:read"], venues: [MOCK_VENUE_ID], assets: [USDC_TESTNET], limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" } } });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateActionNotAllowed");
  });
});

describe("a limit in one currency says nothing about a price in another", () => {
  it("refuses when the price asset and the limit currency disagree", () => {
    const decision = decide(
      { grant: { actions: ["intent:create"], venues: [MOCK_VENUE_ID], assets: [EURC_MOCK], limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" } } },
      { purchase: { productId: "x", quantity: 1, unitAmount: "7.50", totalAmount: "7.50", asset: EURC_MOCK } },
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateCurrencyMismatch");
  });
});

describe("the mandate's window", () => {
  it("refuses an intent issued before the mandate began", () => {
    const decision = decide({}, { issuedAt: "2026-08-31T23:59:59.999Z" });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateWindowMismatch");
  });

  it("refuses an intent issued after the mandate ended", () => {
    const decision = decide({}, { issuedAt: "2026-12-01T00:00:00.001Z" });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateWindowMismatch");
  });

  it("treats both edges as inclusive", () => {
    expect(decide({}, { issuedAt: "2026-09-01T00:00:00.000Z" }).allowed).toBe(true);
    expect(decide({}, { issuedAt: "2026-12-01T00:00:00.000Z" }).allowed).toBe(true);
  });
});

describe("the order of the checks", () => {
  it("reports agent identity before principal identity", () => {
    const decision = decide({}, { agent: STRANGER_DID, principal: STRANGER_DID });

    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateAgentMismatch");
  });

  it("reports principal identity before the action", () => {
    const decision = decide(
      { grant: { actions: ["catalog:read"], venues: [MOCK_VENUE_ID], assets: [USDC_TESTNET], limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" } } },
      { principal: STRANGER_DID },
    );

    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandatePrincipalMismatch");
  });

  it("reports the action before the venue", () => {
    const decision = decide({ grant: { actions: ["catalog:read"], venues: [], assets: [USDC_TESTNET], limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" } } });

    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateActionNotAllowed");
  });

  it("reports the venue before the asset", () => {
    const decision = decide(
      { grant: { actions: ["intent:create"], venues: [], assets: [EURC_MOCK], limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" } } },
      { purchase: { productId: "x", quantity: 1, unitAmount: "7.50", totalAmount: "7.50", asset: EURC_MOCK } },
    );

    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateVenueNotAllowed");
  });

  it("reports the asset before the currency mismatch", () => {
    const decision = decide(
      { grant: { actions: ["intent:create"], venues: [MOCK_VENUE_ID], assets: [], limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" } } },
      { purchase: { productId: "x", quantity: 1, unitAmount: "7.50", totalAmount: "7.50", asset: EURC_MOCK } },
    );

    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateAssetNotAllowed");
  });

  it("reports the currency mismatch before the window", () => {
    const decision = decide(
      { grant: { actions: ["intent:create"], venues: [MOCK_VENUE_ID], assets: [EURC_MOCK], limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" } } },
      {
        issuedAt: "2027-01-01T00:00:00.000Z",
        purchase: { productId: "x", quantity: 1, unitAmount: "7.50", totalAmount: "7.50", asset: EURC_MOCK },
      },
    );

    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateCurrencyMismatch");
  });

  it("reports the window before the amount", () => {
    const decision = decide(
      {},
      {
        issuedAt: "2027-01-01T00:00:00.000Z",
        purchase: { productId: "x", quantity: 1, unitAmount: "9999.00", totalAmount: "9999.00", asset: USDC_TESTNET },
      },
    );

    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("MandateWindowMismatch");
  });
});

describe("mandateCheckError", () => {
  it("carries the denial's code and its structured context", () => {
    const decision = decide(
      {},
      { purchase: { productId: "x", quantity: 1, unitAmount: "89.00", totalAmount: "89.00", asset: USDC_TESTNET } },
    );

    if (decision.allowed) expect.unreachable("expected a denial");
    const error = mandateCheckError(decision);

    expect(hasErrorCode(error, "MandateAmountExceeded")).toBe(true);
    expect(error.details).toMatchObject({ total: "89.0000000", limit: "50.00", currency: "USDC" });
  });
});

describe("perDay is deliberately not enforced here", () => {
  /**
   * Same boundary as B-16, for the mandate's own grant: a daily total needs
   * memory of past spending, which is T18's job, not this pure function's.
   */
  it("a purchase within perTx passes even when it dwarfs perDay", () => {
    const decision = decide(
      { grant: { actions: ["intent:create"], venues: [MOCK_VENUE_ID], assets: [USDC_TESTNET], limits: { perTx: "50.00", perDay: "0.01", currency: "USDC" } } },
      { purchase: { productId: "x", quantity: 1, unitAmount: "50.00", totalAmount: "50.00", asset: USDC_TESTNET } },
    );

    expect(decision.allowed).toBe(true);
  });
});

describe("no field here can carry a venue's prose", () => {
  /**
   * B-13's structural defence, restated for the mandate: `PurchaseIntent`
   * never carries a product's name or description (B-19), so there is no
   * field in either input this function reads through which third-party text
   * could reach a decision. This is a property of the types, not a runtime
   * check — the test documents it rather than proving something new.
   */
  it("checkMandate's inputs are AgentPayMandate and PurchaseIntent, neither of which has a prose field", () => {
    const mandate = mandateFor();
    const intent = intentFor();

    expect(Object.keys(mandate.credentialSubject.grant)).toEqual(["actions", "venues", "assets", "limits"]);
    expect(Object.keys(intent.purchase)).toEqual(["productId", "quantity", "unitAmount", "totalAmount", "asset"]);
  });
});
