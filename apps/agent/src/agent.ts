/**
 * Starting the agent.
 *
 * One thing happens here that decides everything else: the agent's own
 * credential is verified, and the outcome shapes its tool set. There is no
 * separate "am I allowed?" check inside the tools to forget, get wrong, or
 * talk out of — the capability either exists or it does not.
 */
import { AgentPassError, didToStellarAddress } from "@agentpass/core";
import type { Keypair } from "@stellar/stellar-sdk/base";

import type { CatalogAdapter } from "./catalog/catalog.js";
import type { CredentialState, CredentialVerifier } from "./credential/verifier.js";
import { checkOwnCredential } from "./credential/verifier.js";
import { createAgentTools } from "./tools/agent-tools.js";
import type { ToolSet } from "./tools/tool.js";

export interface AgentConfig {
  /** The agent's own AgentPass credential, as a compact JWS. */
  readonly credential: string;
  readonly catalog: CatalogAdapter;
  /**
   * Verifies the credential against the registry. `AgentPass` from
   * `@agentpass/sdk` satisfies this; the narrow port is what keeps the agent
   * from being able to issue or revoke anything.
   */
  readonly verifier: CredentialVerifier;
  /**
   * The agent's own Stellar key — the one its credential names as the subject.
   * Without it nothing can be signed, so `create_purchase_intent` is withheld
   * rather than advertised and then failing.
   */
  readonly signer?: Keypair;
  /** How long a signed intent stays valid. Defaults to 15 minutes. */
  readonly intentTtlSeconds?: number;
  /** Injectable clock, for the validity window. */
  readonly now?: Date;
}

export interface Agent {
  /** Exactly what this agent can do, given what its credential turned out to be. */
  readonly tools: ToolSet;
  /** The startup check's outcome, kept so callers can report it without re-running it. */
  readonly credential: CredentialState;
}

/**
 * Verifies the credential, then builds the tool set that outcome allows.
 *
 * A failed check does **not** stop the agent from starting. It starts able to
 * read the catalogue and to say why it cannot buy — which is the behaviour the
 * phase's demo needs after a revocation, and a good deal more useful than a
 * process that dies with a stack trace.
 *
 * @throws AgentPassError `ConfigError` when the configuration itself is unusable.
 */
export async function createAgent(config: AgentConfig): Promise<Agent> {
  if (config === null || typeof config !== "object") {
    throw new AgentPassError("ConfigError", "createAgent needs a configuration object", {
      details: { received: typeof config },
    });
  }
  if (typeof config.credential !== "string" || config.credential.length === 0) {
    throw new AgentPassError("ConfigError", "the agent needs its credential as a compact JWS", {
      details: { received: typeof config.credential },
    });
  }
  if (typeof config.verifier?.verify !== "function") {
    throw new AgentPassError("ConfigError", "the agent needs a credential verifier", {});
  }
  if (typeof config.catalog?.listProducts !== "function") {
    throw new AgentPassError("ConfigError", "the agent needs a catalogue adapter", {});
  }

  const credential = await checkOwnCredential(config.verifier, config.credential, {
    now: config.now,
  });

  // A key that is not the credential's subject would sign intents that can
  // never verify against it. That is a misconfiguration, not a policy state, so
  // it is loud and immediate rather than a quietly withheld capability.
  if (config.signer !== undefined && credential.usable) {
    const subject = credential.verified.credential.credentialSubject.id;
    if (didToStellarAddress(subject) !== config.signer.publicKey()) {
      throw new AgentPassError(
        "SignerMismatch",
        "the signing key is not the subject of the agent's own credential",
        { details: { subject, signer: config.signer.publicKey() } },
      );
    }
  }

  return {
    credential,
    tools: createAgentTools({
      catalog: config.catalog,
      credential,
      signer: config.signer,
      verifier: config.verifier,
      intentTtlSeconds: config.intentTtlSeconds,
      now: config.now,
    }),
  };
}
