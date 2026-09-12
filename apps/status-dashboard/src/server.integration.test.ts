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
    const vault = await createPostgresMandateVault({ connectionString, tenantId: tenant.id });
    await vault.record({
      subject: principal.did,
      intentId: "fixture-payment",
      currency: "USDC",
      amount: "2.50",
      at: new Date("2026-09-11T12:00:00.000Z"),
    });

    const server = createStatusServer({
      directory,
      vaultFactory: (tenantId) => createPostgresMandateVault({ connectionString, tenantId }),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const mandates = await fetch(`${baseUrl}/api/status/mandates?tenantId=${tenant.id}`);
      expect(mandates.status).toBe(200);
      await expect(mandates.json()).resolves.toMatchObject({ mandates: [{ hash: "a".repeat(64) }] });

      const status = await fetch(`${baseUrl}/api/status/vault/${tenant.id}`);
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        verification: { ok: true },
        records: [{ kind: "granted", amount: "2.50 USDC" }],
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
