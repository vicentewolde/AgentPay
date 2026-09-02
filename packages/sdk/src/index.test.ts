import { randomBytes } from "node:crypto";

import { hasErrorCode, stellarAddressToDid } from "@agentpass/core";
import type { AgentPassCredential } from "@agentpass/core";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import type { AgentPassConfig } from "./config.js";
import { configFromEnv, parseConfig } from "./config.js";
import { assertTrustedRegistry, credentialHashToBytes } from "./guards.js";

const TRUSTED = StrKey.encodeContract(randomBytes(32));
const OTHER = StrKey.encodeContract(randomBytes(32));

const CONFIG: AgentPassConfig = {
  contractId: TRUSTED,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  network: "testnet",
};

function credentialNaming(registry: string): AgentPassCredential {
  const issuer = stellarAddressToDid(Keypair.random().publicKey(), "testnet");
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "AgentPassCredential"],
    issuer,
    validFrom: "2026-09-01T00:00:00Z",
    validUntil: "2026-12-01T00:00:00Z",
    credentialSubject: {
      id: stellarAddressToDid(Keypair.random().publicKey(), "testnet"),
      agent: { name: "compras-demo", model: "claude-sonnet-4-6", operator: "pilot" },
      principal: issuer,
      scope: {
        actions: ["catalog:read"],
        venues: [],
        assets: [],
        limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" },
      },
    },
    credentialStatus: { type: "AgentPassRegistry2026", registry },
  };
}

describe("configuration", () => {
  it("accepts a well-formed config", () => {
    expect(parseConfig(CONFIG)).toEqual(CONFIG);
  });

  it("rejects an account address where a contract id belongs", () => {
    const broken = { ...CONFIG, contractId: Keypair.random().publicKey() };

    expect(() => parseConfig(broken)).toSatisfy(throws("ConfigError"));
  });

  it("rejects an empty or malformed rpc url", () => {
    for (const rpcUrl of ["", "not a url", "soroban-testnet.stellar.org"]) {
      expect(() => parseConfig({ ...CONFIG, rpcUrl })).toSatisfy(throws("ConfigError"));
    }
  });

  it("rejects an unknown network", () => {
    expect(() => parseConfig({ ...CONFIG, network: "futurenet" })).toSatisfy(
      throws("ConfigError"),
    );
  });

  it("rejects unknown fields, so a typo cannot pass silently", () => {
    expect(() => parseConfig({ ...CONFIG, contractID: TRUSTED })).toSatisfy(throws("ConfigError"));
  });

  it("builds a config from the variables bootstrap and deploy write", () => {
    expect(
      configFromEnv({
        AGENT_REGISTRY_CONTRACT_ID: TRUSTED,
        STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
        STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
        STELLAR_NETWORK: "testnet",
      }),
    ).toEqual(CONFIG);
  });

  it("fails loudly when the contract id has not been deployed yet", () => {
    expect(() =>
      configFromEnv({
        AGENT_REGISTRY_CONTRACT_ID: "",
        STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
        STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
        STELLAR_NETWORK: "testnet",
      }),
    ).toSatisfy(throws("ConfigError"));
  });
});

describe("the verifier chooses the registry it trusts", () => {
  it("accepts a credential naming the trusted registry", () => {
    expect(() => assertTrustedRegistry(credentialNaming(TRUSTED), CONFIG)).not.toThrow();
  });

  it("refuses a credential that nominates a registry of its own", () => {
    // Otherwise an issuer could stand up a registry they control and answer
    // for the status of their own credentials.
    try {
      assertTrustedRegistry(credentialNaming(OTHER), CONFIG);
      expect.unreachable("a foreign registry must be refused");
    } catch (error) {
      expect(hasErrorCode(error, "RegistryMismatch")).toBe(true);
    }
  });
});

describe("credential hashes", () => {
  it("accepts 64 lowercase hex characters and yields 32 bytes", () => {
    const hex = randomBytes(32).toString("hex");

    expect(credentialHashToBytes(hex)).toHaveLength(32);
    expect(credentialHashToBytes(hex).toString("hex")).toBe(hex);
  });

  it("refuses anything else rather than silently truncating", () => {
    const valid = randomBytes(32).toString("hex");

    for (const bad of [
      "",
      valid.slice(0, 63),
      `${valid}00`,
      valid.toUpperCase(),
      `0x${valid}`,
      "not-hex".padEnd(64, "z"),
    ]) {
      expect(() => credentialHashToBytes(bad)).toSatisfy(throws("ConfigError"));
    }
  });
});

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
