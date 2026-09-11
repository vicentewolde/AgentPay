import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { makeVenueId } from "./ids.js";
import { loadVenueRegistry } from "./registry.js";
import { createX402Catalog, getX402ServiceRoute } from "./x402-catalog.js";

const CONTRACT_ID = "CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BASE_URL = "https://reference-merchant.example";
const REFERENCE_VENUE = makeVenueId("reference-merchant", CONTRACT_ID);
const CATALOG_ONLY_VENUE = makeVenueId("catalog-only", CONTRACT_ID);

const REGISTRY = loadVenueRegistry([
  {
    slug: "reference-merchant",
    contractId: CONTRACT_ID,
    baseUrl: BASE_URL,
    assets: [{ code: "USDC", issuer: ISSUER }],
  },
  {
    slug: "catalog-only",
    contractId: CONTRACT_ID,
    assets: [{ code: "USDC", issuer: ISSUER }],
  },
]);

const ACCOUNT_SUMMARY_CARD = {
  id: "account-summary",
  name: "Account Summary",
  description: "A paid account summary from the reference merchant.",
  payment: { asset: "USDC", amount: "0.0025", destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" },
  routeTemplate: "/api/x402/account-summary?account={account}",
  input: [{ name: "account", type: "string", required: true }],
};

const SEARCH_BODY = {
  ok: true,
  results: [
    { resource: ACCOUNT_SUMMARY_CARD },
    {
      resource: {
        id: "daily-brief",
        name: "Daily Brief",
        description: "A paid daily brief from the reference merchant.",
        payment: { asset: "USDC", amount: "0.001", destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" },
      },
    },
  ],
};

function fetchReturning(body: unknown, init?: ResponseInit): typeof fetch {
  return (async () => new Response(JSON.stringify(body), init)) as typeof fetch;
}

function fetchThrowing(error: unknown): typeof fetch {
  return (async () => {
    throw error;
  }) as typeof fetch;
}

function options(fetchImpl: typeof fetch) {
  return { venueId: REFERENCE_VENUE, registry: REGISTRY, fetchImpl };
}

describe("createX402Catalog with a second registered venue", () => {
  it("lists and retrieves products using the venue's configured asset", async () => {
    const catalog = createX402Catalog(options(fetchReturning(SEARCH_BODY)));

    await expect(catalog.listProducts()).resolves.toEqual([
      {
        id: "account-summary",
        name: "Account Summary",
        description: "A paid account summary from the reference merchant.",
        price: { amount: "0.0025", asset: `USDC:${ISSUER}` },
        available: true,
      },
      {
        id: "daily-brief",
        name: "Daily Brief",
        description: "A paid daily brief from the reference merchant.",
        price: { amount: "0.001", asset: `USDC:${ISSUER}` },
        available: true,
      },
    ]);
    await expect(catalog.getProduct("daily-brief")).resolves.toMatchObject({ id: "daily-brief" });
  });

  it("rejects an asset not named by this venue", async () => {
    const unknownAsset = {
      ok: true,
      results: [{ resource: { ...ACCOUNT_SUMMARY_CARD, payment: { asset: "EURC", amount: "1", destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" } } }],
    };

    await expect(createX402Catalog(options(fetchReturning(unknownAsset))).listProducts()).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "InvalidProduct"),
    );
  });

  it("rejects a registered venue without a base URL", () => {
    expect(() => createX402Catalog({ venueId: CATALOG_ONLY_VENUE, registry: REGISTRY })).toThrowError();
    try {
      createX402Catalog({ venueId: CATALOG_ONLY_VENUE, registry: REGISTRY });
      expect.unreachable("expected a missing baseUrl failure");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidProduct")).toBe(true);
    }
  });
});

describe("getX402ServiceRoute with a second registered venue", () => {
  it("returns a configured paid route", async () => {
    await expect(getX402ServiceRoute(options(fetchReturning(SEARCH_BODY)), "account-summary")).resolves.toEqual({
      id: "account-summary",
      routeTemplate: "/api/x402/account-summary?account={account}",
      input: [{ name: "account", type: "string", required: true }],
    });
  });

  it("rejects a product without a route template", async () => {
    await expect(getX402ServiceRoute(options(fetchReturning(SEARCH_BODY)), "daily-brief")).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "InvalidProduct"),
    );
  });
});

describe("x402 discovery transport failures", () => {
  it("wraps a connection failure as NetworkError", async () => {
    await expect(createX402Catalog(options(fetchThrowing(new Error("ECONNREFUSED")))).listProducts()).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "NetworkError"),
    );
  });

  it("treats a non-2xx response as NetworkError", async () => {
    await expect(createX402Catalog(options(fetchReturning({}, { status: 502 }))).listProducts()).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "NetworkError"),
    );
  });

  it("treats a non-JSON response as NetworkError", async () => {
    const fetchImpl = (async () => new Response("not json")) as typeof fetch;
    await expect(createX402Catalog(options(fetchImpl)).listProducts()).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "NetworkError"),
    );
  });

  it("treats an unexpected body shape as NetworkError", async () => {
    await expect(createX402Catalog(options(fetchReturning({ unexpected: true }))).listProducts()).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "NetworkError"),
    );
  });
});
