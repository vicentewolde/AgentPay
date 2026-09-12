import { stellarAddressToDid } from "@agentpass/core";
import type { AgentInstance, MandateRecord, PurchaseRecord, Tenant } from "@agentpey/directory";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { readTenantActivity, type TenantActivityDeps, type TenantActivityDirectory } from "./tenant-activity.js";

const TENANT = "ptn_00000000000000000000000001:00000000000000000000000001";
const RAIL = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
const NOW = new Date("2026-09-12T12:00:00.000Z");

const principal = Keypair.random();
const agent = Keypair.random();
const AGENT_DID = stellarAddressToDid(agent.publicKey(), "testnet");
const PRINCIPAL_DID = stellarAddressToDid(principal.publicKey(), "testnet");

function mandateDocument(overrides: Record<string, unknown> = {}) {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "AgentPayMandate"],
    mandateId: "8b0851b3-94e9-45b0-ba36-d6e9e32541d2",
    issuer: PRINCIPAL_DID,
    validFrom: "2026-09-01T00:00:00.000Z",
    validUntil: "2026-12-01T00:00:00.000Z",
    credentialSubject: {
      id: AGENT_DID,
      grant: {
        actions: ["catalog:read", "intent:create"],
        venues: [`signaldesk:${RAIL}`],
        assets: ["USDC:CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"],
        limits: { perTx: "0.3000000", perDay: "0.6000000", currency: "USDC" },
        products: ["signaldesk:market-brief-xlm-usdc"],
      },
    },
    credentialStatus: { type: "AgentPassRegistry2026", registry: RAIL },
    ...overrides,
  };
}

