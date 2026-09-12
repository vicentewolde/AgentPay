import { AgentPassError, hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { createAgentPeyDiscovery, resolvePayableService } from "./agentpey-discovery.js";
import type { CatalogAdapter, Product } from "./catalog.js";
import { toCandidate, type RegisteredCandidate } from "./discovery.js";
import { makeAssetId, makeVenueId, type VenueId } from "./ids.js";
import { loadVenueRegistry } from "./registry.js";
import type { X402ServiceRoute } from "./x402-catalog.js";

const CONTRACT_ID = "CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";
const OTHER_CONTRACT_ID = "CBDWMXZEE44NJ3RA6RS7K4EK36KDFW5S7KHP276HCMM4I52MIUUHEF5B";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const SIGNALDESK_URL = "https://signaldesk.example";
const BAZAAR_URL = "https://bazaar.example";
const SIGNALDESK = makeVenueId("signaldesk", CONTRACT_ID);
const BAZAAR = makeVenueId("bazaar", OTHER_CONTRACT_ID);

const REGISTRY = loadVenueRegistry([
  { slug: "signaldesk", address: CONTRACT_ID, baseUrl: SIGNALDESK_URL, assets: [{ code: "USDC", issuer: ISSUER }] },
  { slug: "bazaar", address: OTHER_CONTRACT_ID, baseUrl: BAZAAR_URL, assets: [{ code: "USDC", issuer: ISSUER }] },
  // No baseUrl: nothing to fetch, so the index must simply skip it.
  { slug: "catalog-only", address: CONTRACT_ID, assets: [{ code: "USDC", issuer: ISSUER }] },
]);

function product(id: string, name: string, description: string): Product {
  return {
    id,
    name,
    description,
    price: { amount: "0.25", asset: makeAssetId("USDC", ISSUER) },
    available: true,
  };
}

const MARKET_REPORT = product("market-report", "Informe de mercado", "Un informe del par XLM/USDC.");
const AI_CREDITS = product("ai-credits", "Créditos de IA", "Un paquete de créditos ficticios.");
const SWAP_RISK = product("swap-risk", "Swap risk", "Riesgo de un swap en el bazaar.");

function catalogOf(venueId: VenueId, products: readonly Product[]): CatalogAdapter {
  return {
    venueId,
    listProducts: async () => products,
    getProduct: async (id) => products.find((p) => p.id === id)!,
  };
}

function failingCatalog(venueId: VenueId, error: unknown): CatalogAdapter {
  return {
    venueId,
    listProducts: async () => {
      throw error;
    },
    getProduct: async () => {
      throw error;
    },
  };
}

function indexOver(
  catalogs: Readonly<Record<string, CatalogAdapter>>,
  overrides: { readonly now?: () => number; readonly cacheTtlMs?: number } = {},
) {
  const errors: VenueId[] = [];
  const source = createAgentPeyDiscovery({
    registry: REGISTRY,
    catalogFor: (venueId) => catalogs[venueId] ?? catalogOf(venueId, []),
    onVenueError: (venueId) => errors.push(venueId),
    ...overrides,
  });
  return { source, errors };
}

describe("createAgentPeyDiscovery", () => {
  it("indexes every registered venue's products as registered candidates", async () => {
    const { source } = indexOver({
      [SIGNALDESK]: catalogOf(SIGNALDESK, [MARKET_REPORT, AI_CREDITS]),
      [BAZAAR]: catalogOf(BAZAAR, [SWAP_RISK]),
    });

    const candidates = await source.search("*");
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.registered)).toBe(true);
    expect(candidates.map((candidate) => candidate.productId).sort()).toEqual([
      "ai-credits",
      "market-report",
      "swap-risk",
    ]);
  });

  it("carries no price out of the venue's catalogue either", async () => {
    const { source } = indexOver({ [SIGNALDESK]: catalogOf(SIGNALDESK, [MARKET_REPORT]) });
    const [candidate] = await source.search("*");
    expect(JSON.stringify(candidate)).not.toContain("0.25");
  });

  it("filters by query, accents and case included", async () => {
    const { source } = indexOver({
      [SIGNALDESK]: catalogOf(SIGNALDESK, [MARKET_REPORT, AI_CREDITS]),
    });
    const candidates = await source.search("creditos");
    expect(candidates.map((candidate) => candidate.productId)).toEqual(["ai-credits"]);
  });

  it("skips a venue that is down, and keeps the ones that answered", async () => {
    const { source, errors } = indexOver({
      [SIGNALDESK]: catalogOf(SIGNALDESK, [MARKET_REPORT]),
      [BAZAAR]: failingCatalog(BAZAAR, new AgentPassError("NetworkError", "down")),
    });

    const candidates = await source.search("*");
    expect(candidates.map((candidate) => candidate.productId)).toEqual(["market-report"]);
    expect(errors).toEqual([BAZAAR]);
  });

  it("refuses with CatalogUnavailable when every venue is down — not an empty list", async () => {
    const { source } = indexOver({
      [SIGNALDESK]: failingCatalog(SIGNALDESK, new AgentPassError("NetworkError", "down")),
      [BAZAAR]: failingCatalog(BAZAAR, new AgentPassError("NetworkError", "down")),
    });
    await expect(source.search("*")).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "CatalogUnavailable"),
    );
  });

  it("never asks a venue that has no base URL", async () => {
    const asked: VenueId[] = [];
    const source = createAgentPeyDiscovery({
      registry: REGISTRY,
      catalogFor: (venueId) => {
        asked.push(venueId);
        return catalogOf(venueId, []);
      },
    });
    await source.search("*");
    expect(asked.sort()).toEqual([BAZAAR, SIGNALDESK].sort());
  });

  it("reuses the index within its TTL, and rebuilds after it", async () => {
    let calls = 0;
    let clock = 1_000;
    const source = createAgentPeyDiscovery({
      registry: REGISTRY,
      cacheTtlMs: 30_000,
      now: () => clock,
      catalogFor: (venueId) => ({
        venueId,
        listProducts: async () => {
          calls += 1;
          return venueId === SIGNALDESK ? [MARKET_REPORT] : [];
        },
        getProduct: async () => MARKET_REPORT,
      }),
    });

    await source.search("*");
    await source.search("informe");
    expect(calls).toBe(2); // two venues, once each

    clock += 30_001;
    await source.search("*");
    expect(calls).toBe(4);
  });
});

