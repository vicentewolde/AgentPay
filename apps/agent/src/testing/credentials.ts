/**
 * Test helpers: real credentials, simulated chain.
 *
 * Signing and the two offline checks run for real — the same `signCredential`
 * and `verifyCredential` the product uses, over genuine Ed25519 keys. Only the
 * third check, the registry lookup, is simulated, because that is the one that
 * needs a network. A double that faked the signature too would prove nothing.
 *
 * Not exported from the package index: this exists for tests.
 */
import type { AgentPassCredential, Scope } from "@agentpass/core";
import {
  AgentPassError,
  signCredential,
  stellarAddressToDid,
  verifyCredential,
} from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk/base";

import type { CredentialVerifier, VerifiedOwnCredential } from "../credential/verifier.js";
import { MOCK_VENUE_ID, USDC_TESTNET } from "../catalog/mock.js";

/** A registry contract id for tests. Well-formed, deliberately not deployed. */
export const TEST_REGISTRY = "CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";

/** The pilot's scope: this venue, this asset, 50.00 per transaction. */
export const PILOT_SCOPE: Scope = {
  actions: ["catalog:read", "intent:create"],
  venues: [MOCK_VENUE_ID],
  assets: [USDC_TESTNET],
  limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" },
};

export interface TestCredentialOptions {
  readonly scope?: Scope;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly registry?: string;
  readonly issuer?: Keypair;
  readonly subject?: Keypair;
}

export interface TestCredential {
  readonly jws: string;
  readonly hash: string;
  readonly credential: AgentPassCredential;
  readonly issuerKeypair: Keypair;
  readonly subjectKeypair: Keypair;
}

/** Builds and signs a credential with real keys. No network. */
export async function makeTestCredential(
  options: TestCredentialOptions = {},
): Promise<TestCredential> {
  const issuerKeypair = options.issuer ?? Keypair.random();
  const subjectKeypair = options.subject ?? Keypair.random();
  const issuerDid = stellarAddressToDid(issuerKeypair.publicKey(), "testnet");

  const credential: AgentPassCredential = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "AgentPassCredential"],
    issuer: issuerDid,
    validFrom: options.validFrom ?? "2026-01-01T00:00:00.000Z",
    validUntil: options.validUntil ?? "2027-01-01T00:00:00.000Z",
    credentialSubject: {
      id: stellarAddressToDid(subjectKeypair.publicKey(), "testnet"),
      agent: { name: "compras-demo", model: "claude-opus-5", operator: "agentpay-pilot" },
      principal: issuerDid,
      scope: options.scope ?? PILOT_SCOPE,
    },
    credentialStatus: {
      type: "AgentPassRegistry2026",
      registry: options.registry ?? TEST_REGISTRY,
    },
  };

  const signed = await signCredential(credential, issuerKeypair);
  return { ...signed, credential, issuerKeypair, subjectKeypair };
}

/** What the simulated registry answers for a credential hash. */
export type SimulatedStatus = "Active" | "Revoked" | "Unknown" | "IssuerInactive";

export interface StubVerifierOptions {
  /** Defaults to `"Active"`. */
  readonly status?: SimulatedStatus;
  /** Throw this instead of consulting the simulated registry — e.g. an outage. */
  readonly failWith?: unknown;
}

/**
 * A {@link CredentialVerifier} that runs the two offline checks for real and
 * simulates only the registry lookup.
 */
export function createStubVerifier(options: StubVerifierOptions = {}): CredentialVerifier {
  const status = options.status ?? "Active";

  return {
    async verify(jws: string, verifyOptions = {}): Promise<VerifiedOwnCredential> {
      // Checks 1 and 2, for real: signature, then the validity window.
      const verified = await verifyCredential(jws, verifyOptions);

      if (options.failWith !== undefined) throw options.failWith;

      // Check 3, simulated.
      switch (status) {
        case "Active":
          return verified;
        case "Revoked":
          throw new AgentPassError(
            "CredentialRevoked",
            "the registry reports this credential as revoked",
            { details: { hash: verified.hash } },
          );
        case "Unknown":
          throw new AgentPassError(
            "CredentialUnknown",
            "this credential was never anchored in the registry",
            { details: { hash: verified.hash } },
          );
        case "IssuerInactive":
          throw new AgentPassError(
            "IssuerInactive",
            "the credential's issuer has been deactivated",
            { details: { hash: verified.hash } },
          );
      }
    },
  };
}
