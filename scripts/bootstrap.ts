#!/usr/bin/env node
/**
 * `pnpm run bootstrap` — prepare a working Stellar testnet environment.
 *
 * Generates the admin / issuer / agent keypairs, funds them through Friendbot,
 * writes `.env.local`, and reports the network's live protocol version.
 *
 * Idempotent by construction: keypairs already in `.env.local` are reused rather
 * than regenerated, funded accounts are left alone, and keys this script does
 * not own — the contract id from deploy:registry, anything a human added — are
 * carried across untouched. See lib/roles.ts for that logic and its tests.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentPassError, isAgentPassError } from "@agentpass/core";

import { readEnvFile, writeEnvFile } from "./lib/env-file.js";
import { TESTNET, fundWithFriendbot, getAccountState, getLiveVersion } from "./lib/network.js";
import { ROLES, renderEnvLocal, resolveKeypair } from "./lib/roles.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = resolve(REPO_ROOT, ".env.local");
const CARGO_TOML = resolve(REPO_ROOT, "contracts/Cargo.toml");

type FundingOutcome = "already funded" | "funded via friendbot";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** Funds only what is not funded, then waits for Horizon to observe the account. */
async function ensureFunded(
  address: string,
): Promise<{ outcome: FundingOutcome; balance: string | undefined }> {
  const before = await getAccountState(TESTNET.horizonUrl, address);
  if (before.funded) {
    return { outcome: "already funded", balance: before.nativeBalance };
  }

  await fundWithFriendbot(TESTNET.friendbotUrl, address);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const after = await getAccountState(TESTNET.horizonUrl, address);
    if (after.funded) {
      return { outcome: "funded via friendbot", balance: after.nativeBalance };
    }
    await sleep(1_000);
  }

  throw new AgentPassError(
    "NetworkError",
    "Friendbot accepted the request but the account never appeared on Horizon",
    { details: { address } },
  );
}

/** The soroban-sdk version pinned for the contracts, so drift stays visible. */
async function pinnedSdkVersion(): Promise<string | undefined> {
  try {
    const contents = await readFile(CARGO_TOML, "utf8");
    return /^\s*soroban-sdk\s*=\s*"([^"]+)"/m.exec(contents)?.[1];
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const existing = await readEnvFile(ENV_PATH);
  const [version, pinnedSdk] = await Promise.all([
    getLiveVersion(TESTNET.rpcUrl),
    pinnedSdkVersion(),
  ]);

  process.stdout.write("\nAgentPass bootstrap · Stellar testnet\n\n");
  process.stdout.write(`  rpc          ${TESTNET.rpcUrl}\n`);
  process.stdout.write(
    `  protocol     ${version.protocolVersion}  (soroban-rpc ${version.rpcVersion.split("-")[0] ?? version.rpcVersion}` +
      `${version.coreVersion === undefined ? "" : `, stellar-core ${version.coreVersion.split(" ")[1] ?? version.coreVersion}`})\n`,
  );
  if (pinnedSdk !== undefined) {
    const pinnedMajor = Number(pinnedSdk.split(".")[0]);
    const drift =
      Number.isFinite(pinnedMajor) && pinnedMajor !== version.protocolVersion
        ? `  ← major trails protocol ${version.protocolVersion}; intentional while ${version.protocolVersion} has no stable SDK`
        : "";
    process.stdout.write(`  soroban-sdk  ${pinnedSdk} pinned in contracts/Cargo.toml${drift}\n`);
  }
  process.stdout.write("\n");

  const resolved = ROLES.map((role) => resolveKeypair(role, existing));

  for (const entry of resolved) {
    const address = entry.keypair.publicKey();
    const { outcome, balance } = await ensureFunded(address);
    process.stdout.write(`  ${entry.role.label.padEnd(7)} ${address}\n`);
    process.stdout.write(
      `  ${" ".repeat(7)} keypair ${entry.origin} · ${outcome}` +
        `${balance === undefined ? "" : ` · ${balance} XLM`}\n\n`,
    );
  }

  await writeEnvFile(ENV_PATH, renderEnvLocal(resolved, existing, new Date()));

  const generated = resolved.filter((entry) => entry.origin === "generated").length;
  process.stdout.write(
    `  wrote .env.local (mode 600) · ${resolved.length} secret seeds, none printed` +
      `${generated === 0 ? " · no new keys, this run changed nothing" : ` · ${generated} newly generated`}\n\n`,
  );
}

try {
  await main();
} catch (error) {
  if (isAgentPassError(error)) {
    process.stderr.write(`\n${error.code}: ${error.message}\n`);
    if (Object.keys(error.details).length > 0) {
      process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    }
  } else {
    process.stderr.write(`\nUnexpected failure: ${String(error)}\n`);
  }
  process.exitCode = 1;
}
