import { isAgentPassError } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { deriveTenantKeypair, generateMasterMnemonic } from "./derive-keys.js";

// A fixed 24-word test mnemonic (BIP-39 English wordlist, valid checksum) —
// never used for anything but these tests.
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

describe("deriveTenantKeypair", () => {
  it("is deterministic — same mnemonic, index and role always derive the same keys", () => {
    const first = deriveTenantKeypair(TEST_MNEMONIC, 7, "agent");
    const second = deriveTenantKeypair(TEST_MNEMONIC, 7, "agent");
    expect(second).toEqual(first);
  });

  it("gives every tenant index a distinct keypair", () => {
    const tenant0 = deriveTenantKeypair(TEST_MNEMONIC, 0, "agent");
    const tenant1 = deriveTenantKeypair(TEST_MNEMONIC, 1, "agent");
    expect(tenant0.publicKey).not.toBe(tenant1.publicKey);
    expect(tenant0.secret).not.toBe(tenant1.secret);
  });

  it("never collides a tenant's agent key with its own issuer key", () => {
    const agent = deriveTenantKeypair(TEST_MNEMONIC, 3, "agent");
    const issuer = deriveTenantKeypair(TEST_MNEMONIC, 3, "issuer");
    expect(agent.publicKey).not.toBe(issuer.publicKey);
    expect(agent.secret).not.toBe(issuer.secret);
  });

  it("derives keys in the expected Stellar strkey shapes", () => {
    const { publicKey, secret } = deriveTenantKeypair(TEST_MNEMONIC, 0, "agent");
    expect(publicKey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(secret).toMatch(/^S[A-Z2-7]{55}$/);
  });

  it("rejects a negative tenant index", () => {
    expect(() => deriveTenantKeypair(TEST_MNEMONIC, -1, "agent")).toSatisfy(
      (fn: () => void) => catches(fn, "InvalidTenantIndex"),
    );
  });

  it("rejects a non-integer tenant index", () => {
    expect(() => deriveTenantKeypair(TEST_MNEMONIC, 1.5, "issuer")).toSatisfy(
      (fn: () => void) => catches(fn, "InvalidTenantIndex"),
    );
  });

  it("rejects a mnemonic that is not valid BIP-39", () => {
    expect(() => deriveTenantKeypair("not a real mnemonic at all", 0, "agent")).toSatisfy(
      (fn: () => void) => catches(fn, "ConfigError"),
    );
  });
});

describe("generateMasterMnemonic", () => {
  it("produces a 24-word phrase that deriveTenantKeypair accepts", () => {
    const mnemonic = generateMasterMnemonic();
    expect(mnemonic.split(" ")).toHaveLength(24);
    expect(() => deriveTenantKeypair(mnemonic, 0, "agent")).not.toThrow();
  });

  it("never repeats a phrase across calls", () => {
    expect(generateMasterMnemonic()).not.toBe(generateMasterMnemonic());
  });
});

function catches(fn: () => void, code: string): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return isAgentPassError(error) && error.code === code;
  }
}
