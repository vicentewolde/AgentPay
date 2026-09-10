/**
 * Against a **live Postgres database** (Supabase in the pilot). Nothing is
 * mocked, because the guarantees this package exists to give are guarantees
 * the database makes and not guarantees TypeScript makes: a unique constraint,
 * a foreign key, and a sequence that never hands the same value out twice.
 *
 *   pnpm --filter @agentpay/directory run test:integration
 *
 * Requires `DATABASE_URL` in `.env.local`. Every test creates its own partners
 * and deletes everything it created in `afterEach`, so repeated runs never
 * accumulate rows and never collide with real data.
 *
 * `@agentpay/tenancy` is used here, and only here, to turn an allocated index
 * into a real Stellar keypair. That is deliberate: the claim this milestone
 * has to support is not "the directory stores a number", it is "two tenants
 * of two different partners end up with different Stellar identities", and
 * only the real derivation can show that.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { hasErrorCode, stellarAddressToDid } from "@agentpass/core";
import { deriveTenantKeypair, generateMasterMnemonic } from "@agentpay/tenancy";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDirectory, type Directory } from "./directory.js";
import { newId, newTenantId } from "./ids.js";

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

describe("createDirectory", () => {
  let connectionString: string;
  let directory: Directory;
  let pool: Pool;
  const partnerIds: string[] = [];
  const principalAddresses: string[] = [];

  /** One master seed for the whole suite — the real thing, generated per run. */
  const masterMnemonic = generateMasterMnemonic();

  /** What `apps/web` will pass as `derive` once F4 wires this up for real. */
  function deriveFromMaster(keyIndex: number): { readonly address: string; readonly did: string } {
    const { publicKey } = deriveTenantKeypair(masterMnemonic, keyIndex, "agent");
    return { address: publicKey, did: stellarAddressToDid(publicKey, "testnet") };
  }

  beforeAll(async () => {
    connectionString = await loadDatabaseUrl();
    // Small pools on purpose: the pilot's database is a Supabase session
    // pooler, and letting `pg` open a connection per concurrent query
    // exhausts the local ephemeral ports before it exhausts the server.
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 2 });
    directory = await createDirectory({ connectionString, maxConnections: 4 });
  });

  afterEach(async () => {
    // Children first: every table here is behind a foreign key.
    while (partnerIds.length > 0) {
      const partnerId = partnerIds.pop();
      await pool.query(
        `delete from directory_mandates where tenant_id in (select id from directory_tenants where partner_id = $1)`,
        [partnerId],
      );
      await pool.query(
        `delete from directory_credentials where agent_id in (
           select a.id from directory_agents a join directory_tenants t on t.id = a.tenant_id where t.partner_id = $1)`,
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
      await pool.query("delete from directory_api_keys where partner_id = $1", [partnerId]);
      await pool.query("delete from directory_partners where id = $1", [partnerId]);
    }
    while (principalAddresses.length > 0) {
      await pool.query("delete from directory_principals where address = $1", [principalAddresses.pop()]);
    }
  });

  afterAll(async () => {
    await directory.close();
    await pool.end();
  });

  async function freshPartner(name = `test-${randomUUID()}`) {
    const partner = await directory.createPartner({ name });
    partnerIds.push(partner.id);
    return partner;
  }

  async function freshPrincipal(index: number) {
    const { publicKey } = deriveTenantKeypair(masterMnemonic, 900_000 + index, "issuer");
    const principal = await directory.upsertPrincipal({
      address: publicKey,
      did: stellarAddressToDid(publicKey, "testnet"),
    });
    principalAddresses.push(principal.address);
    return principal;
  }

  // ---- the claim this milestone exists to support ------------------------

  it("keeps one wallet used with two partners in two separate tenants, with two separate agent identities", async () => {
    const cloudops = await freshPartner("CloudOps");
    const otherPartner = await freshPartner("OtroPartner");

    // The same person, the same wallet, and — deliberately — the same
    // external reference string on both sides. Nothing about the input
    // distinguishes them except which partner is asking.
    const vinny = await freshPrincipal(1);
    const externalRef = "usr_123";

    const tenantA = await directory.createTenant({ partnerId: cloudops.id, externalRef });
    const tenantB = await directory.createTenant({ partnerId: otherPartner.id, externalRef });

    expect(tenantA.id).not.toBe(tenantB.id);
    expect(tenantA.partnerId).toBe(cloudops.id);
    expect(tenantB.partnerId).toBe(otherPartner.id);

    await directory.bindPrincipal({
      tenantId: tenantA.id,
      principalId: vinny.id,
      proofNonce: randomUUID(),
      proofSignature: "sig-a",
    });
    await directory.bindPrincipal({
      tenantId: tenantB.id,
      principalId: vinny.id,
      proofNonce: randomUUID(),
      proofSignature: "sig-b",
    });

    const agentA = await directory.createAgent({ tenantId: tenantA.id, derive: deriveFromMaster });
    const agentB = await directory.createAgent({ tenantId: tenantB.id, derive: deriveFromMaster });

    // Different index, therefore a different Stellar account: this is the
    // thing that `sha256(wallet address)` as a tenant id could never give.
    expect(agentA.keyIndex).not.toBe(agentB.keyIndex);
    expect(agentA.address).not.toBe(agentB.address);
    expect(agentA.did).not.toBe(agentB.did);

    // And each partner sees only its own.
    expect((await directory.listTenants(cloudops.id)).map((t) => t.id)).toEqual([tenantA.id]);
    expect((await directory.listTenants(otherPartner.id)).map((t) => t.id)).toEqual([tenantB.id]);
  });

  it("refuses a second tenant for the same partner and external reference", async () => {
    const partner = await freshPartner();
    await directory.createTenant({ partnerId: partner.id, externalRef: "usr_123" });

    await expect(directory.createTenant({ partnerId: partner.id, externalRef: "usr_123" })).rejects.toSatisfy((error) =>
      hasErrorCode(error, "TenantAlreadyExists"),
    );
  });

  it("refuses a tenant for a partner that does not exist", async () => {
    // Well-formed and never inserted, so the refusal comes from the foreign
    // key and not from the id's own shape.
    await expect(
      directory.createTenant({ partnerId: newId("partner"), externalRef: "usr_123" }),
    ).rejects.toSatisfy((error) => hasErrorCode(error, "PartnerNotFound"));
  });

  it("refuses personal data as an external reference before writing anything", async () => {
    const partner = await freshPartner();
    await expect(
      directory.createTenant({ partnerId: partner.id, externalRef: "vinny@cloudops.cl" }),
    ).rejects.toSatisfy((error) => hasErrorCode(error, "InvalidExternalRef"));
    expect(await directory.listTenants(partner.id)).toEqual([]);
  });

  // ---- key index allocation ---------------------------------------------

  it("never hands the same key index to two agents, even created concurrently", async () => {
    const partner = await freshPartner();
    const tenants = await Promise.all(
      Array.from({ length: 8 }, (_, i) => directory.createTenant({ partnerId: partner.id, externalRef: `usr_${i}` })),
    );

    const agents = await Promise.all(
      tenants.map((tenant) => directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster })),
    );

    const indices = agents.map((a) => a.keyIndex);
    expect(new Set(indices).size).toBe(indices.length);
    // A collision here would mean two tenants deriving the same keypair from
    // the master seed — so assert on the addresses too, not just the numbers.
    expect(new Set(agents.map((a) => a.address)).size).toBe(agents.length);
  });

  it("gives one tenant more than one agent, each with its own identity", async () => {
    // A tenant may hold several agents; renewing or replacing one must not
    // require a new tenant.
    const partner = await freshPartner();
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_multi" });

    const first = await directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster, label: "primary" });
    const second = await directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster, label: "batch jobs" });

    expect(first.keyIndex).not.toBe(second.keyIndex);
    expect(first.address).not.toBe(second.address);
    const listed = await directory.listAgents(tenant.id);
    expect(listed.map((a) => a.id)).toEqual([first.id, second.id]);
  });

  it("creates an agent as derived, not funded — nothing is deployed on chain yet", async () => {
    const partner = await freshPartner();
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_lazy" });
    const agent = await directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster });

    expect(agent.onchainState).toBe("derived");
    const funded = await directory.setAgentOnchainState(agent.id, "funded");
    expect(funded.onchainState).toBe("funded");
  });

  it("refuses an agent for a tenant that does not exist, without burning the derivation", async () => {
    let derivations = 0;
    await expect(
      directory.createAgent({
        tenantId: newTenantId(newId("partner")),
        derive: (index) => {
          derivations += 1;
          return deriveFromMaster(index);
        },
      }),
    ).rejects.toSatisfy((error) => hasErrorCode(error, "TenantNotFound"));
    expect(derivations).toBe(0);
  });

  // ---- api keys ----------------------------------------------------------

  it("authenticates a partner by its api key secret and stops once revoked", async () => {
    const partner = await freshPartner();
    const { apiKey, secret } = await directory.issueApiKey({
      partnerId: partner.id,
      name: "server",
      scopes: ["tenants:write"],
    });

    expect(secret.startsWith("ap_test_")).toBe(true);
    // The secret is never stored: only its hash comes back on the record.
    expect(apiKey.keyHash).not.toContain(secret);

    const authenticated = await directory.authenticate(secret);
    expect(authenticated?.partnerId).toBe(partner.id);
    expect(authenticated?.scopes).toEqual(["tenants:write"]);

    expect(await directory.authenticate(`${secret}x`)).toBeUndefined();

    await directory.revokeApiKey(apiKey.id);
    expect(await directory.authenticate(secret)).toBeUndefined();
  });

  // ---- principals and bindings ------------------------------------------

  it("treats one wallet as one principal no matter how many partners use it", async () => {
    const vinny = await freshPrincipal(2);
    const again = await directory.upsertPrincipal({ address: vinny.address, did: vinny.did });
    expect(again.id).toBe(vinny.id);
  });

  it("replaces the proof when a wallet reconnects, instead of stacking bindings", async () => {
    const partner = await freshPartner();
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_rebind" });
    const vinny = await freshPrincipal(3);

    const first = await directory.bindPrincipal({
      tenantId: tenant.id,
      principalId: vinny.id,
      proofNonce: "nonce-1",
      proofSignature: "sig-1",
    });
    await directory.revokeBinding(tenant.id, vinny.id);
    expect((await directory.findBinding(tenant.id, vinny.id))?.revokedAt).not.toBeNull();

    // Reconnecting from another browser: prove control again, and the binding
    // comes back rather than a second row shadowing the first.
    const second = await directory.bindPrincipal({
      tenantId: tenant.id,
      principalId: vinny.id,
      proofNonce: "nonce-2",
      proofSignature: "sig-2",
    });
    expect(second.id).toBe(first.id);
    expect(second.proofNonce).toBe("nonce-2");
    expect(second.revokedAt).toBeNull();
  });

  // ---- credentials and mandates -----------------------------------------

  it("stores a mandate document byte for byte, key order included", async () => {
    // The trap `C-5` documents for the vault: `jsonb` reorders keys, and a
    // mandate's hash is computed over its serialised text. A round trip that
    // reordered anything would make the stored document hash to something
    // other than what was signed and anchored.
    const partner = await freshPartner();
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_mandate" });
    const agent = await directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster });
    const vinny = await freshPrincipal(4);

    const document = { z: "last", a: "first", nested: { y: 2, b: 1 }, validFrom: "2026-09-10T00:00:00.000Z" };
    const mandateHash = "a".repeat(64);

    const stored = await directory.recordMandate({
      tenantId: tenant.id,
      agentId: agent.id,
      principalId: vinny.id,
      mandateHash,
      signatureKind: "wallet-sep53",
      document,
      signature: "sep53-signature",
      validFrom: new Date("2026-09-10T00:00:00.000Z"),
      validUntil: new Date("2026-09-11T00:00:00.000Z"),
      anchorTx: "tx-anchor",
    });

    const read = await directory.findMandateByHash(mandateHash);
    expect(JSON.stringify(read?.document)).toBe(JSON.stringify(document));
    expect(read?.signatureKind).toBe("wallet-sep53");
    expect(read?.jws).toBeNull();
    expect(stored.supersedesId).toBeNull();
  });

  it("renews a mandate without creating a new agent", async () => {
    const partner = await freshPartner();
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_renew" });
    const agent = await directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster });
    const vinny = await freshPrincipal(5);

    const base = {
      tenantId: tenant.id,
      agentId: agent.id,
      principalId: vinny.id,
      signatureKind: "wallet-sep53" as const,
      document: { grant: "one" },
      validFrom: new Date("2026-09-10T00:00:00.000Z"),
      validUntil: new Date("2026-09-11T00:00:00.000Z"),
      anchorTx: "tx-1",
    };
    const first = await directory.recordMandate({ ...base, mandateHash: "b".repeat(64) });
    const renewal = await directory.recordMandate({
      ...base,
      mandateHash: "c".repeat(64),
      anchorTx: "tx-2",
      validUntil: new Date("2026-09-20T00:00:00.000Z"),
      supersedesId: first.id,
    });

    expect(renewal.agentId).toBe(agent.id);
    expect(renewal.supersedesId).toBe(first.id);
    expect((await directory.listAgents(tenant.id)).length).toBe(1);
  });

  it("stops listing a mandate once it is revoked or out of its window", async () => {
    const partner = await freshPartner();
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_window" });
    const agent = await directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster });
    const vinny = await freshPrincipal(6);

    const base = {
      tenantId: tenant.id,
      agentId: agent.id,
      principalId: vinny.id,
      signatureKind: "platform-jws" as const,
      document: { grant: "one" },
      anchorTx: "tx-1",
    };
    const live = await directory.recordMandate({
      ...base,
      mandateHash: "d".repeat(64),
      validFrom: new Date("2026-09-01T00:00:00.000Z"),
      validUntil: new Date("2026-09-30T00:00:00.000Z"),
    });
    await directory.recordMandate({
      ...base,
      mandateHash: "e".repeat(64),
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2026-01-02T00:00:00.000Z"),
    });

    const at = new Date("2026-09-10T00:00:00.000Z");
    expect((await directory.listActiveMandates(tenant.id, at)).map((m) => m.id)).toEqual([live.id]);

    await directory.revokeMandate("d".repeat(64), "tx-revoke");
    expect(await directory.listActiveMandates(tenant.id, at)).toEqual([]);
    expect((await directory.findMandateByHash("d".repeat(64)))?.revokeTx).toBe("tx-revoke");
  });

  it("keeps a credential findable by the hash that is anchored on chain", async () => {
    const partner = await freshPartner();
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_cred" });
    const agent = await directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster });
    const vinny = await freshPrincipal(7);
    const credentialHash = "f".repeat(64);

    await directory.recordCredential({
      agentId: agent.id,
      tenantId: tenant.id,
      credentialHash,
      issuerDid: stellarAddressToDid(agent.address, "testnet"),
      principalDid: vinny.did,
      jws: "eyJ.header.signature",
      validFrom: new Date("2026-09-10T00:00:00.000Z"),
      validUntil: new Date("2026-09-11T00:00:00.000Z"),
      anchorTx: "tx-cred",
    });

    const found = await directory.findCredentialByHash(credentialHash);
    expect(found?.agentId).toBe(agent.id);
    expect(found?.tenantId).toBe(tenant.id);
    expect(found?.revokedAt).toBeNull();

    await directory.revokeCredential(credentialHash);
    expect((await directory.findCredentialByHash(credentialHash))?.revokedAt).not.toBeNull();
  });

  it("finds a shared agent by its Stellar address — the lookup a bootstrap step needs to be idempotent", async () => {
    const partner = await freshPartner();
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_shared_agent" });
    const agent = await directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster });

    const found = await directory.findAgentByAddress(agent.address);
    expect(found?.id).toBe(agent.id);
    expect(await directory.findAgentByAddress("GNONEXISTENT")).toBeUndefined();
  });

  it("finds the latest credential for a tenant, even before F4 gives it its own agent", async () => {
    // Simulates T39's transitional reality: many tenants' credentials all
    // naming the *same* shared agentId, distinguishable only by tenantId.
    const partner = await freshPartner();
    const tenantA = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_latest_cred_a" });
    const tenantB = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_latest_cred_b" });
    const sharedAgent = await directory.createAgent({ tenantId: tenantA.id, derive: deriveFromMaster });
    const vinny = await freshPrincipal(8);

    expect(await directory.findLatestCredential(tenantB.id)).toBeUndefined();

    const base = {
      agentId: sharedAgent.id,
      issuerDid: stellarAddressToDid(sharedAgent.address, "testnet"),
      principalDid: vinny.did,
      jws: "eyJ.a.b",
      validFrom: new Date("2026-09-10T00:00:00.000Z"),
      validUntil: new Date("2026-09-11T00:00:00.000Z"),
      anchorTx: "tx-a",
    };
    await directory.recordCredential({ ...base, tenantId: tenantA.id, credentialHash: "1".repeat(64) });
    const forB = await directory.recordCredential({ ...base, tenantId: tenantB.id, credentialHash: "2".repeat(64) });

    // Finds B's own credential, not A's — even though both name the same
    // shared agentId.
    const latestForB = await directory.findLatestCredential(tenantB.id);
    expect(latestForB?.id).toBe(forB.id);
    expect(latestForB?.credentialHash).toBe("2".repeat(64));
  });

  it("finds the latest mandate for a tenant regardless of revoked or expired status", async () => {
    const partner = await freshPartner();
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_latest_mandate" });
    const agent = await directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster });
    const vinny = await freshPrincipal(9);

    expect(await directory.findLatestMandate(tenant.id)).toBeUndefined();

    const base = {
      tenantId: tenant.id,
      agentId: agent.id,
      principalId: vinny.id,
      signatureKind: "wallet-sep53" as const,
      document: { grant: "one" },
      anchorTx: "tx-1",
    };
    const first = await directory.recordMandate({
      ...base,
      mandateHash: "3".repeat(64),
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2026-01-02T00:00:00.000Z"), // already expired
    });
    await directory.revokeMandate("3".repeat(64), "tx-revoke");

    // Even revoked and expired, it is still the latest one — supersedesId
    // chaining on renewal needs to find it regardless of its status.
    const latest = await directory.findLatestMandate(tenant.id);
    expect(latest?.id).toBe(first.id);
    expect(latest?.revokedAt).not.toBeNull();

    const renewal = await directory.recordMandate({
      ...base,
      mandateHash: "4".repeat(64),
      validFrom: new Date("2026-09-10T00:00:00.000Z"),
      validUntil: new Date("2026-09-11T00:00:00.000Z"),
      supersedesId: first.id,
    });
    expect((await directory.findLatestMandate(tenant.id))?.id).toBe(renewal.id);
  });

  // ---- survives a restart ------------------------------------------------

  it("still has everything after the process that wrote it is gone", async () => {
    // The failure this package exists to fix: `apps/web` keeps its session in
    // a `Map`, so a restart loses the credential and the Mandate and the next
    // "Iniciar sesión" issues brand new ones.
    const partner = await freshPartner();
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: "usr_restart" });
    const agent = await directory.createAgent({ tenantId: tenant.id, derive: deriveFromMaster });

    const reopened = await createDirectory({ connectionString, maxConnections: 1 });
    try {
      const foundTenant = await reopened.findTenant(tenant.id);
      const foundAgent = await reopened.findAgent(agent.id);
      expect(foundTenant?.externalRef).toBe("usr_restart");
      expect(foundAgent?.address).toBe(agent.address);
      expect(foundAgent?.keyIndex).toBe(agent.keyIndex);
    } finally {
      await reopened.close();
    }
  });
});
