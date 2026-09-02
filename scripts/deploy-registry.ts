#!/usr/bin/env node
/**
 * `pnpm run deploy:registry` — build, upload, deploy and verify `agent_registry`,
 * then make sure the pilot's one issuer is registered and active.
 *
 * Re-runnable: when the recorded contract is live and its wasm matches what the
 * source builds to, this does nothing and says so. Any drift stops the script
 * and asks for `--redeploy`, because a redeploy means a **new contract id**, and
 * every credential anchored against the old one would be orphaned.
 *
 * Registering the issuer here, not as a separate manual step, is what lets
 * someone who has never seen this repo clone it and run the full CLI cycle
 * (T8) straight through: without it, `agentpass issue` would fail with
 * `IssuerNotRegistered` on a fresh deployment.
 *
 * The admin secret reaches the Stellar CLI through the environment, never on the
 * command line, so it cannot be read out of the process list.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { AgentPassError, isAgentPassError, isStellarAddress } from "@agentpass/core";
import { createAgentPass } from "@agentpass/sdk";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { Client } from "@stellar/stellar-sdk/contract";

import { readEnvFile, upsertEnvValue, writeEnvFile } from "./lib/env-file.js";
import { TESTNET, getLiveVersion } from "./lib/network.js";
import { EMPTY_DEPLOYMENT, readDeployment, writeDeployment } from "./lib/deployment.js";
import type { AgentRegistryDeployment } from "./lib/deployment.js";

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = resolve(REPO_ROOT, ".env.local");
const CONTRACTS_DIR = resolve(REPO_ROOT, "contracts");
const DEPLOYMENT_PATH = resolve(REPO_ROOT, "deployments/testnet.json");
const WASM_PATH = resolve(CONTRACTS_DIR, "target/wasm32v1-none/release/agent_registry.wasm");

const REDEPLOY = process.argv.slice(2).includes("--redeploy");

/** The CLI inherits network and identity from the environment, not from argv. */
function cliEnv(adminSecret: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STELLAR_ACCOUNT: adminSecret,
    STELLAR_NETWORK: TESTNET.network,
    STELLAR_RPC_URL: TESTNET.rpcUrl,
    STELLAR_NETWORK_PASSPHRASE: TESTNET.passphrase,
  };
}

async function stellar(args: readonly string[], adminSecret: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("stellar", [...args], {
      cwd: CONTRACTS_DIR,
      env: cliEnv(adminSecret),
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new AgentPassError("CommandFailed", `stellar ${args.join(" ")} failed`, {
      cause: error,
      // Never echo the environment: it carries the admin secret.
      details: { command: `stellar ${args.join(" ")}`, stderr: stderr.slice(-2000) },
    });
  }
}

/** The last non-empty stdout line, which is where the CLI puts its result. */
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

interface LiveContract {
  readonly admin: string;
  readonly schemaVersion: number;
}

/**
 * `Client.from` builds its methods from the interface spec it fetches off the
 * chain, so TypeScript cannot know them ahead of time. This is the script's one
 * untyped boundary; everything that comes back through it is validated below
 * before it is used or written to disk.
 */
interface RegistryReader {
  get_admin(): Promise<{ readonly result: unknown }>;
  schema_version(): Promise<{ readonly result: unknown }>;
}

/**
 * A Rust `Result<T, E>` arrives as an Ok/Err wrapper; a plain return arrives
 * bare. Unwrapping an Err throws, which is what we want — a contract error
 * should stop the deploy rather than be written to disk.
 */
function unwrapResult(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "unwrap" in value) {
    const candidate = (value as { unwrap: unknown }).unwrap;
    if (typeof candidate === "function") {
      return (value as { unwrap: () => unknown }).unwrap();
    }
  }
  return value;
}

/**
 * Reads the deployed contract back through the SDK rather than trusting the
 * CLI's output — an independent confirmation that the thing on chain is the
 * thing we meant to put there.
 */
async function probe(contractId: string, sourcePublicKey: string): Promise<LiveContract> {
  const client = await Client.from({
    contractId,
    networkPassphrase: TESTNET.passphrase,
    rpcUrl: TESTNET.rpcUrl,
    publicKey: sourcePublicKey,
  });
  const reader = client as unknown as RegistryReader;

  const adminValue = unwrapResult((await reader.get_admin()).result);
  const schemaValue = unwrapResult((await reader.schema_version()).result);

  // The unwrapped Address arrives as a String object, not a primitive.
  const adminString = String(adminValue);

  if (!isStellarAddress(adminString)) {
    throw new AgentPassError("NetworkError", "the contract returned an unreadable admin", {
      details: { contractId, admin: adminString },
    });
  }
  if (typeof schemaValue !== "number") {
    throw new AgentPassError("NetworkError", "the contract returned an unreadable schema version", {
      details: { contractId, schemaVersion: String(schemaValue) },
    });
  }

  return { admin: adminString, schemaVersion: schemaValue };
}

async function updateEnvLocal(contractId: string): Promise<void> {
  const contents = await readFile(ENV_PATH, "utf8");
  await writeEnvFile(ENV_PATH, upsertEnvValue(contents, "AGENT_REGISTRY_CONTRACT_ID", contractId));
}

/**
 * The pilot has exactly one issuer role. `meta_hash` is an opaque 32-byte
 * pointer the contract stores but never interprets — nothing consumes it yet,
 * so this deterministically derives one from the issuer's own address rather
 * than inventing a metadata format nobody asked for.
 */
