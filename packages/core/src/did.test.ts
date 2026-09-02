import { randomBytes } from "node:crypto";

import { Keypair, StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";

import type { AgentPassErrorCode } from "./errors.js";
import { hasErrorCode } from "./errors.js";
import {
  didToPublicKey,
  didToStellarAddress,
  parseStellarDid,
  stellarAddressToDid,
  stellarAddressSchema,
  stellarDidSchema,
} from "./did.js";

const SAMPLE = 100;

describe("did:stellar round trip", () => {
  it(`recovers the original raw public key for ${SAMPLE} random keypairs`, () => {
    for (let i = 0; i < SAMPLE; i += 1) {
      const keypair = Keypair.random();

      const did = stellarAddressToDid(keypair.publicKey(), "testnet");
      const recovered = didToPublicKey(did);

      expect(Uint8Array.from(recovered)).toEqual(Uint8Array.from(keypair.rawPublicKey()));
      expect(recovered).toHaveLength(32);
      expect(didToStellarAddress(did)).toBe(keypair.publicKey());
    }
  });

  it(`preserves every byte for ${SAMPLE} random 32-byte keys, independently of Keypair`, () => {
    for (let i = 0; i < SAMPLE; i += 1) {
      const raw = Uint8Array.from(randomBytes(32));

      const did = stellarAddressToDid(StrKey.encodeEd25519PublicKey(Buffer.from(raw)), "testnet");

      expect(Uint8Array.from(didToPublicKey(did))).toEqual(raw);
    }
  });

  it("keeps the network segment it was built with", () => {
    const address = Keypair.random().publicKey();

    expect(parseStellarDid(stellarAddressToDid(address, "testnet"))).toEqual({
      did: `did:stellar:testnet:${address}`,
      network: "testnet",
      address,
    });
    expect(parseStellarDid(stellarAddressToDid(address, "public")).network).toBe("public");
  });

  it("performs no I/O — the module never reaches the network", async () => {
    const did = stellarAddressToDid(Keypair.random().publicKey(), "testnet");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("core must not perform I/O");
    }) as typeof fetch;

    try {
      expect(didToPublicKey(did)).toHaveLength(32);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("malformed input", () => {
  const address = Keypair.random().publicKey();
  const secret = Keypair.random().secret();
  const contract = StrKey.encodeContract(randomBytes(32));
  // Flip the final checksum character to something it is definitely not, so the
  // mutation is real on every run rather than 31 runs out of 32.
  const mutatedChecksum = `${address.slice(0, -1)}${address.endsWith("A") ? "B" : "A"}`;

  const cases: ReadonlyArray<readonly [label: string, did: string, code: AgentPassErrorCode]> = [
    ["empty string", "", "InvalidDid"],
    ["too few segments", `did:stellar:${address}`, "InvalidDid"],
    ["too many segments", `did:stellar:testnet:${address}:extra`, "InvalidDid"],
    ["wrong scheme", `urn:stellar:testnet:${address}`, "InvalidDid"],
    ["wrong method", `did:key:testnet:${address}`, "InvalidDid"],
    ["unknown network", `did:stellar:mainnet:${address}`, "InvalidDid"],
    ["uppercased scheme", `DID:STELLAR:testnet:${address}`, "InvalidDid"],
    ["leading whitespace", ` did:stellar:testnet:${address}`, "InvalidDid"],
    ["empty address", "did:stellar:testnet:", "InvalidStellarAddress"],
    ["a secret seed", `did:stellar:testnet:${secret}`, "InvalidStellarAddress"],
    ["a contract id", `did:stellar:testnet:${contract}`, "InvalidStellarAddress"],
    ["a truncated address", `did:stellar:testnet:${address.slice(0, -1)}`, "InvalidStellarAddress"],
    ["a mutated checksum", `did:stellar:testnet:${mutatedChecksum}`, "InvalidStellarAddress"],
  ];

  it.each(cases)("rejects %s with a typed error, never undefined", (_label, did, code) => {
    for (const call of [() => parseStellarDid(did), () => didToPublicKey(did)]) {
      let threw = false;
      try {
        const result: unknown = call();
        expect.unreachable(`expected a throw, got ${String(result)}`);
      } catch (error) {
        threw = true;
        expect(hasErrorCode(error, code)).toBe(true);
      }
      expect(threw).toBe(true);
    }
  });

  it("refuses to build a DID from something that is not a G-address", () => {
    for (const bad of [secret, contract, "", "not-an-address", address.toLowerCase()]) {
      try {
        stellarAddressToDid(bad, "testnet");
        expect.unreachable(`expected a throw for ${bad}`);
      } catch (error) {
        expect(hasErrorCode(error, "InvalidStellarAddress")).toBe(true);
      }
    }
  });

  it("refuses an unsupported network even when the address is valid", () => {
    try {
      stellarAddressToDid(address, "futurenet" as "testnet");
      expect.unreachable("expected a throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidDid")).toBe(true);
    }
  });
});

describe("edge validators", () => {
  const address = Keypair.random().publicKey();

  it("parses a valid DID and rejects a malformed one with the underlying message", () => {
    expect(stellarDidSchema.parse(`did:stellar:testnet:${address}`)).toBe(
      `did:stellar:testnet:${address}`,
    );

    const failure = stellarDidSchema.safeParse("did:key:testnet:whatever");
    expect(failure.success).toBe(false);
    expect(failure.error?.issues[0]?.message).toContain('expected method "stellar"');
  });

  it("validates bare addresses", () => {
    expect(stellarAddressSchema.safeParse(address).success).toBe(true);
    expect(stellarAddressSchema.safeParse(Keypair.random().secret()).success).toBe(false);
  });
});
