import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { parseAssetId, parseVenueId } from "./ids.js";
import {
  BAZAAR_USDC,
  BAZAAR_USDC_ISSUER,
  BAZAAR_VENUE_CONTRACT_ID,
  BAZAAR_VENUE_ID,
  createBazaarCatalog,
  getBazaarServiceRoute,
} from "./bazaar.js";

const BASE_URL = "https://stellar-bazaar-x402.example";

/** Two fixtures shaped like the live deployment's real `/api/discovery/search` reply. */
const SEARCH_BODY = {
  ok: true,
  query: "*",
  results: [
    {
      resource: {
        version: "bazaar.service-card/v0",
        id: "swap-risk-quote",
        name: "Swap Risk Quote",
        description: "Estima impacto de ruta, profundidad y riesgo de ejecucion para un par.",
        kind: "http",
        payment: { scheme: "exact", asset: "USDC", amount: "0.001", destination: "GDVR2KDK5DSMNYZJKNISUIOBDC6FZK3XZOIQWSS7KL4BRMD5BMW6RMCQ" },
        routeTemplate: "/api/x402/swap-risk?pair={pair}&amount={amount}&side={side}",
        input: [
          { name: "pair", type: "string", required: true },
          { name: "amount", type: "number", required: true },
          { name: "side", type: "string", required: true },
        ],
      },
      score: 0,
    },
    {
      resource: {
        version: "bazaar.service-card/v0",
        id: "stellar-ledger-brief",
        name: "Ledger Brief",
        description: "Resume actividad reciente de una cuenta o contrato.",
        kind: "http",
        payment: { scheme: "exact", asset: "USDC", amount: "0.005", destination: "GDVR2KDK5DSMNYZJKNISUIOBDC6FZK3XZOIQWSS7KL4BRMD5BMW6RMCQ" },
      },
      score: 0,
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

describe("the bazaar catalogue's identity", () => {
  it("names a venue whose contract id is well-formed but not deployed", () => {
    const parsed = parseVenueId(BAZAAR_VENUE_ID);

    expect(parsed.slug).toBe("stellar-bazaar");
    expect(parsed.contractId).toBe(BAZAAR_VENUE_CONTRACT_ID);
  });

  it("prices in the bazaar's own USDC — a contract issuer, not the mock's classic one", () => {
    const parsed = parseAssetId(BAZAAR_USDC);

    expect(parsed.code).toBe("USDC");
    expect(parsed.issuer).toBe(BAZAAR_USDC_ISSUER);
    expect(parsed.issuerKind).toBe("contract");
  });
});

describe("listProducts", () => {
  it("maps every ServiceCard in the search response to a Product", async () => {
    const catalog = createBazaarCatalog({ baseUrl: BASE_URL, fetchImpl: fetchReturning(SEARCH_BODY) });

    const products = await catalog.listProducts();

    expect(products).toHaveLength(2);
    expect(products[0]).toEqual({
      id: "swap-risk-quote",
      name: "Swap Risk Quote",
      description: "Estima impacto de ruta, profundidad y riesgo de ejecucion para un par.",
      price: { amount: "0.001", asset: BAZAAR_USDC },
      available: true,
    });
  });

  it("hits GET /api/discovery/search?query=* against the configured base url", async () => {
    let requestedUrl: string | undefined;
    const fetchImpl = (async (url: string | URL) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify(SEARCH_BODY));
    }) as typeof fetch;

    await createBazaarCatalog({ baseUrl: `${BASE_URL}/`, fetchImpl }).listProducts();

    expect(requestedUrl).toBe(`${BASE_URL}/api/discovery/search?query=*`);
  });

  it("wraps a network failure as NetworkError", async () => {
    const catalog = createBazaarCatalog({ baseUrl: BASE_URL, fetchImpl: fetchThrowing(new Error("ECONNREFUSED")) });

    try {
      await catalog.listProducts();
      expect.unreachable("expected listProducts to throw");
    } catch (error) {
      expect(hasErrorCode(error, "NetworkError")).toBe(true);
    }
  });

  it("treats a non-2xx status as NetworkError", async () => {
    const catalog = createBazaarCatalog({
      baseUrl: BASE_URL,
      fetchImpl: fetchReturning({ ok: false }, { status: 500 }),
    });

    try {
      await catalog.listProducts();
      expect.unreachable("expected listProducts to throw");
    } catch (error) {
      expect(hasErrorCode(error, "NetworkError")).toBe(true);
    }
  });

  it("treats a non-JSON body as NetworkError", async () => {
    const fetchImpl = (async () => new Response("<html>not json</html>")) as typeof fetch;
    const catalog = createBazaarCatalog({ baseUrl: BASE_URL, fetchImpl });

    try {
      await catalog.listProducts();
      expect.unreachable("expected listProducts to throw");
    } catch (error) {
      expect(hasErrorCode(error, "NetworkError")).toBe(true);
    }
  });

  it("treats a body that does not match the expected shape as NetworkError", async () => {
    const catalog = createBazaarCatalog({
      baseUrl: BASE_URL,
      fetchImpl: fetchReturning({ unexpected: "shape" }),
    });

    try {
      await catalog.listProducts();
      expect.unreachable("expected listProducts to throw");
    } catch (error) {
      expect(hasErrorCode(error, "NetworkError")).toBe(true);
    }
  });

  it("treats ok: false as NetworkError, not an empty catalogue", async () => {
    const catalog = createBazaarCatalog({
      baseUrl: BASE_URL,
      fetchImpl: fetchReturning({ ok: false, results: [] }),
    });

    try {
      await catalog.listProducts();
      expect.unreachable("expected listProducts to throw");
    } catch (error) {
      expect(hasErrorCode(error, "NetworkError")).toBe(true);
    }
  });

  it("refuses a row priced in an asset it has no issuer for, rather than guessing one", async () => {
    const body = {
      ok: true,
      results: [
        {
          resource: {
            id: "xlm-priced-thing",
            name: "Something priced in XLM",
            description: "n/a",
            payment: { asset: "XLM", amount: "1.00", destination: "GDVR2KDK5DSMNYZJKNISUIOBDC6FZK3XZOIQWSS7KL4BRMD5BMW6RMCQ" },
          },
        },
      ],
    };
    const catalog = createBazaarCatalog({ baseUrl: BASE_URL, fetchImpl: fetchReturning(body) });

    try {
      await catalog.listProducts();
      expect.unreachable("expected listProducts to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidProduct")).toBe(true);
    }
  });

  it("surfaces a row that fails product validation as InvalidProduct", async () => {
    const body = {
      ok: true,
      results: [
        {
          resource: {
            id: "bad id with spaces",
            name: "Whatever",
            description: "n/a",
            payment: { asset: "USDC", amount: "1.00", destination: "GDVR2KDK5DSMNYZJKNISUIOBDC6FZK3XZOIQWSS7KL4BRMD5BMW6RMCQ" },
          },
        },
      ],
    };
    const catalog = createBazaarCatalog({ baseUrl: BASE_URL, fetchImpl: fetchReturning(body) });

    try {
      await catalog.listProducts();
      expect.unreachable("expected listProducts to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidProduct")).toBe(true);
    }
  });
});

