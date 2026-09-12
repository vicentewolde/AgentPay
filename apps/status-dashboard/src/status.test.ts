import { stellarAddressToDid } from "@agentpass/core";
import type { AgentInstance, MandateRecord, Tenant } from "@agentpey/directory";
import type { VaultRecord } from "@agentpey/vault";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  LOW_USDC_WARNING,
  PERDAY_WARNING_RATIO,
  readPerDayUsage,
  readRailBalances,
  recentRefusals,
  type StatusDirectory,
  type VaultReader,
} from "./status.js";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const AGENT_DID = stellarAddressToDid(Keypair.random().publicKey(), "testnet");
const REGISTRY = "CBDWMXZEE44NJ3RA6RS7K4EK36KDFW5S7KHP276HCMM4I52MIUUHEF5B";

const tenant: Tenant = {
  id: "tenant_01J7QW8VQEJPAXEPAYSTATUS71",
  partnerId: "partner_01J7QW8VQEJPAXEPAYSTATUS71",
  externalRef: "status-metrics-test",
  label: null,
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
};

function mandateFixture(overrides: {
  readonly perDay?: string;
  readonly currency?: string;
  readonly revokedAt?: Date | null;
  readonly validUntil?: Date;
  readonly createdAt?: Date;
} = {}): MandateRecord {
  const { perDay = "10.00", currency = "USDC", revokedAt = null, validUntil = new Date("2099-01-01T00:00:00.000Z"), createdAt = NOW } = overrides;
  return {
    id: "mandate_01J7QW8VQEJPAXEPAYSTATUS71",
    tenantId: tenant.id,
    agentId: "agent_01J7QW8VQEJPAXEPAYSTATUS71",
    principalId: "principal_01J7QW8VQEJPAXEPAYSTATUS71",
    mandateHash: "a".repeat(64),
    signatureKind: "platform-jws",
    document: {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiableCredential", "AgentPayMandate"],
      mandateId: "11111111-1111-4111-8111-111111111111",
      issuer: AGENT_DID,
      validFrom: NOW.toISOString(),
      validUntil: validUntil.toISOString(),
      credentialSubject: {
        id: AGENT_DID,
        grant: { actions: ["catalog:read"], venues: [], assets: [], limits: { perTx: "1.00", perDay, currency } },
      },
      credentialStatus: { type: "AgentPassRegistry2026", registry: REGISTRY },
    },
    signature: null,
    jws: "fixture-jws",
    validFrom: NOW,
    validUntil,
    anchorTx: "fixture-anchor",
    supersedesId: null,
    revokedAt,
    revokeTx: null,
    createdAt,
  };
}

function directoryWith(mandates: readonly MandateRecord[], agents: readonly AgentInstance[] = []): StatusDirectory {
  return {
    findTenant: async (id) => (id === tenant.id ? tenant : undefined),
    listMandates: async () => mandates,
    listAgents: async () => agents,
  };
}

describe("readPerDayUsage", () => {
  it("computes the ratio against the tenant's active Mandate and flags it near the limit past the warning ratio", async () => {
    const directory = directoryWith([mandateFixture({ perDay: "10.00" })]);
    const vault: VaultReader = { list: () => [], verify: () => ({ ok: true }), spentOn: async () => "8.50" };

    const usage = await readPerDayUsage(directory, async () => vault, tenant.id, NOW);

    expect(usage).toEqual({
      subject: AGENT_DID,
      currency: "USDC",
      perDayLimit: "10.00",
      spentToday: "8.50",
      ratio: 0.85,
      nearLimit: true,
    });
    expect(usage?.ratio).toBeGreaterThanOrEqual(PERDAY_WARNING_RATIO);
  });

  it("does not flag near-limit below the warning ratio", async () => {
    const directory = directoryWith([mandateFixture({ perDay: "10.00" })]);
    const vault: VaultReader = { list: () => [], verify: () => ({ ok: true }), spentOn: async () => "1.00" };

    const usage = await readPerDayUsage(directory, async () => vault, tenant.id, NOW);

    expect(usage?.nearLimit).toBe(false);
  });

  it("returns undefined when the tenant has no unrevoked, unexpired Mandate", async () => {
    const revoked = directoryWith([mandateFixture({ revokedAt: NOW })]);
    await expect(readPerDayUsage(revoked, async () => { throw new Error("should not read the vault"); }, tenant.id, NOW)).resolves.toBeUndefined();

    const expired = directoryWith([mandateFixture({ validUntil: new Date("2020-01-01T00:00:00.000Z") })]);
    await expect(readPerDayUsage(expired, async () => { throw new Error("should not read the vault"); }, tenant.id, NOW)).resolves.toBeUndefined();

    const none = directoryWith([]);
    await expect(readPerDayUsage(none, async () => { throw new Error("should not read the vault"); }, tenant.id, NOW)).resolves.toBeUndefined();
  });

  it("picks the most recently created active Mandate when a tenant has more than one", async () => {
    const older = mandateFixture({ perDay: "5.00", createdAt: new Date("2026-09-01T00:00:00.000Z") });
    const newer = mandateFixture({ perDay: "20.00", createdAt: new Date("2026-09-10T00:00:00.000Z") });
    const directory = directoryWith([older, newer]);
    const vault: VaultReader = { list: () => [], verify: () => ({ ok: true }), spentOn: async () => "1.00" };

    const usage = await readPerDayUsage(directory, async () => vault, tenant.id, NOW);

    expect(usage?.perDayLimit).toBe("20.00");
  });

  it("returns undefined rather than throwing when the stored document does not parse as a Mandate", async () => {
    const malformed = mandateFixture();
    const directory = directoryWith([{ ...malformed, document: { not: "a mandate" } }]);

    await expect(readPerDayUsage(directory, async () => { throw new Error("should not read the vault"); }, tenant.id, NOW)).resolves.toBeUndefined();
  });
});

