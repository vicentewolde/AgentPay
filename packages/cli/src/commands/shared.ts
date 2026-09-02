import { AgentPassError } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";

/** Shared by `issue` and `revoke`, the pilot's only two issuer-signed operations. */
export function requireIssuerKeypair(env: Record<string, string>): Keypair {
  const secret = env["ISSUER_SECRET_KEY"];
  if (secret === undefined || secret === "") {
    throw new AgentPassError("ConfigError", "ISSUER_SECRET_KEY is missing from .env.local", {
      details: { fix: "run `pnpm run bootstrap` first" },
    });
  }
  try {
    return Keypair.fromSecret(secret);
  } catch (error) {
    throw new AgentPassError("ConfigError", "ISSUER_SECRET_KEY is not a valid Stellar secret seed", {
      cause: error,
    });
  }
}
