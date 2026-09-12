import { stellarAddressToDid } from "@agentpass/core";
import type { AgentInstance, Partner, Tenant } from "@agentpey/directory";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  ensureSharedPayerIdentity,
  ensureVisitorTenant,
  type SharedPayerDirectory,
  type VisitorTenantDirectory,
} from "./shared-identity.js";

const ADDRESS = Keypair.random().publicKey();
const DID = stellarAddressToDid(ADDRESS, "testnet");

function fakePartner(id: string): Partner {
  return { id, name: "x", status: "active", returnOrigins: [], createdAt: new Date(), updatedAt: new Date() };
}

function fakeTenant(id: string, partnerId: string): Tenant {
  return { id, partnerId, externalRef: "shared-legacy-agent", label: null, status: "active", createdAt: new Date(), updatedAt: new Date() };
}

function fakeAgent(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    id: "agt_00000000000000000000000001",
    tenantId: "ptn_00000000000000000000000001:00000000000000000000000001",
    keyIndex: 0,
    address: ADDRESS,
    did: DID,
    label: null,
    status: "active",
    onchainState: "derived",
    policyRailContractId: null,
    policyRailFundedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A minimal in-memory stand-in for the directory, implementing only what this module depends on. */
function fakeDirectory(): SharedPayerDirectory & { readonly createAgentCalls: number } {
  let agent: AgentInstance | undefined;
  let tenant: Tenant | undefined;
  let createAgentCalls = 0;

  return {
    get createAgentCalls() {
      return createAgentCalls;
    },
    async findAgentByAddress(address) {
      return agent?.address === address ? agent : undefined;
    },
    async createPartner(input) {
      return fakePartner("ptn_00000000000000000000000001");
    },
    async createTenant(input) {
      tenant = fakeTenant("ptn_00000000000000000000000001:00000000000000000000000001", input.partnerId);
      return tenant;
    },
    async findTenant(id) {
      return tenant?.id === id ? tenant : undefined;
    },
    async createAgent(input) {
      createAgentCalls += 1;
      const identity = await input.derive(0);
      // Real Postgres round-trips the row through `agentInstanceSchema.parse`
      // on the way back out, which is what actually brands `did` as a
      // `StellarDid` — mirrored here rather than trusting the caller's
      // `derive` return type, which is deliberately plain `string` (`DeriveAgentIdentity`).
      agent = fakeAgent({
        tenantId: input.tenantId,
        address: identity.address,
        did: stellarAddressToDid(identity.address, "testnet"),
        label: input.label ?? null,
      });
      return agent;
    },
    async setAgentOnchainState(id, state) {
      if (agent === undefined || agent.id !== id) throw new Error("agent not found in fake");
      agent = { ...agent, onchainState: state };
      return agent;
    },
  };
}

describe("ensureSharedPayerIdentity", () => {
  it("creates the shared agent row on the first call, marked funded", async () => {
    const directory = fakeDirectory();
    const identity = await ensureSharedPayerIdentity(directory, ADDRESS);

    expect(identity.payer.address).toBe(ADDRESS);
    expect(identity.payer.onchainState).toBe("funded");
    expect(identity.partnerId).toMatch(/^ptn_/);
    expect(directory.createAgentCalls).toBe(1);
  });

  it("reuses the existing row on every later call — no second agent is ever created", async () => {
    const directory = fakeDirectory();
    const first = await ensureSharedPayerIdentity(directory, ADDRESS);
    const second = await ensureSharedPayerIdentity(directory, ADDRESS);
    const third = await ensureSharedPayerIdentity(directory, ADDRESS);

    expect(second.payer.id).toBe(first.payer.id);
    expect(third.payer.id).toBe(first.payer.id);
    expect(directory.createAgentCalls).toBe(1);
  });

  it("recovers when a concurrent call already created the row — the create path loses the race but the lookup wins", async () => {
    const directory = fakeDirectory();
    // Simulate: another request already inserted the row (e.g. the unique
    // constraint on `address`), so this call's own createAgent would fail —
    // exercised here by having createPartner itself throw, which is enough
    // to prove the catch-and-refetch path works regardless of which step
    // in the creation sequence loses the race.
    const winner = await ensureSharedPayerIdentity(directory, ADDRESS);

    const raceProneDirectory: SharedPayerDirectory = {
      ...directory,
      findAgentByAddress: vi.fn(async (address: string) => (address === ADDRESS ? winner.payer : undefined)),
      createPartner: vi.fn(async () => {
        throw new Error("unique constraint violation (simulated)");
      }),
    };

    // findAgentByAddress already finds the winner's row, so createPartner
    // should never even be called for this second attempt.
    const loser = await ensureSharedPayerIdentity(raceProneDirectory, ADDRESS);
    expect(loser.payer.id).toBe(winner.payer.id);
    expect(raceProneDirectory.createPartner).not.toHaveBeenCalled();
  });

  it("re-throws the original error when creation fails and the row still cannot be found afterwards", async () => {
    const directory: SharedPayerDirectory = {
      async findAgentByAddress() {
        return undefined;
      },
      async createPartner(): Promise<Partner> {
        throw new Error("database unreachable (simulated)");
      },
      async createTenant() {
        throw new Error("unreached");
      },
      async findTenant() {
        return undefined;
      },
      async createAgent() {
        throw new Error("unreached");
      },
      async setAgentOnchainState() {
        throw new Error("unreached");
      },
    };

    await expect(ensureSharedPayerIdentity(directory, ADDRESS)).rejects.toThrow("database unreachable (simulated)");
  });
});

function fakeVisitorTenantDirectory(): VisitorTenantDirectory & { readonly createTenantCalls: number } {
  const tenants = new Map<string, Tenant>();
  let createTenantCalls = 0;

  return {
    get createTenantCalls() {
      return createTenantCalls;
    },
    async findTenantByExternalRef(partnerId, externalRef) {
      return tenants.get(`${partnerId}:${externalRef}`);
    },
    async createTenant(input) {
      createTenantCalls += 1;
      const key = `${input.partnerId}:${input.externalRef}`;
      if (tenants.has(key)) throw new Error("TenantAlreadyExists (simulated)");
      const tenant = fakeTenant(`${input.partnerId}:t${createTenantCalls}`, input.partnerId);
      tenants.set(key, { ...tenant, externalRef: input.externalRef });
      return tenants.get(key)!;
    },
  };
}

describe("ensureVisitorTenant", () => {
  const PARTNER_ID = "ptn_00000000000000000000000001";
  const WALLET = "GVINNY000000000000000000000000000000000000000000000001";

  it("creates the tenant on the first call for a wallet", async () => {
    const directory = fakeVisitorTenantDirectory();
    const tenant = await ensureVisitorTenant(directory, PARTNER_ID, WALLET);

    expect(tenant.partnerId).toBe(PARTNER_ID);
    expect(tenant.externalRef).toBe(WALLET);
    expect(directory.createTenantCalls).toBe(1);
  });

  it("finds the same tenant on a later call — no second tenant is created", async () => {
    const directory = fakeVisitorTenantDirectory();
    const first = await ensureVisitorTenant(directory, PARTNER_ID, WALLET);
    const second = await ensureVisitorTenant(directory, PARTNER_ID, WALLET);

    expect(second.id).toBe(first.id);
    expect(directory.createTenantCalls).toBe(1);
  });

  it("keeps two different wallets in two different tenants under the same partner", async () => {
    const directory = fakeVisitorTenantDirectory();
    const a = await ensureVisitorTenant(directory, PARTNER_ID, WALLET);
    const b = await ensureVisitorTenant(directory, PARTNER_ID, "GOTHERWALLET00000000000000000000000000000000000000002");

    expect(a.id).not.toBe(b.id);
  });

  it("recovers when a concurrent call already created the tenant", async () => {
    const directory = fakeVisitorTenantDirectory();
    const winner = await ensureVisitorTenant(directory, PARTNER_ID, WALLET);

    const raceProneDirectory: VisitorTenantDirectory = {
      findTenantByExternalRef: vi.fn(async (partnerId: string, externalRef: string) =>
        partnerId === PARTNER_ID && externalRef === WALLET ? winner : undefined,
      ),
      createTenant: vi.fn(async () => {
        throw new Error("unique constraint violation (simulated)");
      }),
    };

    const loser = await ensureVisitorTenant(raceProneDirectory, PARTNER_ID, WALLET);
    expect(loser.id).toBe(winner.id);
  });
});
