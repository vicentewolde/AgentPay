/**
 * MandateVault (Fase 5, T27): a durable, tamper-evident record of every
 * `PolicyRail` decision — granted or refused — so the daily-spend memory
 * survives a restart, and a refusal is not lost the moment the response is
 * sent.
 *
 * Every prior phase's decision state was ephemeral by design, and said so out
 * loud: `SpendLedger`'s in-memory implementation (Fase 3, `apps/agent`)
 * "loses everything on restart — fine for a pilot and for tests, not for
 * anything that needs to survive one." This is that something.
 *
 * `MandateVault` is deliberately typed to satisfy `SpendLedger`'s three
 * methods (`spentOn`, `record`, `hasRecorded`) **structurally**, without
 * importing that type — the same pattern `RegistryAccess` already established
 * in `@agentpay/mandate` (T20): a package stays ignorant of an app's types,
 * and TypeScript's structural typing is what makes the app's `PolicyRail`
 * accept a `MandateVault` wherever it expects a `SpendLedger`, with no
 * adapter code anywhere. `packages/*` never depends on `apps/*` in this repo;
 * this keeps that true.
 *
 * Append-only, hash-chained JSON Lines on disk: each record's hash covers its
 * own fields and the previous record's hash, so editing any old line breaks
 * every hash after it. It is the same "off-chain document, hash that can be
 * anchored on-chain" shape credentials and mandates already use — `verify()`
 * here is the offline half of that. Anchoring the chain's head on Stellar
 * after a real payment, closing the on-chain half of the loop, is a later
 * milestone (T28), not this one: this file only has to make the claim
 * checkable, not yet checked by anyone but the vault's own owner.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { AgentPassError, decimalAmountSchema } from "@agentpass/core";

/** Stellar carries seven decimal places — same scale `apps/agent`'s amount arithmetic uses. */
const AMOUNT_DECIMALS = 7;
const SCALE = 10_000_000n;

function invalidAmount(value: unknown): AgentPassError {
  return new AgentPassError("InvalidAmount", `"${String(value)}" is not a usable amount`, {
    details: { value: String(value) },
  });
}

/** @throws AgentPassError `InvalidAmount` for anything the credential schema would not accept. */
function scaleAmount(value: string): bigint {
  const parsed = decimalAmountSchema.safeParse(value);
  if (!parsed.success) throw invalidAmount(value);
  const [whole, fraction = ""] = parsed.data.split(".") as [string, string?];
  const padded = `${fraction}0000000`.slice(0, AMOUNT_DECIMALS);
  return BigInt(whole) * SCALE + BigInt(padded);
}

function unscaleAmount(scaled: bigint): string {
  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE).toString().padStart(AMOUNT_DECIMALS, "0");
  return `${whole}.${fraction}`;
}

/** `YYYY-MM-DD`, in UTC — the same day boundary `SpendLedger` uses. */
function utcDayKey(at: Date): string {
  const iso = at.toISOString();
  return iso.slice(0, iso.indexOf("T"));
}

export interface VaultGrantedEntry {
  readonly kind: "granted";
  readonly subject: string;
  readonly intentId: string;
  readonly currency: string;
  readonly amount: string;
  readonly at: string;
}

export interface VaultRefusedEntry {
  readonly kind: "refused";
  readonly subject: string;
  readonly intentId: string;
  readonly code: string;
  readonly reason: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly at: string;
}

/**
 * That a `granted` decision's payment settled and got anchored on-chain
 * (Fase 5, T28) — the third thing that can happen to an intent, after
 * `granted`/`refused`. Kept in the same chain as everything else, so the act
 * of anchoring is itself part of the tamper-evident history, not just its
 * on-chain result.
 */
export interface VaultAnchoredEntry {
  readonly kind: "anchored";
  readonly subject: string;
  readonly intentId: string;
  /** The Stellar transaction hash the payment itself settled as. */
  readonly paymentTx: string;
  /** `sha256(<granted record's hash> + ":" + paymentTx)` — what got anchored. */
  readonly linkHash: string;
  /** The transaction hash of the anchoring call itself. */
  readonly anchorTx: string;
  readonly at: string;
}

