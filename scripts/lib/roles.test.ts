import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { hasErrorCode } from "@agentpass/core";

import { parseEnv } from "./env-file.js";
import { ROLES, renderEnvLocal, resolveKeypair } from "./roles.js";

const ADMIN = ROLES[0];

function envFor(entries: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries));
}

describe("resolveKeypair", () => {
  it("generates a fresh keypair when nothing is stored", () => {
    const resolved = resolveKeypair(ADMIN, envFor({}));

    expect(resolved.origin).toBe("generated");
    expect(resolved.keypair.publicKey()).toMatch(/^G[A-Z2-7]{55}$/);
  });

  it("reuses the stored secret — this is what makes bootstrap idempotent", () => {
    const existing = Keypair.random();
    const env = envFor({
      ADMIN_SECRET_KEY: existing.secret(),
      ADMIN_PUBLIC_KEY: existing.publicKey(),
    });

    const first = resolveKeypair(ADMIN, env);
    const second = resolveKeypair(ADMIN, env);

    expect(first.origin).toBe("reused");
    expect(first.keypair.publicKey()).toBe(existing.publicKey());
    expect(second.keypair.publicKey()).toBe(existing.publicKey());
  });

  it("rejects a malformed secret with ConfigError, not a bare Error", () => {
    try {
      resolveKeypair(ADMIN, envFor({ ADMIN_SECRET_KEY: "SNOTAREALSEED" }));
      expect.unreachable("a malformed seed must throw");
    } catch (error) {
      expect(hasErrorCode(error, "ConfigError")).toBe(true);
    }
  });

  it("rejects a public key that disagrees with its secret", () => {
    const env = envFor({
      ADMIN_SECRET_KEY: Keypair.random().secret(),
      ADMIN_PUBLIC_KEY: Keypair.random().publicKey(),
    });

    try {
      resolveKeypair(ADMIN, env);
      expect.unreachable("a mismatched public key must throw");
    } catch (error) {
      expect(hasErrorCode(error, "ConfigError")).toBe(true);
    }
  });

  it("rejects a public key stored without its secret, since it cannot sign", () => {
    const env = envFor({ ADMIN_PUBLIC_KEY: Keypair.random().publicKey() });

    try {
      resolveKeypair(ADMIN, env);
      expect.unreachable("a public key with no secret must throw");
    } catch (error) {
      expect(hasErrorCode(error, "ConfigError")).toBe(true);
    }
  });
});

describe("renderEnvLocal", () => {
  const resolved = ROLES.map((role) => resolveKeypair(role, envFor({})));
  const now = new Date("2026-09-01T00:00:00.000Z");

  it("writes every role's keypair and reparses to the same values", () => {
    const parsed = parseEnv(renderEnvLocal(resolved, envFor({}), now));

    for (const entry of resolved) {
      expect(parsed.get(`${entry.role.id}_PUBLIC_KEY`)).toBe(entry.keypair.publicKey());
      expect(parsed.get(`${entry.role.id}_SECRET_KEY`)).toBe(entry.keypair.secret());
    }
    expect(parsed.get("STELLAR_NETWORK_PASSPHRASE")).toBe("Test SDF Network ; September 2015");
  });

  it("preserves the contract id written by deploy:registry", () => {
    const contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const parsed = parseEnv(
      renderEnvLocal(resolved, envFor({ AGENT_REGISTRY_CONTRACT_ID: contractId }), now),
    );

    expect(parsed.get("AGENT_REGISTRY_CONTRACT_ID")).toBe(contractId);
  });

  it("carries over keys bootstrap does not own", () => {
    const parsed = parseEnv(renderEnvLocal(resolved, envFor({ OPERATOR_NOTE: "hand added" }), now));

    expect(parsed.get("OPERATOR_NOTE")).toBe("hand added");
  });

  it("is byte-stable across runs apart from its timestamp", () => {
    const existing = parseEnv(renderEnvLocal(resolved, envFor({}), now));
    const rerun = ROLES.map((role) => resolveKeypair(role, existing));

    expect(renderEnvLocal(rerun, existing, now)).toBe(renderEnvLocal(resolved, envFor({}), now));
    expect(rerun.every((entry) => entry.origin === "reused")).toBe(true);
  });
});
