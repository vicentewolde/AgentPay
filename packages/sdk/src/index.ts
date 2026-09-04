/**
 * @agentpass/sdk — issue, verify and revoke against a live registry.
 *
 * `core` covers the two offline checks. This package adds the third, the one
 * that makes authorisation revocable from outside the agent: asking the
 * registry whether the credential is still active and its issuer still trusted.
 */
import type { AgentPassCredential, StellarDid, VerifiedCredential } from "@agentpass/core";
import {
  AgentPassError,
  credentialHash,
  didToStellarAddress,
  signCredential,
  verifyCredential,
} from "@agentpass/core";
import type { Keypair } from "@stellar/stellar-sdk";

import type { AgentPassConfig } from "./config.js";
import { parseConfig } from "./config.js";
import type { CredRecord, CredStatus } from "./registry.js";
import { assertTrustedRegistry } from "./guards.js";
import { Registry } from "./registry.js";

export interface IssueParams {
  readonly credential: AgentPassCredential;
  /** Must be the credential's own issuer; `core` refuses otherwise. */
  readonly issuer: Keypair;
}

export interface IssuedCredential {
  /** The compact JWS. This is the credential as it travels. */
  readonly jws: string;
  /** `sha256(jws)`, hex — the key anchored on chain. */
  readonly hash: string;
  readonly credential: AgentPassCredential;
  /** Hash of the transaction that anchored it. */
  readonly transactionHash: string;
}

export interface VerifyOptions {
  /** Injectable clock for the offline validity window. */
  readonly now?: Date;
}

export interface FullyVerifiedCredential extends VerifiedCredential {
  /** Always `"Active"`; anything else has already thrown. */
  readonly status: Extract<CredStatus, "Active">;
  readonly issuerAddress: string;
}

export interface RevokeParams {
  readonly credentialHash: string;
  /** Must be the issuer that anchored it; the contract refuses otherwise. */
  readonly issuer: Keypair;
}

export interface RegisterIssuerParams {
  readonly admin: Keypair;
  /** The issuer's Stellar account address. */
  readonly issuer: string;
  /** 32 bytes of hex identifying the issuer's off-chain metadata. */
  readonly metaHash: string;
}

/**
 * The registry's `anchor()` call, with no document-specific signing bolted on.
 *
 * `issue()` is exactly this plus `signCredential` in front of it — the
 * contract itself never knew what a credential was, only a hash, a subject
 * and an expiry. Exposed on its own so a later phase's document (a Mandate,
 * `M-3`/T20) can anchor through the same registry without this package
 * having to learn that document exists: it hands over a hash, not a type.
 */
export interface AnchorParams {
  readonly credentialHash: string;
  readonly subject: string;
  readonly expiresAt: Date;
  /** Must be the party the anchored hash names as issuer. */
  readonly issuer: Keypair;
}

export interface AgentPass {
  readonly config: AgentPassConfig;
  issue(params: IssueParams): Promise<IssuedCredential>;
  verify(jws: string, options?: VerifyOptions): Promise<FullyVerifiedCredential>;
  revoke(params: RevokeParams): Promise<string>;
  status(hash: string): Promise<CredStatus>;
  /**
   * The full anchored record for a hash — who anchored it, for whom, and
   * when — not just the collapsed four-word `status()`. `undefined` when
   * the hash was never anchored. Same registry call `status()` already
   * makes, one layer less summarised (T30).
   */
  getRecord(hash: string): Promise<CredRecord | undefined>;
  /** Whether an issuer is registered, and whether it is still active. */
  issuerStatus(address: string): Promise<{ registered: boolean; active: boolean }>;
  /** Admin operation, outside the issue/verify/revoke surface. */
  registerIssuer(params: RegisterIssuerParams): Promise<string>;
  deactivateIssuer(params: { admin: Keypair; issuer: string }): Promise<string>;
  /** The raw registry call `issue()` already makes internally. See {@link AnchorParams}. */
  anchor(params: AnchorParams): Promise<string>;
}