describe("getProduct", () => {
  it("finds a product by id within the listed catalogue", async () => {
    const catalog = createBazaarCatalog({ baseUrl: BASE_URL, fetchImpl: fetchReturning(SEARCH_BODY) });

    const product = await catalog.getProduct("stellar-ledger-brief");

    expect(product.name).toBe("Ledger Brief");
  });

  it("throws ProductNotFound for an id the bazaar does not list", async () => {
    const catalog = createBazaarCatalog({ baseUrl: BASE_URL, fetchImpl: fetchReturning(SEARCH_BODY) });

    try {
      await catalog.getProduct("does-not-exist");
      expect.unreachable("expected getProduct to throw");
    } catch (error) {
      expect(hasErrorCode(error, "ProductNotFound")).toBe(true);
    }
  });
});

describe("getBazaarServiceRoute", () => {
  it("returns the route template and inputs for a product that has one", async () => {
    const route = await getBazaarServiceRoute(
      { baseUrl: BASE_URL, fetchImpl: fetchReturning(SEARCH_BODY) },
      "swap-risk-quote",
    );

    expect(route).toEqual({
      id: "swap-risk-quote",
      routeTemplate: "/api/x402/swap-risk?pair={pair}&amount={amount}&side={side}",
      input: [
        { name: "pair", type: "string", required: true },
        { name: "amount", type: "number", required: true },
        { name: "side", type: "string", required: true },
      ],
    });
  });

  it("throws ProductNotFound for an id the bazaar does not list", async () => {
    try {
      await getBazaarServiceRoute({ baseUrl: BASE_URL, fetchImpl: fetchReturning(SEARCH_BODY) }, "does-not-exist");
      expect.unreachable("expected getBazaarServiceRoute to throw");
    } catch (error) {
      expect(hasErrorCode(error, "ProductNotFound")).toBe(true);
    }
  });

  it("throws InvalidProduct for a card with no paid route", async () => {
    try {
      await getBazaarServiceRoute(
        { baseUrl: BASE_URL, fetchImpl: fetchReturning(SEARCH_BODY) },
        "stellar-ledger-brief",
      );
      expect.unreachable("expected getBazaarServiceRoute to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidProduct")).toBe(true);
    }
  });
});
