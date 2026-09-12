#!/usr/bin/env node
/**
 * Registers the origins a partner may send a principal back to after signing
 * (T81).
 *
 * An operator script and not an HTTP route, for the same reason
 * `create-partner.ts` is one: this is the allowlist that stops the consent
 * page from becoming an open redirect, and a partner being able to edit its
 * own allowlist over the network would defeat the point of having one. Adding
 * an origin is a deliberate act by whoever runs the platform.
 *
 * **Replaces, never appends.** An allowlist that only grows is one nobody can
 * take an entry out of, and removing a compromised origin has to be possible.
 * The script prints what the partner had before, so a replacement is never
 * silent.
 *
 *   pnpm run partner:return-origins -- --partner ptn_… --origins https://a.example,https://b.example
 *   pnpm run partner:return-origins -- --partner ptn_…                 (just shows them)
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDirectory } from "@agentpey/directory";
import { returnOriginsSchema } from "@agentpey/partner-api";

import { readEnvFile } from "./lib/env-file.js";

const ENV_PATH = resolve(fileURLToPath(new URL("..", import.meta.url)), ".env.local");

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

const partnerId = readArg("partner");
if (partnerId === undefined) {
  throw new Error("usage: pnpm run partner:return-origins -- --partner <ptn_…> [--origins <url,url>]");
}

const env = await readEnvFile(ENV_PATH);
const connectionString = env.get("DATABASE_URL") ?? process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === "") {
  throw new Error("DATABASE_URL is missing — set it in .env.local or the environment.");
}

const directory = await createDirectory({ connectionString });

const before = await directory.findPartner(partnerId);
if (before === undefined) throw new Error(`no partner with id "${partnerId}"`);

process.stdout.write(`partner  ${before.id}  (${before.name})\n`);
process.stdout.write(`current  ${before.returnOrigins.length === 0 ? "(none — may not use return_url)" : before.returnOrigins.join(", ")}\n`);

const raw = readArg("origins");
if (raw === undefined) process.exit(0);

const origins = returnOriginsSchema.parse(
  raw
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter((value) => value !== ""),
);

const after = await directory.setPartnerReturnOrigins(partnerId, origins);
process.stdout.write(`new      ${after.returnOrigins.length === 0 ? "(none)" : after.returnOrigins.join(", ")}\n`);
