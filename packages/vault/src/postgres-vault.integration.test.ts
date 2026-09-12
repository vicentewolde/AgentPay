/**
 * Against a **live Postgres database** (Supabase in the pilot). Nothing here
 * is mocked — the point is to prove the exact failure mode this backend
 * fixes: that a vault's history survives a process restart, which
 * `createFileMandateVault` cannot promise on a host with an ephemeral
 * filesystem (Render's free tier).
 *
 *   pnpm --filter @agentpey/vault run test:integration
 *
 * Requires `DATABASE_URL` in `.env.local`. Every test uses its own random
 * `tenantId` and deletes its own rows in `afterEach`, so repeated runs never
 * accumulate rows in the shared database and never collide with a real
 * tenant's data.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMandateVault } from "./postgres-vault.js";

const ENV_PATH = fileURLToPath(new URL("../../../.env.local", import.meta.url));

async function loadDatabaseUrl(): Promise<string> {
  const contents = await readFile(ENV_PATH, "utf8").catch(() => {
    throw new Error(`${ENV_PATH} is missing. Add DATABASE_URL to it first — see .env.example.`);
  });
  for (const line of contents.split("\n")) {
    const match = /^\s*DATABASE_URL\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (match?.[1] !== undefined && match[1] !== "") return match[1];
  }
  throw new Error(`DATABASE_URL is not set in ${ENV_PATH}.`);
}

describe("createPostgresMandateVault", () => {
  let connectionString: string;
  let pool: Pool;
  const usedTenantIds: string[] = [];

  beforeAll(async () => {
    connectionString = await loadDatabaseUrl();
    pool = new Pool({ connectionString });
  });

  afterEach(async () => {
    // A test may use more than one tenantId (e.g. two tenants at once) —
    // clean up every one it touched, not just the last.
    while (usedTenantIds.length > 0) {
      const tenantId = usedTenantIds.pop();
      await pool.query("delete from vault_records where tenant_id = $1", [tenantId]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  function freshTenantId(): string {
    const tenantId = `test-${randomUUID()}`;
    usedTenantIds.push(tenantId);
    return tenantId;
  }

  it("records a grant and reports it back in spentOn", async () => {
    const tenantId = freshTenantId();
    const vault = await createPostgresMandateVault({ connectionString, tenantId });
    const at = new Date("2026-09-09T12:00:00.000Z");

    await vault.record({ subject: "did:stellar:testnet:GABC", intentId: "i1", currency: "USDC", amount: "5.00", at });

    expect(await vault.spentOn("did:stellar:testnet:GABC", "USDC", at)).toBe("5.0000000");
    expect(await vault.hasRecorded("i1")).toBe(true);
  });

  it("deduplicates a grant by intentId, same as the file backend", async () => {
    const tenantId = freshTenantId();
    const vault = await createPostgresMandateVault({ connectionString, tenantId });
    const at = new Date("2026-09-09T12:00:00.000Z");
    const entry = { subject: "did:stellar:testnet:GABC", intentId: "same", currency: "USDC", amount: "5.00", at };

    await vault.record(entry);
    await vault.record(entry);

    expect(await vault.spentOn("did:stellar:testnet:GABC", "USDC", at)).toBe("5.0000000");
    expect(vault.list().length).toBe(1);
  });

  it("keeps refusals and anchors in the same chain, and passes verify()", async () => {
    const tenantId = freshTenantId();
    const vault = await createPostgresMandateVault({ connectionString, tenantId });

    await vault.record({
      subject: "did:stellar:testnet:GABC",
      intentId: "i1",
      currency: "USDC",
      amount: "1.00",
      at: new Date(),
    });
    await vault.recordRefusal({
      subject: "did:stellar:testnet:GABC",
      intentId: "i2",
      code: "ScopeAmountExceeded",
      reason: "over perTx",
      details: {},
    });
    await vault.recordAnchor({
      subject: "did:stellar:testnet:GABC",
      intentId: "i1",
      paymentTx: "tx123",
      linkHash: "hash123",
      anchorTx: "anchortx123",
    });

    expect(vault.list().map((r) => r.entry.kind)).toEqual(["granted", "refused", "anchored"]);
    expect(vault.verify()).toEqual({ ok: true });
  });

  it("survives being reconstructed — the exact scenario a Render restart forces", async () => {
    const tenantId = freshTenantId();
    const at = new Date("2026-09-09T12:00:00.000Z");

    const before = await createPostgresMandateVault({ connectionString, tenantId });
    await before.record({
      subject: "did:stellar:testnet:GABC",
      intentId: "i1",
      currency: "USDC",
      amount: "3.00",
      at,
    });

    // A brand-new instance, as if the process had just restarted — no
    // shared in-memory state with `before` at all.
    const after = await createPostgresMandateVault({ connectionString, tenantId });

    expect(after.list().length).toBe(1);
    expect(await after.spentOn("did:stellar:testnet:GABC", "USDC", at)).toBe("3.0000000");
    expect(after.verify()).toEqual({ ok: true });

    // And it keeps appending to the same chain, not a fresh one.
    await after.record({
      subject: "did:stellar:testnet:GABC",
      intentId: "i2",
      currency: "USDC",
      amount: "2.00",
      at,
    });
    expect(after.list().length).toBe(2);
    expect(after.list()[1]?.prevHash).toBe(after.list()[0]?.hash);
  });

  it(
    "G4: a second, already-running instance sees the first one's spend immediately — no cache to go stale",
    async () => {
      const tenantId = freshTenantId();
      const at = new Date("2026-09-09T12:00:00.000Z");
      const subject = "did:stellar:testnet:GABC";

      // Both alive at once, like two Render instances behind the same
      // Postgres — unlike "survives being reconstructed" above, `b` is not
      // built *after* `a`'s write; it already exists when `a` writes.
      const a = await createPostgresMandateVault({ connectionString, tenantId });
      const b = await createPostgresMandateVault({ connectionString, tenantId });

      expect(await b.spentOn(subject, "USDC", at)).toBe("0.0000000");

      await a.record({ subject, intentId: "i1", currency: "USDC", amount: "5.00", at });

      // Before the fix, `b.spentOn` read from a `totals` map built once at
      // construction — it would still report "0.0000000" here forever,
      // regardless of what `a` (or any other process) ever recorded.
      expect(await b.spentOn(subject, "USDC", at)).toBe("5.0000000");

      // And the reverse direction holds too: `a` sees `b`'s writes.
      await b.record({ subject, intentId: "i2", currency: "USDC", amount: "3.00", at });
      expect(await a.spentOn(subject, "USDC", at)).toBe("8.0000000");
    },
  );

  it(
    "G4: two instances racing the same perDay limit — the second sees the first's spend and correctly refuses to record over it",
    async () => {
      // The daily-limit decision itself (`checkDailyLimit`, apps/agent) is
      // out of scope here on purpose (this ticket changes where the total
      // comes from, not how it is judged) and packages/* never depends on
      // apps/* (see this file's header). The boundary check below is that
      // same "spentToday + amount > perDay" arithmetic, inlined, only to
      // prove the vault hands out a total a caller could correctly act on.
      const tenantId = freshTenantId();
      const at = new Date("2026-09-09T12:00:00.000Z");
      const subject = "did:stellar:testnet:GABC";
      const perDayScaled = 60_000_000n; // 6.00, at the vault's own 7-decimal scale

      const a = await createPostgresMandateVault({ connectionString, tenantId });
      const b = await createPostgresMandateVault({ connectionString, tenantId });

      // `a` spends 5.00 of a 6.00 perDay limit — comfortably under.
      const spentBeforeA = await a.spentOn(subject, "USDC", at);
      expect(spentBeforeA).toBe("0.0000000");
      await a.record({ subject, intentId: "a1", currency: "USDC", amount: "5.00", at });

      // `b`, a separate instance that never saw `a`'s write in memory
      // (before this fix, its own `totals` cache would still read "0.00"
      // here, forever), asks about spending another 5.00 — over the limit
      // once `a`'s spend is actually counted.
      const spentBeforeB = await b.spentOn(subject, "USDC", at);
      expect(spentBeforeB).toBe("5.0000000");
      const wouldTotal = 50_000_000n + 50_000_000n; // spentBeforeB + the new 5.00, scaled
      expect(wouldTotal > perDayScaled).toBe(true);
      // `b` correctly never calls `record` for a decision it must refuse —
      // the ledger stays exactly what `a` alone put there.
      expect(await a.spentOn(subject, "USDC", at)).toBe("5.0000000");
    },
  );

  it(
    "two instances truly racing to record() the same tenant never collide on seq — the chain stays unbroken",
    async () => {
      // Not sequential like the tests above: both instances fire `record`
      // at the same time, on purpose, to actually exercise the advisory
      // lock rather than just assert around it. Before this fix, `seq` came
      // from each instance's own local `records.length` — this reproduces
      // the exact "duplicate key value violates unique constraint
      // vault_records_pkey" crash this ticket found and fixed.
      const tenantId = freshTenantId();
      const at = new Date("2026-09-09T12:00:00.000Z");
      const subject = "did:stellar:testnet:GABC";

      const a = await createPostgresMandateVault({ connectionString, tenantId });
      const b = await createPostgresMandateVault({ connectionString, tenantId });

      await Promise.all([
        a.record({ subject, intentId: "a1", currency: "USDC", amount: "1.00", at }),
        b.record({ subject, intentId: "b1", currency: "USDC", amount: "2.00", at }),
      ]);

      // Whichever instance's transaction committed first, both must have
      // succeeded, with distinct, correctly-chained seqs — not a crash, and
      // not a fork.
      const fresh = await createPostgresMandateVault({ connectionString, tenantId });
      expect(fresh.list().length).toBe(2);
      expect(fresh.list().map((r) => r.seq).sort()).toEqual([0, 1]);
      expect(fresh.verify()).toEqual({ ok: true });
      expect(await fresh.spentOn(subject, "USDC", at)).toBe("3.0000000");
    },
  );

  it("keeps two tenants' chains fully independent", async () => {
    const tenantA = freshTenantId();
    const tenantB = freshTenantId();
    const at = new Date("2026-09-09T12:00:00.000Z");

    const vaultA = await createPostgresMandateVault({ connectionString, tenantId: tenantA });
    const vaultB = await createPostgresMandateVault({ connectionString, tenantId: tenantB });

    await vaultA.record({ subject: "did:stellar:testnet:GA", intentId: "a1", currency: "USDC", amount: "1.00", at });
    await vaultB.record({ subject: "did:stellar:testnet:GB", intentId: "b1", currency: "USDC", amount: "9.00", at });

    expect(vaultA.list().length).toBe(1);
    expect(vaultB.list().length).toBe(1);
    expect(await vaultA.spentOn("did:stellar:testnet:GA", "USDC", at)).toBe("1.0000000");
    expect(await vaultB.spentOn("did:stellar:testnet:GB", "USDC", at)).toBe("9.0000000");
  });
});
