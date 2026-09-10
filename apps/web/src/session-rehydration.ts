/**
 * The one decision T39 exists to make correctly: given what the directory
 * already knows about a tenant, does starting a session reuse what is
 * already signed and anchored, or does it have to issue and anchor fresh
 * documents?
 *
 * Pure, no network, no clock — same discipline `checkMandate` and
 * `checkScope` already follow, for the same reason: the one function whose
 * answer decides "issue new documents or don't" is exactly the kind of logic
 * that most benefits from being testable without a server, a database or
 * testnet.
 *
 * **What this is not.** It is not a trust boundary. Whether a mandate is
 * still genuinely valid — not revoked on chain, not expired, signed by the
 * principal it claims — is decided at *purchase* time by
 * `createOnChainMandateVerifier` and `checkMandate`/`checkScope`, exactly as
 * before T39. This module only decides whether starting a session gets to
 * skip a redundant `issue()` + `anchorMandate()` round trip against testnet.
 * A row here that is stale relative to the chain (revoked out-of-band,
 * somehow) costs nothing new: the purchase path already refuses it, the same
 * way it always has.
 */
import type { CredentialRecord, MandateRecord } from "@agentpay/directory";

export type RehydrationDecision =
  | {
      readonly kind: "rehydrate";
      readonly credential: CredentialRecord;
      readonly mandate: MandateRecord;
    }
  | {
      readonly kind: "issue";
      /** The mandate a fresh one should name as `supersedesId`, if this tenant has one at all. */
      readonly supersedes: MandateRecord | undefined;
    };

export interface RehydrationInputs {
  /** The tenant's most recently recorded credential, if it has one. */
  readonly latestCredential: CredentialRecord | undefined;
  /** The tenant's mandates that are neither revoked nor outside their validity window right now. */
  readonly activeMandates: readonly MandateRecord[];
  /** The tenant's most recently recorded mandate, active or not — for `supersedesId` chaining. */
  readonly latestMandate: MandateRecord | undefined;
  /**
   * The agent identity a fresh session would use right now — this tenant's
   * own current `directory_agents` row id (`ensureTenantAgent`'s
   * `instance.id`, F4/T40). Rehydration only ever reuses a credential or
   * mandate that already names *this* agent; one that names anything else is
   * stale relative to the identity a session would use today and is treated
   * exactly like one with no record at all.
   *
   * This field earned its place the hard way, not by design: pre-F4, every
   * tenant's rows shared one `agentId` (`C-33`) — `latestCredential.agentId
   * === mostRecentActive.agentId` was the whole check, and it happened to be
   * true for everyone. The first real F4 session found a pre-F4 record whose
   * `agentId` was the *shared payer's* row, rehydrated it anyway (the two
   * still agreed with each other), and handed `finishSession` a document
   * whose subject was the shared key alongside a signer that was this
   * tenant's brand-new derived key — `createAgent()`'s own fail-closed
   * subject/signer check caught it immediately (`SignerMismatch`), but the
   * right fix is not letting a stale identity reach that check to begin with.
   */
  readonly currentAgentId: string;
}

/**
 * Decides whether a session can be rehydrated from what the directory
 * already holds for this tenant, or must issue fresh documents.
 *
 * Rehydration requires all three: a credential on file that is not revoked,
 * at least one active mandate, and — the check both name — that both name
 * `currentAgentId`. A credential or mandate from before this tenant had its
 * own identity, or from before an identity change of any kind, is never
 * eligible: it is treated the same as no record at all, falling through to
 * `"issue"` and chaining `supersedesId` to whatever was most recently
 * recorded, even if that record's own identity has since changed. The
 * renewal is the correct outcome either way — a routine one (this tenant's
 * mandate expired or was revoked) or a migration (the identity scheme
 * itself changed underneath it, as F4 did) look identical from here, and
 * both are handled by issuing fresh documents.
 *
 * A tenant with more than one active mandate for the current agent — which
 * should not happen under normal operation, since starting a new one is
 * exactly what this function exists to avoid — rehydrates the most recently
 * issued one rather than refusing outright: refusing would turn a data
 * anomaly into an outage for a UX-only decision, and the security-relevant
 * checks live elsewhere (see the module docstring).
 */
export function decideRehydration(inputs: RehydrationInputs): RehydrationDecision {
  const { latestCredential, activeMandates, latestMandate, currentAgentId } = inputs;

  if (latestCredential !== undefined && latestCredential.revokedAt === null && latestCredential.agentId === currentAgentId) {
    const mostRecentActive = activeMandates
      .filter((mandate) => mandate.agentId === currentAgentId)
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
    if (mostRecentActive !== undefined) {
      return { kind: "rehydrate", credential: latestCredential, mandate: mostRecentActive };
    }
  }

  return { kind: "issue", supersedes: latestMandate };
}