function candidateAt(url: string, productId?: string): RegisteredCandidate {
  const candidate = toCandidate(REGISTRY, { source: "periplo", resourceUrl: url, productId });
  if (candidate === undefined || !candidate.registered) throw new Error("fixture is not a registered candidate");
  return candidate;
}

const ROUTES: readonly X402ServiceRoute[] = [
  { id: "market-report", routeTemplate: "/api/x402/market-report?pair={pair}", input: [] },
  { id: "ai-credits", routeTemplate: "/api/x402/ai-credits?pack={pack}", input: [] },
];

describe("resolvePayableService", () => {
  const listRoutes = async () => ROUTES;

  it("asks the merchant which product lives at a URL the catalogue indexed", async () => {
    const resolved = await resolvePayableService(
      candidateAt(`${SIGNALDESK_URL}/api/x402/market-report`),
      listRoutes,
    );
    expect(resolved).toEqual({ venueId: SIGNALDESK, productId: "market-report" });
  });

  it("ignores a query string and a trailing slash on the indexed URL", async () => {
    const resolved = await resolvePayableService(
      candidateAt(`${SIGNALDESK_URL}/api/x402/market-report/?pair=XLM%2FUSDC`),
      listRoutes,
    );
    expect(resolved.productId).toBe("market-report");
  });

  it("refuses a URL the merchant offers nothing at", async () => {
    await expect(
      resolvePayableService(candidateAt(`${SIGNALDESK_URL}/api/x402/something-else`), listRoutes),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "ProductNotFound"));
  });

  it("refuses rather than guessing when two routes claim one URL", async () => {
    const ambiguous = async (): Promise<readonly X402ServiceRoute[]> => [
      { id: "a", routeTemplate: "/api/x402/market-report?pair={pair}", input: [] },
      { id: "b", routeTemplate: "/api/x402/market-report", input: [] },
    ];
    await expect(
      resolvePayableService(candidateAt(`${SIGNALDESK_URL}/api/x402/market-report`), ambiguous),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "InvalidProduct"));
  });

  it("checks a candidate's own product id against the merchant instead of believing it", async () => {
    await expect(
      resolvePayableService(candidateAt(SIGNALDESK_URL, "market-report"), listRoutes),
    ).resolves.toEqual({ venueId: SIGNALDESK, productId: "market-report" });

    await expect(
      resolvePayableService(candidateAt(SIGNALDESK_URL, "not-for-sale"), listRoutes),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "ProductNotFound"));
  });
});
