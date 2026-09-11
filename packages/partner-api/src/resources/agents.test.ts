import { stellarAddressToDid } from "@agentpass/core";
import { newId, newTenantId, type AgentInstance } from "@agentpay/directory";
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";

import { agentResourceSchema, toAgentResource } from "./agents.js";

const tenantId = newTenantId(newId("partner"));
const keypair = Keypair.random();

function fakeAgent(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    id: newId("agent"),
    tenantId,
    keyIndex: 7,
    address: keypair.publicKey(),
    did: stellarAddressToDid(keypair.publicKey(), "testnet"),
    label: null,
    status: "active",
    onchainState: "derived",
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    updatedAt: new Date("2026-09-10T00:00:00.000Z"),
    ...overrides,
  };
}

describe("toAgentResource", () => {
  it("maps the internal AgentInstance to the public DTO, without keyIndex", () => {
    const agent = fakeAgent();
    const resource = toAgentResource(agent);

    expect(resource).toEqual({
      id: agent.id,
      tenant_id: tenantId,
      address: agent.address,
      did: agent.did,
      label: null,
      status: "active",
      onchain_state: "derived",
      created_at: "2026-09-10T00:00:00.000Z",
    });
    expect(agentResourceSchema.safeParse(resource).success).toBe(true);
    expect("keyIndex" in resource).toBe(false);
    expect("key_index" in resource).toBe(false);
  });
});
