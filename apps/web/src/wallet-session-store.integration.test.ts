/**
 * Live Postgres proof for T69/G12: every table `save`s on one store
 * instance and `get`s on a *different* one — the two-request boundary
 * (challenge → verify, wallet-consent → wallet-anchor) that used to live in
 * one process's memory.
 *
 *   pnpm --filter @agentpey/web run test:integration
 *
 * Requires DATABASE_URL in .env.local. Cleanup removes only this run's own
 * `test-` prefixed rows.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { AgentPassError } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildSessionDocuments } from "./session-documents.js";
import {
  createPostgresWalletSessionStore,
  type PendingConsentSessionPayload,
  type PendingWalletSessionPayload,
} from "./wallet-session-store.js";

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

const REGISTRY = "CBDWMXZEE44NJ3RA6RS7K4EK36KDFW5S7KHP276HCMM4I52MIUUHEF5B";

function walletSessionPayload(overrides: Partial<PendingWalletSessionPayload> = {}): PendingWalletSessionPayload {
  const now = new Date("2026-09-12T00:00:00.000Z");
  const { credential, mandate } = buildSessionDocuments({
    issuerAddress: Keypair.random().publicKey(),
    agentAddress: Keypair.random().publicKey(),
    walletAddress: Keypair.random().publicKey(),
    scope: {
      agent: { name: "wallet-session-store-test", model: "claude-opus-5", operator: "agentpey-pilot" },
      scope: {
        actions: ["catalog:read"],
        venues: [],
        assets: [],
        limits: { perTx: "1.00", perDay: "5.00", currency: "USDC" },
      },
    },
    registryContractId: REGISTRY,
    now,
    validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });
  return {
    issuedCredentialJws: "header.payload.signature",
    credentialHash: "a".repeat(64),
    credentialAnchorTx: "b".repeat(64),
    credential,
    mandate,
    walletAddress: Keypair.random().publicKey(),
    demoScope: {
      agent: { name: "wallet-session-store-test", model: "claude-opus-5", operator: "agentpey-pilot" },
      scope: { actions: ["catalog:read"], venues: [], assets: [], limits: { perTx: "1.00", perDay: "5.00", currency: "USDC" } },
    },
    baseUrl: "https://stellar-bazaar-x402.vercel.app",
    ...overrides,
  };
}

function consentSessionPayload(overrides: Partial<PendingConsentSessionPayload> = {}): PendingConsentSessionPayload {
  const payload = walletSessionPayload();
  return {
    issuedCredentialJws: payload.issuedCredentialJws,
    credentialHash: payload.credentialHash,
    credentialAnchorTx: payload.credentialAnchorTx,
    credential: payload.credential,
    mandate: payload.mandate,
    walletAddress: payload.walletAddress,
    tenantId: `test-${randomUUID()}`,
    ...overrides,
  };
}

describe("createPostgresWalletSessionStore", () => {
  let connectionString: string;
  let pool: Pool;
  const nonces: string[] = [];
  const sessionIds: string[] = [];
  const consentSessionIds: string[] = [];

  beforeAll(async () => {
    connectionString = await loadDatabaseUrl();
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  });

  afterEach(async () => {
    while (nonces.length > 0) await pool.query("delete from wallet_challenges where nonce = $1", [nonces.pop()]);
    while (sessionIds.length > 0) {
      const sessionId = sessionIds.pop();
      await pool.query("delete from pending_wallet_sessions where session_id = $1", [sessionId]);
      await pool.query("delete from wallet_address_by_session where session_id = $1", [sessionId]);
    }
    while (consentSessionIds.length > 0) {
      const consentSessionId = consentSessionIds.pop();
      await pool.query("delete from pending_consent_sessions where consent_session_id = $1", [consentSessionId]);
      await pool.query("delete from wallet_address_by_consent_session where consent_session_id = $1", [consentSessionId]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  function freshId(prefix: string): string {
    const id = `test-${prefix}-${randomUUID()}`;
    return id;
  }

  it("issueChallenge on one instance, takeChallenge on a different one — single-use", async () => {
    const storeA = await createPostgresWalletSessionStore({ connectionString });
    const storeB = await createPostgresWalletSessionStore({ connectionString });
    const nonce = freshId("nonce");
    nonces.push(nonce);

    await storeA.issueChallenge(nonce, 60_000);

    await expect(storeB.takeChallenge(nonce)).resolves.toBe(true);
    await expect(storeB.takeChallenge(nonce)).resolves.toBe(false);
  });

  it("an expired challenge is unreadable, even by the instance that issued it", async () => {
    const store = await createPostgresWalletSessionStore({ connectionString });
    const nonce = freshId("nonce");
    nonces.push(nonce);

    await store.issueChallenge(nonce, -1_000);

    await expect(store.takeChallenge(nonce)).resolves.toBe(false);
  });

  it("setPendingWalletSession on one instance, getPendingWalletSession on a different one", async () => {
    const storeA = await createPostgresWalletSessionStore({ connectionString });
    const storeB = await createPostgresWalletSessionStore({ connectionString });
    const sessionId = freshId("session");
    sessionIds.push(sessionId);
    const payload = walletSessionPayload();

    await storeA.setPendingWalletSession(sessionId, payload, 60_000);

    await expect(storeB.getPendingWalletSession(sessionId)).resolves.toEqual(payload);
  });

  it("updatePendingWalletSession merges signature/requestId without disturbing the rest", async () => {
    const storeA = await createPostgresWalletSessionStore({ connectionString });
    const storeB = await createPostgresWalletSessionStore({ connectionString });
    const sessionId = freshId("session");
    sessionIds.push(sessionId);
    const payload = walletSessionPayload();
    await storeA.setPendingWalletSession(sessionId, payload, 60_000);

    await storeA.updatePendingWalletSession(sessionId, { signature: "sig-1", requestId: "req-1" });

    await expect(storeB.getPendingWalletSession(sessionId)).resolves.toEqual({
      ...payload,
      signature: "sig-1",
      requestId: "req-1",
    });
  });

  it("deletePendingWalletSession removes it — a later get finds nothing", async () => {
    const store = await createPostgresWalletSessionStore({ connectionString });
    const sessionId = freshId("session");
    sessionIds.push(sessionId);
    await store.setPendingWalletSession(sessionId, walletSessionPayload(), 60_000);

    await store.deletePendingWalletSession(sessionId);

    await expect(store.getPendingWalletSession(sessionId)).resolves.toBeUndefined();
  });

  it("setPendingConsentSession on one instance, getPendingConsentSession on a different one", async () => {
    const storeA = await createPostgresWalletSessionStore({ connectionString });
    const storeB = await createPostgresWalletSessionStore({ connectionString });
    const consentSessionId = freshId("consent");
    consentSessionIds.push(consentSessionId);
    const payload = consentSessionPayload();

    await storeA.setPendingConsentSession(consentSessionId, payload, 60_000);

    await expect(storeB.getPendingConsentSession(consentSessionId)).resolves.toEqual(payload);
  });

  it("updatePendingConsentSession merges signature/requestId", async () => {
    const store = await createPostgresWalletSessionStore({ connectionString });
    const consentSessionId = freshId("consent");
    consentSessionIds.push(consentSessionId);
    const payload = consentSessionPayload();
    await store.setPendingConsentSession(consentSessionId, payload, 60_000);

    await store.updatePendingConsentSession(consentSessionId, { signature: "sig-2", requestId: "req-2" });

    await expect(store.getPendingConsentSession(consentSessionId)).resolves.toEqual({
      ...payload,
      signature: "sig-2",
      requestId: "req-2",
    });
  });

  it("deletePendingConsentSession removes it", async () => {
    const store = await createPostgresWalletSessionStore({ connectionString });
    const consentSessionId = freshId("consent");
    consentSessionIds.push(consentSessionId);
    await store.setPendingConsentSession(consentSessionId, consentSessionPayload(), 60_000);

    await store.deletePendingConsentSession(consentSessionId);

    await expect(store.getPendingConsentSession(consentSessionId)).resolves.toBeUndefined();
  });

  it("setWalletAddressForSession on one instance, getWalletAddressForSession on a different one — no TTL", async () => {
    const storeA = await createPostgresWalletSessionStore({ connectionString });
    const storeB = await createPostgresWalletSessionStore({ connectionString });
    const sessionId = freshId("session");
    sessionIds.push(sessionId);
    const address = Keypair.random().publicKey();

    await storeA.setWalletAddressForSession(sessionId, address);

    await expect(storeB.getWalletAddressForSession(sessionId)).resolves.toBe(address);
  });

  it("setWalletAddressForConsentSession, get on a different instance, then delete", async () => {
    const storeA = await createPostgresWalletSessionStore({ connectionString });
    const storeB = await createPostgresWalletSessionStore({ connectionString });
    const consentSessionId = freshId("consent");
    consentSessionIds.push(consentSessionId);
    const address = Keypair.random().publicKey();

    await storeA.setWalletAddressForConsentSession(consentSessionId, address);
    await expect(storeB.getWalletAddressForConsentSession(consentSessionId)).resolves.toBe(address);

    await storeB.deleteWalletAddressForConsentSession(consentSessionId);
    await expect(storeA.getWalletAddressForConsentSession(consentSessionId)).resolves.toBeUndefined();
  });

  it("an unknown key reads as undefined everywhere, not an error", async () => {
    const store = await createPostgresWalletSessionStore({ connectionString });
    const missing = freshId("missing");

    await expect(store.getPendingWalletSession(missing)).resolves.toBeUndefined();
    await expect(store.getPendingConsentSession(missing)).resolves.toBeUndefined();
    await expect(store.getWalletAddressForSession(missing)).resolves.toBeUndefined();
    await expect(store.getWalletAddressForConsentSession(missing)).resolves.toBeUndefined();
  });

  it("sweepExpired (T70) deletes rows past expires_at, leaves live rows and TTL-less rows alone", async () => {
    const store = await createPostgresWalletSessionStore({ connectionString });

    const expiredNonce = freshId("nonce");
    const liveNonce = freshId("nonce");
    nonces.push(expiredNonce, liveNonce);
    await store.issueChallenge(expiredNonce, -1_000);
    await store.issueChallenge(liveNonce, 60_000);

    const expiredSessionId = freshId("session");
    const liveSessionId = freshId("session");
    sessionIds.push(expiredSessionId, liveSessionId);
    await store.setPendingWalletSession(expiredSessionId, walletSessionPayload(), -1_000);
    await store.setPendingWalletSession(liveSessionId, walletSessionPayload(), 60_000);

    const expiredConsentId = freshId("consent");
    const liveConsentId = freshId("consent");
    consentSessionIds.push(expiredConsentId, liveConsentId);
    await store.setPendingConsentSession(expiredConsentId, consentSessionPayload(), -1_000);
    await store.setPendingConsentSession(liveConsentId, consentSessionPayload(), 60_000);

    // No expires_at at all (C-71) — sweepExpired must never touch these.
    const permanentSessionId = freshId("session");
    sessionIds.push(permanentSessionId);
    const permanentAddress = Keypair.random().publicKey();
    await store.setWalletAddressForSession(permanentSessionId, permanentAddress);

    const swept = await store.sweepExpired();

    expect(swept.walletChallenges).toBeGreaterThanOrEqual(1);
    expect(swept.pendingWalletSessions).toBeGreaterThanOrEqual(1);
    expect(swept.pendingConsentSessions).toBeGreaterThanOrEqual(1);

    // The already-expired rows are gone even from the raw table, not just unreadable.
    const { rows: remainingChallenges } = await pool.query("select 1 from wallet_challenges where nonce = $1", [
      expiredNonce,
    ]);
    expect(remainingChallenges).toHaveLength(0);
    const { rows: remainingSessions } = await pool.query(
      "select 1 from pending_wallet_sessions where session_id = $1",
      [expiredSessionId],
    );
    expect(remainingSessions).toHaveLength(0);
    const { rows: remainingConsentSessions } = await pool.query(
      "select 1 from pending_consent_sessions where consent_session_id = $1",
      [expiredConsentId],
    );
    expect(remainingConsentSessions).toHaveLength(0);

    // Live rows and TTL-less rows survive the sweep untouched.
    await expect(store.getPendingWalletSession(liveSessionId)).resolves.toBeDefined();
    await expect(store.getPendingConsentSession(liveConsentId)).resolves.toBeDefined();
    await expect(store.getWalletAddressForSession(permanentSessionId)).resolves.toBe(permanentAddress);
    await expect(store.takeChallenge(liveNonce)).resolves.toBe(true);
  });
});
