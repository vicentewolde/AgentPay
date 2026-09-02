import { AgentPassError } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";

import { formatEnvLine } from "./env-file.js";
import { TESTNET } from "./network.js";

export const ROLES = [
  { id: "ADMIN", label: "admin", purpose: "registry admin — register_issuer / deactivate_issuer" },
  { id: "ISSUER", label: "issuer", purpose: "signs credentials and anchors their hashes" },
  { id: "AGENT", label: "agent", purpose: "subject of the demo credential" },
] as const;

export type Role = (typeof ROLES)[number];
export type KeyOrigin = "reused" | "generated";

export interface ResolvedRole {
  readonly role: Role;
  readonly keypair: Keypair;
  readonly origin: KeyOrigin;
}

/** Keys bootstrap owns and rewrites. Anything else in .env.local is carried over verbatim. */
export const MANAGED_KEYS: ReadonlySet<string> = new Set([
  "STELLAR_NETWORK",
  "STELLAR_RPC_URL",
  "STELLAR_HORIZON_URL",
  "STELLAR_NETWORK_PASSPHRASE",
  "STELLAR_FRIENDBOT_URL",
  "AGENT_REGISTRY_CONTRACT_ID",
  ...ROLES.flatMap((role) => [`${role.id}_PUBLIC_KEY`, `${role.id}_SECRET_KEY`]),
]);

/**
 * Reuses the stored secret when there is one, otherwise mints a fresh keypair.
 * This is what makes `pnpm run bootstrap` idempotent.
 */
export function resolveKeypair(role: Role, env: ReadonlyMap<string, string>): ResolvedRole {
  const secret = env.get(`${role.id}_SECRET_KEY`)?.trim() ?? "";
  const storedPublic = env.get(`${role.id}_PUBLIC_KEY`)?.trim() ?? "";

  if (secret === "") {
    if (storedPublic !== "") {
      throw new AgentPassError(
        "ConfigError",
        `${role.id}_PUBLIC_KEY is set but ${role.id}_SECRET_KEY is empty — that key cannot sign`,
        { details: { role: role.id, publicKey: storedPublic } },
      );
    }
    return { role, keypair: Keypair.random(), origin: "generated" };
  }

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(secret);
  } catch (error) {
    throw new AgentPassError(
      "ConfigError",
      `${role.id}_SECRET_KEY is not a valid Stellar secret seed`,
      { cause: error, details: { role: role.id } },
    );
  }

  if (storedPublic !== "" && storedPublic !== keypair.publicKey()) {
    throw new AgentPassError(
      "ConfigError",
      `${role.id}_PUBLIC_KEY does not match the account derived from ${role.id}_SECRET_KEY`,
      { details: { role: role.id, stored: storedPublic, derived: keypair.publicKey() } },
    );
  }

  return { role, keypair, origin: "reused" };
}

/**
 * Renders the whole `.env.local`. Values bootstrap does not own — the contract
 * id from deploy:registry, anything a human added — survive the rewrite.
 */
export function renderEnvLocal(
  resolved: readonly ResolvedRole[],
  existing: ReadonlyMap<string, string>,
  now: Date,
): string {
  const lines: string[] = [
    `# Written by \`pnpm run bootstrap\` at ${now.toISOString()}.`,
    "# Contains secret seeds. Never commit this file — .gitignore already covers it.",
    "# Re-running bootstrap reuses every key below.",
    "",
    formatEnvLine("STELLAR_NETWORK", TESTNET.network),
    formatEnvLine("STELLAR_RPC_URL", TESTNET.rpcUrl),
    formatEnvLine("STELLAR_HORIZON_URL", TESTNET.horizonUrl),
    formatEnvLine("STELLAR_NETWORK_PASSPHRASE", TESTNET.passphrase),
    formatEnvLine("STELLAR_FRIENDBOT_URL", TESTNET.friendbotUrl),
  ];

  for (const { role, keypair } of resolved) {
    lines.push("", `# ${role.purpose}`);
    lines.push(formatEnvLine(`${role.id}_PUBLIC_KEY`, keypair.publicKey()));
    lines.push(formatEnvLine(`${role.id}_SECRET_KEY`, keypair.secret()));
  }

  lines.push("", "# Written by `pnpm run deploy:registry`.");
  lines.push(
    formatEnvLine("AGENT_REGISTRY_CONTRACT_ID", existing.get("AGENT_REGISTRY_CONTRACT_ID") ?? ""),
  );

  const carried = [...existing].filter(([key]) => !MANAGED_KEYS.has(key));
  if (carried.length > 0) {
    lines.push("", "# Carried over from the previous .env.local — bootstrap does not own these.");
    for (const [key, value] of carried) lines.push(formatEnvLine(key, value));
  }

  return `${lines.join("\n")}\n`;
}
