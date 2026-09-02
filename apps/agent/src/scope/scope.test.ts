import type { Scope } from "@agentpass/core";
import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { EURC_MOCK, MOCK_VENUE_ID, USDC_TESTNET } from "../catalog/mock.js";
import { checkScope, scopeError, type ScopeRequest } from "./scope.js";

const OTHER_VENUE = "otro-bazaar:CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";

const PILOT: Scope = {
  actions: ["catalog:read", "intent:create"],
  venues: [MOCK_VENUE_ID],
  assets: [USDC_TESTNET],
  limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" },
};

const REQUEST: ScopeRequest = {
  venue: MOCK_VENUE_ID,
  asset: USDC_TESTNET,
  unitAmount: "18.50",
  quantity: 1,
};

function decide(scope: Partial<Scope> = {}, request: Partial<ScopeRequest> = {}) {
  return checkScope({ ...PILOT, ...scope }, { ...REQUEST, ...request });
}

describe("a purchase the credential authorises", () => {
  it("is allowed, with the total worked out exactly", () => {
    const decision = decide({}, { unitAmount: "18.50", quantity: 2 });

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) expect.unreachable("expected an allowed decision");
    expect(decision.total).toBe("37.0000000");
    expect(decision.limit).toBe("50.00");
  });

  /**
   * Inclusive, matching how phase 1 treats the on-chain expiry boundary — the
   * two sides of the system must not disagree about what "at the limit" means.
   */
  it("allows a total that lands exactly on perTx", () => {
    expect(decide({}, { unitAmount: "50.00", quantity: 1 }).allowed).toBe(true);
    expect(decide({}, { unitAmount: "25.00", quantity: 2 }).allowed).toBe(true);
    expect(decide({}, { unitAmount: "0.0000001", quantity: 500_000_000 }).allowed).toBe(true);
  });

  it("refuses one unit past it", () => {
    const decision = decide({}, { unitAmount: "50.0000001", quantity: 1 });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("ScopeAmountExceeded");
  });
});

describe("the arithmetic is exact where a float would refuse a legal purchase", () => {
  /**
   * Each of these totals lands exactly on its limit, and each is a value whose
   * floating-point product overshoots it. A float implementation refuses a
   * purchase the credential authorises — the failure mode amounts-as-strings
   * exists to prevent, checked here at the decision rather than only in the
   * arithmetic's own unit tests.
   */
  it.each([
    ["0.1 x 3 against 0.3", "0.1", 3, "0.3", 0.1 * 3],
    ["0.07 x 3 against 0.21", "0.07", 3, "0.21", 0.07 * 3],
    ["1.1 x 3 against 3.3", "1.1", 3, "3.3", 1.1 * 3],
    ["0.035 x 3 against 0.105", "0.035", 3, "0.105", 0.035 * 3],
  ])("allows %s", (_label, unitAmount, quantity, perTx, floatProduct) => {
    // The premise: in floating point this product really is over the limit.
    expect(floatProduct).toBeGreaterThan(Number(perTx));

    const decision = decide(
      { limits: { perTx, perDay: "999999.00", currency: "USDC" } },
      { unitAmount, quantity },
    );

    expect(decision.allowed).toBe(true);
  });

  it("stays exact past the range a double can represent", () => {
    const decision = decide(
      { limits: { perTx: "999999999.9999999", perDay: "999999999.9999999", currency: "USDC" } },
      { unitAmount: "999999999.9999999", quantity: 1 },
    );

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) expect.unreachable("expected an allowed decision");
    expect(decision.total).toBe("999999999.9999999");
  });
});

describe("fail-closed, per B-1", () => {
  it("an empty venues list permits no venue at all", () => {
    const decision = decide({ venues: [] });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("ScopeVenueNotAllowed");
    expect(decision.details.permitsNothing).toBe(true);
  });

  it("an empty assets list permits no asset at all", () => {
    const decision = decide({ assets: [] });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("ScopeAssetNotAllowed");
    expect(decision.details.permitsNothing).toBe(true);
  });

  it("the credential the repo ships as an example authorises no purchase", () => {
    // examples/scope.json: actions to create intents, but no venue and no asset.
    const decision = decide({ venues: [], assets: [] });

    expect(decision.allowed).toBe(false);
  });
});

describe("byte-for-byte matching, per B-3", () => {
  it.each([
    ["a different venue", { venue: OTHER_VENUE }],
    ["the same contract under a different slug", { venue: MOCK_VENUE_ID.replace("mock-", "el-") }],
    ["a padded venue", { venue: ` ${MOCK_VENUE_ID}` }],
    ["an uppercased venue", { venue: MOCK_VENUE_ID.toUpperCase() }],
  ])("refuses %s", (_label, request) => {
    expect(decide({}, request).allowed).toBe(false);
  });

  it("refuses an asset that differs only in its issuer", () => {
    const decision = decide({}, { asset: EURC_MOCK });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("ScopeAssetNotAllowed");
  });
});

describe("the action must be permitted", () => {
  it("refuses when the credential grants only catalogue reads", () => {
    const decision = decide({ actions: ["catalog:read"] });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("ScopeActionNotAllowed");
  });
});

describe("a limit in one currency says nothing about a price in another", () => {
  it("refuses when the price asset and the limit currency disagree", () => {
    const decision = decide(
      { assets: [EURC_MOCK], limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" } },
      { asset: EURC_MOCK, unitAmount: "7.50" },
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("ScopeCurrencyMismatch");
  });

  it("allows it once the limit is denominated in the same currency", () => {
    expect(
      decide(
        { assets: [EURC_MOCK], limits: { perTx: "50.00", perDay: "200.00", currency: "EURC" } },
        { asset: EURC_MOCK, unitAmount: "7.50" },
      ).allowed,
    ).toBe(true);
  });
});

describe("the order of the checks", () => {
  /**
   * Broadest first, so the reason reported is the most fundamental one that
   * failed: being allowed to act at all outranks being allowed here, which
   * outranks being allowed to spend this, which outranks how much.
   */
  it("reports the action before the venue", () => {
    const decision = decide({ actions: ["catalog:read"], venues: [] });

    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("ScopeActionNotAllowed");
  });

  it("reports the venue before the asset", () => {
    const decision = decide({ venues: [] }, { asset: EURC_MOCK });

    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("ScopeVenueNotAllowed");
  });

  it("reports the asset before the amount", () => {
    const decision = decide({}, { asset: EURC_MOCK, unitAmount: "9999.00" });

    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("ScopeAssetNotAllowed");
  });
});

describe("scopeError", () => {
  it("carries the denial's code and its structured context", () => {
    const decision = decide({}, { unitAmount: "89.00" });

    if (decision.allowed) expect.unreachable("expected a denial");
    const error = scopeError(decision);

    expect(hasErrorCode(error, "ScopeAmountExceeded")).toBe(true);
    expect(error.details).toMatchObject({
      total: "89.0000000",
      limit: "50.00",
      quantity: 1,
      currency: "USDC",
    });
  });
});

describe("perDay is deliberately not enforced here", () => {
  /**
   * A daily total needs memory of past spending, which is enforcement rather
   * than a scope check — PolicyRail, phase 3. T12 promises `perTx`, which is
   * stateless, and does not quietly do half of the other thing.
   */
  it("a purchase within perTx passes even when it dwarfs perDay", () => {
    const decision = decide(
      { limits: { perTx: "50.00", perDay: "0.01", currency: "USDC" } },
      { unitAmount: "50.00" },
    );

    expect(decision.allowed).toBe(true);
  });
});
