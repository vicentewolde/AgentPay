/**
 * The agent's view of its own credential.
 *
 * Verification happens once, at startup, and its outcome decides what the agent
 * can do: an unusable credential means `create_purchase_intent` is never put in
 * the tool set at all (see `tools/tool.ts` on why absence beats refusal).
 *
 * The agent holds a {@link CredentialVerifier}, not the AgentPass SDK. The port
 * has exactly one method, so the agent structurally cannot issue a credential,
 * cannot revoke one, and cannot register an issuer — least privilege enforced
 * by the type, not by remembering not to call those. `AgentPass` from
 * `@agentpass/sdk` satisfies it as-is.
 */
import type { AgentPassCredential, StellarDid } from "@agentpass/core";
import { AgentPassError, credentialHash, isAgentPassError } from "@agentpass/core";

/** What a fully verified credential looks like — the SDK's `verify()` result. */
export interface VerifiedOwnCredential {
  readonly jws: string;
  /** `sha256(jws)`, hex. Computed from the document received, never declared. */
  readonly hash: string;
  readonly credential: AgentPassCredential;
  readonly issuer: StellarDid;
  readonly subject: StellarDid;
}

/**
 * The single capability the agent needs on chain. `AgentPass` satisfies this
 * structurally; a test double needs to implement only this.
 */
export interface CredentialVerifier {
  verify(jws: string, options?: { readonly now?: Date }): Promise<VerifiedOwnCredential>;
}

interface CredentialStateBase {
  /** `sha256(jws)` of the document received. Well-defined even for garbage. */
  readonly hash: string;
  /** When startup ran the check. The state is a snapshot, not a live reading. */
  readonly checkedAt: Date;
}

export interface UsableCredential extends CredentialStateBase {
  readonly usable: true;
  readonly verified: VerifiedOwnCredential;
}

export interface UnusableCredential extends CredentialStateBase {
  readonly usable: false;
  /**
   * Why it is unusable. Always an {@link AgentPassError}: a failure that is not
   * one gets wrapped rather than escaping untyped.
   */
  readonly problem: AgentPassError;
}

export type CredentialState = UsableCredential | UnusableCredential;

/**
 * Runs the three AgentPass checks against the agent's own credential and turns
 * the outcome into a state, never into a thrown error.
 *
 * **Not knowing counts as unusable.** An RPC timeout leaves the on-chain status
 * unknown, and an agent that cannot confirm its authorisation must not act on
 * it — the same fail-closed direction as B-1. The distinction survives in
 * `problem.code`, so the operator can tell a revocation from an outage.
 */
export async function checkOwnCredential(
  verifier: CredentialVerifier,
  jws: string,
  options: { readonly now?: Date } = {},
): Promise<CredentialState> {
  const checkedAt = options.now ?? new Date();

  if (typeof jws !== "string" || jws.length === 0) {
    throw new AgentPassError("ConfigError", "the agent was given no credential to verify", {
      details: { received: typeof jws },
    });
  }

  try {
    const verified = await verifier.verify(jws, { now: checkedAt });
    return { usable: true, hash: verified.hash, verified, checkedAt };
  } catch (error) {
    const problem = isAgentPassError(error)
      ? error
      : new AgentPassError("NetworkError", "the credential could not be checked", {
          cause: error,
        });

    return { usable: false, hash: credentialHash(jws), problem, checkedAt };
  }
}
