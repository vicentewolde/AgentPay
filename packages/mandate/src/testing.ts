/**
 * Test helpers, exported from the package rather than hidden in a test file so
 * later milestones (`checkMandate`, the ledger, the demo) build their fixtures
 * the same way instead of each inventing a mandate by hand.
 *
 * Everything here signs with real keys. Nothing is stubbed: a fixture that
 * fakes the signature would let a break in the signing path pass every test
 * that uses it.
 */
import { randomBytes } from "node:crypto";

import type { Scope, StellarDid } from "@agentpass/core";
import { stellarAddressToDid } from "@agentpass/core";
import { Keypair, StrKey } from "@stellar/stellar-sdk/base";

import type { AgentPayMandate } from "./mandate.js";
import { createMandate } from "./create.js";

export const TEST_REGISTRY = StrKey.encodeContract(randomBytes(32));

export const TEST_GRANT: Scope = {
  actions: ["catalog:read", "intent:create"],
  venues: ["mock-bazaar:CCL57L4ZQVQCGTQKGQMOAX7QDPEDW4LX2QSPBQMTMLB7BFQ7I3TM7F4A"],
  assets: ["USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"],
  limits: { perTx: "50.0000000", perDay: "200.0000000", currency: "USDC" },
};

export interface TestMandateOverrides {
  readonly grant?: Scope;
  readonly registry?: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly mandateId?: string;
}

/** Builds an unsigned mandate from a principal and an agent keypair. */
export function makeTestMandate(
  principal: Keypair,
  agent: Keypair,
  overrides: TestMandateOverrides = {},
): AgentPayMandate {
  return createMandate({
    principal: didOf(principal),
    agent: didOf(agent),
    grant: overrides.grant ?? TEST_GRANT,
    registry: overrides.registry ?? TEST_REGISTRY,
    validFrom: overrides.validFrom ?? "2026-09-01T00:00:00.000Z",
    validUntil: overrides.validUntil ?? "2026-12-01T00:00:00.000Z",
    ...(overrides.mandateId === undefined ? {} : { mandateId: overrides.mandateId }),
  });
}

export function didOf(keypair: Keypair): StellarDid {
  return stellarAddressToDid(keypair.publicKey(), "testnet");
}
