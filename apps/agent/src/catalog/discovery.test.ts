import { AgentPassError, hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import {
  MAX_QUERY_LENGTH,
  matchesQuery,
  parseQuery,
  registeredOnly,
  resolveCandidateVenue,
  toCandidate,
  withCatalogFallback,
  type CatalogSource,
  type ServiceCandidate,
} from "./discovery.js";
import { makeVenueId } from "./ids.js";
import { loadVenueRegistry } from "./registry.js";

const CONTRACT_ID = "CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BASE_URL = "https://signaldesk.example/api";
const VENUE = makeVenueId("signaldesk", CONTRACT_ID);

const REGISTRY = loadVenueRegistry([
  { slug: "signaldesk", contractId: CONTRACT_ID, baseUrl: BASE_URL, assets: [{ code: "USDC", issuer: ISSUER }] },
  // A venue with no baseUrl: registered so its assets resolve, but not something a URL can match.
  { slug: "catalog-only", contractId: CONTRACT_ID, assets: [{ code: "USDC", issuer: ISSUER }] },
]);

function sourceReturning(sourceId: string, candidates: readonly ServiceCandidate[]): CatalogSource {
  return { sourceId, search: async () => candidates };
}

function sourceThrowing(sourceId: string, error: unknown): CatalogSource {
  return {
    sourceId,
    search: async () => {
      throw error;
    },
  };
}

const REGISTERED_CANDIDATE = toCandidate(REGISTRY, {
  source: "test",
  resourceUrl: `${BASE_URL}/x402/market-report`,
  title: "Market report",
  description: "XLM/USDC",
})!;

describe("resolveCandidateVenue", () => {
  it("matches a candidate URL to the venue that owns its origin", () => {
    expect(resolveCandidateVenue(REGISTRY, `${BASE_URL}/x402/market-report`)).toBe(VENUE);
  });

  it("matches on origin, not on prefix — a lookalike host resolves to nothing", () => {
    expect(resolveCandidateVenue(REGISTRY, "https://signaldesk.example.attacker.test/api/x402")).toBeUndefined();
  });

  it("does not match a different scheme or port on the same host", () => {
    expect(resolveCandidateVenue(REGISTRY, "http://signaldesk.example/api")).toBeUndefined();
    expect(resolveCandidateVenue(REGISTRY, "https://signaldesk.example:8443/api")).toBeUndefined();
  });

  it("resolves nothing for a URL that is not an absolute http(s) URL", () => {
    expect(resolveCandidateVenue(REGISTRY, "/api/x402/market-report")).toBeUndefined();
    expect(resolveCandidateVenue(REGISTRY, "data:text/plain,hello")).toBeUndefined();
    expect(resolveCandidateVenue(REGISTRY, "not a url at all")).toBeUndefined();
  });

  it("ignores a URL that smuggles credentials at a registered host", () => {
    expect(resolveCandidateVenue(REGISTRY, "https://user:pass@signaldesk.example/api")).toBeUndefined();
  });
});

describe("toCandidate", () => {
  it("marks a candidate at a registered origin as registered, with its venue", () => {
    const candidate = toCandidate(REGISTRY, {
      source: "periplo",
      resourceUrl: `${BASE_URL}/x402/market-report`,
      description: "A market report",
    });
    expect(candidate?.registered).toBe(true);
    expect(candidate?.venueId).toBe(VENUE);
  });

  it("marks an unknown origin as unregistered, and gives it no venue to read", () => {
    const candidate = toCandidate(REGISTRY, {
      source: "periplo",
      resourceUrl: "https://stranger.example/paid",
      description: "Something nobody registered",
    });
    expect(candidate?.registered).toBe(false);
    expect(candidate?.venueId).toBeUndefined();
  });

  it("never carries a price, whatever the catalogue said", () => {
    const candidate = toCandidate(REGISTRY, {
      source: "periplo",
      resourceUrl: `${BASE_URL}/x402/market-report`,
      description: "0.25 USDC",
    });
    expect(Object.keys(candidate!)).not.toContain("price");
    expect(Object.keys(candidate!)).not.toContain("amount");
  });

  it("skips a row whose text carries control characters", () => {
    expect(
      toCandidate(REGISTRY, {
        source: "periplo",
        resourceUrl: `${BASE_URL}/x402/market-report`,
        title: "Market\u0007report",
        description: "fine",
      }),
    ).toBeUndefined();
  });

  it("skips a row whose resource is not an absolute http(s) URL", () => {
    expect(toCandidate(REGISTRY, { source: "periplo", resourceUrl: "ftp://x.example/a" })).toBeUndefined();
  });
});

describe("registeredOnly", () => {
  it("keeps only what the registry vouches for", () => {
    const stranger = toCandidate(REGISTRY, { source: "periplo", resourceUrl: "https://stranger.example/paid" })!;
    expect(registeredOnly([REGISTERED_CANDIDATE, stranger])).toEqual([REGISTERED_CANDIDATE]);
  });
});

describe("parseQuery", () => {
  it("refuses a query longer than the cap", () => {
    expect(() => parseQuery("x".repeat(MAX_QUERY_LENGTH + 1))).toThrow(
      expect.objectContaining({ code: "InvalidArguments" }),
    );
  });

  it("refuses a query with control characters", () => {
    expect(hasErrorCode(callAndCatch(() => parseQuery("report\u0007")), "InvalidArguments")).toBe(true);
  });

  it("refuses a non-string", () => {
    expect(hasErrorCode(callAndCatch(() => parseQuery(42)), "InvalidArguments")).toBe(true);
  });

  it("accepts an ordinary query unchanged", () => {
    expect(parseQuery("informe XLM/USDC")).toBe("informe XLM/USDC");
  });
});

describe("matchesQuery", () => {
  it("matches everything for an empty query or a star", () => {
    expect(matchesQuery("", ["anything"])).toBe(true);
    expect(matchesQuery("*", ["anything"])).toBe(true);
  });

  it("ignores accents, case and punctuation", () => {
    expect(matchesQuery("INFORME", ["informe de mercado"])).toBe(true);
    expect(matchesQuery("informe", ["Infórme de mercado"])).toBe(true);
    expect(matchesQuery("xlm/usdc", ["par XLM USDC"])).toBe(true);
  });

  it("requires every token to appear", () => {
    expect(matchesQuery("informe creditos", ["informe de mercado"])).toBe(false);
  });

  it("skips absent haystack parts instead of matching on 'undefined'", () => {
    expect(matchesQuery("undefined", [undefined, "a market report"])).toBe(false);
  });
});

describe("withCatalogFallback", () => {
  it("uses the primary when it answers", async () => {
    const source = withCatalogFallback({
      primary: sourceReturning("periplo", [REGISTERED_CANDIDATE]),
      fallback: sourceThrowing("agentpey", new Error("should not be called")),
    });
    await expect(source.search("*")).resolves.toEqual([REGISTERED_CANDIDATE]);
  });

  it("falls back when the primary is down, and says so", async () => {
    const seen: unknown[] = [];
    const source = withCatalogFallback({
      primary: sourceThrowing("periplo", new AgentPassError("NetworkError", "down")),
      fallback: sourceReturning("agentpey", [REGISTERED_CANDIDATE]),
      onFallback: (error) => seen.push(error),
    });
    await expect(source.search("*")).resolves.toEqual([REGISTERED_CANDIDATE]);
    expect(seen).toHaveLength(1);
  });

  it("refuses with CatalogUnavailable when neither source answered — not an empty list", async () => {
    const source = withCatalogFallback({
      primary: sourceThrowing("periplo", new AgentPassError("NetworkError", "down")),
      fallback: sourceThrowing("agentpey", new AgentPassError("NetworkError", "also down")),
    });
    const error = await source.search("*").then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(hasErrorCode(error, "CatalogUnavailable")).toBe(true);
    expect((error as AgentPassError).details).toMatchObject({
      primary: { source: "periplo" },
      fallback: { source: "agentpey" },
    });
  });
});

function callAndCatch(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}