function addressOf(did: StellarDid): string {
  return didToStellarAddress(did);
}

export async function createAgentPass(config: unknown): Promise<AgentPass> {
  const parsed = parseConfig(config);
  const registry = await Registry.connect(parsed);

  return {
    config: parsed,

    async issue({ credential, issuer }: IssueParams): Promise<IssuedCredential> {
      assertTrustedRegistry(credential, parsed);

      // core validates the credential and refuses a key that is not its issuer.
      const signed = await signCredential(credential, issuer);

      const transactionHash = await registry.anchor({
        issuer,
        credentialHash: signed.hash,
        subject: addressOf(credential.credentialSubject.id),
        expiresAt: new Date(credential.validUntil),
      });

      return { ...signed, credential, transactionHash };
    },

    /** The three checks, in order: signature, validity window, registry. */
    async verify(jws: string, options: VerifyOptions = {}): Promise<FullyVerifiedCredential> {
      // Checks 1 and 2, offline. Throws InvalidSignature, CredentialExpired or
      // CredentialNotYetValid before any network call is made.
      const verified = await verifyCredential(jws, options);
      assertTrustedRegistry(verified.credential, parsed);

      // Check 3a: is this credential still active on chain?
      const status = await registry.status(verified.hash);
      switch (status) {
        case "Active":
          break;
        case "Revoked":
          throw new AgentPassError("CredentialRevoked", "the registry reports this credential as revoked", {
            details: { hash: verified.hash, registry: parsed.contractId },
          });
        case "Unknown":
          throw new AgentPassError("CredentialUnknown", "this credential was never anchored in the registry", {
            details: { hash: verified.hash, registry: parsed.contractId },
          });
        case "Expired":
          // The signed window said otherwise, so the two disagree. Say so.
          throw new AgentPassError(
            "CredentialExpired",
            "the registry reports this credential as expired, though its signed window has not closed",
            { details: { hash: verified.hash, validUntil: verified.credential.validUntil } },
          );
      }

      // Check 3b: is the issuer still trusted?
      const issuerAddress = addressOf(verified.credential.issuer);
      const issuer = await registry.issuer(issuerAddress);
      if (issuer === undefined) {
        throw new AgentPassError("IssuerNotRegistered", "the credential's issuer is not in the registry", {
          details: { issuerAddress, registry: parsed.contractId },
        });
      }
      if (!issuer.active) {
        throw new AgentPassError("IssuerInactive", "the credential's issuer has been deactivated", {
          details: { issuerAddress, registry: parsed.contractId },
        });
      }

      return { ...verified, status: "Active", issuerAddress };
    },

    async revoke({ credentialHash: hash, issuer }: RevokeParams): Promise<string> {
      return registry.revoke({ issuer, credentialHash: hash });
    },

    async status(hash: string): Promise<CredStatus> {
      return registry.status(hash);
    },

    async getRecord(hash: string): Promise<CredRecord | undefined> {
      return registry.getCredential(hash);
    },

    async issuerStatus(address: string): Promise<{ registered: boolean; active: boolean }> {
      const record = await registry.issuer(address);
      return { registered: record !== undefined, active: record?.active ?? false };
    },

    async registerIssuer(params: RegisterIssuerParams): Promise<string> {
      return registry.registerIssuer(params);
    },

    async deactivateIssuer(params: { admin: Keypair; issuer: string }): Promise<string> {
      return registry.deactivateIssuer(params);
    },

    async anchor(params: AnchorParams): Promise<string> {
      return registry.anchor({
        issuer: params.issuer,
        credentialHash: params.credentialHash,
        subject: params.subject,
        expiresAt: params.expiresAt,
      });
    },
  };
}

export { credentialHash };
export { assertTrustedRegistry, credentialHashToBytes } from "./guards.js";
export { CRED_STATUSES, type CredRecord, type CredStatus } from "./registry.js";
export {
  agentPassConfigSchema,
  configFromEnv,
  parseConfig,
  type AgentPassConfig,
} from "./config.js";
