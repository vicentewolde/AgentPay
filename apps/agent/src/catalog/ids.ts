/**
 * The two identifiers T12 compares against a signed credential's `scope`.
 *
 * `scope.venues` and `scope.assets` are plain strings in the AgentPass schema —
 * the credential travels signed, but nothing has ever parsed those strings.
 * This module fixes their canonical form, because the moment a purchase is
 * authorised by asking "is this venue in the allowed list?", the answer depends
 * entirely on both sides spelling the venue the same way.
 *
 * Comparison is byte for byte: no trimming, no case folding, no normalisation.
 * That is the rule `did.ts` already applies to DIDs, for the same reason — a
 * string that differs by one byte names a different thing. Combined with the
 * fail-closed reading of an empty list (B-1), every ambiguity here resolves to
 * a refusal, never to a purchase.
 */
import { AgentPassError } from "@agentpass/core";
import { StrKey } from "@stellar/stellar-sdk/base";
import { z } from "zod";

/** Separates the human-readable half of an id from the on-chain half. */
export const ID_SEPARATOR = ":";

/** `bazaar-aliado` — lowercase, digits and single hyphens, never leading or trailing. */
const VENUE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VENUE_SLUG_MAX_LENGTH = 40;

/** Stellar asset codes are 1–12 alphanumeric characters, case-sensitive. */
const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;

declare const venueIdBrand: unique symbol;
/**
 * A string proven to be `<slug>:<contract id>` — a venue the agent can be
 * authorised to buy at. Produced only by {@link parseVenueId},
 * {@link makeVenueId} and {@link venueIdSchema}.
 */
export type VenueId = string & { readonly [venueIdBrand]: true };

declare const assetIdBrand: unique symbol;
/**
 * A string proven to be `<CODE>:<issuer>` — an asset the agent can be
 * authorised to spend. Produced only by {@link parseAssetId},
 * {@link makeAssetId} and {@link assetIdSchema}.
 */
export type AssetId = string & { readonly [assetIdBrand]: true };

export interface ParsedVenueId {
  readonly venueId: VenueId;
  /** The human-readable label. Carried, never trusted to identify anything. */
  readonly slug: string;
  /** The Soroban contract that *is* the venue's identity (`C...`). */
  readonly contractId: string;
}

export interface ParsedAssetId {
  readonly assetId: AssetId;
  /** The asset code, e.g. `USDC`. Case-sensitive, as Stellar treats it. */
  readonly code: string;
  /** The issuing account (`G...`) or token contract (`C...`). */
  readonly issuer: string;
  readonly issuerKind: "account" | "contract";
}

function invalidVenueId(value: string, reason: string, message: string): AgentPassError {
  return new AgentPassError("InvalidVenueId", message, { details: { venueId: value, reason } });
}

function invalidAssetId(value: string, reason: string, message: string): AgentPassError {
  return new AgentPassError("InvalidAssetId", message, { details: { assetId: value, reason } });
}

/** Exactly two segments, or nothing — a third `:` makes the id ambiguous. */
function splitOnce(value: string): [string, string] | undefined {
  const segments = value.split(ID_SEPARATOR);
  if (segments.length !== 2) return undefined;
  return segments as [string, string];
}

/**
 * Splits `<slug>:<contract id>`, validating both halves.
 *
 * Never returns a partial result: either the id is well-formed or this throws.
 *
 * @throws AgentPassError `InvalidVenueId`
 */
export function parseVenueId(value: string): ParsedVenueId {
  if (typeof value !== "string") {
    throw invalidVenueId(String(value), "not-a-string", "a venue id must be a string");
  }

  const parts = splitOnce(value);
  if (parts === undefined) {
    throw invalidVenueId(
      value,
      "malformed",
      `expected <slug>${ID_SEPARATOR}<contract id>, got ${value.split(ID_SEPARATOR).length} segment(s)`,
    );
  }

  const [slug, contractId] = parts;

  if (slug.length > VENUE_SLUG_MAX_LENGTH) {
    throw invalidVenueId(
      value,
      "slug-too-long",
      `a venue slug is at most ${VENUE_SLUG_MAX_LENGTH} characters, got ${slug.length}`,
    );
  }
  if (!VENUE_SLUG_PATTERN.test(slug)) {
    throw invalidVenueId(
      value,
      "malformed-slug",
      `"${slug}" is not a venue slug: lowercase letters, digits and single hyphens only`,
    );
  }
  if (!StrKey.isValidContract(contractId)) {
    throw invalidVenueId(
      value,
      "malformed-contract-id",
      "the second segment is not a Soroban contract id (C...)",
    );
  }

  return { venueId: value as VenueId, slug, contractId };
}

/**
 * Splits `<CODE>:<issuer>`, validating both halves.
 *
 * The issuer may be a classic account (`G...`) or a token contract (`C...`):
 * which one the real bazaar wants is still an open question for T15, and
 * accepting both keeps that answer from reshaping this type.
 *
 * @throws AgentPassError `InvalidAssetId`
 */
export function parseAssetId(value: string): ParsedAssetId {
  if (typeof value !== "string") {
    throw invalidAssetId(String(value), "not-a-string", "an asset id must be a string");
  }

  const parts = splitOnce(value);
  if (parts === undefined) {
    throw invalidAssetId(
      value,
      "malformed",
      `expected <CODE>${ID_SEPARATOR}<issuer>, got ${value.split(ID_SEPARATOR).length} segment(s)`,
    );
  }

  const [code, issuer] = parts;

  if (!ASSET_CODE_PATTERN.test(code)) {
    throw invalidAssetId(
      value,
      "malformed-code",
      `"${code}" is not a Stellar asset code: 1–12 alphanumeric characters`,
    );
  }

  const issuerKind = StrKey.isValidEd25519PublicKey(issuer)
    ? "account"
    : StrKey.isValidContract(issuer)
      ? "contract"
      : undefined;

  if (issuerKind === undefined) {
    throw invalidAssetId(
      value,
      "malformed-issuer",
      "the issuer is neither a Stellar account (G...) nor a Soroban contract (C...)",
    );
  }

  return { assetId: value as AssetId, code, issuer, issuerKind };
}

/** Builds a {@link VenueId} from its parts, validating the result. */
export function makeVenueId(slug: string, contractId: string): VenueId {
  return parseVenueId(`${slug}${ID_SEPARATOR}${contractId}`).venueId;
}

/** Builds an {@link AssetId} from its parts, validating the result. */
export function makeAssetId(code: string, issuer: string): AssetId {
  return parseAssetId(`${code}${ID_SEPARATOR}${issuer}`).assetId;
}

/** Edge validator: parses unknown input into a branded {@link VenueId}. */
export const venueIdSchema = z
  .string()
  .superRefine((value, ctx) => {
    try {
      parseVenueId(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof AgentPassError ? error.message : "invalid venue id",
      });
    }
  })
  .transform((value) => value as VenueId);

/** Edge validator: parses unknown input into a branded {@link AssetId}. */
export const assetIdSchema = z
  .string()
  .superRefine((value, ctx) => {
    try {
      parseAssetId(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof AgentPassError ? error.message : "invalid asset id",
      });
    }
  })
  .transform((value) => value as AssetId);
