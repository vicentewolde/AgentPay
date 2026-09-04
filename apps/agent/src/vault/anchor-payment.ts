/**
 * Anchoring a settled payment's evidence on-chain — Fase 5, T28.
 *
 * T27 made every `PolicyRail` decision durable and hash-chained, off-chain.
 * What it could not do (`V-3`, Fase 5): put any of that on Stellar, because
 * `@x402/stellar` builds and signs the payment transaction entirely inside
 * the package, with no memo parameter exposed — there is no way to reference
 * a `VaultRecord` from *inside* the payment transaction itself.
 *
 * This is the companion transaction `V-3` proposed instead: a **separate**
 * transaction, built and signed entirely by this code, that anchors a hash
 * committing to both the vault's record of the decision and the payment's
 * own transaction hash — against `agent_registry`, reusing `anchor()`
 * exactly as T20 already does for credentials and mandates. No new
 * contract. Once anchored, anyone holding the `VaultRecord` (from the vault
 * file) and the payment's transaction hash (from Horizon) can recompute
 * {@link paymentLinkHash} and confirm the registry actually anchored it —
 * proof that does not require trusting whoever operates the vault file.
 */
import type { CredStatus } from "@agentpass/sdk";
import type { Keypair } from "@stellar/stellar-sdk/base";
import { createHash } from "node:crypto";

import type { VaultRecord } from "@agentpay/vault";

/** The one capability this module needs — `AgentPass.anchor()`'s own shape (T20's `RegistryAccess` pattern). */
export interface RegistryAnchor {
  anchor(params: {
    readonly credentialHash: string;
    readonly subject: string;
    readonly expiresAt: Date;
    readonly issuer: Keypair;
  }): Promise<string>;
}

/** The other half `RegistryAnchor` does not need: reading back what a hash's status is. */
export interface RegistryAnchorStatus {
  status(hash: string): Promise<CredStatus>;
}

/**
 * `sha256(record.hash + ":" + paymentTx)` — the one value that exists only
 * because both the decision *and* the payment happened. Neither half alone
 * can produce it: a vault record from a purchase that was never paid, or a
 * payment transaction that was never authorised, would each recompute a
 * different hash than what got anchored for a real, paid, authorised
 * purchase.
 */
export function paymentLinkHash(record: VaultRecord, paymentTx: string): string {
  return createHash("sha256").update(`${record.hash}:${paymentTx}`, "utf8").digest("hex");
}

export interface AnchorPaymentDecisionParams {
  /** The vault's `granted` record for the intent this payment settled. */
  readonly record: VaultRecord;
  /** The Stellar transaction hash the payment itself settled as. */
  readonly paymentTx: string;
  /** The agent's own Stellar address — same subject credentials and mandates already anchor under. */
  readonly subject: string;
  readonly expiresAt: Date;
  /** Must already be a registered, active issuer in the registry — same key that anchors mandates (`M-17`). */
  readonly issuer: Keypair;
}

export interface AnchoredPaymentDecision {
  readonly linkHash: string;
  /** The transaction hash of the anchoring call itself — distinct from `paymentTx`. */
  readonly transactionHash: string;
}

/**
 * Anchors {@link paymentLinkHash} against the registry.
 *
 * @throws AgentPassError `IssuerNotRegistered` / `IssuerInactive` — the
 * registry's own refusal, surfaced through `registry.anchor()`, same as
 * `anchorMandate` (T20).
 */
export async function anchorPaymentDecision(
  registry: RegistryAnchor,
  params: AnchorPaymentDecisionParams,
): Promise<AnchoredPaymentDecision> {
  const linkHash = paymentLinkHash(params.record, params.paymentTx);
  const transactionHash = await registry.anchor({
    credentialHash: linkHash,
    subject: params.subject,
    expiresAt: params.expiresAt,
    issuer: params.issuer,
  });
  return { linkHash, transactionHash };
}

/**
 * Recomputes {@link paymentLinkHash} from a vault record and a payment
 * transaction hash held independently, and asks the registry what it knows
 * about that exact hash — the verification side of `anchorPaymentDecision`,
 * usable by anyone who trusts the registry but not whoever ran the vault.
 */
export async function verifyPaymentAnchor(
  registry: RegistryAnchorStatus,
  record: VaultRecord,
  paymentTx: string,
): Promise<{ readonly linkHash: string; readonly status: CredStatus }> {
  const linkHash = paymentLinkHash(record, paymentTx);
  const status = await registry.status(linkHash);
  return { linkHash, status };
}