async function ensureIssuerRegistered(
  contractId: string,
  admin: Keypair,
  issuerPublicKey: string,
): Promise<void> {
  const agentpass = await createAgentPass({
    contractId,
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.passphrase,
    network: TESTNET.network,
  });

  const current = await agentpass.issuerStatus(issuerPublicKey);
  if (current.registered && current.active) {
    process.stdout.write(`  issuer       ${issuerPublicKey} already registered and active\n\n`);
    return;
  }

  const metaHash = createHash("sha256").update(issuerPublicKey).digest("hex");
  await agentpass.registerIssuer({ admin, issuer: issuerPublicKey, metaHash });
  process.stdout.write(
    `  issuer       ${issuerPublicKey} ${current.registered ? "re-activated" : "registered"}\n\n`,
  );
}

async function main(): Promise<void> {
  const env = await readEnvFile(ENV_PATH);
  const adminSecret = requireEnv(env, "ADMIN_SECRET_KEY");
  const admin = Keypair.fromSecret(adminSecret);
  const issuerPublicKey = requireEnv(env, "ISSUER_PUBLIC_KEY");

  const [version, recorded] = await Promise.all([
    getLiveVersion(TESTNET.rpcUrl),
    readDeployment(DEPLOYMENT_PATH),
  ]);

  process.stdout.write("\nAgentPass deploy:registry · Stellar testnet\n\n");
  process.stdout.write(`  protocol     ${version.protocolVersion}\n`);
  process.stdout.write(`  admin        ${admin.publicKey()}\n\n`);

  process.stdout.write("  building     …\n");
  await stellar(["contract", "build"], adminSecret);
  const wasm = await readFile(WASM_PATH);
  const wasmHash = createHash("sha256").update(wasm).digest("hex");
  process.stdout.write(`  wasm         ${wasm.byteLength} bytes · ${wasmHash.slice(0, 16)}…\n\n`);

  const previous = recorded.agentRegistry;
  if (previous !== null && !REDEPLOY) {
    let live: LiveContract;
    try {
      live = await probe(previous.contractId, admin.publicKey());
    } catch (error) {
      throw new AgentPassError(
        "ConfigError",
        "a contract is recorded but does not answer; re-run with --redeploy to replace it",
        { cause: error, details: { contractId: previous.contractId } },
      );
    }

    if (previous.wasmHash !== wasmHash) {
      throw new AgentPassError(
        "ConfigError",
        "the source builds to a different wasm than the deployed contract; re-run with --redeploy",
        {
          details: {
            deployed: previous.wasmHash,
            built: wasmHash,
            warning:
              "a redeploy creates a NEW contract id; credentials anchored against the old one keep pointing at it",
          },
        },
      );
    }

    process.stdout.write(`  contract     ${previous.contractId}\n`);
    process.stdout.write(
      `  verified     admin ${live.admin} · schema v${live.schemaVersion}\n\n`,
    );
    process.stdout.write("  already deployed and matching the built wasm — nothing to do\n\n");

    await updateEnvLocal(previous.contractId);
    await writeDeployment(DEPLOYMENT_PATH, {
      ...EMPTY_DEPLOYMENT,
      protocolVersion: version.protocolVersion,
      agentRegistry: previous,
    });
    await ensureIssuerRegistered(previous.contractId, admin, issuerPublicKey);
    return;
  }

  process.stdout.write("  uploading    …\n");
  const uploaded = lastLine(await stellar(["contract", "upload", "--wasm", WASM_PATH], adminSecret));
  if (uploaded !== wasmHash) {
    throw new AgentPassError("CommandFailed", "the uploaded wasm hash differs from the local one", {
      details: { uploaded, local: wasmHash },
    });
  }

  process.stdout.write("  deploying    …\n");
  const contractId = lastLine(
    await stellar(
      [
        "contract",
        "deploy",
        "--wasm-hash",
        wasmHash,
        "--",
        "--admin",
        admin.publicKey(),
      ],
      adminSecret,
    ),
  );
  if (!StrKey.isValidContract(contractId)) {
    throw new AgentPassError("CommandFailed", "the CLI did not return a contract id", {
      details: { output: contractId },
    });
  }

  const live = await probe(contractId, admin.publicKey());
  if (live.admin !== admin.publicKey()) {
    throw new AgentPassError("ConfigError", "the deployed contract has an unexpected admin", {
      details: { expected: admin.publicKey(), actual: live.admin },
    });
  }

  const record: AgentRegistryDeployment = {
    contractId,
    wasmHash,
    admin: admin.publicKey(),
    schemaVersion: live.schemaVersion,
    deployedAt: new Date().toISOString(),
    protocolVersion: version.protocolVersion,
  };

  await writeDeployment(DEPLOYMENT_PATH, {
    ...EMPTY_DEPLOYMENT,
    protocolVersion: version.protocolVersion,
    agentRegistry: record,
  });
  await updateEnvLocal(contractId);

  process.stdout.write(`\n  contract     ${contractId}\n`);
  process.stdout.write(`  verified     admin ${live.admin} · schema v${live.schemaVersion}\n\n`);
  process.stdout.write("  wrote deployments/testnet.json and .env.local\n\n");

  await ensureIssuerRegistered(contractId, admin, issuerPublicKey);
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
