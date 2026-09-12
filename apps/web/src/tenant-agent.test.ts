import { stellarAddressToDid } from "@agentpass/core";
import type { AgentInstance } from "@agentpey/directory";
import { generateMasterMnemonic } from "@agentpey/tenancy";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

import { ensureTenantAgent, type TenantAgentDirectory } from "./tenant-agent.js";

const TENANT_A = "ptn_00000000000000000000000001:00000000000000000000000001";
const TENANT_B = "ptn_00000000000000000000000001:00000000000000000000000002";
const PLACEHOLDER_ADDRESS = Keypair.random().publicKey();

function fakeAgent(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    id: "agt_00000000000000000000000001",
    tenantId: TENANT_A,
    keyIndex: 0,
    address: PLACEHOLDER_ADDRESS,
    did: stellarAddressToDid(PLACEHOLDER_ADDRESS, "testnet"),
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

/** A minimal in-memory stand-in for the directory, backed by a real key-index sequence. */
function fakeDirectory(): TenantAgentDirectory & { readonly createAgentCalls: number } {
  const byTenant = new Map<string, AgentInstance[]>();
  let nextIndex = 0;
  let createAgentCalls = 0;

  return {
    get createAgentCalls() {
      return createAgentCalls;
    },
    async listAgents(tenantId) {
      return byTenant.get(tenantId) ?? [];
    },
    async createAgent(input) {
      createAgentCalls += 1;
      const keyIndex = nextIndex;
      nextIndex += 1;
      const identity = await input.derive(keyIndex);
      const agent = fakeAgent({
        id: `agt_${String(keyIndex).padStart(26, "0")}`,
        tenantId: input.tenantId,
        keyIndex,
        address: identity.address,
        did: stellarAddressToDid(identity.address, "testnet"),
        label: input.label ?? null,
      });
      byTenant.set(input.tenantId, [...(byTenant.get(input.tenantId) ?? []), agent]);
      return agent;
    },
  };
}

describe("ensureTenantAgent", () => {
  const mnemonic = generateMasterMnemonic();

  it("derives and creates the tenant's own agent on the first call", async () => {
    const directory = fakeDirectory();
    const result = await ensureTenantAgent(directory, mnemonic, TENANT_A);

    expect(result.instance.tenantId).toBe(TENANT_A);
    expect(result.keypair.publicKey()).toBe(result.instance.address);
    expect(directory.createAgentCalls).toBe(1);
  });

  it("reuses the same agent on later calls — no second one is ever created", async () => {
    const directory = fakeDirectory();
    const first = await ensureTenantAgent(directory, mnemonic, TENANT_A);
    const second = await ensureTenantAgent(directory, mnemonic, TENANT_A);
    const third = await ensureTenantAgent(directory, mnemonic, TENANT_A);

    expect(second.instance.id).toBe(first.instance.id);
    expect(third.instance.id).toBe(first.instance.id);
    expect(second.keypair.secret()).toBe(first.keypair.secret());
    expect(directory.createAgentCalls).toBe(1);
  });

  it("gives two different tenants two different derived identities, from the same seed", async () => {
    const directory = fakeDirectory();
    const a = await ensureTenantAgent(directory, mnemonic, TENANT_A);
    const b = await ensureTenantAgent(directory, mnemonic, TENANT_B);

    expect(a.instance.keyIndex).not.toBe(b.instance.keyIndex);
    expect(a.instance.address).not.toBe(b.instance.address);
    expect(a.keypair.secret()).not.toBe(b.keypair.secret());
  });

  it("re-derives the exact same keypair across separate calls — nothing about it is cached or stored", async () => {
    // The whole point of deriving from (mnemonic, keyIndex) instead of
    // storing a secret: a brand new call, with no shared in-memory state at
    // all, reconstructs the identical private key.
    const directory = fakeDirectory();
    const first = await ensureTenantAgent(directory, mnemonic, TENANT_A);

    const freshDirectory: TenantAgentDirectory = { listAgents: async () => [first.instance], createAgent: directory.createAgent };
    const rehydrated = await ensureTenantAgent(freshDirectory, mnemonic, TENANT_A);

    expect(rehydrated.keypair.secret()).toBe(first.keypair.secret());
  });

  it("recovers when a concurrent call already created the tenant's agent mid-flight", async () => {
    // The scenario this guards: this call's own `listAgents` finds nothing
    // (it is the very first request for a brand-new tenant), but by the time
    // its own `createAgent` runs, another request already won that race —
    // exercised here by having `createAgent` itself throw, and the *second*
    // `listAgents` call (inside the catch) finding what the winner created.
    const winner = fakeAgent({ tenantId: TENANT_A, keyIndex: 7 });
    let listCalls = 0;
    const raceProneDirectory: TenantAgentDirectory = {
      listAgents: vi.fn(async () => {
        listCalls += 1;
        return listCalls === 1 ? [] : [winner];
      }),
      createAgent: vi.fn(async () => {
        throw new Error("unique constraint violation (simulated)");
      }),
    };

    const loser = await ensureTenantAgent(raceProneDirectory, mnemonic, TENANT_A);
    expect(loser.instance.id).toBe(winner.id);
    expect(raceProneDirectory.createAgent).toHaveBeenCalledTimes(1);
    expect(raceProneDirectory.listAgents).toHaveBeenCalledTimes(2);
  });

  it("re-throws the original error when creation fails and the tenant still has no agent afterwards", async () => {
    const directory: TenantAgentDirectory = {
      async listAgents() {
        return [];
      },
      async createAgent() {
        throw new Error("database unreachable (simulated)");
      },
    };

    await expect(ensureTenantAgent(directory, mnemonic, TENANT_A)).rejects.toThrow("database unreachable (simulated)");
  });
});
