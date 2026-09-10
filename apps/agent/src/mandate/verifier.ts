/**
 * The agent's view of its own Mandate — the same discipline T11 established
 * for its credential, applied to the principal's consent.
 *
 * Verification happens twice: once at startup, deciding whether
 * `create_purchase_intent` exists at all, and once more immediately before
 * every signature, the same B-17 reasoning extended to the mandate: signing
 * against a mandate last seen hours ago would put the agent's signature on
 * consent the principal may have withdrawn since.
 *
 * The agent holds a {@link MandateVerifier}, not `@agentpay/mandate`'s full
 * anchor/verify/revoke surface — the port has exactly one method, so the
 * agent structurally cannot anchor a mandate or revoke one. `createOnChainMandateVerifier`
 * below is the one place that closes over a live registry to satisfy it.
 *
 * T35 widens what a mandate *is*, without touching either paragraph above: a
 * `MandateSource` is a JWS (a platform-held key signed it, `sign.ts`) or a
 * `{ mandate, signature }` pair (a connected wallet signed it, SEP-0053,
 * `wallet-sign.ts`) — the two are not interchangeable byte-for-byte, but
 * `checkOwnMandate` and everything downstream of it only ever look at the
 * `VerifiedOwnMandate` shape both paths produce, so nothing past this file
 * needs to know which kind of document it is holding.
 */
import type {
  AgentPayMandate,
  RegistryAccess,
  VerifyMandateOptions,
  VerifyWalletSignedMandateOptions,
} from "@agentpay/mandate";
import { mandateHash, verifyMandateOnChain, verifyWalletSignedMandateOnChain, walletMandateHash } from "@agentpay/mandate";
import type { StellarDid } from "@agentpass/core";
import { AgentPassError, isAgentPassError } from "@agentpass/core";

/** A JWS (platform-signed) or a wallet's SEP-0053 signature over a plain mandate document — T35. */
export type MandateSource = string | { readonly mandate: AgentPayMandate; readonly signature: string };

function hashOf(source: MandateSource): string {
  return typeof source === "string" ? mandateHash(source) : walletMandateHash(source.mandate);
}

/** What a fully verified mandate looks like — the on-chain check's result. */
export interface VerifiedOwnMandate {
  /** Re-verify against this later (the B-17/T35 freshness re-check) — a JWS, or the wallet pair that produced this result. */
  readonly source: MandateSource;
  /** `sha256(...)`, hex. Computed from the document received, never declared. */
  readonly hash: string;
  readonly mandate: AgentPayMandate;
  readonly principal: StellarDid;
  readonly agent: StellarDid;
}

/**
 * The single capability the agent needs on chain for its mandate.
 * `verifyMandateOnChain`/`verifyWalletSignedMandateOnChain` bound to a live
 * registry satisfy this.
 */
export interface MandateVerifier {
  verify(source: MandateSource, options?: VerifyMandateOptions & VerifyWalletSignedMandateOptions): Promise<VerifiedOwnMandate>;
}

/** Wires the two on-chain checks to a live registry, as a narrow `MandateVerifier`. */
export function createOnChainMandateVerifier(registry: RegistryAccess): MandateVerifier {
  return {
    async verify(source, options) {
      if (typeof source === "string") {
        const verified = await verifyMandateOnChain(registry, source, options);
        return { source, hash: verified.hash, mandate: verified.mandate, principal: verified.principal, agent: verified.agent };
      }
      const verified = await verifyWalletSignedMandateOnChain(registry, source.mandate, source.signature, options);
      return { source, hash: verified.hash, mandate: verified.mandate, principal: verified.principal, agent: verified.agent };
    },
  };
}

interface MandateStateBase {
  /** `sha256(jws)` of the document received. Well-defined even for garbage. */
  readonly hash: string;
  /** When this check ran. The state is a snapshot, not a live reading. */
  readonly checkedAt: Date;
}

export interface UsableMandate extends MandateStateBase {
  readonly usable: true;
  readonly verified: VerifiedOwnMandate;
}

export interface UnusableMandate extends MandateStateBase {
  readonly usable: false;
  /** Always an {@link AgentPassError}: a failure that is not one gets wrapped. */
  readonly problem: AgentPassError;
}

export type MandateState = UsableMandate | UnusableMandate;

/**
 * Runs the full on-chain mandate check and turns the outcome into a state,
 * never into a thrown error — same shape as `checkOwnCredential`.
 *
 * **Not knowing counts as unusable.** An RPC timeout leaves the mandate's
 * on-chain status unknown, and an agent that cannot confirm the principal's
 * consent must not act on it — same fail-closed direction as `B-1`.
 */
export async function checkOwnMandate(
  verifier: MandateVerifier,
  source: MandateSource,
  options: { readonly now?: Date } = {},
): Promise<MandateState> {
  const checkedAt = options.now ?? new Date();

  const empty = typeof source === "string" ? source.length === 0 : source.mandate === undefined;
  if (empty) {
    throw new AgentPassError("ConfigError", "the agent was given no mandate to verify", {
      details: { received: typeof source },
    });
  }

  try {
    const verified = await verifier.verify(source, { now: checkedAt });
    return { usable: true, hash: verified.hash, verified, checkedAt };
  } catch (error) {
    const problem = isAgentPassError(error)
      ? error
      : new AgentPassError("NetworkError", "the mandate could not be checked", { cause: error });

    return { usable: false, hash: hashOf(source), problem, checkedAt };
  }
}
