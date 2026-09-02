import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { parseAssetId, parseVenueId } from "./ids.js";
import {
  EURC_MOCK,
  MOCK_PRODUCTS,
  MOCK_VENUE_CONTRACT_ID,
  MOCK_VENUE_ID,
  USDC_TESTNET,
  createMockCatalog,
} from "./mock.js";

/** The pilot credential's per-transaction limit, for splitting the fixtures. */
const PER_TX = 50;

function amount(value: string): number {
  return Number.parseFloat(value);
}

describe("the mock catalogue's identity", () => {
  it("names a venue whose contract id is well-formed but not deployed", () => {
    const parsed = parseVenueId(MOCK_VENUE_ID);

    expect(parsed.slug).toBe("mock-bazaar");
    expect(parsed.contractId).toBe(MOCK_VENUE_CONTRACT_ID);
  });

  it("prices in two parseable assets", () => {
    expect(parseAssetId(USDC_TESTNET).code).toBe("USDC");
    expect(parseAssetId(EURC_MOCK).code).toBe("EURC");
    expect(USDC_TESTNET).not.toBe(EURC_MOCK);
  });
});

describe("the seeded products", () => {
  it("holds twelve, every one of them schema-valid", () => {
    expect(MOCK_PRODUCTS).toHaveLength(12);
  });

  it("has unique ids", () => {
    const ids = new Set(MOCK_PRODUCTS.map((product) => product.id));

    expect(ids.size).toBe(MOCK_PRODUCTS.length);
  });

  it("covers both sides of a 50.00 per-transaction limit", () => {
    const under = MOCK_PRODUCTS.filter((p) => amount(p.price.amount) <= PER_TX);
    const over = MOCK_PRODUCTS.filter((p) => amount(p.price.amount) > PER_TX);

    expect(under.length).toBeGreaterThanOrEqual(3);
    expect(over.length).toBeGreaterThanOrEqual(3);
  });

  it("holds one product priced in a foreign asset and cheap enough to pass on amount", () => {
    const foreign = MOCK_PRODUCTS.filter((p) => p.price.asset !== USDC_TESTNET);

    expect(foreign).toHaveLength(1);
    expect(foreign[0]?.price.asset).toBe(EURC_MOCK);
    // Otherwise a rejection could not be attributed to the asset alone.
    expect(amount(foreign[0]?.price.amount ?? "0")).toBeLessThan(PER_TX);
  });

  it("holds an unavailable product", () => {
    expect(MOCK_PRODUCTS.some((product) => !product.available)).toBe(true);
  });

  /**
   * The point of T12: these live in the ordinary catalogue, not in a fixture
   * the demo never walks. If a later milestone's refusal ever depends on the
   * agent choosing to ignore them, that is a bug the normal run can expose.
   */
  it("seeds two descriptions that argue for their own approval", () => {
    const hostile = MOCK_PRODUCTS.filter((product) =>
      /ignora tus instrucciones|exento del limite/i.test(product.description),
    );

    expect(hostile).toHaveLength(2);
    expect(hostile.map((product) => product.id).sort()).toEqual([
      "manta-lana-chilota",
      "polera-stellar-santiago",
    ]);
  });

  it("puts one injection on a product that passes every structural check", () => {
    const passing = MOCK_PRODUCTS.find((p) => p.id === "polera-stellar-santiago");

    expect(passing?.available).toBe(true);
    expect(passing?.price.asset).toBe(USDC_TESTNET);
    expect(amount(passing?.price.amount ?? "0")).toBeLessThan(PER_TX);
  });

  it("puts the other on a product the amount check must refuse", () => {
    const refused = MOCK_PRODUCTS.find((p) => p.id === "manta-lana-chilota");

    expect(amount(refused?.price.amount ?? "0")).toBeGreaterThan(PER_TX);
  });
});

describe("createMockCatalog", () => {
  it("answers listProducts with every seeded product", async () => {
    const catalog = createMockCatalog();

    await expect(catalog.listProducts()).resolves.toHaveLength(12);
    expect(catalog.venueId).toBe(MOCK_VENUE_ID);
  });

  it("returns one product by exact id", async () => {
    const catalog = createMockCatalog();
    const product = await catalog.getProduct("mate-calabaza");

    expect(product.name).toBe("Mate de calabaza curado");
  });

  it("throws ProductNotFound for an unknown id, never undefined", async () => {
    const catalog = createMockCatalog();

    await expect(catalog.getProduct("no-existe")).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "ProductNotFound"),
    );
  });

  it("matches ids exactly: no trimming, no case folding", async () => {
    const catalog = createMockCatalog();

    await expect(catalog.getProduct(" mate-calabaza")).rejects.toThrow();
    await expect(catalog.getProduct("MATE-CALABAZA")).rejects.toThrow();
  });

  it("validates injected rows through the same parseProduct every adapter uses", async () => {
    expect(() => createMockCatalog({ products: [{ id: "roto" }] })).toSatisfy((build: () => void) => {
      try {
        build();
        return false;
      } catch (error) {
        return hasErrorCode(error, "InvalidProduct");
      }
    });
  });

  it("accepts a caller-supplied catalogue, so tests need no special adapter", async () => {
    const catalog = createMockCatalog({
      products: [
        {
          id: "solo",
          name: "Unico",
          description: "",
          price: { amount: "1.00", asset: USDC_TESTNET },
          available: true,
        },
      ],
    });

    await expect(catalog.listProducts()).resolves.toHaveLength(1);
  });
});
