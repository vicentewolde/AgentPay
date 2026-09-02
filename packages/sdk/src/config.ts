import { AgentPassError, STELLAR_NETWORKS, stellarContractIdSchema } from "@agentpass/core";
import { z } from "zod";

/**
 * What the SDK needs to reach a registry. The contract id is the verifier's
 * own choice of which registry it trusts — see `verify` in index.ts, which
 * rejects a credential naming a different one.
 */
export const agentPassConfigSchema = z.strictObject({
  contractId: stellarContractIdSchema,
  rpcUrl: z.url(),
  networkPassphrase: z.string().min(1),
  network: z.enum(STELLAR_NETWORKS),
});

export type AgentPassConfig = z.infer<typeof agentPassConfigSchema>;

export function parseConfig(input: unknown): AgentPassConfig {
  const parsed = agentPassConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new AgentPassError("ConfigError", "invalid AgentPass configuration", {
      details: { issues: z.treeifyError(parsed.error) },
    });
  }
  return parsed.data;
}

/**
 * Builds a config from environment variables, the shape `pnpm run bootstrap`
 * and `pnpm run deploy:registry` write into `.env.local`.
 */
export function configFromEnv(env: Record<string, string | undefined> = process.env): AgentPassConfig {
  return parseConfig({
    contractId: env["AGENT_REGISTRY_CONTRACT_ID"] ?? "",
    rpcUrl: env["STELLAR_RPC_URL"] ?? "",
    networkPassphrase: env["STELLAR_NETWORK_PASSPHRASE"] ?? "",
    network: env["STELLAR_NETWORK"] ?? "",
  });
}
