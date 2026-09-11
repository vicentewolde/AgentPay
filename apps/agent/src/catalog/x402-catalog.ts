/**
 * A {@link CatalogAdapter} over any venue's x402 discovery API — the generic
 * adapter F7 asked for. `bazaar.ts` used to hardcode this HTTP logic once
 * per venue; this module is that logic with the venue's identity and
 * recognised assets factored out into the {@link VenueRegistry} (`registry.ts`).
 * Adding a second merchant that speaks the same discovery API is now a row
 * in `venues.json` plus one call to {@link createX402Catalog} — no new file
 * shaped like `bazaar.ts` needed.
 *
 * The transport itself — `GET /api/discovery/search`, the `ServiceCard`
 * shape, `getServiceRoute` reading `routeTemplate` — is exactly what T15/T19
 * verified against the real bazaar, carried over unchanged. A venue whose
 * discovery API disagrees with this shape is a venue this adapter cannot
 * speak to yet, the same limitation `bazaar.ts` always had.
 */
import { AgentPassError } from "@agentpass/core";
import { z } from "zod";

import { parseProduct, productNotFound, type CatalogAdapter, type Product } from "./catalog.js";
import type { VenueId } from "./ids.js";
import { baseUrlForVenue, mapAssetCodeForVenue, type VenueRegistry } from "./registry.js";

/**
 * `ServiceCard` (`bazaar.service-card/v0`). Deliberately not strict — this is
 * third-party shape a venue can extend, and a schema that rejected an added
 * field would turn a harmless upstream change into an outage here.
 */
const serviceCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  payment: z.object({
    asset: z.string(),
    amount: z.string(),
    destination: z.string(),
  }),
  /**
   * The paid route, with `{name}` placeholders — e.g. `/api/x402/swap-risk?pair={pair}`.
   * Only read by {@link getX402ServiceRoute}; `CatalogAdapter`'s own
   * `Product` never carries it, on purpose (T9).
   */
  routeTemplate: z.string().optional(),
  input: z
    .array(z.object({ name: z.string(), type: z.string(), required: z.boolean() }))
    .optional(),
});

const discoverySearchResponseSchema = z.object({
  ok: z.boolean(),
  results: z.array(z.object({ resource: serviceCardSchema })),
});

export interface X402CatalogOptions {
  readonly venueId: VenueId;
  readonly registry: VenueRegistry;
  /** Overrides the venue's registry `baseUrl` — for a deployment that reaches the same venue at a different host, or a test double. */
  readonly baseUrl?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

function networkError(
  message: string,
  baseUrl: string,
  options?: { readonly cause?: unknown; readonly extra?: Record<string, unknown> },
): AgentPassError {
  return new AgentPassError("NetworkError", message, {
    cause: options?.cause,
    details: { baseUrl, ...options?.extra },
  });
}

/** Resolves the venue's `baseUrl` — an explicit override, falling back to its registry row. */
function requireBaseUrl(options: X402CatalogOptions): string {
  const baseUrl = options.baseUrl ?? baseUrlForVenue(options.registry, options.venueId);
  if (baseUrl === undefined) {
    throw new AgentPassError(
      "InvalidProduct",
      `venue "${options.venueId}" has no baseUrl to fetch a catalogue from`,
      { details: { venueId: options.venueId } },
    );
  }
  return baseUrl.replace(/\/+$/, "");
}

function toProduct(card: z.infer<typeof serviceCardSchema>, options: X402CatalogOptions): Product {
  return parseProduct({
    id: card.id,
    name: card.name,
    description: card.description,
    price: {
      amount: card.payment.amount,
      asset: mapAssetCodeForVenue(options.registry, options.venueId, card.payment.asset),
    },
    // A discovery catalogue exposes no stock/availability concept — every listed service is offered.
    available: true,
  });
}

/**
 * @throws AgentPassError `NetworkError` on an unreachable host, a non-2xx
 * status, a non-JSON body, or a body that does not match the expected shape.
 */
async function fetchServiceCards(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<readonly z.infer<typeof serviceCardSchema>[]> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/discovery/search?query=*`);
  } catch (error) {
    throw networkError("could not reach the venue's discovery API", baseUrl, { cause: error });
  }

  if (!response.ok) {
    throw networkError("the venue's discovery API answered with a non-2xx status", baseUrl, {
      extra: { status: response.status },
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw networkError("the venue's discovery API did not answer with JSON", baseUrl, { cause: error });
  }

  const parsed = discoverySearchResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw networkError("the venue's discovery API answered with an unexpected shape", baseUrl, {
      extra: {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
  }
  if (!parsed.data.ok) {
    throw networkError("the venue's discovery API reported a failed search", baseUrl);
  }

  return parsed.data.results.map((row) => row.resource);
}

/**
 * A {@link CatalogAdapter} over an x402 venue's REST discovery API,
 * configured entirely from its {@link VenueRegistry} row.
 *
 * @throws AgentPassError `NetworkError` on an unreachable host, a non-2xx
 * status, a non-JSON body, or a body that does not match the expected shape.
 * @throws AgentPassError `InvalidProduct` when the venue has no `baseUrl` in
 * the registry, or a row's price is in an asset that venue's row does not
 * name, or otherwise fails {@link parseProduct}.
 */
export function createX402Catalog(options: X402CatalogOptions): CatalogAdapter {
  const { venueId } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = requireBaseUrl(options);

  async function fetchProducts(): Promise<readonly Product[]> {
    const cards = await fetchServiceCards(baseUrl, fetchImpl);
    return cards.map((card) => toProduct(card, options));
  }

  return {
    venueId,

    async listProducts(): Promise<readonly Product[]> {
      return fetchProducts();
    },

    async getProduct(id: string): Promise<Product> {
      const products = await fetchProducts();
      const product = products.find((p) => p.id === id);
      if (product === undefined) throw productNotFound(id, venueId);
      return product;
    },
  };
}

export interface X402ServiceRoute {
  readonly id: string;
  /** e.g. `/api/x402/swap-risk?pair={pair}&amount={amount}&side={side}`. */
  readonly routeTemplate: string;
  readonly input: readonly { readonly name: string; readonly type: string; readonly required: boolean }[];
}

/**
 * The paid route for one product on any registered x402 venue — what an
 * `executeBazaarPayment`-style caller needs to actually hit the `402`
 * challenge, and that `CatalogAdapter` has no field for (T9's `Product` is
 * deliberately venue-agnostic).
 *
 * @throws AgentPassError `ProductNotFound` when the venue has no such id.
 * @throws AgentPassError `InvalidProduct` when the card has no paid route.
 */
export async function getX402ServiceRoute(
  options: X402CatalogOptions,
  productId: string,
): Promise<X402ServiceRoute> {
  const { venueId } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = requireBaseUrl(options);

  const cards = await fetchServiceCards(baseUrl, fetchImpl);
  const card = cards.find((row) => row.id === productId);
  if (card === undefined) throw productNotFound(productId, venueId);

  if (card.routeTemplate === undefined) {
    throw new AgentPassError("InvalidProduct", `"${productId}" has no paid route to pay for`, {
      details: { productId, venueId },
    });
  }

  return { id: card.id, routeTemplate: card.routeTemplate, input: card.input ?? [] };
}
