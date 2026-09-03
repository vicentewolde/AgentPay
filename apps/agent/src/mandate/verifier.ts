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
 */
import type { AgentPayMandate, RegistryAccess, VerifyMandateOptions } from "@agentpay/mandate";
import { mandateHash, verifyMandateOnChain } from "@agentpay/mandate";
import type { StellarDid } from "@agentpass/core";
import { AgentPassError, isAgentPassError } from "@agentpass/core";

/** What a fully verified mandate looks like — the on-chain check's result. */
export interface VerifiedOwnMandate {
  readonly jws: string;
  /** `sha256(jws)`, hex. Computed from the document received, never declared. */
  readonly hash: string;
  readonly mandate: AgentPayMandate;
  readonly principal: StellarDid;
  readonly agent: StellarDid;
}

/**
 * The single capability the agent needs on chain for its mandate.
 * `verifyMandateOnChain` bound to a live registry satisfies this.
 */
export interface MandateVerifier {
  verify(jws: string, options?: VerifyMandateOptions): Promise<VerifiedOwnMandate>;
}

/** Wires `verifyMandateOnChain` to a live registry, as a narrow `MandateVerifier`. */
export function createOnChainMandateVerifier(registry: RegistryAccess): MandateVerifier {
  return {
    verify: (jws, options) => verifyMandateOnChain(registry, jws, options),
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
  jws: string,
  options: { readonly now?: Date } = {},
): Promise<MandateState> {
  const checkedAt = options.now ?? new Date();

  if (typeof jws !== "string" || jws.length === 0) {
    throw new AgentPassError("ConfigError", "the agent was given no mandate to verify", {
      details: { received: typeof jws },
    });
  }

  try {
    const verified = await verifier.verify(jws, { now: checkedAt });
    return { usable: true, hash: verified.hash, verified, checkedAt };
  } catch (error) {
    const problem = isAgentPassError(error)
      ? error
      : new AgentPassError("NetworkError", "the mandate could not be checked", { cause: error });

    return { usable: false, hash: mandateHash(jws), problem, checkedAt };
  }
}
