import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { makeVenueId } from "./ids.js";
import { baseUrlForVenue, loadVenueRegistry, mapAssetCodeForVenue, mapAssetIssuerForVenue } from "./registry.js";

const CONTRACT_A = "CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";
const CONTRACT_B = "CBDWMXZEE44NJ3RA6RS7K4EK36KDFW5S7KHP276HCMM4I52MIUUHEF5B";
const ISSUER_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ISSUER_B = "GDJUSV2UGZ3VWCZHE4Y3Z7MSCH5V5G54H6QXOOZNZEDQI5WPZHWYXXWB";
const REFERENCE_MERCHANT = makeVenueId("reference-merchant", CONTRACT_A);
const SECOND_MERCHANT = makeVenueId("second-merchant", CONTRACT_B);
const UNKNOWN_VENUE = makeVenueId("unknown-venue", CONTRACT_B);
const CATALOG_ONLY = makeVenueId("catalog-only", CONTRACT_A);

const ONE_ROW = [
  {
    slug: "reference-merchant",
    contractId: CONTRACT_A,
    baseUrl: "https://reference-merchant.example",
    assets: [{ code: "USDC", issuer: ISSUER_A }],
  },
];

describe("loadVenueRegistry", () => {
  it("indexes a well-formed row by its derived VenueId", () => {
    const registry = loadVenueRegistry(ONE_ROW);

    expect([...registry.venues.keys()]).toEqual([`reference-merchant:${CONTRACT_A}`]);
  });

  it("accepts more than one venue and more than one asset per venue", () => {
    const registry = loadVenueRegistry([
      ...ONE_ROW,
      {
        slug: "second-merchant",
        contractId: CONTRACT_B,
        baseUrl: "https://second-merchant.example",
        assets: [
          { code: "USDC", issuer: ISSUER_B },
          { code: "EURC", issuer: ISSUER_A },
        ],
      },
    ]);

    expect(registry.venues.size).toBe(2);
    expect(mapAssetCodeForVenue(registry, SECOND_MERCHANT, "EURC")).toBe(
      `EURC:${ISSUER_A}`,
    );
  });

  it("accepts a row with no baseUrl", () => {
    const registry = loadVenueRegistry([
      { slug: "catalog-only", contractId: CONTRACT_A, assets: [{ code: "USDC", issuer: ISSUER_A }] },
    ]);

    expect(baseUrlForVenue(registry, CATALOG_ONLY)).toBeUndefined();
  });

  it("throws InvalidVenueRegistry for a row that fails schema validation", () => {
    try {
      loadVenueRegistry([{ slug: "Not-Lowercase", contractId: CONTRACT_A, assets: [{ code: "USDC", issuer: ISSUER_A }] }]);
      expect.unreachable("expected loadVenueRegistry to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidVenueRegistry")).toBe(true);
    }
  });

  it("throws InvalidVenueRegistry for a venue with an empty assets array", () => {
    try {
      loadVenueRegistry([{ slug: "empty", contractId: CONTRACT_A, assets: [] }]);
      expect.unreachable("expected loadVenueRegistry to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidVenueRegistry")).toBe(true);
    }
  });

  it("throws InvalidVenueRegistry when the same venue appears twice", () => {
    try {
      loadVenueRegistry([...ONE_ROW, ...ONE_ROW]);
      expect.unreachable("expected loadVenueRegistry to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidVenueRegistry")).toBe(true);
    }
  });

  it("throws InvalidVenueRegistry when one venue names the same asset code twice", () => {
    try {
      loadVenueRegistry([
        {
          slug: "reference-merchant",
          contractId: CONTRACT_A,
          assets: [
            { code: "USDC", issuer: ISSUER_A },
            { code: "USDC", issuer: ISSUER_B },
          ],
        },
      ]);
      expect.unreachable("expected loadVenueRegistry to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidVenueRegistry")).toBe(true);
    }
  });

  it("throws InvalidVenueRegistry when one venue names the same issuer twice under different codes", () => {
    try {
      loadVenueRegistry([
        {
          slug: "reference-merchant",
          contractId: CONTRACT_A,
          assets: [
            { code: "USDC", issuer: ISSUER_A },
            { code: "USDX", issuer: ISSUER_A },
          ],
        },
      ]);
      expect.unreachable("expected loadVenueRegistry to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidVenueRegistry")).toBe(true);
    }
  });
});

describe("mapAssetCodeForVenue", () => {
  it("resolves a code the venue's row names to its AssetId", () => {
    const registry = loadVenueRegistry(ONE_ROW);

    expect(mapAssetCodeForVenue(registry, REFERENCE_MERCHANT, "USDC")).toBe(
      `USDC:${ISSUER_A}`,
    );
  });

  it("fails closed on a code the venue's row does not name, rather than guessing", () => {
    const registry = loadVenueRegistry(ONE_ROW);

    try {
      mapAssetCodeForVenue(registry, REFERENCE_MERCHANT, "EURC");
      expect.unreachable("expected mapAssetCodeForVenue to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidProduct")).toBe(true);
    }
  });

  it("fails closed on a venue the registry has no row for", () => {
    const registry = loadVenueRegistry(ONE_ROW);

    try {
      mapAssetCodeForVenue(registry, UNKNOWN_VENUE, "USDC");
      expect.unreachable("expected mapAssetCodeForVenue to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidProduct")).toBe(true);
    }
  });
});

describe("mapAssetIssuerForVenue", () => {
  it("resolves an issuer/contract the venue's row names to its AssetId", () => {
    const registry = loadVenueRegistry(ONE_ROW);

    expect(mapAssetIssuerForVenue(registry, REFERENCE_MERCHANT, ISSUER_A)).toBe(
      `USDC:${ISSUER_A}`,
    );
  });

  it("fails closed on an issuer the venue's row does not name", () => {
    const registry = loadVenueRegistry(ONE_ROW);

    try {
      mapAssetIssuerForVenue(registry, REFERENCE_MERCHANT, ISSUER_B);
      expect.unreachable("expected mapAssetIssuerForVenue to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidProduct")).toBe(true);
    }
  });
});