export type VaultEntry = VaultGrantedEntry | VaultRefusedEntry | VaultAnchoredEntry;

export interface VaultRecord {
  readonly seq: number;
  /** The previous record's `hash`, or `""` for the first record (`seq === 0`). */
  readonly prevHash: string;
  readonly hash: string;
  readonly entry: VaultEntry;
}

export interface RecordRefusalInput {
  readonly subject: string;
  readonly intentId: string;
  readonly code: string;
  readonly reason: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface RecordAnchorInput {
  readonly subject: string;
  readonly intentId: string;
  readonly paymentTx: string;
  readonly linkHash: string;
  readonly anchorTx: string;
}

export interface VaultVerification {
  readonly ok: boolean;
  /** The first record whose stored hash does not match its recomputed hash, if any. */
  readonly brokenAtSeq?: number;
}

export interface MandateVault {
  // The SpendLedger port (`apps/agent/src/ledger/spend-ledger.ts`), satisfied
  // structurally — see the file docstring.
  spentOn(subject: string, currency: string, at: Date): Promise<string>;
  record(entry: {
    readonly subject: string;
    readonly intentId: string;
    readonly currency: string;
    readonly amount: string;
    readonly at: Date;
  }): Promise<void>;
  hasRecorded(intentId: string): Promise<boolean>;

  /** Everything `record` is not: a refusal, kept instead of thrown away. */
  recordRefusal(input: RecordRefusalInput, at?: Date): Promise<void>;

  /** That a `granted` decision's payment settled and got anchored on-chain (T28). */
  recordAnchor(input: RecordAnchorInput, at?: Date): Promise<void>;

  /** The full chain, in order — or just one subject's slice of it. */
  list(subject?: string): readonly VaultRecord[];

  /** The latest record's hash, or `undefined` for an empty vault. */
  head(): string | undefined;

  /** Recomputes every hash from the stored entries and confirms none were edited after the fact. */
  verify(): VaultVerification;
}

function computeHash(seq: number, prevHash: string, entry: VaultEntry): string {
  return createHash("sha256").update(JSON.stringify({ seq, prevHash, entry }), "utf8").digest("hex");
}

/** @throws AgentPassError `VaultCorrupted` for a file that is not well-formed JSON Lines of {@link VaultRecord}s. */
function parseLine(line: string, path: string): VaultRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new AgentPassError("VaultCorrupted", `${path} contains a line that is not valid JSON`, {
      cause: error,
      details: { path },
    });
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    typeof (parsed as { seq?: unknown }).seq !== "number" ||
    typeof (parsed as { prevHash?: unknown }).prevHash !== "string" ||
    typeof (parsed as { hash?: unknown }).hash !== "string" ||
    typeof (parsed as { entry?: unknown }).entry !== "object"
  ) {
    throw new AgentPassError("VaultCorrupted", `${path} contains a record that is not a valid vault entry`, {
      details: { path },
    });
  }
  return parsed as VaultRecord;
}

/**
 * A {@link MandateVault} backed by an append-only JSON Lines file at `path`.
 * Rebuilds its in-memory state (totals, seen intents, chain head) from the
 * file on construction, so a restart picks up exactly where the process left
 * off — the durability `SpendLedger`'s in-memory implementation could not
 * offer.
 *
 * Every write is synchronous (`appendFileSync`) on purpose: Node runs
 * JavaScript single-threaded, so a synchronous write cannot interleave with
 * another call's read-modify-write of the in-memory state the way an
 * `await`-ing async write could. `LocalPolicyRail` already serialises
 * `authorise()` per subject (`M-15`); this adds no further locking because
 * none is needed within one process — the same limit already written down
 * for `SpendLedger` and `LocalPolicyRail` applies here too: durable within
 * this process's file, not across more than one process writing the same
 * path concurrently.
 *
 * @throws AgentPassError `VaultCorrupted` if `path` already exists and is not
 * well-formed JSON Lines of {@link VaultRecord}s.
 */
