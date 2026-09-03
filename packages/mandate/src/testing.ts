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
import { AgentPassError, stellarAddressToDid } from "@agentpass/core";
import type { CredStatus } from "@agentpass/sdk";
import { Keypair, StrKey } from "@stellar/stellar-sdk/base";

import type { RegistryAccess } from "./anchor.js";
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

export interface FakeRegistryAccess extends RegistryAccess {
  /** Test control, not part of {@link RegistryAccess}: seeds an issuer directly. */
  registerIssuer(address: string, active?: boolean): void;
  deactivateIssuer(address: string): void;
  /** What `anchor` actually recorded for `hash` — the contract's own `get_credential`. */
  getCredential(hash: string): { readonly issuer: string; readonly subject: string } | undefined;
}

interface FakeCredRecord {
  readonly issuer: string;
  readonly subject: string;
  readonly expiresAtMs: number;
  revoked: boolean;
}

/**
 * An in-memory {@link RegistryAccess}, faithful to the contract's own rules
 * (`contracts/agent-registry/src/lib.rs`): `anchor` refuses an unregistered or
 * deactivated issuer and a hash already anchored; `revoke` is idempotent;
 * `status` reads revoked before expiry, matching the contract's own priority.
 *
 * Not a mock of `@agentpass/sdk` — nothing here imports it. `RegistryAccess`
 * is a structural port, and this satisfies it directly, the same way a real
 * `AgentPass` does (see the compile-time check in `anchor.test.ts`).
 */
export function createFakeRegistryAccess(
  options: { readonly contractId?: string; readonly now?: () => Date } = {},
): FakeRegistryAccess {
  const contractId = options.contractId ?? TEST_REGISTRY;
  const clock = options.now ?? (() => new Date());
  const issuers = new Map<string, boolean>();
  const creds = new Map<string, FakeCredRecord>();

  return {
    config: { contractId },

    registerIssuer(address: string, active = true): void {
      issuers.set(address, active);
    },

    deactivateIssuer(address: string): void {
      issuers.set(address, false);
    },

    async anchor({ credentialHash, subject, expiresAt, issuer }): Promise<string> {
      const address = issuer.publicKey();
      if (!issuers.has(address)) {
        throw new AgentPassError("IssuerNotRegistered", "issuer is not registered", {
          details: { issuer: address },
        });
      }
      if (issuers.get(address) === false) {
        throw new AgentPassError("IssuerInactive", "issuer has been deactivated", {
          details: { issuer: address },
        });
      }
      if (creds.has(credentialHash)) {
        // The contract's own CredentialAlreadyAnchored is not specially mapped
        // by @agentpass/sdk today — a revert surfaces as a generic transport
        // failure there too (registry.ts's `send()`). Matched here, not improved.
        throw new AgentPassError("NetworkError", "anchor was rejected by the network", {
          details: { reason: "CredentialAlreadyAnchored" },
        });
      }
      creds.set(credentialHash, { issuer: address, subject, expiresAtMs: expiresAt.getTime(), revoked: false });
      return `fake-tx-${credentialHash.slice(0, 8)}`;
    },

    getCredential(hash: string) {
      const record = creds.get(hash);
      return record === undefined ? undefined : { issuer: record.issuer, subject: record.subject };
    },

    async status(hash: string): Promise<CredStatus> {
      const record = creds.get(hash);
      if (record === undefined) return "Unknown";
      if (record.revoked) return "Revoked";
      if (record.expiresAtMs < clock().getTime()) return "Expired";
      return "Active";
    },

    async issuerStatus(address: string): Promise<{ registered: boolean; active: boolean }> {
      if (!issuers.has(address)) return { registered: false, active: false };
      return { registered: true, active: issuers.get(address) === true };
    },

    async revoke({ credentialHash, issuer }): Promise<string> {
      const record = creds.get(credentialHash);
      if (record === undefined) {
        throw new AgentPassError("NetworkError", "revoke was rejected by the network", {
          details: { reason: "CredentialUnknown" },
        });
      }
      if (record.issuer !== issuer.publicKey()) {
        throw new AgentPassError("NetworkError", "revoke was rejected by the network", {
          details: { reason: "NotCredentialIssuer" },
        });
      }
      record.revoked = true;
      return `fake-tx-${credentialHash.slice(0, 8)}`;
    },
  };
}
