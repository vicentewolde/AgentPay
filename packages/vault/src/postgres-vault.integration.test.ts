/**
 * Against a **live Postgres database** (Supabase in the pilot). Nothing here
 * is mocked — the point is to prove the exact failure mode this backend
 * fixes: that a vault's history survives a process restart, which
 * `createFileMandateVault` cannot promise on a host with an ephemeral
 * filesystem (Render's free tier).
 *
 *   pnpm --filter @agentpay/vault run test:integration
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