export function createFileMandateVault(options: { readonly path: string }): MandateVault {
  const { path } = options;

  const records: VaultRecord[] = [];
  const totals = new Map<string, Map<string, Map<string, bigint>>>();
  const seenIntents = new Set<string>();

  if (existsSync(path)) {
    const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
    for (const line of lines) {
      const record = parseLine(line, path);
      records.push(record);
      if (record.entry.kind === "granted") {
        seenIntents.add(record.entry.intentId);
        const scaled = scaleAmount(record.entry.amount);
        const bySubject = totals.get(record.entry.subject) ?? new Map<string, Map<string, bigint>>();
        totals.set(record.entry.subject, bySubject);
        const byCurrency = bySubject.get(record.entry.currency) ?? new Map<string, bigint>();
        bySubject.set(record.entry.currency, byCurrency);
        const day = record.entry.at.slice(0, record.entry.at.indexOf("T"));
        byCurrency.set(day, (byCurrency.get(day) ?? 0n) + scaled);
      }
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }

  function append(entry: VaultEntry): VaultRecord {
    const seq = records.length;
    const prevHash = records.at(-1)?.hash ?? "";
    const record: VaultRecord = { seq, prevHash, hash: computeHash(seq, prevHash, entry), entry };
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
    records.push(record);
    return record;
  }

  return {
    async spentOn(subject, currency, at) {
      const total = totals.get(subject)?.get(currency)?.get(utcDayKey(at)) ?? 0n;
      return unscaleAmount(total);
    },

    async record(entry) {
      if (seenIntents.has(entry.intentId)) return;

      // Validates the amount, and throws `InvalidAmount` before anything is
      // appended — a rejected entry must stay retryable under the same
      // intentId, not silently and permanently ignored (mirrors the
      // in-memory `SpendLedger`'s own rule).
      const scaled = scaleAmount(entry.amount);

      append({
        kind: "granted",
        subject: entry.subject,
        intentId: entry.intentId,
        currency: entry.currency,
        amount: entry.amount,
        at: entry.at.toISOString(),
      });

      const bySubject = totals.get(entry.subject) ?? new Map<string, Map<string, bigint>>();
      totals.set(entry.subject, bySubject);
      const byCurrency = bySubject.get(entry.currency) ?? new Map<string, bigint>();
      bySubject.set(entry.currency, byCurrency);
      const day = utcDayKey(entry.at);
      byCurrency.set(day, (byCurrency.get(day) ?? 0n) + scaled);

      seenIntents.add(entry.intentId);
    },

    async hasRecorded(intentId) {
      return seenIntents.has(intentId);
    },

    async recordRefusal(input, at) {
      append({
        kind: "refused",
        subject: input.subject,
        intentId: input.intentId,
        code: input.code,
        reason: input.reason,
        details: input.details,
        at: (at ?? new Date()).toISOString(),
      });
    },

    async recordAnchor(input, at) {
      append({
        kind: "anchored",
        subject: input.subject,
        intentId: input.intentId,
        paymentTx: input.paymentTx,
        linkHash: input.linkHash,
        anchorTx: input.anchorTx,
        at: (at ?? new Date()).toISOString(),
      });
    },

    list(subject) {
      return subject === undefined ? records.slice() : records.filter((r) => r.entry.subject === subject);
    },

    head() {
      return records.at(-1)?.hash;
    },

    verify() {
      let prevHash = "";
      for (const record of records) {
        const expected = computeHash(record.seq, prevHash, record.entry);
        if (record.hash !== expected || record.prevHash !== prevHash) {
          return { ok: false, brokenAtSeq: record.seq };
        }
        prevHash = record.hash;
      }
      return { ok: true };
    },
  };
}
