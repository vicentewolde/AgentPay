#!/usr/bin/env node
/**
 * `pnpm run loadtest:perday` — makes independent Node processes compete for
 * one tenant's daily USDC allowance against the live Postgres vault.
 *
 * Two modes, same coordinated race window, same reference limit:
 *
 *  - default (racy): every worker calls `spentOn()` and `record()` as two
 *    separate, unlocked calls — the exact shape `LocalPolicyRail.authorise()`
 *    used before this ticket's fix. This is what found, and still
 *    reproduces, the gap T61 alone left open (T64).
 *  - `--atomic`: every worker makes the same decision through
 *    `vault.atomically()` instead — the fix this ticket's finding led to
 *    (T65/`C-68`). Run both and diff the summaries: `--atomic` is the proof
 *    the fix holds under real, separate OS processes, not just the
 *    integration test's two instances in one process.
 *
 * Neither mode is an x402 or Bazaar payment load test — the race lives in
 * `packages/vault/src/postgres-vault.ts`, measured directly. The run always
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

/**
 * "racy": `spentOn()` then `record()` as two separate, unlocked calls — the
 * gap this ticket found. "atomic": the same decision through
 * `vault.atomically()` — the fix. Selected with `--atomic` on the command
 * line; default is "racy" so `pnpm run loadtest:perday` keeps reproducing
 * the original finding unless asked otherwise.
 */
type LoadtestMode = "racy" | "atomic";

interface WorkerConfiguration {
  readonly connectionString: string;
  readonly tenantId: string;
  readonly subject: string;
  readonly at: string;
  readonly mode: LoadtestMode;
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
  const mode = process.env.LOADTEST_MODE;
  if (
    connectionString === undefined ||
    tenantId === undefined ||
    subject === undefined ||
    at === undefined ||
    (mode !== "racy" && mode !== "atomic")
  ) {
    throw new Error("load-test worker did not receive its configuration");
  }
  return { connectionString, tenantId, subject, at, mode };
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

    if (configuration.mode === "atomic") {
      // The read, the decision, and the write all happen inside one
      // Postgres transaction holding this tenant's advisory lock — no
      // decision/commit round-trip with the coordinator needed, because
      // nothing outside this call can observe or act on a half-made decision.
      const atomically = vault.atomically;
      if (atomically === undefined) throw new Error("createPostgresMandateVault must implement atomically");
      const shouldRecord = await atomically(configuration.subject, async (locked) => {
        const spentToday = parseScaled(await locked.spentOn(configuration.subject, CURRENCY, at));
        const shouldRecordNow = spentToday + ATTEMPT_AMOUNT <= REFERENCE_PER_DAY;
        if (shouldRecordNow) {
          await locked.record({
            subject: configuration.subject,
            intentId: `loadtest-${pid}-${round}-${randomUUID()}`,
            currency: CURRENCY,
            amount: ATTEMPT_AMOUNT_TEXT,
            at,
          });
        }
        return shouldRecordNow;
      });
      if (shouldRecord) accepted += 1;
      else rejected += 1;
      writeMessage({ type: "roundComplete", pid, round });
      continue;
    }

    // "racy": this worker alone makes the decision, from a plain unlocked
    // read. The coordinator only creates a repeatable schedule in which
    // separate processes all have the same race window between this read
    // and their later write — this is the gap `atomic` mode above closes.
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
      LOADTEST_MODE: configuration.mode,
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
    // Atomic mode has no per-round barrier holding workers back (unlike
    // racy mode's commit/continue exchange), so a fast worker can finish all
    // its rounds and exit while a slower one is still mid-round — that is
    // not a failure as long as the fast one already satisfied `predicate`
    // before it exited. Only flag a worker that exited *without* satisfying
    // what this wait is for.
    const stuck = workers.find((worker) => worker.exitCode !== null && !predicate(worker.messages));
    const fatal = workers.find((worker) => worker.messages.some((message) => message.type === "fatal"));
    if (stuck !== undefined || fatal !== undefined) {
      throw new Error(`a worker stopped before ${description}`);
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Polls `exitCode` (recorded by the listener `spawnWorker` attaches at spawn
 * time, so it can never miss the event) instead of attaching a fresh
 * `.once("exit", ...)` here — a worker can have already exited by the time
 * this runs, and Node only replays an event to listeners registered before
 * it fired.
 */
async function waitForExit(workers: readonly WorkerHandle[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!workers.every((worker) => worker.exitCode !== null)) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for workers to exit");
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
  const mode: LoadtestMode = process.argv.includes("--atomic") ? "atomic" : "racy";
  const configuration: WorkerConfiguration = {
    connectionString,
    tenantId: `loadtest-${randomUUID()}`,
    subject: `did:stellar:testnet:loadtest:${randomUUID()}`,
    at: new Date().toISOString(),
    mode,
  };
  const workers = Array.from({ length: PROCESS_COUNT }, () => spawnWorker(configuration));
  const cleanupPool = createCleanupPool(connectionString);

  try {
    await waitForAll(workers, (messages) => messages.some((message) => message.type === "ready"), "workers to connect");
    for (let round = 0; round < ATTEMPTS_PER_PROCESS; round += 1) {
      for (const worker of workers) send(worker, { type: "begin", round });

      if (mode === "atomic") {
        // No decision/commit exchange: each worker's whole read-decide-write
        // sequence already happened atomically inside `vault.atomically()`
        // by the time its `roundComplete` arrives.
        await waitForAll(
          workers,
          (messages) => messages.some((message) => message.type === "roundComplete" && message.round === round),
          `round ${round + 1} (atomic)`,
        );
        continue;
      }

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
    // Not a `.once("exit", ...)` listener attached here: atomic mode's
    // workers can finish and exit fast enough that the event already fired
    // before such a listener would attach, which would then wait forever
    // (found running this exact harness — the process went quiet and exited
    // 0 on its own once nothing else was left to keep the event loop alive).
    // `exitCode` is instead recorded by the listener `spawnWorker` attaches
    // immediately on spawn, so polling it here can never miss the event.
    await waitForExit(workers);

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
    console.log(`  mode:            ${mode}`);
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
