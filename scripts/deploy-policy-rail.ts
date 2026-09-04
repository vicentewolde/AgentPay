#!/usr/bin/env node
/**
 * `pnpm run deploy:policy-rail` — deploy the `policy_rail` smart account (T22)
 * and leave it able to pay: same limits `LocalPolicyRail` enforces off-chain,
 * enforced by the network inside the transfer itself (T31).
 *
 * Re-runnable, like `deploy:registry`: a recorded contract that still answers
 * with the wasm this source builds is left alone, and only its USDC balance is
 * topped up. Any drift stops and asks for `--redeploy`, because a redeploy
 * means a **new contract id** — and the old one keeps whatever balance it had.
 *
 * `owner` is the agent's own key: the agent still authorises its purchases,
 * exactly as it does when paying from its classic account. What changes is who
 * the money moves from, and who gets to say no — `__check_auth` re-checks
 * `perTx`/`perDay` on chain, after `LocalPolicyRail` already checked them off
 * chain. Two independent gates on the same numbers, not one moved.
 *
 * Secrets reach the Stellar CLI through the environment, never argv, so they
 * cannot be read out of the process list.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { AgentPassError, isAgentPassError } from "@agentpass/core";
import { BAZAAR_USDC_ISSUER, fromScaledAmount, toScaledAmount } from "@agentpay/agent";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

import { readEnvFile, upsertEnvValue, writeEnvFile } from "./lib/env-file.js";
import { TESTNET, getLiveVersion } from "./lib/network.js";
import { readDeployment, writeDeployment } from "./lib/deployment.js";
import type { PolicyRailDeployment } from "./lib/deployment.js";

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = resolve(REPO_ROOT, ".env.local");
const CONTRACTS_DIR = resolve(REPO_ROOT, "contracts");
const DEPLOYMENT_PATH = resolve(REPO_ROOT, "deployments/testnet.json");
const WASM_PATH = resolve(CONTRACTS_DIR, "target/wasm32v1-none/release/policy_rail.wasm");

const REDEPLOY = process.argv.slice(2).includes("--redeploy");

/**
 * `swap-risk-quote`, the one product with a real payment path, costs
 * 0.0010000 USDC. `perTx` at twice that leaves a purchase comfortably inside
 * the limit while still refusing a challenge that asked for meaningfully more
 * than what the catalogue quoted; `perDay` allows ten of them, enough for a
 * demo session and still a number the contract can be seen enforcing.
 */
const PER_TX = "0.0020000";
const PER_DAY = "0.0100000";
const VALID_DAYS = 365;

/** Top up to {@link FUND_TARGET} whenever the rail holds less than this. */
const FUND_THRESHOLD = "0.0050000";
const FUND_TARGET = "0.0500000";

function cliEnv(secret: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STELLAR_ACCOUNT: secret,
    STELLAR_NETWORK: TESTNET.network,
    STELLAR_RPC_URL: TESTNET.rpcUrl,
    STELLAR_NETWORK_PASSPHRASE: TESTNET.passphrase,
  };
}

