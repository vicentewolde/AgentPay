import { AgentPassError } from "@agentpass/core";
import { loadVenueRegistry, makeVenueId, toCandidate, type CatalogSource } from "@agentpey/agent";
import { describe, expect, it } from "vitest";

import { createPublicDiscovery, handleDiscoverySearch } from "./discovery-route.js";

const CONTRACT_ID = "CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BASE_URL = "https://signaldesk.example";
const VENUE = makeVenueId("signaldesk", CONTRACT_ID);

const REGISTRY = loadVenueRegistry([
  { slug: "signaldesk", contractId: CONTRACT_ID, baseUrl: BASE_URL, assets: [{ code: "USDC", issuer: ISSUER }] },
]);

const CANDIDATE = toCandidate(REGISTRY, {
  source: "agentpey",
  resourceUrl: BASE_URL,
  title: "Informe de mercado",
  description: "Un informe del par XLM/USDC.",
  productId: "market-report",
})!;

function sourceReturning(candidates: readonly typeof CANDIDATE[]): CatalogSource {
  return { sourceId: "agentpey", search: async () => candidates };
}

describe("handleDiscoverySearch", () => {
  it("answers 200 with the venue named on every row", async () => {
    const result = await handleDiscoverySearch(sourceReturning([CANDIDATE]), "informe");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      source: "agentpey",
      query: "informe",
      results: [
        {
          venue: VENUE,
          registered: true,
          product_id: "market-report",
          resource_url: BASE_URL,
          title: "Informe de mercado",
          description: "Un informe del par XLM/USDC.",
        },
      ],
    });
  });

  it("publishes no price on any row", async () => {
    const result = await handleDiscoverySearch(sourceReturning([CANDIDATE]), "*");
    expect(JSON.stringify(result.body)).not.toContain("price");
  });

  it("treats a missing query as 'everything'", async () => {
    const seen: string[] = [];
    const source: CatalogSource = {
      sourceId: "agentpey",
      search: async (query) => {
        seen.push(query);
        return [];
      },
    };
    await handleDiscoverySearch(source, null);
    expect(seen).toEqual(["*"]);
  });

  it("answers 400 for a query it will not forward, without searching", async () => {
    let searched = 0;
    const source: CatalogSource = {
      sourceId: "agentpey",
      search: async () => {
        searched += 1;
        return [];
      },
    };
    const result = await handleDiscoverySearch(source, "x".repeat(500));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ ok: false, code: "InvalidArguments" });
    expect(searched).toBe(0);
  });

  it("answers 503 when nobody replied — which is not the same as nothing being for sale", async () => {
    const source: CatalogSource = {
      sourceId: "agentpey",
      search: async () => {
        throw new AgentPassError("CatalogUnavailable", "no registered venue answered its catalogue");
      },
    };
    const result = await handleDiscoverySearch(source, "*");
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, code: "CatalogUnavailable" });
  });

  it("does not swallow an unexpected failure into a 200", async () => {
    const source: CatalogSource = {
      sourceId: "agentpey",
      search: async () => {
        throw new Error("boom");
      },
    };
    await expect(handleDiscoverySearch(source, "*")).rejects.toThrow("boom");
  });
});

describe("createPublicDiscovery", () => {
  it("serves only registered venues, and gives up on one that hangs", async () => {
    const source = createPublicDiscovery({
      registry: REGISTRY,
      timeoutMs: 20,
      fetchImpl: (async (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as typeof fetch,
    });

    const result = await handleDiscoverySearch(source, "*");
    expect(result.status).toBe(503);
  });

  it("indexes what a registered venue's own catalogue answers", async () => {
    const source = createPublicDiscovery({
      registry: REGISTRY,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            ok: true,
            results: [
              {
                resource: {
                  id: "market-report",
                  name: "Informe de mercado",
                  description: "Un informe del par XLM/USDC.",
                  payment: { asset: "USDC", amount: "0.25", destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" },
                  routeTemplate: "/api/x402/market-report?pair={pair}",
                },
              },
            ],
          }),
        )) as typeof fetch,
    });

    const result = await handleDiscoverySearch(source, "informe");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      results: [{ venue: VENUE, registered: true, product_id: "market-report" }],
    });
    // The venue quoted 0.25 USDC; the public index still publishes no price.
    expect(JSON.stringify(result.body)).not.toContain("0.25");
  });
});
