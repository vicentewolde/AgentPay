/**
 * Stellar keys as JWKs.
 *
 * A Stellar secret is a **32-byte Ed25519 seed**, not an expanded private key.
 * The JWK carries that seed in `d` and the public key in `x`, both base64url.
 * Swapping them, or using plain base64, produces a key that signs happily and
 * verifies against nothing — see jwk.test.ts, which pins this against the
 * RFC 8032 vector and @noble/curves.
 */
import type { Keypair } from "@stellar/stellar-sdk/base";

import { didToPublicKey } from "./did.js";
import { AgentPassError } from "./errors.js";

export interface Ed25519PublicJWK {
  readonly kty: "OKP";
  readonly crv: "Ed25519";
  /** Public key, 32 bytes, base64url. */
  readonly x: string;
}

export interface Ed25519PrivateJWK extends Ed25519PublicJWK {
  /** Ed25519 **seed**, 32 bytes, base64url. Not an expanded private key. */
  readonly d: string;
}

/** The JOSE algorithm every AgentPass signature uses. */
export const AGENTPASS_JWS_ALG = "EdDSA";

const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** Builds the public half of a JWK from raw Ed25519 key material. */
export function publicKeyToJWK(rawPublicKey: Uint8Array): Ed25519PublicJWK {
  if (rawPublicKey.length !== 32) {
    throw new AgentPassError("ConfigError", "an Ed25519 public key must be 32 bytes", {
      details: { length: rawPublicKey.length },
    });
  }

  return { kty: "OKP", crv: "Ed25519", x: toBase64Url(rawPublicKey) };
}

/**
 * The verifier's path: a DID in, a verification key out, no network access.
 * Propagates `InvalidDid` / `InvalidStellarAddress` from {@link didToPublicKey}.
 */
export function didToPublicJWK(did: string): Ed25519PublicJWK {
  return publicKeyToJWK(didToPublicKey(did));
}

/**
 * The signer's path. Requires a keypair that actually holds a seed —
 * `Keypair.fromPublicKey()` cannot sign, and is rejected rather than silently
 * yielding a JWK with no `d`.
 */
export function stellarKeypairToJWK(keypair: Keypair): Ed25519PrivateJWK {
  if (!keypair.canSign()) {
    throw new AgentPassError(
      "ConfigError",
      "this keypair holds no secret seed, so it cannot produce a signing JWK",
      { details: { publicKey: keypair.publicKey() } },
    );
  }

  const seed = Uint8Array.from(keypair.rawSecretKey());
  if (seed.length !== 32) {
    throw new AgentPassError("ConfigError", "an Ed25519 seed must be 32 bytes", {
      details: { length: seed.length },
    });
  }

  return {
    ...publicKeyToJWK(Uint8Array.from(keypair.rawPublicKey())),
    d: toBase64Url(seed),
  };
}
