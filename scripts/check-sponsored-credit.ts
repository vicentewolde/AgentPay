#!/usr/bin/env node
/**
 * Reads how much sponsored testnet credit the pilot has left (T77).
 *
 * Strictly read-only: it counts funded rails in Postgres and simulates a
 * SEP-41 `balance()` on the reserve. It cannot move anything, and it is
 * configured with the reserve's *public* address, never its secret — the
 * same split `RESERVE_ADDRESS` exists for.
 *
 * Run with `pnpm run check:sponsored-credit`.
 */
import { readSponsoredCreditStatus } from "@agentpey/activity";
import { readRailUsdcBalance } from "@agentpey/agent";
import { createDirectory } from "@agentpey/directory";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readEnvFile } from "./lib/env-file.js";

const ENV_PATH = resolve(fileURLToPath(new URL("..", import.meta.url)), ".env.local");

const env = await readEnvFile(ENV_PATH);
const reserve = env.get("RESERVE_ADDRESS");
const connectionString = env.get("DATABASE_URL");
if (reserve === undefined || reserve === "") throw new Error("RESERVE_ADDRESS is missing from .env.local");
if (connectionString === undefined || connectionString === "") throw new Error("DATABASE_URL is missing from .env.local");

const directory = await createDirectory({ connectionString });
const status = await readSponsoredCreditStatus(directory, reserve, readRailUsdcBalance);

console.log(`reserve        ${reserve}`);
console.log(`reserve USDC   ${status.reserveUsdc}`);
console.log(`rails funded   ${status.funded} of ${status.cap}`);
console.log(`can sponsor    ${status.remaining} more tenant(s)${status.nearExhaustion ? "  ← running low" : ""}`);
