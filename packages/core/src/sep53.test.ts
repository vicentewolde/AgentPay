import { createHash } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { signStellarMessage, verifyStellarMessage } from "./sep53.js";

const STELLAR_MESSAGE_PREFIX = "Stellar Signed Message:\n";

/** Reference SEP-0053 signer, hand-rolled independently of `signStellarMessage`
 * — so the "accepts a signature produced per SEP-0053" test can't pass just
 * because both sides share the same bug. */
function referenceSignStellarMessage(keypair: Keypair, message: string): string {
  const payload = Buffer.concat([Buffer.from(STELLAR_MESSAGE_PREFIX, "utf8"), Buffer.from(message, "utf8")]);
  const hash = createHash("sha256").update(payload).digest();
  // `Keypair.sign` returns a plain Uint8Array, not a Node Buffer — its own
  // `.toString("base64")` silently ignores the encoding argument instead of
  // erroring, which is exactly how this line first got it wrong.
  return Buffer.from(keypair.sign(hash)).toString("base64");
}

describe("signStellarMessage / verifyStellarMessage round trip", () => {
  it("verifies its own signature", () => {
    const wallet = Keypair.random();
    const signature = signStellarMessage(wallet, "connect me");

    expect(verifyStellarMessage(wallet.publicKey(), "connect me", signature)).toBe(true);
  });
});

describe("verifyStellarMessage", () => {
  it("accepts a signature produced per SEP-0053 by an independent reference signer", () => {
    const wallet = Keypair.random();
    const signature = referenceSignStellarMessage(wallet, "connect me");

    expect(verifyStellarMessage(wallet.publicKey(), "connect me", signature)).toBe(true);
  });

  it("rejects a signature over a different message", () => {
    const wallet = Keypair.random();
    const signature = referenceSignStellarMessage(wallet, "connect me");

    expect(verifyStellarMessage(wallet.publicKey(), "connect someone else", signature)).toBe(false);
  });

  it("rejects a signature from a different wallet than claimed", () => {
    const wallet = Keypair.random();
    const impostor = Keypair.random();
    const signature = referenceSignStellarMessage(impostor, "connect me");

    expect(verifyStellarMessage(wallet.publicKey(), "connect me", signature)).toBe(false);
  });

  it("rejects a signature that skips the SEP-0053 prefix", () => {
    const wallet = Keypair.random();
    const message = "connect me";
    // Signs the raw message hash directly, without "Stellar Signed Message:\n" —
    // exactly the mistake this function exists to refuse.
    const unprefixedHash = createHash("sha256").update(message, "utf8").digest();
    const signature = Buffer.from(wallet.sign(unprefixedHash)).toString("base64");

    expect(verifyStellarMessage(wallet.publicKey(), message, signature)).toBe(false);
  });

  it("returns false, never throws, for a malformed public key or signature", () => {
    expect(verifyStellarMessage("not-a-real-address", "connect me", "not-base64-either")).toBe(false);
    expect(verifyStellarMessage(Keypair.random().publicKey(), "connect me", "")).toBe(false);
  });
});
