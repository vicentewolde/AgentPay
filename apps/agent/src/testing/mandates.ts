/**
 * Test helpers: real mandates, simulated chain — the mandate's equivalent of
 * `testing/credentials.ts`.
 *
 * Signing and the two offline checks run for real (`createMandate` +
 * `signMandate` + `verifyMandate`, over genuine Ed25519 keys). Only the
 * registry lookup is simulated. A double that faked the signature too would
 * prove nothing about `checkOwnMandate`.
 *
 * Not exported from the package index: this exists for tests.
 */
import type { Scope, StellarDid } from "@agentpass/core";
import { AgentPassError, stellarAddressToDid } from "@agentpass/core";
import { createMandate, signMandate, verifyMandate, type AgentPayMandate } from "@agentpay/mandate";
import { Keypair } from "@stellar/stellar-sdk/base";

import type { MandateVerifier, VerifiedOwnMandate } from "../mandate/verifier.js";
import { PILOT_SCOPE, TEST_REGISTRY } from "./credentials.js";

function didOf(keypair: Keypair): StellarDid {
  return stellarAddressToDid(keypair.publicKey(), "testnet");
}

/**
 * Identical to `PILOT_SCOPE` (`testing/credentials.ts`) on purpose: a default
 * test mandate that grants exactly what the default test credential's own
 * `scope` already permits, so a test exercising `PolicyRail` through the
 * mandate never hits a narrower limit than the credential-only tests already
 * assumed, unless it deliberately asks for one.
 */
export const PILOT_GRANT: Scope = PILOT_SCOPE;

export interface TestMandateOptions {
  readonly grant?: Scope;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly registry?: string;
  /** The principal — defaults to a fresh key, override to match a credential's issuer/principal. */
  readonly principal?: Keypair;
  /** The agent this mandate empowers — override to match a credential's subject. */
  readonly agent?: Keypair;
}

export interface TestMandate {
  readonly jws: string;
  readonly hash: string;
  readonly mandate: AgentPayMandate;
  readonly principalKeypair: Keypair;
  readonly agentKeypair: Keypair;
}

/** Builds and signs a mandate with real keys. No network. */
export async function makeTestMandate(options: TestMandateOptions = {}): Promise<TestMandate> {
  const principalKeypair = options.principal ?? Keypair.random();
  const agentKeypair = options.agent ?? Keypair.random();

  const mandate = createMandate({
    principal: didOf(principalKeypair),
    agent: didOf(agentKeypair),
    grant: options.grant ?? PILOT_GRANT,
    registry: options.registry ?? TEST_REGISTRY,
    validFrom: options.validFrom ?? "2026-01-01T00:00:00.000Z",
    validUntil: options.validUntil ?? "2027-01-01T00:00:00.000Z",
  });

  const signed = await signMandate(mandate, principalKeypair);
  return { ...signed, principalKeypair, agentKeypair };
}

/** What the simulated on-chain check answers for a mandate hash. */
export type SimulatedMandateStatus = "Active" | "Revoked" | "Unknown" | "IssuerInactive";

export interface StubMandateVerifierOptions {
  /** Defaults to `"Active"`. */
  readonly status?: SimulatedMandateStatus;
  /** Throw this instead of consulting the simulated registry — e.g. an outage. */
  readonly failWith?: unknown;
}

/**
 * A {@link MandateVerifier} that runs the two offline checks for real
 * (`verifyMandate`) and simulates only the on-chain lookup — same split
 * `createStubVerifier` uses for credentials.
 */
export function createStubMandateVerifier(options: StubMandateVerifierOptions = {}): MandateVerifier {
  const status = options.status ?? "Active";

  return {
    async verify(jws: string, verifyOptions = {}): Promise<VerifiedOwnMandate> {
      const verified = await verifyMandate(jws, verifyOptions);

      if (options.failWith !== undefined) throw options.failWith;

      switch (status) {
        case "Active":
          return verified;
        case "Revoked":
          throw new AgentPassError("MandateRevoked", "the registry reports this mandate as revoked", {
            details: { hash: verified.hash },
          });
        case "Unknown":
          throw new AgentPassError("MandateUnknown", "this mandate was never anchored in the registry", {
            details: { hash: verified.hash },
          });
        case "IssuerInactive":
          throw new AgentPassError("IssuerInactive", "the mandate's principal has been deactivated", {
            details: { hash: verified.hash },
          });
      }
    },
  };
}
