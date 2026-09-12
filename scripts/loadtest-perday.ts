#!/usr/bin/env node
/**
 * `pnpm run loadtest:perday` — makes independent Node processes compete for
 * one tenant's daily USDC allowance against the live Postgres vault.
 *
 * This deliberately coordinates the instant between `spentOn()` and
 * `record()`: every worker makes its own limit decision, then the parent
 * releases all approved workers together. It is a process-level probe of the
 * race T61 addresses, not an x402 or Bazaar payment load test. The run always
 * deletes its own `loadtest-` tenant rows before it exits.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { createPostgresMandateVault } from "../packages/vault/src/postgres-vault.js";
import { readEnvFile } from "./lib/env-file.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = fileURLToPath(new URL("../.env.local", import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const TSX_CLI_PATH = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const SCRIPTS_TSCONFIG = fileURLToPath(new URL("../tsconfig.scripts.json", import.meta.url));
// `pg` belongs to @agentpey/vault, not this root package. Resolve it from the
// vault package so pnpm's non-hoisted workspace layout remains valid without
// adding a second dependency merely to delete this harness's test rows.
const requireFromVault = createRequire(new URL("../packages/vault/package.json", import.meta.url));

const PROCESS_COUNT = 4;
const ATTEMPTS_PER_PROCESS = 3;
const CURRENCY = "USDC";
const REFERENCE_PER_DAY = 100_000_000n; // 10.0000000 at Stellar's 7-decimal scale
const ATTEMPT_AMOUNT = 30_000_000n; // 3.0000000: four concurrent approvals exceed the reference limit
const ATTEMPT_AMOUNT_TEXT = "3.0000000";

const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("begin"), round: z.number().int().nonnegative() }),
  z.object({ type: z.literal("commit"), round: z.number().int().nonnegative() }),
  z.object({ type: z.literal("continue"), round: z.number().int().nonnegative() }),
]);

const WorkerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), pid: z.number().int() }),
  z.object({
    type: z.literal("decision"),
    pid: z.number().int(),
    round: z.number().int().nonnegative(),
    shouldRecord: z.boolean(),
  }),
  z.object({ type: z.literal("roundComplete"), pid: z.number().int(), round: z.number().int().nonnegative() }),
  z.object({ type: z.literal("result"), pid: z.number().int(), accepted: z.number().int(), rejected: z.number().int() }),
  z.object({ type: z.literal("fatal"), pid: z.number().int(), stage: z.string() }),
]);

type Command = z.infer<typeof CommandSchema>;
type WorkerMessage = z.infer<typeof WorkerMessageSchema>;

interface WorkerConfiguration {
  readonly connectionString: string;
  readonly tenantId: string;
  readonly subject: string;
  readonly at: string;
}

interface WorkerResult {
  readonly pid: number;
  readonly accepted: number;
  readonly rejected: number;
}

interface WorkerHandle {
  readonly child: ChildProcessWithoutNullStreams;
  readonly messages: WorkerMessage[];
  readonly stderr: string[];
  exitCode: number | null;
}

interface CleanupPool {
  query(query: string, values: readonly string[]): Promise<unknown>;
  end(): Promise<void>;
}

interface CleanupPoolOptions {
  readonly connectionString: string;
  readonly ssl: { readonly rejectUnauthorized: boolean; readonly ca?: string };
}

interface PgModule {
  readonly Pool: new (options: CleanupPoolOptions) => CleanupPool;
}

const { Pool } = requireFromVault("pg") as unknown as PgModule;

function formatScaled(amount: bigint): string {
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 10_000_000n;
  const fraction = (absolute % 10_000_000n).toString().padStart(7, "0");
  return `${sign}${whole}.${fraction}`;
}

function parseScaled(amount: string): bigint {
  const match = /^(\d+)\.(\d{7})$/.exec(amount);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`vault returned an invalid scaled amount: ${amount}`);
  }
  return BigInt(match[1]) * 10_000_000n + BigInt(match[2]);
}

async function readDatabaseUrl(): Promise<string> {
  const fromFile = (await readEnvFile(ENV_PATH)).get("DATABASE_URL");
  const connectionString = fromFile ?? process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is missing — set it in .env.local or the environment.");
  }
  return connectionString;
}

function createCleanupPool(connectionString: string): CleanupPool {
  // Match createPostgresMandateVault's T62 TLS posture. In particular, a
  // configured provider CA must verify this cleanup connection as well.
  const postgresCa = process.env.POSTGRES_CA_CERT;
  return new Pool({
    connectionString,
    ssl:
      postgresCa === undefined || postgresCa === ""
        ? { rejectUnauthorized: false }
        : { ca: postgresCa, rejectUnauthorized: true },
  });
}

function workerConfiguration(): WorkerConfiguration {
  const connectionString = process.env.LOADTEST_DATABASE_URL;
  const tenantId = process.env.LOADTEST_TENANT_ID;
  const subject = process.env.LOADTEST_SUBJECT;
  const at = process.env.LOADTEST_AT;
  if (connectionString === undefined || tenantId === undefined || subject === undefined || at === undefined) {
    throw new Error("load-test worker did not receive its configuration");
  }
  return { connectionString, tenantId, subject, at };
}

function writeMessage(message: WorkerMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function nextCommand(iterator: AsyncIterator<string>): Promise<Command> {
  const next = await iterator.next();
  if (next.done) throw new Error("load-test coordinator closed the worker command channel");
  return CommandSchema.parse(JSON.parse(next.value));
}

async function workerMain(): Promise<void> {
  const configuration = workerConfiguration();
  const pid = process.pid;
  const commands = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const vault = await createPostgresMandateVault({
    connectionString: configuration.connectionString,
    tenantId: configuration.tenantId,
  });
  const at = new Date(configuration.at);
  let accepted = 0;
  let rejected = 0;

  writeMessage({ type: "ready", pid });
  for (let round = 0; round < ATTEMPTS_PER_PROCESS; round += 1) {
    const begin = await nextCommand(commands);
    if (begin.type !== "begin" || begin.round !== round) throw new Error("unexpected coordinator command");

    // This worker alone makes the decision. The coordinator only creates a
    // repeatable schedule in which separate processes all have the same race
    // window between this read and their later write.
    const spentToday = parseScaled(await vault.spentOn(configuration.subject, CURRENCY, at));
    const shouldRecord = spentToday + ATTEMPT_AMOUNT <= REFERENCE_PER_DAY;
    writeMessage({ type: "decision", pid, round, shouldRecord });

    const action = await nextCommand(commands);
    if (action.round !== round || (shouldRecord ? action.type !== "commit" : action.type !== "continue")) {
      throw new Error("unexpected coordinator action");
    }
    if (shouldRecord) {
      await vault.record({
        subject: configuration.subject,
        intentId: `loadtest-${pid}-${round}-${randomUUID()}`,
        currency: CURRENCY,
        amount: ATTEMPT_AMOUNT_TEXT,
        at,
      });
      accepted += 1;
    } else {
      rejected += 1;
    }
    writeMessage({ type: "roundComplete", pid, round });
  }
  writeMessage({ type: "result", pid, accepted, rejected });
}

function spawnWorker(configuration: WorkerConfiguration): WorkerHandle {
  const child = spawn(process.execPath, [TSX_CLI_PATH, "--tsconfig", SCRIPTS_TSCONFIG, SCRIPT_PATH, "--worker"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LOADTEST_DATABASE_URL: configuration.connectionString,
      LOADTEST_TENANT_ID: configuration.tenantId,
      LOADTEST_SUBJECT: configuration.subject,
      LOADTEST_AT: configuration.at,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const handle: WorkerHandle = { child, messages: [], stderr: [], exitCode: null };
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on("line", (line) => {
    const parsed = WorkerMessageSchema.safeParse(JSON.parse(line));
    if (parsed.success) handle.messages.push(parsed.data);
    else handle.messages.push({ type: "fatal", pid: child.pid ?? -1, stage: "invalid worker message" });
  });
  const errors = createInterface({ input: child.stderr, crlfDelay: Infinity });
  errors.on("line", (line) => handle.stderr.push(line));
  child.on("exit", (code) => {
    handle.exitCode = code;
  });
  return handle;
}

function send(handle: WorkerHandle, command: Command): void {
  handle.child.stdin.write(`${JSON.stringify(command)}\n`);
}

async function waitForAll(
  workers: readonly WorkerHandle[],
  predicate: (messages: readonly WorkerMessage[]) => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!workers.every((worker) => predicate(worker.messages))) {
    const stopped = workers.find((worker) => worker.exitCode !== null);
    const fatal = workers.find((worker) => worker.messages.some((message) => message.type === "fatal"));
    if (stopped !== undefined || fatal !== undefined) {
      throw new Error(`a worker stopped before ${description}`);
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

function resultFor(worker: WorkerHandle): WorkerResult | undefined {
  const message = worker.messages.find((candidate) => candidate.type === "result");
  return message?.type === "result" ? message : undefined;
}

function stopWorkers(workers: readonly WorkerHandle[]): void {
  for (const worker of workers) {
    if (worker.exitCode === null) worker.child.kill();
  }
}

async function coordinatorMain(): Promise<number> {
  const connectionString = await readDatabaseUrl();
  const configuration: WorkerConfiguration = {
    connectionString,
    tenantId: `loadtest-${randomUUID()}`,
    subject: `did:stellar:testnet:loadtest:${randomUUID()}`,
    at: new Date().toISOString(),
  };
  const workers = Array.from({ length: PROCESS_COUNT }, () => spawnWorker(configuration));
  const cleanupPool = createCleanupPool(connectionString);

  try {
    await waitForAll(workers, (messages) => messages.some((message) => message.type === "ready"), "workers to connect");
    for (let round = 0; round < ATTEMPTS_PER_PROCESS; round += 1) {
      for (const worker of workers) send(worker, { type: "begin", round });
      await waitForAll(
        workers,
        (messages) => messages.some((message) => message.type === "decision" && message.round === round),
        `round ${round + 1} decisions`,
      );
      for (const worker of workers) {
        const decision = worker.messages.find(
          (message) => message.type === "decision" && message.round === round,
        );
        send(worker, { type: decision?.type === "decision" && decision.shouldRecord ? "commit" : "continue", round });
      }
      await waitForAll(
        workers,
        (messages) => messages.some((message) => message.type === "roundComplete" && message.round === round),
        `round ${round + 1} writes`,
      );
    }
    await waitForAll(workers, (messages) => messages.some((message) => message.type === "result"), "worker results");
    await new Promise<void>((resolve) => {
      let remaining = workers.length;
      for (const worker of workers) {
        worker.child.once("exit", () => {
          remaining -= 1;
          if (remaining === 0) resolve();
        });
      }
    });

    const results = workers.map(resultFor);
    if (results.some((result) => result === undefined) || workers.some((worker) => worker.exitCode !== 0)) {
      throw new Error("a load-test worker did not exit cleanly");
    }

    // This vault is intentionally new: list()/verify() are a construction-time
    // view, so the audit must not reuse a worker's in-memory record array.
    const audit = await createPostgresMandateVault({ connectionString, tenantId: configuration.tenantId });
    const recorded = audit.list().filter((record) => record.entry.kind === "granted");
    const total = parseScaled(await audit.spentOn(configuration.subject, CURRENCY, new Date(configuration.at)));
    const accepted = results.reduce((sum, result) => sum + (result?.accepted ?? 0), 0);
    const rejected = results.reduce((sum, result) => sum + (result?.rejected ?? 0), 0);
    const withinLimit = total <= REFERENCE_PER_DAY;
    const chain = audit.verify();
    const consistentCount = accepted === recorded.length;

    console.log("perDay multi-process load test");
    console.log(`  processes:       ${PROCESS_COUNT}`);
    console.log(`  attempts:        ${PROCESS_COUNT * ATTEMPTS_PER_PROCESS}`);
    console.log(`  accepted:        ${accepted}`);
    console.log(`  rejected:        ${rejected}`);
    console.log(`  records written: ${recorded.length}`);
    console.log(`  recorded total:  ${formatScaled(total)} ${CURRENCY}`);
    console.log(`  reference limit: ${formatScaled(REFERENCE_PER_DAY)} ${CURRENCY}`);
    console.log(`  within limit:    ${withinLimit ? "yes" : "NO"}`);
    console.log(`  chain intact:    ${chain.ok ? "yes" : `NO (broken at seq ${chain.brokenAtSeq})`}`);
    console.log(`  worker counts:   ${consistentCount ? "consistent" : "MISMATCH"}`);

    return withinLimit && chain.ok && consistentCount ? 0 : 1;
  } finally {
    stopWorkers(workers);
    await cleanupPool.query("delete from vault_records where tenant_id = $1", [configuration.tenantId]);
    await cleanupPool.end();
  }
}

async function main(): Promise<number> {
  if (process.argv.includes("--worker")) {
    try {
      await workerMain();
      return 0;
    } catch {
      writeMessage({ type: "fatal", pid: process.pid, stage: "worker execution" });
      return 1;
    }
  }
  return coordinatorMain();
}

main()
  .then((exitCode) => {
    // `MandateVault` intentionally has no close() method. Force an orderly
    // CLI exit after the awaited cleanup rather than retain idle pg pools.
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`loadtest:perday failed: ${message}`);
    process.exit(1);
  });