function refusedEntry(at: string, intentId: string): VaultRecord {
  return {
    seq: 0,
    prevHash: "",
    hash: "b".repeat(64),
    entry: { kind: "refused", subject: AGENT_DID, intentId, code: "MandateDailyLimitExceeded", reason: "over perDay", details: {}, at },
  };
}

function grantedEntry(at: string, intentId: string): VaultRecord {
  return {
    seq: 1,
    prevHash: "b".repeat(64),
    hash: "c".repeat(64),
    entry: { kind: "granted", subject: AGENT_DID, intentId, currency: "USDC", amount: "1.00", at },
  };
}

describe("recentRefusals", () => {
  it("keeps only refused entries, most recent first", () => {
    const records = [refusedEntry("2026-09-12T10:00:00.000Z", "intent-1"), grantedEntry("2026-09-12T10:30:00.000Z", "intent-2"), refusedEntry("2026-09-12T11:00:00.000Z", "intent-3")];

    const refusals = recentRefusals(records);

    expect(refusals.map((r) => r.intentId)).toEqual(["intent-3", "intent-1"]);
  });

  it("caps at the given limit", () => {
    const records = Array.from({ length: 5 }, (_, i) => refusedEntry(`2026-09-12T1${i}:00:00.000Z`, `intent-${i}`));

    expect(recentRefusals(records, 2)).toHaveLength(2);
  });
});

describe("readRailBalances", () => {
  function agentFixture(overrides: Partial<AgentInstance> = {}): AgentInstance {
    return {
      id: "agent_01J7QW8VQEJPAXEPAYSTATUS71",
      tenantId: tenant.id,
      keyIndex: 0,
      address: Keypair.random().publicKey(),
      did: AGENT_DID,
      label: null,
      status: "active",
      onchainState: "funded",
      policyRailContractId: null,
      policyRailFundedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }

  it("skips agents without a policy_rail and flags a low balance for the rest", async () => {
    const railed = agentFixture({ id: "agent-with-rail", policyRailContractId: "CRAILCONTRACTIDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    const unrailed = agentFixture({ id: "agent-without-rail", policyRailContractId: null });
    const directory = directoryWith([], [railed, unrailed]);

    const balances = await readRailBalances(directory, tenant.id, async (contractId) => (contractId === railed.policyRailContractId ? "0.0010000" : "1.0000000"));

    expect(balances).toEqual([{ agentId: "agent-with-rail", contractId: railed.policyRailContractId, usdc: "0.0010000", low: true }]);
    expect(Number(LOW_USDC_WARNING)).toBeGreaterThan(0.001);
  });

  it("reports a failed balance read as an error string instead of throwing", async () => {
    const railed = agentFixture({ policyRailContractId: "CRAILCONTRACTIDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    const directory = directoryWith([], [railed]);

    const balances = await readRailBalances(directory, tenant.id, async () => {
      throw new Error("RPC unreachable");
    });

    expect(balances).toEqual([{ agentId: railed.id, contractId: railed.policyRailContractId, usdc: "error: Error: RPC unreachable", low: false }]);
  });
});