async function stellar(args: readonly string[], secret: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("stellar", [...args], {
      cwd: CONTRACTS_DIR,
      env: cliEnv(secret),
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new AgentPassError("CommandFailed", `stellar ${args.join(" ")} failed`, {
      cause: error,
      // Never echo the environment: it carries a secret key.
      details: { command: `stellar ${args.join(" ")}`, stderr: stderr.slice(-2000) },
    });
  }
}

function lastLine(output: string): string {
  const lines = output.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const last = lines.at(-1);
  if (last === undefined) {
    throw new AgentPassError("CommandFailed", "the Stellar CLI produced no output");
  }
  return last;
}

function requireEnv(env: ReadonlyMap<string, string>, key: string): string {
  const value = env.get(key)?.trim() ?? "";
  if (value === "") {
    throw new AgentPassError("ConfigError", `${key} is missing from .env.local`, {
      details: { key, fix: "run `pnpm run bootstrap` first" },
    });
  }
  return value;
}

/** A contract's USDC balance, as a decimal string. Read-only, no fee. */
async function usdcBalance(address: string, secret: string): Promise<string> {
  const raw = lastLine(
    await stellar(["contract", "invoke", "--id", BAZAAR_USDC_ISSUER, "--", "balance", "--id", address], secret),
  );
  const scaled = BigInt(raw.replaceAll('"', ""));
  return fromScaledAmount(scaled);
}

/**
 * Moves USDC into the rail from the account that already holds it — the agent.
 * A contract address needs no trustline: a SEP-41 balance lives in the token
 * contract's own storage, whoever holds it (the same way T22 funded this
 * contract with native XLM).
 */
async function ensureFunded(contractId: string, funder: Keypair): Promise<void> {
  const balance = await usdcBalance(contractId, funder.secret());
  process.stdout.write(`  balance      ${balance} USDC\n`);
  if (toScaledAmount(balance) >= toScaledAmount(FUND_THRESHOLD)) {
    process.stdout.write("  funding      above the threshold — nothing to top up\n\n");
    return;
  }

  const top = toScaledAmount(FUND_TARGET) - toScaledAmount(balance);
  process.stdout.write(`  funding      +${fromScaledAmount(top)} USDC from ${funder.publicKey()}\n`);
  await stellar(
    [
      "contract",
      "invoke",
      "--id",
      BAZAAR_USDC_ISSUER,
      "--",
      "transfer",
      "--from",
      funder.publicKey(),
      "--to",
      contractId,
      "--amount",
      top.toString(),
    ],
    funder.secret(),
  );
  process.stdout.write(`  balance      ${await usdcBalance(contractId, funder.secret())} USDC\n\n`);
}

interface LiveRail {
  readonly owner: string;
  readonly asset: string;
  readonly perTx: string;
  readonly perDay: string;
  readonly validUntil: string;
}

/**
 * Reads the deployed contract back through the CLI rather than trusting what
 * was passed in — an independent confirmation that the rail on chain is the
 * rail we meant to put there, and the one whose `owner` the agent can sign for.
 */
async function probe(contractId: string, secret: string): Promise<LiveRail> {
  const read = async (method: string): Promise<string> =>
    lastLine(await stellar(["contract", "invoke", "--id", contractId, "--", method], secret)).replaceAll('"', "");

  const [owner, asset, perTx, perDay, validUntil] = await Promise.all([
    read("owner"),
    read("asset"),
    read("per_tx"),
    read("per_day"),
    read("valid_until"),
  ]);

  if (!/^[0-9a-f]{64}$/.test(owner)) {
    throw new AgentPassError("NetworkError", "the rail returned an unreadable owner key", {
      details: { contractId, owner },
    });
  }
  return {
    owner: StrKey.encodeEd25519PublicKey(Buffer.from(owner, "hex")),
    asset,
    perTx: fromScaledAmount(BigInt(perTx)),
    perDay: fromScaledAmount(BigInt(perDay)),
    validUntil: new Date(Number(BigInt(validUntil)) * 1000).toISOString(),
  };
}

async function main(): Promise<void> {
  const env = await readEnvFile(ENV_PATH);
  const admin = Keypair.fromSecret(requireEnv(env, "ADMIN_SECRET_KEY"));
  const agent = Keypair.fromSecret(requireEnv(env, "AGENT_SECRET_KEY"));

  const [version, recorded] = await Promise.all([
    getLiveVersion(TESTNET.rpcUrl),
    readDeployment(DEPLOYMENT_PATH),
  ]);

  process.stdout.write("\nAgentPay deploy:policy-rail · Stellar testnet\n\n");
  process.stdout.write(`  protocol     ${version.protocolVersion}\n`);
  process.stdout.write(`  deployer     ${admin.publicKey()}\n`);
  process.stdout.write(`  owner        ${agent.publicKey()} (the agent)\n`);
  process.stdout.write(`  asset        ${BAZAAR_USDC_ISSUER} (USDC)\n\n`);

  process.stdout.write("  building     …\n");
  await stellar(["contract", "build"], admin.secret());
  const wasm = await readFile(WASM_PATH);
  const wasmHash = createHash("sha256").update(wasm).digest("hex");
  process.stdout.write(`  wasm         ${wasm.byteLength} bytes · ${wasmHash.slice(0, 16)}…\n\n`);

  const previous = recorded.policyRail;
  if (previous !== null && !REDEPLOY) {
    let live: LiveRail;
    try {
      live = await probe(previous.contractId, admin.secret());
    } catch (error) {
      throw new AgentPassError(
        "ConfigError",
        "a rail is recorded but does not answer; re-run with --redeploy to replace it",
        { cause: error, details: { contractId: previous.contractId } },
      );
    }
    if (previous.wasmHash !== wasmHash) {
      throw new AgentPassError(
        "ConfigError",
        "the source builds to a different wasm than the deployed rail; re-run with --redeploy",
        {
          details: {
            deployed: previous.wasmHash,
            built: wasmHash,
            warning: "a redeploy creates a NEW contract id, and the old one keeps its balance",
          },
        },
      );
    }
    if (live.owner !== agent.publicKey()) {
      throw new AgentPassError(
        "ConfigError",
        "the deployed rail's owner is not this agent — it cannot authorise payments from it",
        { details: { contractId: previous.contractId, owner: live.owner, agent: agent.publicKey() } },
      );
    }

    process.stdout.write(`  contract     ${previous.contractId}\n`);
    process.stdout.write(`  verified     perTx ${live.perTx} · perDay ${live.perDay} · until ${live.validUntil}\n\n`);
    process.stdout.write("  already deployed and matching the built wasm — nothing to redeploy\n\n");

    await writeEnvFile(
      ENV_PATH,
      upsertEnvValue(await readFile(ENV_PATH, "utf8"), "POLICY_RAIL_CONTRACT_ID", previous.contractId),
    );
    await writeDeployment(DEPLOYMENT_PATH, { ...recorded, protocolVersion: version.protocolVersion });
    await ensureFunded(previous.contractId, agent);
    return;
  }

  process.stdout.write("  uploading    …\n");
  const uploaded = lastLine(await stellar(["contract", "upload", "--wasm", WASM_PATH], admin.secret()));
  if (uploaded !== wasmHash) {
    throw new AgentPassError("CommandFailed", "the uploaded wasm hash differs from the local one", {
      details: { uploaded, local: wasmHash },
    });
  }

  const validUntil = new Date(Date.now() + VALID_DAYS * 24 * 60 * 60 * 1000);
  process.stdout.write("  deploying    …\n");
  const contractId = lastLine(
    await stellar(
      [
        "contract",
        "deploy",
        "--wasm-hash",
        wasmHash,
        "--",
        "--owner",
        Buffer.from(StrKey.decodeEd25519PublicKey(agent.publicKey())).toString("hex"),
        "--asset",
        BAZAAR_USDC_ISSUER,
        "--per_tx",
        toScaledAmount(PER_TX).toString(),
        "--per_day",
        toScaledAmount(PER_DAY).toString(),
        "--valid_until",
        Math.floor(validUntil.getTime() / 1000).toString(),
      ],
      admin.secret(),
    ),
  );
  if (!StrKey.isValidContract(contractId)) {
    throw new AgentPassError("CommandFailed", "the CLI did not return a contract id", {
      details: { output: contractId },
    });
  }

  const live = await probe(contractId, admin.secret());
  if (live.owner !== agent.publicKey() || live.asset !== BAZAAR_USDC_ISSUER) {
    throw new AgentPassError("ConfigError", "the deployed rail does not match what was asked for", {
      details: { expected: { owner: agent.publicKey(), asset: BAZAAR_USDC_ISSUER }, actual: live },
    });
  }

  const record: PolicyRailDeployment = {
    contractId,
    wasmHash,
    owner: agent.publicKey(),
    asset: BAZAAR_USDC_ISSUER,
    perTx: live.perTx,
    perDay: live.perDay,
    validUntil: live.validUntil,
    deployedAt: new Date().toISOString(),
    protocolVersion: version.protocolVersion,
  };
  await writeDeployment(DEPLOYMENT_PATH, {
    ...recorded,
    protocolVersion: version.protocolVersion,
    policyRail: record,
  });
  await writeEnvFile(
    ENV_PATH,
    upsertEnvValue(await readFile(ENV_PATH, "utf8"), "POLICY_RAIL_CONTRACT_ID", contractId),
  );

  process.stdout.write(`\n  contract     ${contractId}\n`);
  process.stdout.write(`  verified     perTx ${live.perTx} · perDay ${live.perDay} · until ${live.validUntil}\n\n`);
  process.stdout.write("  wrote deployments/testnet.json and .env.local\n\n");

  await ensureFunded(contractId, agent);
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
