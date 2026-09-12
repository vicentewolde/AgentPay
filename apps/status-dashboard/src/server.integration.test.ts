/**
 * Live Postgres proof for the operational path. It intentionally seeds through
 * the existing directory and vault writers, then asks the dashboard only via
 * HTTP GET — the dashboard itself has no writer in scope.
 *
 *   pnpm --filter @agentpey/status-dashboard run test:integration
 *
 * Requires DATABASE_URL in .env.local. The cleanup removes only this test's
 * randomly named tenant, partner, principal and vault records.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { AgentPassError, stellarAddressToDid } from "@agentpass/core";
import { createDirectory, type Directory } from "@agentpey/directory";
import { createPostgresMandateVault } from "@agentpey/vault";
import { Keypair } from "@stellar/stellar-sdk";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createStatusServer } from "./server.js";

const ENV_PATH = fileURLToPath(new URL("../../../.env.local", import.meta.url));
const REGISTRY = "CBDWMXZEE44NJ3RA6RS7K4EK36KDFW5S7KHP276HCMM4I52MIUUHEF5B";

async function loadDatabaseUrl(): Promise<string> {
  const contents = await readFile(ENV_PATH, "utf8").catch(() => "");
  const match = /^\s*DATABASE_URL\s*=\s*"?(.*?)"?\s*$/m.exec(contents);
  if (match?.[1] === undefined || match[1] === "") {
    throw new AgentPassError("ConfigError", `${ENV_PATH} is missing DATABASE_URL. Add it before running the live dashboard test.`, {
      details: { envPath: ENV_PATH, key: "DATABASE_URL" },
    });
  }
  return match[1];
}

describe("status dashboard against Postgres", () => {
  let connectionString: string;
  let directory!: Directory;
  let pool!: Pool;
  const tenantIds: string[] = [];
  const partnerIds: string[] = [];
  const principalAddresses: string[] = [];

  beforeAll(async () => {
    connectionString = await loadDatabaseUrl();
    directory = await createDirectory({ connectionString, maxConnections: 2 });
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 2 });
  });

  afterEach(async () => {
    while (tenantIds.length > 0) {
      const tenantId = tenantIds.pop();
      await pool.query("delete from vault_records where tenant_id = $1", [tenantId]);
    }
    while (partnerIds.length > 0) {
      const partnerId = partnerIds.pop();
      await pool.query(
        `delete from directory_mandates where tenant_id in (select id from directory_tenants where partner_id = $1)`,
        [partnerId],
      );
      await pool.query(
        `delete from directory_principal_bindings where tenant_id in (select id from directory_tenants where partner_id = $1)`,
        [partnerId],
      );
      await pool.query(
        `delete from directory_agents where tenant_id in (select id from directory_tenants where partner_id = $1)`,
        [partnerId],
      );
      await pool.query("delete from directory_tenants where partner_id = $1", [partnerId]);
      await pool.query("delete from directory_partners where id = $1", [partnerId]);
    }
    while (principalAddresses.length > 0) {
      await pool.query("delete from directory_principals where address = $1", [principalAddresses.pop()]);
    }
  });

  afterAll(async () => {
    if (directory !== undefined) await directory.close();
    if (pool !== undefined) await pool.end();
  });

  it("shows a seeded mandate and verifies a seeded vault chain through GET routes", async () => {
    const partner = await directory.createPartner({ name: `status-dashboard-${randomUUID()}` });
    partnerIds.push(partner.id);
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: `status_${randomUUID()}` });
    tenantIds.push(tenant.id);
    const principalKey = Keypair.random();
    const principal = await directory.upsertPrincipal({
      address: principalKey.publicKey(),
      did: stellarAddressToDid(principalKey.publicKey(), "testnet"),
    });
    principalAddresses.push(principal.address);
    await directory.bindPrincipal({ tenantId: tenant.id, principalId: principal.id, proofNonce: randomUUID(), proofSignature: "test-proof" });
    const agentKey = Keypair.random();
    const agent = await directory.createAgent({
      tenantId: tenant.id,
      derive: () => ({ address: agentKey.publicKey(), did: stellarAddressToDid(agentKey.publicKey(), "testnet") }),
    });
    await directory.recordMandate({
      tenantId: tenant.id,
      agentId: agent.id,
      principalId: principal.id,
      mandateHash: "a".repeat(64),
      signatureKind: "platform-jws",
      document: { fixture: "status-dashboard" },
      jws: "fixture-jws",
      validFrom: new Date("2026-09-11T00:00:00.000Z"),
      validUntil: new Date("2026-09-12T00:00:00.000Z"),
      anchorTx: "fixture-mandate-anchor",
    });
    // T71: a second, more recent Mandate that actually parses as an
    // `AgentPayMandate` — the fixture above never did, so perDay usage needs
    // one that does, to exercise the happy path against real Postgres too.
    await directory.recordMandate({
      tenantId: tenant.id,
      agentId: agent.id,
      principalId: principal.id,
      mandateHash: "b".repeat(64),
      signatureKind: "platform-jws",
      document: {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiableCredential", "AgentPayMandate"],
        mandateId: randomUUID(),
        issuer: principal.did,
        validFrom: "2026-09-11T00:00:00.000Z",
        validUntil: "2099-01-01T00:00:00.000Z",
        credentialSubject: {
          id: agent.did,
          grant: { actions: ["catalog:read"], venues: [], assets: [], limits: { perTx: "1.00", perDay: "10.00", currency: "USDC" } },
        },
        credentialStatus: { type: "AgentPassRegistry2026", registry: REGISTRY },
      },
      jws: "fixture-jws-2",
      validFrom: new Date("2026-09-11T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      anchorTx: "fixture-mandate-anchor-2",
    });
    const vault = await createPostgresMandateVault({ connectionString, tenantId: tenant.id });
    // `readPerDayUsage` (T71) reads `spentOn` against *today* (real wall-clock
    // `now`, not injectable through the HTTP route) — so this fixture has to
    // land in today's UTC day too, not a fixed past date, or the metrics
    // assertion below reads a stale $0.00 instead of this recorded amount.
    await vault.record({
      subject: agent.did,
      intentId: "fixture-payment",
      currency: "USDC",
      amount: "2.50",
      at: new Date(),
    });
    await vault.recordRefusal({
      subject: agent.did,
      intentId: "fixture-refused",
      code: "MandateDailyLimitExceeded",
      reason: "over perDay",
      details: {},
    });

    const server = createStatusServer({
      directory,
      vaultFactory: (tenantId) => createPostgresMandateVault({ connectionString, tenantId }),
      readRailBalance: async () => "0.00",
      reserveAddress: "GAK6E5E7L63ZYFZZZFXDTYVG6MVAKILSHI5FITGH5U4ORACEZQ4GFP2K",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const mandates = await fetch(`${baseUrl}/api/status/mandates?tenantId=${tenant.id}`);
      expect(mandates.status).toBe(200);
      await expect(mandates.json()).resolves.toMatchObject({ mandates: [{ hash: "b".repeat(64) }, { hash: "a".repeat(64) }] });

      const status = await fetch(`${baseUrl}/api/status/vault/${tenant.id}`);
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        verification: { ok: true },
        records: [{ kind: "refused", detail: "MandateDailyLimitExceeded: over perDay" }, { kind: "granted", amount: "2.50 USDC" }],
      });

      const metrics = await fetch(`${baseUrl}/api/status/metrics/${tenant.id}`);
      expect(metrics.status).toBe(200);
      await expect(metrics.json()).resolves.toMatchObject({
        perDay: { subject: agent.did, currency: "USDC", perDayLimit: "10.00", spentToday: "2.5000000" },
        rejections: [{ code: "MandateDailyLimitExceeded", reason: "over perDay", intentId: "fixture-refused" }],
        railBalances: [],
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