function mandateRecord(overrides: Partial<MandateRecord> = {}): MandateRecord {
  return {
    id: "mdt_00000000000000000000000001",
    tenantId: TENANT,
    agentId: "agt_00000000000000000000000001",
    principalId: "prc_00000000000000000000000001",
    mandateHash: "c".repeat(64),
    signatureKind: "wallet-sep53",
    document: mandateDocument(),
    signature: "sig",
    jws: null,
    validFrom: new Date("2026-09-01T00:00:00.000Z"),
    validUntil: new Date("2026-12-01T00:00:00.000Z"),
    anchorTx: "d".repeat(64),
    supersedesId: null,
    revokedAt: null,
    revokeTx: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function agentRow(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    id: "agt_00000000000000000000000001",
    tenantId: TENANT,
    keyIndex: 0,
    address: agent.publicKey(),
    did: AGENT_DID,
    label: null,
    status: "active",
    onchainState: "funded",
    policyRailContractId: RAIL,
    policyRailFundedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const tenant: Tenant = {
  id: TENANT,
  partnerId: "ptn_00000000000000000000000001",
  externalRef: "rop_abc",
  label: null,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

interface Fixture {
  readonly mandates?: readonly MandateRecord[];
  readonly agents?: readonly AgentInstance[];
  readonly purchases?: readonly PurchaseRecord[];
  readonly spentToday?: string;
  readonly vaultRecords?: readonly unknown[];
}

function deps(fixture: Fixture = {}): TenantActivityDeps {
  const directory: TenantActivityDirectory = {
    async findTenant() {
      return tenant;
    },
    async listMandates() {
      return [...(fixture.mandates ?? [])];
    },
    async listAgents() {
      return [...(fixture.agents ?? [])];
    },
    async listPurchases() {
      return [...(fixture.purchases ?? [])];
    },
  };
  return {
    directory,
    vaultFactory: async () => ({
      list: () => (fixture.vaultRecords ?? []) as never,
      verify: () => ({ ok: true }) as never,
      spentOn: async () => fixture.spentToday ?? "0.0000000",
    }),
    readBalance: async () => "0.6500000",
    now: NOW,
  };
}

describe("a tenant that has signed nothing", () => {
  it("reports no mandate, no daily limit and no rail — not zeros", async () => {
    const activity = await readTenantActivity(deps(), TENANT);
    expect(activity.mandate).toBeNull();
    expect(activity.per_day).toBeNull();
    // "you have not paid for anything yet" is a different thing to show a
    // person than "your rail is empty".
    expect(activity.rail).toBeNull();
    expect(activity.purchases).toEqual([]);
  });
});

describe("a tenant with an active mandate", () => {
  it("shows the permissions that were actually signed, product allowlist included", async () => {
    const activity = await readTenantActivity(deps({ mandates: [mandateRecord()] }), TENANT);
    expect(activity.mandate?.status).toBe("active");
    expect(activity.mandate?.grant.products).toEqual(["signaldesk:market-brief-xlm-usdc"]);
    expect(activity.mandate?.grant.limits.perDay).toBe("0.6000000");
    expect(activity.mandate?.anchor_tx).toBe("d".repeat(64));
  });

  it("works out what is left of today without touching a float", async () => {
    const activity = await readTenantActivity(deps({ mandates: [mandateRecord()], spentToday: "0.4500000" }), TENANT);
    expect(activity.per_day).toMatchObject({
      limit: "0.6000000",
      spent_today: "0.4500000",
      remaining: "0.1500000",
      currency: "USDC",
    });
  });

  it("warns before exhaustion, not at it — 80% of the signed limit", async () => {
    const near = await readTenantActivity(deps({ mandates: [mandateRecord()], spentToday: "0.4800000" }), TENANT);
    expect(near.per_day?.near_limit).toBe(true);
    const fine = await readTenantActivity(deps({ mandates: [mandateRecord()], spentToday: "0.4000000" }), TENANT);
    expect(fine.per_day?.near_limit).toBe(false);
  });

  it("never reports a negative remainder, even if spending somehow passed the limit", async () => {
    const activity = await readTenantActivity(deps({ mandates: [mandateRecord()], spentToday: "0.9000000" }), TENANT);
    expect(activity.per_day?.remaining).toBe("0.0000000");
  });

  it("ignores a revoked mandate", async () => {
    const activity = await readTenantActivity(
      deps({ mandates: [mandateRecord({ revokedAt: new Date("2026-09-11T00:00:00.000Z") })] }),
      TENANT,
    );
    expect(activity.mandate).toBeNull();
    expect(activity.per_day).toBeNull();
  });

  it("ignores an expired mandate", async () => {
    const activity = await readTenantActivity(
      deps({ mandates: [mandateRecord({ validUntil: new Date("2026-09-02T00:00:00.000Z") })] }),
      TENANT,
    );
    expect(activity.mandate).toBeNull();
  });

  it("reports no mandate rather than crashing when the stored document is not one", async () => {
    const activity = await readTenantActivity(
      deps({ mandates: [mandateRecord({ document: { version: 1 } })] }),
      TENANT,
    );
    expect(activity.mandate).toBeNull();
  });
});

describe("the rail", () => {
  it("is reported with its balance and named as sponsored credit, not as money", async () => {
    const activity = await readTenantActivity(deps({ agents: [agentRow()] }), TENANT);
    expect(activity.rail).toMatchObject({ contract_id: RAIL, balance: "0.6500000", asset: "USDC", sponsored: true });
  });

  it("is absent for an agent that has never paid, so no rail exists yet", async () => {
    const activity = await readTenantActivity(deps({ agents: [agentRow({ policyRailContractId: null })] }), TENANT);
    expect(activity.rail).toBeNull();
  });
});

describe("refusals", () => {
  it("carries the vault's own refusals, newest first, with code and reason", async () => {
    const records = [
      { entry: { kind: "refused", at: "2026-09-12T09:00:00.000Z", intentId: "i-1", code: "MandateProductNotAllowed", reason: "producto no permitido" } },
      { entry: { kind: "refused", at: "2026-09-12T10:00:00.000Z", intentId: "i-2", code: "MandateDailyLimitExceeded", reason: "límite diario" } },
      { entry: { kind: "granted", at: "2026-09-12T11:00:00.000Z", intentId: "i-3" } },
    ];
    const activity = await readTenantActivity(deps({ vaultRecords: records }), TENANT);
    expect(activity.refusals.map((r) => r.code)).toEqual(["MandateDailyLimitExceeded", "MandateProductNotAllowed"]);
    expect(activity.refusals[0]?.reason).toBe("límite diario");
  });
});
