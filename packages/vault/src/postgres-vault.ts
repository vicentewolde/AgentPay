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
  // Supabase (this project's documented choice, .env.example) requires TLS
  // for external connections; `pg` does not negotiate it on its own from a
  // plain `postgresql://` string. `rejectUnauthorized: false` skips CA
  // verification, not encryption itself — the same trade-off every popular
  // guide for connecting to Supabase from Render/Vercel/Heroku makes,
  // because Node's default CA bundle does not ship Supabase's chain.
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await pool.query(CREATE_TABLE_SQL);
  } catch (error) {
    // The underlying driver error (wrong password, SSL required, host
    // unreachable, ...) used to vanish here — logged nowhere, shown nowhere.
    // Both the server log (for a host like Render, where that's the only
    // place to look) and the details this bubbles up to the caller now carry
    // the real message, not just this function's own generic one.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[vault] could not reach or initialise Postgres: ${message}`);
    throw new AgentPassError("ConfigError", "could not reach or initialise the vault's Postgres database", {
      cause: error,
      details: { cause: message },
    });
  }

  let rows: readonly VaultRow[];
  try {
    ({ rows } = await pool.query<VaultRow>(
      "select seq, prev_hash, hash, entry from vault_records where tenant_id = $1 order by seq asc",
      [tenantId],
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[vault] could not load vault_records for tenant ${tenantId}: ${message}`);
    throw new AgentPassError("ConfigError", "could not read this tenant's vault records from Postgres", {
      cause: error,
      details: { cause: message },
    });
  }

  const records: VaultRecord[] = rows.map((row) => ({
    seq: row.seq,
    prevHash: row.prev_hash,
    hash: row.hash,
    entry: row.entry,
  }));

  const seenIntents = new Set<string>();
  for (const record of records) {
    if (record.entry.kind === "granted") seenIntents.add(record.entry.intentId);
  }

  /**
   * Serialises appends to this tenant's chain across every writer connected
   * to this Postgres — not just within this process. `seq`/`prevHash` used
   * to come from this instance's own local `records` array (`records.length`,
   * `records.at(-1)`), which is exactly what let two live instances of this
   * same tenant's vault both compute `seq = 0` and collide on the table's own
   * primary key the moment both tried to append (found writing this ticket's
   * own test, not by inspection). `pg_advisory_xact_lock` is a Postgres-side
   * lock keyed by `tenantId`: whichever writer — this process or another one
   * entirely — asks for it first holds it until its transaction commits or
   * rolls back, and every other asker (any process) blocks until then. The
   * `seq`/`prevHash` this reads are the real, current tail of the chain,
   * always read inside that same lock, so no other writer can move the tail
   * out from under it between the read and the insert.
   */
  async function append(entry: VaultEntry): Promise<VaultRecord> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [tenantId]);

      const { rows: tail } = await client.query<{ seq: number; hash: string }>(
        "select seq, hash from vault_records where tenant_id = $1 order by seq desc limit 1",
        [tenantId],
      );
      const seq = (tail[0]?.seq ?? -1) + 1;
      const prevHash = tail[0]?.hash ?? "";
      const record: VaultRecord = { seq, prevHash, hash: computeHash(seq, prevHash, entry), entry };

      await client.query(
        "insert into vault_records (tenant_id, seq, prev_hash, hash, entry) values ($1, $2, $3, $4, $5)",
        [tenantId, record.seq, record.prevHash, record.hash, JSON.stringify(record.entry)],
      );
      await client.query("commit");
      records.push(record);
      return record;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    // G4: reads the running total straight from Postgres on every call,
    // instead of an in-memory cache built once at construction — two
    // processes (two Render instances, or this same process before and
    // after a restart) share one source of truth for `perDay`, not one
    // cache each that never learns about the other's writes. `checkDailyLimit`
    // itself is untouched (M-10 / this ticket's own scope): only where the
    // total it is handed comes from changes.
    async spentOn(subject, currency, at) {
      const { rows } = await pool.query<{ entry: VaultEntry }>(
        `select entry from vault_records
         where tenant_id = $1
           and entry->>'kind' = 'granted'
           and entry->>'subject' = $2
           and entry->>'currency' = $3
           and left(entry->>'at', 10) = $4`,
        [tenantId, subject, currency, utcDayKey(at)],
      );
      let total = 0n;
      for (const row of rows) {
        if (row.entry.kind === "granted") total += scaleAmount(row.entry.amount);
      }
      return unscaleAmount(total);
    },

    async record(entry) {
      if (seenIntents.has(entry.intentId)) return;

      // Validates and throws `InvalidAmount` before anything is written —
      // same rule as the file backend: a rejected entry stays retryable
      // under the same intentId, not silently and permanently dropped.
      scaleAmount(entry.amount);

      await append({
        kind: "granted",
        subject: entry.subject,
        intentId: entry.intentId,
        currency: entry.currency,
        amount: entry.amount,
        at: entry.at.toISOString(),
      });

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
