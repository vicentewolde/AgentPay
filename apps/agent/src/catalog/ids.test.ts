import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import {
  assetIdSchema,
  makeAssetId,
  makeVenueId,
  parseAssetId,
  parseVenueId,
  venueIdSchema,
} from "./ids.js";

const CONTRACT = "CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";
const ACCOUNT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("parseVenueId", () => {
  it("splits a well-formed id into its slug and contract id", () => {
    const parsed = parseVenueId(`bazaar-aliado:${CONTRACT}`);

    expect(parsed.slug).toBe("bazaar-aliado");
    expect(parsed.contractId).toBe(CONTRACT);
    expect(parsed.venueId).toBe(`bazaar-aliado:${CONTRACT}`);
  });

  it.each([
    ["no separator", CONTRACT],
    ["three segments", `a:b:${CONTRACT}`],
    ["empty slug", `:${CONTRACT}`],
    ["uppercase slug", `Bazaar:${CONTRACT}`],
    ["underscore in slug", `bazaar_aliado:${CONTRACT}`],
    ["leading hyphen", `-bazaar:${CONTRACT}`],
    ["trailing hyphen", `bazaar-:${CONTRACT}`],
    ["double hyphen", `bazaar--aliado:${CONTRACT}`],
    ["account instead of contract", `bazaar:${ACCOUNT}`],
    ["truncated contract", `bazaar:${CONTRACT.slice(0, -1)}`],
    ["empty string", ""],
  ])("rejects %s with InvalidVenueId", (_label, value) => {
    expect(() => parseVenueId(value)).toThrow();
    try {
      parseVenueId(value);
    } catch (error) {
      expect(hasErrorCode(error, "InvalidVenueId")).toBe(true);
    }
  });

  it("returns the exact string it was given, never a normalised one", () => {
    for (const id of [`bazaar:${CONTRACT}`, `mock-bazaar:${CONTRACT}`, `b2:${CONTRACT}`]) {
      expect(parseVenueId(id).venueId).toBe(id);
    }
  });

  /**
   * Pinned to the *reason*, not just to "it threw". Asserting only that a
   * padded id throws is satisfied by an implementation that trims it first and
   * then fails somewhere else — which is exactly what a normalising mutation
   * does. The reason says the slug is what was malformed, and that can only be
   * true if nothing trimmed the string beforehand.
   */
  it("is not lenient: whitespace is part of the identity, not noise to strip", () => {
    const canonical = `bazaar:${CONTRACT}`;

    for (const padded of [` ${canonical}`, `\t${canonical}`]) {
      try {
        parseVenueId(padded);
        expect.unreachable("a padded venue id must not parse");
      } catch (error) {
        expect(hasErrorCode(error, "InvalidVenueId")).toBe(true);
        expect((error as { details: { reason: string } }).details.reason).toBe("malformed-slug");
      }
    }

    try {
      parseVenueId(`${canonical} `);
      expect.unreachable("a trailing space must not parse");
    } catch (error) {
      expect((error as { details: { reason: string } }).details.reason).toBe(
        "malformed-contract-id",
      );
    }
  });

  it("is not lenient: case is part of the identity", () => {
    try {
      parseVenueId(`BAZAAR:${CONTRACT}`);
      expect.unreachable("an uppercase slug must not parse");
    } catch (error) {
      expect((error as { details: { reason: string } }).details.reason).toBe("malformed-slug");
    }
    // StrKey is case-sensitive, so a lowercased contract id names nothing.
    expect(() => parseVenueId(`bazaar:${CONTRACT.toLowerCase()}`)).toThrow();
  });

  it("makeVenueId validates what it builds", () => {
    expect(makeVenueId("bazaar", CONTRACT)).toBe(`bazaar:${CONTRACT}`);
    expect(() => makeVenueId("Bazaar", CONTRACT)).toThrow();
    expect(() => makeVenueId("bazaar", ACCOUNT)).toThrow();
  });
});

describe("parseAssetId", () => {
  it("accepts a classic asset issued by an account", () => {
    const parsed = parseAssetId(`USDC:${ACCOUNT}`);

    expect(parsed.code).toBe("USDC");
    expect(parsed.issuer).toBe(ACCOUNT);
    expect(parsed.issuerKind).toBe("account");
  });

  it("accepts a token contract as the issuer, for whatever T15 turns out to need", () => {
    const parsed = parseAssetId(`USDC:${CONTRACT}`);

    expect(parsed.issuerKind).toBe("contract");
  });

  it.each([
    ["no separator", "USDC"],
    ["three segments", `USDC:x:${ACCOUNT}`],
    ["empty code", `:${ACCOUNT}`],
    ["code over twelve characters", `USDCUSDCUSDCU:${ACCOUNT}`],
    ["punctuation in the code", `US-DC:${ACCOUNT}`],
    ["issuer that is neither G nor C", "USDC:not-an-issuer"],
    ["secret seed as issuer", "USDC:SBUVRVHDDUNIHXQBSMPPMRDMKM4YWDMXKPQKBDXPJPMPTNMKMLXCQTCM"],
    ["empty string", ""],
  ])("rejects %s with InvalidAssetId", (_label, value) => {
    try {
      parseAssetId(value);
      expect.unreachable("expected parseAssetId to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidAssetId")).toBe(true);
    }
  });

  it("treats the asset code as case-sensitive, as Stellar does", () => {
    expect(parseAssetId(`usdc:${ACCOUNT}`).code).toBe("usdc");
    expect(parseAssetId(`usdc:${ACCOUNT}`).assetId).not.toBe(`USDC:${ACCOUNT}`);
  });

  it("returns the exact string it was given, never a normalised one", () => {
    for (const id of [`USDC:${ACCOUNT}`, `usdc:${ACCOUNT}`, `XLM1:${CONTRACT}`]) {
      expect(parseAssetId(id).assetId).toBe(id);
    }
    expect(() => parseAssetId(` USDC:${ACCOUNT}`)).toThrow();
    expect(() => parseAssetId(`USDC:${ACCOUNT} `)).toThrow();
  });

  it("makeAssetId validates what it builds", () => {
    expect(makeAssetId("USDC", ACCOUNT)).toBe(`USDC:${ACCOUNT}`);
    expect(() => makeAssetId("US DC", ACCOUNT)).toThrow();
  });
});

describe("edge schemas", () => {
  it("venueIdSchema accepts canonical ids and rejects the rest", () => {
    expect(venueIdSchema.safeParse(`bazaar:${CONTRACT}`).success).toBe(true);
    expect(venueIdSchema.safeParse(`bazaar:${ACCOUNT}`).success).toBe(false);
    expect(venueIdSchema.safeParse(42).success).toBe(false);
  });

  it("assetIdSchema accepts canonical ids and rejects the rest", () => {
    expect(assetIdSchema.safeParse(`USDC:${ACCOUNT}`).success).toBe(true);
    expect(assetIdSchema.safeParse("USDC").success).toBe(false);
    expect(assetIdSchema.safeParse(null).success).toBe(false);
  });

  it("surfaces the parse failure's message, not a generic one", () => {
    const result = venueIdSchema.safeParse(`Bazaar:${CONTRACT}`);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("venue slug");
    }
  });
});
