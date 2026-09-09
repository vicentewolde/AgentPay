/**
 * A {@link MandateVault} backed by Postgres — Fase 6, T33. The append-only,
 * hash-chained shape is identical to {@link createFileMandateVault}; the only
 * thing that changes is where the records live.
 *
 * Motive: `createFileMandateVault` writes JSON Lines to a path on local
 * disk, which is exactly what breaks on Render's free tier — the
 * filesystem is wiped on every redeploy and every scale-to-zero restart, so
 * a vault built that way loses its evidence the moment the pilot's host
 * restarts, not just when someone deletes it on purpose. Postgres survives
 * that restart; this is the only difference that matters for the fix.
 *
 * `tenantId` scopes the chain: every row this instance writes or reads
 * carries the same `tenant_id`, so one shared Postgres database can hold
 * many independent vaults (one per `apps/web` session today, one per real
 * partner once T34 gives each tenant its own funded Stellar identity) in one
 * table, the same way `createFileMandateVault`'s `path` scopes one vault to
 * one file.
 */
import { AgentPassError } from "@agentpass/core";
import { Pool } from "pg";

import { computeHash, scaleAmount, utcDayKey, unscaleAmount } from "./internal/amount.js";
import type { MandateVault, VaultEntry, VaultRecord } from "./vault.js";

export interface PostgresMandateVaultOptions {
  readonly connectionString: string;
  readonly tenantId: string;
}

interface VaultRow {
  readonly seq: number;
  readonly prev_hash: string;
  readonly hash: string;
  readonly entry: VaultEntry;
}

// `entry` is `json`, not `jsonb`, on purpose: Postgres's `jsonb` type
// normalises object key order on write, while `json` preserves the exact
// text it was given. `computeHash` recomputes over `JSON.stringify(entry)`,
// which is order-sensitive — a `jsonb` round trip silently reorders keys and
// makes `verify()` report tampering that never happened (found by this
// package's own integration test, not read from documentation).
const CREATE_TABLE_SQL = `
  create table if not exists vault_records (
    tenant_id  text        not null,
    seq        integer     not null,
    prev_hash  text        not null,
    hash       text        not null,
    entry      json        not null,
    created_at timestamptz not null default now(),
    primary key (tenant_id, seq)
  )
`;

/**
 * @throws AgentPassError `ConfigError` if `connectionString` cannot be
 * reached at all (the caller almost certainly wants that to be loud, not a
 * vault that silently behaves as if it were empty).
 */
export async function createPostgresMandateVault(options: PostgresMandateVaultOptions): Promise<MandateVault> {
  const { connectionString, tenantId } = options;
  const pool = new Pool({ connectionString });

  try {
    await pool.query(CREATE_TABLE_SQL);
  } catch (error) {
    throw new AgentPassError("ConfigError", "could not reach or initialise the vault's Postgres database", {
      cause: error,
    });
  }

  const { rows } = await pool.query<VaultRow>(
    "select seq, prev_hash, hash, entry from vault_records where tenant_id = $1 order by seq asc",
    [tenantId],
  );

  const records: VaultRecord[] = rows.map((row) => ({
    seq: row.seq,
    prevHash: row.prev_hash,
    hash: row.hash,
    entry: row.entry,
  }));

  const totals = new Map<string, Map<string, Map<string, bigint>>>();
  const seenIntents = new Set<string>();

  for (const record of records) {
    if (record.entry.kind !== "granted") continue;
    seenIntents.add(record.entry.intentId);
    const scaled = scaleAmount(record.entry.amount);
    const bySubject = totals.get(record.entry.subject) ?? new Map<string, Map<string, bigint>>();
    totals.set(record.entry.subject, bySubject);
    const byCurrency = bySubject.get(record.entry.currency) ?? new Map<string, bigint>();
    bySubject.set(record.entry.currency, byCurrency);
    const day = record.entry.at.slice(0, record.entry.at.indexOf("T"));
    byCurrency.set(day, (byCurrency.get(day) ?? 0n) + scaled);
  }

  // Serialises appends within this process: each call's insert only starts
  // once the previous one has committed and pushed its record into `records`,
  // so two overlapping calls can never compute the same `seq`/`prevHash`.
  // Same limit as the file backend (V-7): durable within one process writing
  // this tenant's rows, not across more than one process at a time.
  let writeQueue: Promise<void> = Promise.resolve();

  function append(entry: VaultEntry): Promise<VaultRecord> {
    const result = writeQueue.then(async () => {
      const seq = records.length;
      const prevHash = records.at(-1)?.hash ?? "";
      const record: VaultRecord = { seq, prevHash, hash: computeHash(seq, prevHash, entry), entry };
      await pool.query(
        "insert into vault_records (tenant_id, seq, prev_hash, hash, entry) values ($1, $2, $3, $4, $5)",
        [tenantId, record.seq, record.prevHash, record.hash, JSON.stringify(record.entry)],
      );
      records.push(record);
      return record;
    });
    // Keep the queue alive even if this append failed, so a later append
    // is not permanently blocked behind a rejected promise.
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    async spentOn(subject, currency, at) {
      const total = totals.get(subject)?.get(currency)?.get(utcDayKey(at)) ?? 0n;
      return unscaleAmount(total);
    },

    async record(entry) {
      if (seenIntents.has(entry.intentId)) return;

      // Validates and throws `InvalidAmount` before anything is written —
      // same rule as the file backend: a rejected entry stays retryable
      // under the same intentId, not silently and permanently dropped.
      const scaled = scaleAmount(entry.amount);

      await append({
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
      await append({
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
      await append({
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
