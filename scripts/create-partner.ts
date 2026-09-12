#!/usr/bin/env node
/**
 * `pnpm run partner:create -- --name "CloudOps"` — mints a `Partner` row and
 * issues its first `/v1` API key.
 *
 * An operator script, not an HTTP route, by design: there is no partner
 * onboarding UI in this alcance (`PLATAFORMA-PARTNERS.md` § F5, "Fuera de
 * alcance: ... Panel de partner"), and exposing partner creation over the
 * network before there is any admin authentication in front of it would be
 * a bigger step than this pilot needs. Same pattern `scripts/bootstrap.ts`
 * already uses for Stellar keys: run by hand, once per partner.
 *
 * The secret is printed exactly once, here, and nowhere else — the same
 * rule `issueApiKey` itself documents. Nothing in this script writes it to
 * a file or a log beyond this one stdout line.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDirectory } from "@agentpey/directory";
import { API_SCOPES } from "@agentpey/partner-api";

import { readEnvFile } from "./lib/env-file.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = resolve(REPO_ROOT, ".env.local");

function readArg(name: string): string | undefined {
  const flag = `--${name}`;
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function readDatabaseUrl(): Promise<string> {
  const fromFile = (await readEnvFile(ENV_PATH)).get("DATABASE_URL");
  const databaseUrl = fromFile ?? process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is missing — set it in .env.local or the environment.");
  }
  return databaseUrl;
}

async function main(): Promise<void> {
  const name = readArg("name");
  if (name === undefined || name.trim().length === 0) {
    console.error('Usage: pnpm run partner:create -- --name "CloudOps" [--scopes tenants:read,tenants:write,...]');
    process.exitCode = 1;
    return;
  }

  const scopesArg = readArg("scopes");
  // Defaults to everything T45 froze — there is no partner-facing scope
  // picker yet (out of F5's alcance), so a narrower default would just be a
  // key the operator has to re-issue the moment a partner needs one more
  // route.
  const scopes = scopesArg === undefined ? [...API_SCOPES] : scopesArg.split(",").map((scope) => scope.trim());

  const directory = await createDirectory({ connectionString: await readDatabaseUrl() });
  try {
    const partner = await directory.createPartner({ name });
    const { apiKey, secret } = await directory.issueApiKey({ partnerId: partner.id, name: `${name} — default key`, scopes });

    console.log(`Partner created: ${partner.id} (${partner.name})`);
    console.log(`API key issued:  ${apiKey.id}`);
    console.log(`Scopes:          ${apiKey.scopes.join(", ")}`);
    console.log("");
    console.log("Secret (shown once — store it now, it cannot be retrieved again):");
    console.log(secret);
  } finally {
    await directory.close();
  }
}

await main();
