import { isAgentPassError, signStellarMessage } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";

import { didOf, makeTestMandate } from "./testing.js";
import {
  canonicalMandateJson,
  mandateChallengeMessage,
  verifyWalletSignedMandate,
  walletMandateHash,
} from "./wallet-sign.js";

function walletSign(principal: Keypair, mandate: ReturnType<typeof makeTestMandate>): string {
  return signStellarMessage(principal, mandateChallengeMessage(mandate));
}

/** Rebuilds an object with every level's keys inserted in reverse order —
 * same values, deliberately different enumeration order at every depth, to
 * prove `canonicalMandateJson` does not depend on it. */
function withReversedKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withReversedKeyOrder);
  if (value !== null && typeof value === "object") {
    const rebuilt: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
      rebuilt[key] = withReversedKeyOrder((value as Record<string, unknown>)[key]);
    }
    return rebuilt;
  }
  return value;
}

describe("canonicalMandateJson / walletMandateHash", () => {
  it("is the same string regardless of key insertion order", () => {
    const principal = Keypair.random();
    const agent = Keypair.random();
    const mandate = makeTestMandate(principal, agent);

    // Same fields, rebuilt as a fresh object with every level's keys in
    // reverse order — exactly what a browser and a server independently
    // constructing "the same" mandate could produce.
    const reordered = withReversedKeyOrder(mandate) as typeof mandate;

    expect(canonicalMandateJson(reordered)).toBe(canonicalMandateJson(mandate));
    expect(walletMandateHash(reordered)).toBe(walletMandateHash(mandate));
  });

  it("changes if any field of the mandate changes", () => {
    const principal = Keypair.random();
    const agent = Keypair.random();
    const mandate = makeTestMandate(principal, agent);
    const different = makeTestMandate(principal, agent, { mandateId: "11111111-1111-4111-8111-111111111111" });

    expect(walletMandateHash(different)).not.toBe(walletMandateHash(mandate));
  });
});

describe("mandateChallengeMessage", () => {
  it("names the agent, the limits and the mandate's own hash", () => {
    const principal = Keypair.random();
    const agent = Keypair.random();
    const mandate = makeTestMandate(principal, agent);
    const message = mandateChallengeMessage(mandate);

    expect(message).toContain(didOf(agent));
    expect(message).toContain(mandate.credentialSubject.grant.limits.perTx);
    expect(message).toContain(mandate.credentialSubject.grant.limits.perDay);
    expect(message).toContain(walletMandateHash(mandate));
  });
});

describe("verifyWalletSignedMandate", () => {
  it("verifies a mandate signed by its own principal", async () => {
    const principal = Keypair.random();
    const agent = Keypair.random();
    const mandate = makeTestMandate(principal, agent);
    const signature = walletSign(principal, mandate);

    const verified = await verifyWalletSignedMandate(mandate, signature, { now: new Date("2026-09-15") });

    expect(verified.principal).toBe(didOf(principal));
    expect(verified.agent).toBe(didOf(agent));
    expect(verified.hash).toBe(walletMandateHash(mandate));
  });

  it("rejects a signature from a wallet other than the mandate's principal", async () => {
    const principal = Keypair.random();
    const impostor = Keypair.random();
    const agent = Keypair.random();
    const mandate = makeTestMandate(principal, agent);
    const signature = walletSign(impostor, mandate);

    await expect(verifyWalletSignedMandate(mandate, signature, { now: new Date("2026-09-15") })).rejects.toSatisfy(
      (error: unknown) => isAgentPassError(error) && error.code === "InvalidSignature",
    );
  });

  it("rejects a signature over a mandate that was tampered with after signing", async () => {
    const principal = Keypair.random();
    const agent = Keypair.random();
    const mandate = makeTestMandate(principal, agent);
    const signature = walletSign(principal, mandate);

    const tampered = {
      ...mandate,
      credentialSubject: {
        ...mandate.credentialSubject,
        grant: { ...mandate.credentialSubject.grant, limits: { ...mandate.credentialSubject.grant.limits, perTx: "999999.0000000" } },
      },
    };

    await expect(verifyWalletSignedMandate(tampered, signature, { now: new Date("2026-09-15") })).rejects.toSatisfy(
      (error: unknown) => isAgentPassError(error) && error.code === "InvalidSignature",
    );
  });

  it("rejects a payload that is not a valid mandate", async () => {
    await expect(verifyWalletSignedMandate({ not: "a mandate" }, "sig")).rejects.toSatisfy(
      (error: unknown) => isAgentPassError(error) && error.code === "InvalidMandate",
    );
  });

  it("rejects an expired mandate, after checking the signature", async () => {
    const principal = Keypair.random();
    const agent = Keypair.random();
    const mandate = makeTestMandate(principal, agent, {
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-02-01T00:00:00.000Z",
    });
    const signature = walletSign(principal, mandate);

    await expect(verifyWalletSignedMandate(mandate, signature, { now: new Date("2026-09-15") })).rejects.toSatisfy(
      (error: unknown) => isAgentPassError(error) && error.code === "MandateExpired",
    );
  });

  it("rejects a mandate not yet valid", async () => {
    const principal = Keypair.random();
    const agent = Keypair.random();
    const mandate = makeTestMandate(principal, agent, {
      validFrom: "2027-01-01T00:00:00.000Z",
      validUntil: "2027-02-01T00:00:00.000Z",
    });
    const signature = walletSign(principal, mandate);

    await expect(verifyWalletSignedMandate(mandate, signature, { now: new Date("2026-09-15") })).rejects.toSatisfy(
      (error: unknown) => isAgentPassError(error) && error.code === "MandateNotYetValid",
    );
  });
});
