import { stellarAddressToDid } from "@agentpass/core";
import type { AgentInstance } from "@agentpey/directory";
import { deriveTenantKeypair, generateMasterMnemonic } from "@agentpey/tenancy";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { ensureTenantPolicyRail, type TenantRailDirectory } from "./tenant-rail.js";

const TENANT_A = "ptn_00000000000000000000000001:00000000000000000000000001";
const RAIL_CONTRACT_ID = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";

function fakeAgent(overrides: Partial<AgentInstance> = {}): AgentInstance {
  const address = Keypair.random().publicKey();
  return {
    id: "agt_00000000000000000000000001",
    tenantId: TENANT_A,
    keyIndex: 0,
    address,
    did: stellarAddressToDid(address, "testnet"),
    label: null,
    status: "active",
    onchainState: "derived",
    policyRailContractId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("ensureTenantPolicyRail", () => {
  const mnemonic = generateMasterMnemonic();

  it("returns the existing rail without touching the directory or the network, when one is already deployed", async () => {
    const instance = fakeAgent({ policyRailContractId: RAIL_CONTRACT_ID });
    const { secret } = deriveTenantKeypair(mnemonic, instance.keyIndex, "agent");
    const keypair = Keypair.fromSecret(secret);

    let setCalls = 0;
    const directory: TenantRailDirectory = {
      async setAgentPolicyRail() {
        setCalls += 1;
        throw new Error("must not be called — a rail already exists");
      },
    };

    const contractId = await ensureTenantPolicyRail(
      directory,
      { instance, keypair },
      Keypair.random().publicKey(),
      Keypair.random(),
      "0".repeat(64),
    );

    expect(contractId).toBe(RAIL_CONTRACT_ID);
    expect(setCalls).toBe(0);
  });
});
