import { randomBytes } from "node:crypto";

import { hasErrorCode } from "@agentpass/core";
import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { configFromEnv, parseConfig, type AgentPassConfig } from "./config.js";

const CONFIG: AgentPassConfig = {
  contractId: StrKey.encodeContract(randomBytes(32)),
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  network: "testnet",
};

const ENV = {
  AGENT_REGISTRY_CONTRACT_ID: CONFIG.contractId,
  STELLAR_RPC_URL: CONFIG.rpcUrl,
  STELLAR_NETWORK_PASSPHRASE: CONFIG.networkPassphrase,
  STELLAR_NETWORK: CONFIG.network,
};

describe("parseConfig", () => {
  it("accepts a complete and valid configuration", () => {
    expect(parseConfig(CONFIG)).toEqual(CONFIG);
  });

  it.each([
    { name: "contractId", input: omit(CONFIG, "contractId") },
    { name: "rpcUrl", input: omit(CONFIG, "rpcUrl") },
    { name: "networkPassphrase", input: omit(CONFIG, "networkPassphrase") },
    { name: "network", input: omit(CONFIG, "network") },
    { name: "contractId type", input: { ...CONFIG, contractId: 123 } },
    { name: "rpcUrl type", input: { ...CONFIG, rpcUrl: 123 } },
    { name: "networkPassphrase type", input: { ...CONFIG, networkPassphrase: 123 } },
    { name: "network value", input: { ...CONFIG, network: "futurenet" } },
  ])("rejects an invalid configuration ($name)", ({ input }) => {
    expect(() => parseConfig(input)).toSatisfy(throws("ConfigError"));
  });
});

describe("configFromEnv", () => {
  it("builds the expected configuration from complete environment variables", () => {
    expect(configFromEnv(ENV)).toEqual(CONFIG);
  });

  it.each([
    "AGENT_REGISTRY_CONTRACT_ID",
    "STELLAR_RPC_URL",
    "STELLAR_NETWORK_PASSPHRASE",
    "STELLAR_NETWORK",
  ])("rejects a missing %s variable with ConfigError", (variable) => {
    const missing = { ...ENV };
    delete missing[variable as keyof typeof missing];

    expect(() => configFromEnv(missing)).toSatisfy(throws("ConfigError"));
  });

  it.each([
    "AGENT_REGISTRY_CONTRACT_ID",
    "STELLAR_RPC_URL",
    "STELLAR_NETWORK_PASSPHRASE",
    "STELLAR_NETWORK",
  ])("rejects an empty %s variable with ConfigError", (variable) => {
    expect(() => configFromEnv({ ...ENV, [variable]: "" })).toSatisfy(
      throws("ConfigError"),
    );
  });
});

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

/** Asserts a thunk throws an AgentPassError carrying `code`. */
function throws(code: Parameters<typeof hasErrorCode>[1]) {
  return (thunk: () => unknown): boolean => {
    try {
      thunk();
      return false;
    } catch (error) {
      return hasErrorCode(error, code);
    }
  };
}
