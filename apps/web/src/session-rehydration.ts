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
}

/**
 * Decides whether a session can be rehydrated from what the directory
 * already holds for this tenant, or must issue fresh documents.
 *
 * Rehydration requires all three: a credential on file, at least one active
 * mandate, and — the check that actually matters — that credential and that
 * mandate name the **same agent**. Before F4 gives each tenant its own
 * Stellar identity, every tenant's rows share one `agentId` by construction
 * (`C-33`), so this comparison is trivially true today; it stays correct
 * once F4 makes it meaningful, without this function changing at all.
 *
 * A tenant with more than one active mandate — which should not happen
 * under normal operation, since starting a new one is exactly what this
 * function exists to avoid — rehydrates the most recently issued one rather
 * than refusing outright: refusing would turn a data anomaly into an outage
 * for a UX-only decision, and the security-relevant checks live elsewhere
 * (see the module docstring).
 */
export function decideRehydration(inputs: RehydrationInputs): RehydrationDecision {
  const { latestCredential, activeMandates, latestMandate } = inputs;

  if (latestCredential !== undefined && latestCredential.revokedAt === null && activeMandates.length > 0) {
    const mostRecentActive = [...activeMandates].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
    if (mostRecentActive !== undefined && mostRecentActive.agentId === latestCredential.agentId) {
      return { kind: "rehydrate", credential: latestCredential, mandate: mostRecentActive };
    }
  }

  return { kind: "issue", supersedes: latestMandate };
}
