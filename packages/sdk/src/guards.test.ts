import { randomBytes } from "node:crypto";

import { hasErrorCode, stellarAddressToDid } from "@agentpass/core";
import type { AgentPassCredential } from "@agentpass/core";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import type { AgentPassConfig } from "./config.js";
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

describe("assertTrustedRegistry", () => {
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
      expect(error).toMatchObject({
        details: {
          credentialRegistry: OTHER,
          trustedRegistry: TRUSTED,
        },
      });
    }
  });
});

describe("credentialHashToBytes", () => {
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

  it("throws ConfigError with correct details for invalid hex", () => {
    const invalid = "not-hex".padEnd(64, "z");
    try {
      credentialHashToBytes(invalid);
      expect.unreachable("expected credentialHashToBytes to throw");
    } catch (error) {
      expect(hasErrorCode(error, "ConfigError")).toBe(true);
      expect(error).toMatchObject({
        details: { value: invalid },
      });
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
