/**
 * The brief flags this as the project's most likely point of silent failure: a
 * Stellar secret is a 32-byte Ed25519 *seed*, and the JWK needs that seed in
 * `d` and the public key in `x`, both base64url. Get it wrong and everything
 * still appears to work — keys are produced, signatures are made — but they
 * verify against nothing.
 *
 * So these tests were written before the implementation, and each one
 * cross-checks against an independent source: the RFC 8032 test vector, and
 * @noble/curves, which shares no code with jose or the Stellar SDK.
 */
import type { webcrypto } from "node:crypto";

import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair } from "@stellar/stellar-sdk/base";
import { importJWK } from "jose";
import { describe, expect, it } from "vitest";

import { stellarAddressToDid } from "./did.js";
import { hasErrorCode } from "./errors.js";
import { didToPublicJWK, publicKeyToJWK, stellarKeypairToJWK } from "./jwk.js";

/** RFC 8032, section 7.1, TEST 1. An external, immovable reference point. */
const RFC8032 = {
  seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
} as const;

const fromB64url = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "base64url"));
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

describe("stellarKeypairToJWK against the RFC 8032 vector", () => {
  const keypair = Keypair.fromRawEd25519Seed(Buffer.from(RFC8032.seed, "hex"));

  it("puts the 32-byte seed in d and the public key in x — not the other way round", () => {
    const jwk = stellarKeypairToJWK(keypair);

    expect(hex(fromB64url(jwk.d))).toBe(RFC8032.seed);
    expect(hex(fromB64url(jwk.x))).toBe(RFC8032.publicKey);
    expect(fromB64url(jwk.d)).toHaveLength(32);
    expect(fromB64url(jwk.x)).toHaveLength(32);
  });

  it("declares the OKP/Ed25519 key type", () => {
    const jwk = stellarKeypairToJWK(keypair);

    expect(jwk.kty).toBe("OKP");
    expect(jwk.crv).toBe("Ed25519");
  });

  it("encodes base64url, not base64 — no +, / or = may appear", () => {
    for (let i = 0; i < 50; i += 1) {
      const jwk = stellarKeypairToJWK(Keypair.random());

      for (const value of [jwk.d, jwk.x]) {
        expect(value).not.toMatch(/[+/=]/);
        expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    }
  });
});

describe("cross-check against @noble/curves", () => {
  it("derives the same public key from d that noble derives from the same seed", () => {
    for (let i = 0; i < 50; i += 1) {
      const jwk = stellarKeypairToJWK(Keypair.random());

      expect(hex(ed25519.getPublicKey(fromB64url(jwk.d)))).toBe(hex(fromB64url(jwk.x)));
    }
  });

  it("signs with WebCrypto through the JWK and verifies with noble", async () => {
    const keypair = Keypair.random();
    const jwk = stellarKeypairToJWK(keypair);
    const message = new TextEncoder().encode("agentpass cross-check");

    const privateKey = await importJWK(jwk, "EdDSA");
    const signature = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, privateKey as webcrypto.CryptoKey, message),
    );

    expect(ed25519.verify(signature, message, Uint8Array.from(keypair.rawPublicKey()))).toBe(true);
  });

  it("signs with noble and verifies with WebCrypto through the public JWK", async () => {
    const keypair = Keypair.random();
    const message = new TextEncoder().encode("agentpass cross-check");

    const signature = ed25519.sign(message, Uint8Array.from(keypair.rawSecretKey()));

    const publicKey = await importJWK(publicKeyToJWK(keypair.rawPublicKey()), "EdDSA");
    const verified = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey as webcrypto.CryptoKey,
      signature,
      message,
    );

    expect(verified).toBe(true);
  });

  it("rejects a signature made with a different key", async () => {
    const message = new TextEncoder().encode("agentpass cross-check");
    const signature = ed25519.sign(message, Uint8Array.from(Keypair.random().rawSecretKey()));

    const publicKey = await importJWK(publicKeyToJWK(Keypair.random().rawPublicKey()), "EdDSA");

    expect(
      await crypto.subtle.verify({ name: "Ed25519" }, publicKey as webcrypto.CryptoKey, signature, message),
    ).toBe(false);
  });
});

describe("public JWKs", () => {
  it("carries no private material", () => {
    const keypair = Keypair.random();

    const jwk = publicKeyToJWK(keypair.rawPublicKey());

    expect(jwk).not.toHaveProperty("d");
    expect(hex(fromB64url(jwk.x))).toBe(hex(Uint8Array.from(keypair.rawPublicKey())));
  });

  it("derives from a DID without touching the network — the verifier's path", () => {
    const keypair = Keypair.random();
    const did = stellarAddressToDid(keypair.publicKey(), "testnet");

    expect(didToPublicJWK(did)).toEqual(publicKeyToJWK(keypair.rawPublicKey()));
  });

  it("propagates the DID's typed error for a malformed identifier", () => {
    try {
      didToPublicJWK("did:key:testnet:whatever");
      expect.unreachable("a malformed DID must throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidDid")).toBe(true);
    }
  });
});

describe("keys that cannot sign", () => {
  it("refuses to build a private JWK from a public-only keypair", () => {
    const publicOnly = Keypair.fromPublicKey(Keypair.random().publicKey());

    try {
      stellarKeypairToJWK(publicOnly);
      expect.unreachable("a public-only keypair has no seed to put in d");
    } catch (error) {
      expect(hasErrorCode(error, "ConfigError")).toBe(true);
    }
  });
});
