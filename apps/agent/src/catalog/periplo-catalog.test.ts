import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { createPeriploCatalog, PERIPLO_NETWORK } from "./periplo-catalog.js";
import { makeVenueId } from "./ids.js";
import { loadVenueRegistry } from "./registry.js";

const CONTRACT_ID = "CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BASE_URL = "https://signaldesk.example";
const VENUE = makeVenueId("signaldesk", CONTRACT_ID);

const REGISTRY = loadVenueRegistry([
  { slug: "signaldesk", address: CONTRACT_ID, baseUrl: BASE_URL, assets: [{ code: "USDC", issuer: ISSUER }] },
]);

const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

function offer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asset: USDC_SAC,
    payTo: "GBHD27INOTFHFPHVGQMKSW2EGRK3T6E47OHIVR7L44JGHWUJKXIZBXSR",
    amount: "10000",
    scheme: "exact",
    network: PERIPLO_NETWORK,
    maxTimeoutSeconds: 300,
    ...overrides,
  };
}

/** The live shape, verified against `periplo-testnet.fly.dev` while writing T78. */
const SIGNALDESK_ROW = {
  resource: `${BASE_URL}/api/x402/market-report`,
  type: "http",
  x402Version: 2,
  accepts: [offer()],
  lastUpdated: "2026-09-12T00:00:00.000Z",
  description: "A market report on XLM/USDC.",
  extensions: { bazaar: { info: {}, schema: {} } },
};

/**
 * The integration-test row that is actually sitting in the public catalogue:
 * a `.example` hostname and `accepts: []`. Not a hypothesis — copied from
 * `GET /discovery/resources` as it answered on 2026-09-12.
 */
const JUNK_ROW = {
  resource: "https://periplo-phase2-test.example/b043afd1-b828-42de-a692-c460e1018dd7",
  type: "http",
  x402Version: 2,
  accepts: [],
  description: "Phase 2 RLS integration test row",
};

const STRANGER_ROW = {
  resource: "https://agentpayments.fi/api/conformance",
  type: "http",
  accepts: [offer({ payTo: "GCYZRDWKRTJCQJYDUHP24TQZXD76ATEVSQIHKVAGMDBRR2KH4DEKFY5T" })],
  description: "Somebody else's paid endpoint.",
};

function fetchReturning(body: unknown, init?: ResponseInit): typeof fetch {
  return (async () => new Response(JSON.stringify(body), init)) as typeof fetch;
}

function catalogOver(rows: readonly unknown[], key: "resources" | "items" = "resources") {
  return createPeriploCatalog({
    baseUrl: "https://periplo.example",
    registry: REGISTRY,
    fetchImpl: fetchReturning({ x402Version: 2, [key]: rows, pagination: { limit: 20, cursor: null } }),
  });
}

describe("createPeriploCatalog", () => {
  it("reads the Bazaar shape the existing ServiceCard adapter cannot", async () => {
    const candidates = await catalogOver([SIGNALDESK_ROW]).search("*");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      source: "periplo",
      registered: true,
      venueId: VENUE,
      resourceUrl: `${BASE_URL}/api/x402/market-report`,
      description: "A market report on XLM/USDC.",
    });
  });

  it("reads rows under `items` as well as `resources` — both shapes are live", async () => {
    await expect(catalogOver([SIGNALDESK_ROW], "items").search("*")).resolves.toHaveLength(1);
  });

  it("carries no price, no payTo and no asset out of the catalogue", async () => {
    const [candidate] = await catalogOver([SIGNALDESK_ROW]).search("*");
    const serialised = JSON.stringify(candidate);
    expect(serialised).not.toContain("10000");
    expect(serialised).not.toContain("GBHD27IN");
    expect(serialised).not.toContain(USDC_SAC);
  });

  it("names no title, because a Bazaar row has no name to read", async () => {
    const [candidate] = await catalogOver([SIGNALDESK_ROW]).search("*");
    expect(candidate!.title).toBeUndefined();
  });

  it("drops the live integration-test row, because it offers nothing on this network", async () => {
    const candidates = await catalogOver([JUNK_ROW, SIGNALDESK_ROW]).search("*");
    expect(candidates.map((candidate) => candidate.resourceUrl)).toEqual([
      `${BASE_URL}/api/x402/market-report`,
    ]);
  });

  it("drops a row offering a different network or scheme", async () => {
    const mainnet = { ...SIGNALDESK_ROW, accepts: [offer({ network: "stellar:pubnet" })] };
    const upTo = { ...SIGNALDESK_ROW, accepts: [offer({ scheme: "upto" })] };
    await expect(catalogOver([mainnet, upTo]).search("*")).resolves.toEqual([]);
  });

  it("returns a stranger's endpoint as a candidate the registry does not vouch for", async () => {
    const [candidate] = await catalogOver([STRANGER_ROW]).search("*");
    expect(candidate).toMatchObject({ registered: false });
    expect(candidate!.venueId).toBeUndefined();
  });

  it("skips a malformed row instead of failing the whole search", async () => {
    const candidates = await catalogOver([{ nonsense: true }, null, "a string", SIGNALDESK_ROW]).search("*");
    expect(candidates).toHaveLength(1);
  });

  it("refuses a query it will not put in a URL, before any fetch", async () => {
    let called = 0;
    const catalog = createPeriploCatalog({
      registry: REGISTRY,
      fetchImpl: (async () => {
        called += 1;
        return new Response("{}");
      }) as typeof fetch,
    });
    await expect(catalog.search("x".repeat(500))).rejects.toMatchObject({ code: "InvalidArguments" });
    expect(called).toBe(0);
  });

  it("reports a non-2xx status as a NetworkError", async () => {
    const catalog = createPeriploCatalog({
      registry: REGISTRY,
      fetchImpl: fetchReturning({}, { status: 502 }),
    });
    await expect(catalog.search("*")).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "NetworkError"),
    );
  });

  it("reports an unreachable catalogue as a NetworkError", async () => {
    const catalog = createPeriploCatalog({
      registry: REGISTRY,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    await expect(catalog.search("*")).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "NetworkError"),
    );
  });

  it("reports an envelope with neither items nor resources as a NetworkError", async () => {
    const catalog = createPeriploCatalog({
      registry: REGISTRY,
      fetchImpl: fetchReturning({ x402Version: 2 }),
    });
    await expect(catalog.search("*")).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "NetworkError"),
    );
  });

  it("sends the query to the catalogue, encoded", async () => {
    const urls: string[] = [];
    const catalog = createPeriploCatalog({
      baseUrl: "https://periplo.example/",
      registry: REGISTRY,
      fetchImpl: (async (input: string | URL | Request) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ resources: [] }));
      }) as typeof fetch,
    });
    await catalog.search("informe XLM/USDC");
    expect(urls).toEqual(["https://periplo.example/discovery/search?query=informe%20XLM%2FUSDC"]);
  });
});
