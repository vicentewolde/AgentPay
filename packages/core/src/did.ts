/**
 * `did:stellar` — a DID method with no resolution step.
 *
 * A Stellar account address *is* an Ed25519 public key in StrKey form, so the
 * verification key is recovered from the identifier itself by decoding it. That
 * is the whole point: verifying a credential's signature never touches the
 * network, never queries a ledger, and cannot be made to fail by an outage.
 *
 * Imports come from `@stellar/stellar-sdk/base`, the subpath without the
 * Horizon and RPC clients, so this module physically cannot perform I/O.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { z } from "zod";

import { AgentPassError } from "./errors.js";

export const DID_SCHEME = "did";
export const DID_METHOD = "stellar";

/** The networks the method namespaces. This pilot only ever exercises testnet. */
export const STELLAR_NETWORKS = ["testnet", "public"] as const;
export type StellarNetwork = (typeof STELLAR_NETWORKS)[number];

declare const stellarDidBrand: unique symbol;
/**
 * A string proven to be a well-formed `did:stellar`. Produced only by
 * {@link stellarAddressToDid}, {@link parseStellarDid} and
 * {@link stellarDidSchema}, so an arbitrary string cannot be passed where a
 * validated DID is expected.
 */
export type StellarDid = string & { readonly [stellarDidBrand]: true };

export interface ParsedStellarDid {
  readonly did: StellarDid;
  readonly network: StellarNetwork;
  /** The Stellar account address (`G...`) carried by the DID. */
  readonly address: string;
}

export function isStellarNetwork(value: string): value is StellarNetwork {
  return (STELLAR_NETWORKS as readonly string[]).includes(value);
}

export function isStellarAddress(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value);
}

function invalidDid(did: string, reason: string, message: string): AgentPassError {
  return new AgentPassError("InvalidDid", message, { details: { did, reason } });
}

/**
 * Builds `did:stellar:<network>:<address>`.
 *
 * @throws AgentPassError `InvalidStellarAddress` for anything that is not a
 * `G...` account — a secret seed, a contract id and a muxed address all fail.
 * @throws AgentPassError `InvalidDid` for an unknown network.
 */
export function stellarAddressToDid(address: string, network: StellarNetwork): StellarDid {
  if (!isStellarNetwork(network)) {
    throw new AgentPassError("InvalidDid", `unsupported Stellar network "${String(network)}"`, {
      details: { network, supported: [...STELLAR_NETWORKS] },
    });
  }

  if (!isStellarAddress(address)) {
    throw new AgentPassError(
      "InvalidStellarAddress",
      "expected a Stellar Ed25519 account address (G...)",
      { details: { address } },
    );
  }

  return `${DID_SCHEME}:${DID_METHOD}:${network}:${address}` as StellarDid;
}

/**
 * Splits a `did:stellar` into its parts, validating every one of them.
 *
 * Never returns a partial result: either the DID is well-formed or this throws
 * a typed error. Nothing here is lenient — no trimming, no case folding — since
 * a DID that differs by a byte identifies a different subject.
 */
export function parseStellarDid(did: string): ParsedStellarDid {
  if (typeof did !== "string") {
    throw invalidDid(String(did), "not-a-string", "a DID must be a string");
  }

  const segments = did.split(":");
  if (segments.length !== 4) {
    throw invalidDid(
      did,
      "malformed",
      `expected ${DID_SCHEME}:${DID_METHOD}:<network>:<address>, got ${segments.length} segment(s)`,
    );
  }

  const [scheme, method, network, address] = segments as [string, string, string, string];

  if (scheme !== DID_SCHEME) {
    throw invalidDid(did, "wrong-scheme", `expected scheme "${DID_SCHEME}", got "${scheme}"`);
  }
  if (method !== DID_METHOD) {
    throw invalidDid(did, "wrong-method", `expected method "${DID_METHOD}", got "${method}"`);
  }
  if (!isStellarNetwork(network)) {
    throw invalidDid(
      did,
      "unsupported-network",
      `unsupported network "${network}", expected one of ${STELLAR_NETWORKS.join(", ")}`,
    );
  }
  if (!isStellarAddress(address)) {
    throw new AgentPassError(
      "InvalidStellarAddress",
      "the DID's address segment is not a Stellar Ed25519 account address (G...)",
      { details: { did, address } },
    );
  }

  return { did: did as StellarDid, network, address };
}

/** The Stellar account address a DID identifies. */
export function didToStellarAddress(did: string): string {
  return parseStellarDid(did).address;
}

/**
 * The raw 32-byte Ed25519 public key a DID identifies — the material a JWS
 * signature is verified against. No network access, by construction.
 */
export function didToPublicKey(did: string): Uint8Array {
  const { address } = parseStellarDid(did);

  try {
    return StrKey.decodeEd25519PublicKey(address);
  } catch (error) {
    // Unreachable while isValidEd25519PublicKey and decode agree; kept so this
    // function can only ever return a key or throw, never undefined.
    throw new AgentPassError(
      "InvalidStellarAddress",
      "the DID's address passed validation but could not be decoded",
      { cause: error, details: { did, address } },
    );
  }
}

/** Edge validator: parses unknown input into a branded {@link StellarDid}. */
export const stellarDidSchema = z
  .string()
  .superRefine((value, ctx) => {
    try {
      parseStellarDid(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof AgentPassError ? error.message : "invalid did:stellar",
      });
    }
  })
  .transform((value) => value as StellarDid);

/** Edge validator for a bare Stellar account address. */
export const stellarAddressSchema = z
  .string()
  .refine(isStellarAddress, { message: "expected a Stellar Ed25519 account address (G...)" });
