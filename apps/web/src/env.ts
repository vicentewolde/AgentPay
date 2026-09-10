/**
 * Reading configuration, and refusing it clearly when it is wrong.
 *
 * Extracted from `server.ts` in T36 for one reason: two of the three failures
 * that broke T35 on the live deploy were here, and none of it had a single
 * test. Nothing in this module touches the network or the session state, so
 * all of it is testable without either.
 */
import { readFile } from "node:fs/promises";

import { AgentPassError } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";

/**
 * A read-only subset of `scripts/lib/env-file.ts`'s `.env` parser, duplicated
 * rather than imported: `apps/web` and `scripts/` sit in separate TypeScript
 * project-reference graphs (`tsc -b`'s composite build vs.
 * `tsconfig.scripts.json`'s standalone one), so a cross-import would put a
 * file outside this project's `rootDir`. The format (`KEY="value"`, `#`
 * comments) is small enough that copying it is cheaper than restructuring
 * either build.
 */
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

export function unquoteEnvValue(raw: string): string {
  const value = raw.trim();
  const first = value[0];
  const quoted = value.length >= 2 && (first === '"' || first === "'") && value[value.length - 1] === first;
  if (!quoted) return value;
  const inner = value.slice(1, -1);
  return first === '"' ? inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\") : inner;
}

export async function readEnvFile(path: string): Promise<Map<string, string>> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw new AgentPassError("ConfigError", `could not read ${path}`, { cause: error, details: { path } });
  }
  const entries = new Map<string, string>();
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = ENV_LINE.exec(line);
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;
    entries.set(key, unquoteEnvValue(rawValue));
  }
  return entries;
}

/**
 * `.env.local` is how local dev sets secrets (per the project's own
 * convention — see CLAUDE.md). Render, and any other host that injects
 * config straight into the process, has no such file on disk: it sets
 * `process.env` instead. Fall back to it for any key the file doesn't
 * have, so the same code works in both places.
 */
export async function readEnv(path: string, processEnv: NodeJS.ProcessEnv = process.env): Promise<Map<string, string>> {
  const env = new Map(await readEnvFile(path));
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined && !env.has(key)) env.set(key, value);
  }
  return env;
}

export function requireEnv(env: ReadonlyMap<string, string>, key: string): string {
  const value = env.get(key);
  if (value === undefined || value === "") {
    throw new AgentPassError("ConfigError", `${key} is missing from .env.local and process.env`, {
      details: { fix: "run `pnpm run bootstrap` and `pnpm run deploy:registry` first, or set it as an env var", key },
    });
  }
  return value;
}

/**
 * Every Stellar secret this server reads from the environment goes through
 * here. Handed a public key (`G...`) where a secret seed (`S...`) belongs,
 * `Keypair.fromSecret` throws a raw strkey error — "invalid version byte.
 * expected 144, got 48" — that names neither the variable at fault nor what
 * to do about it. That is exactly what the live deploy showed the first time
 * `ADMIN_SECRET_KEY` was set, so the version bytes stay inside the SDK and
 * the operator gets the variable's name and the fix instead.
 */
export function requireSecretKey(env: ReadonlyMap<string, string>, key: string): Keypair {
  const value = requireEnv(env, key);
  try {
    return Keypair.fromSecret(value);
  } catch (error) {
    throw new AgentPassError(
      "ConfigError",
      `${key} must be an S... secret seed, not a G... address — the value set for it is not a Stellar secret key`,
      { cause: error, details: { key, startsWith: `${value.slice(0, 1)}...` } },
    );
  }
}
