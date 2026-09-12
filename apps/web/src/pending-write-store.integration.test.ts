/**
 * Live Postgres proof for T68/G12: `save` on one store instance, `take` on
 * a *different* one — exactly the two-request boundary
 * `prepareAnchor`/`prepareRevoke` and `submitSigned` cross in production.
 *
 *   pnpm --filter @agentpey/web run test:integration
 *
 * Requires DATABASE_URL in .env.local. Cleanup removes only this run's own
 * `test-` request ids.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { AgentPassError } from "@agentpass/core";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPostgresPendingWriteStore } from "./pending-write-store.js";

const ENV_PATH = fileURLToPath(new URL("../../../.env.local", import.meta.url));

async function loadDatabaseUrl(): Promise<string> {
  const contents = await readFile(ENV_PATH, "utf8").catch(() => "");
  const match = /^\s*DATABASE_URL\s*=\s*"?(.*?)"?\s*$/m.exec(contents);
  if (match?.[1] === undefined || match[1] === "") {
    throw new AgentPassError(
      "ConfigError",
      `${ENV_PATH} is missing DATABASE_URL. Add it before running this live test.`,
      { details: { envPath: ENV_PATH, key: "DATABASE_URL" } },
    );
  }
  return match[1];
}

describe("createPostgresPendingWriteStore", () => {
  let connectionString: string;
  let pool: Pool;
  const requestIds: string[] = [];

  beforeAll(async () => {
    connectionString = await loadDatabaseUrl();
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  });

  afterEach(async () => {
    while (requestIds.length > 0) {
      const requestId = requestIds.pop();
      await pool.query("delete from sdk_pending_writes where request_id = $1", [requestId]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  function freshRequestId(): string {
    const requestId = `test-${randomUUID()}`;
    requestIds.push(requestId);
    return requestId;
  }

  it("save on one instance, take on a different one — the exact boundary G12 closes", async () => {
    const storeA = await createPostgresPendingWriteStore({ connectionString });
    const storeB = await createPostgresPendingWriteStore({ connectionString });
    const requestId = freshRequestId();
    const write = {
      kind: "anchor" as const,
      issuerAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV",
      credentialHash: "a".repeat(64),
      subject: "GZYXWVUTSRQPONMLKJIHGFEDCBA765432ZYXWVUTSRQPONMLKJIHGFE",
      expiresAt: new Date().toISOString(),
    };

    await storeA.save(requestId, write, 60_000);

    await expect(storeB.take(requestId)).resolves.toEqual(write);
  });

  it("take consumes — a second read finds nothing, on any instance", async () => {
    const storeA = await createPostgresPendingWriteStore({ connectionString });
    const storeB = await createPostgresPendingWriteStore({ connectionString });
    const requestId = freshRequestId();
    const write = { kind: "revoke" as const, issuerAddress: "GABC", credentialHash: "b".repeat(64) };

    await storeA.save(requestId, write, 60_000);
    await expect(storeA.take(requestId)).resolves.toEqual(write);
    await expect(storeB.take(requestId)).resolves.toBeUndefined();
  });

  it("an expired write is unreadable, even by the instance that saved it", async () => {
    const store = await createPostgresPendingWriteStore({ connectionString });
    const requestId = freshRequestId();
    const write = { kind: "revoke" as const, issuerAddress: "GABC", credentialHash: "c".repeat(64) };

    await store.save(requestId, write, -1_000); // already expired

    await expect(store.take(requestId)).resolves.toBeUndefined();
  });

  it("an unknown requestId reads as undefined, not an error", async () => {
    const store = await createPostgresPendingWriteStore({ connectionString });

    await expect(store.take(`test-${randomUUID()}`)).resolves.toBeUndefined();
  });

  it("sweepExpired (T70) deletes an abandoned write from the raw table, leaves a live one readable", async () => {
    const store = await createPostgresPendingWriteStore({ connectionString });
    const expiredId = freshRequestId();
    const liveId = freshRequestId();
    const write = { kind: "revoke" as const, issuerAddress: "GABC", credentialHash: "d".repeat(64) };

    await store.save(expiredId, write, -1_000); // abandoned — never followed by a take()
    await store.save(liveId, write, 60_000);

    const swept = await store.sweepExpired();
    expect(swept.deleted).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query("select 1 from sdk_pending_writes where request_id = $1", [expiredId]);
    expect(rows).toHaveLength(0);
    await expect(store.take(liveId)).resolves.toEqual(write);
  });
});
