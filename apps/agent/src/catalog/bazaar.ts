/**
 * The real bazaar (`stellar-bazaar-x402`), read as a `CatalogAdapter`.
 *
 * T19 already established this is not a Soroban contract to query: it is an
 * MCP/REST discovery API. This adapter talks to the one transport verified
 * working against the live deployment — `GET /api/discovery/search` — after
 * probing the MCP endpoint (`POST /api/mcp`, `tools/call` and even a bare
 * `initialize`) and finding it answers every request with an empty `500`.
 * That was checked twice, not assumed from a single flaky call. If the
 * bazaar's MCP transport starts working, swapping the transport in here does
 * not touch `CatalogAdapter` or anything upstream of it.
 *
 * The bazaar's own `/api/discovery/resources/{id}` — documented in its
 * `/llms.txt` agent guide as the single-resource lookup — also 404s on the
 * live deployment (a cached, edge-served 404, not a transient error). So
 * `getProduct` is implemented by listing and filtering rather than a direct
 * fetch; if that route starts working this can switch to it without changing
 * the interface.
 *
 * Two identity gaps the bazaar's own shape leaves open, resolved here the
 * same way `mock.ts` resolves its own:
 *
 * - **No venue contract.** ROADMAP.md §4.2 confirms the bazaar deploys an
 *   app, not a Soroban contract — there is no `C...` to name as its
 *   `VenueId`. `BAZAAR_VENUE_CONTRACT_ID` is `sha256("agentpay:phase2:stellar-bazaar")`
 *   in StrKey form: well-formed, not deployed, same technique
 *   `MOCK_VENUE_CONTRACT_ID` already uses and for the same reason — `ids.ts`
 *   is not touched by T15, so the identity has to fit the shape that already
 *   exists.
 * - **The asset code, not an asset id.** Every `ServiceCard.payment.asset`
 *   this bazaar quotes is the bare string `"USDC"` — no issuer. Its own
 *   `/llms.txt` names the Stellar Asset Contract this catalogue actually
 *   prices in: `BAZAAR_USDC_ISSUER`. That is a **different** `AssetId` than
 *   the mock's `USDC_TESTNET` (a classic `G...` issuer) — same underlying
 *   asset, two addresses, and `ids.ts` compares byte for byte on purpose
 *   (`B-1`'s sibling reasoning). A credential authorised for the mock's USDC
 *   does not thereby authorise the bazaar's; a scope naming the bazaar has to
 *   name this id specifically. An asset code this adapter does not recognise
 *   fails closed as `InvalidProduct` rather than guessing an issuer.
 */
import { AgentPassError } from "@agentpass/core";
import { z } from "zod";

import { parseProduct, productNotFound, type CatalogAdapter, type Product } from "./catalog.js";
import { makeAssetId, makeVenueId, type AssetId, type VenueId } from "./ids.js";

/** `sha256("agentpay:phase2:stellar-bazaar")`, StrKey-encoded. Not deployed. */
export const BAZAAR_VENUE_CONTRACT_ID = "CBDWMXZEE44NJ3RA6RS7K4EK36KDFW5S7KHP276HCMM4I52MIUUHEF5B";

export const BAZAAR_VENUE_ID: VenueId = makeVenueId("stellar-bazaar", BAZAAR_VENUE_CONTRACT_ID);

/**
 * The Stellar Asset Contract for USDC on testnet, as named in the bazaar's
 * own `/llms.txt` ("Testnet Configuration"). Verified live 2026-09-03.
 */
export const BAZAAR_USDC_ISSUER = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export const BAZAAR_USDC: AssetId = makeAssetId("USDC", BAZAAR_USDC_ISSUER);

/**
 * `ServiceCard` (`bazaar.service-card/v0`). Deliberately not strict — this is
 * third-party shape the bazaar can extend (it already carries `tags`,
 * `delivery`, `provider`, none of which a catalogue entry needs), and a
 * schema that rejected an added field would turn a harmless upstream change
 * into an outage here.
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
   * Only read by {@link getBazaarServiceRoute} (T24); `CatalogAdapter`'s own
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

export interface BazaarCatalogOptions {
  /** e.g. `https://stellar-bazaar-x402.vercel.app` — no trailing slash required. */
  readonly baseUrl: string;
  /** Defaults to {@link BAZAAR_VENUE_ID}. */
  readonly venueId?: VenueId;
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

/**
 * The only asset code this catalogue has a verified issuer for is `USDC`
 * (`BAZAAR_USDC_ISSUER`, read from the bazaar's own `/llms.txt`). Anything
 * else fails closed — a fabricated issuer could quietly authorise the wrong
 * asset, which is worse than refusing the product outright.
 */
function mapAsset(code: string, venueId: VenueId): AssetId {
  if (code !== "USDC") {
    throw new AgentPassError(
      "InvalidProduct",
      `the bazaar quoted an asset code this adapter has no issuer for: "${code}"`,
      { details: { assetCode: code, venueId } },
    );
  }
  return BAZAAR_USDC;
}

/**
 * The sibling of {@link mapAsset} for a real x402 payment challenge: a live
 * `PaymentRequirements.asset` names the SAC contract address directly
 * (`CBIELTK6...`), not the bare code the discovery `ServiceCard` uses —
 * confirmed by hitting a real bazaar route (T24). Same fail-closed rule: an
 * address this adapter does not recognise refuses rather than guesses.
 */
export function mapAssetContract(contractAddress: string, venueId: VenueId): AssetId {
  if (contractAddress !== BAZAAR_USDC_ISSUER) {
    throw new AgentPassError(
      "InvalidProduct",
      `the bazaar's payment challenge names an asset contract this adapter does not recognise: "${contractAddress}"`,
      { details: { assetContract: contractAddress, venueId } },
    );
  }
  return BAZAAR_USDC;
}

function toProduct(card: z.infer<typeof serviceCardSchema>, venueId: VenueId): Product {
  return parseProduct({
    id: card.id,
    name: card.name,
    description: card.description,
    price: { amount: card.payment.amount, asset: mapAsset(card.payment.asset, venueId) },
    // The bazaar exposes no stock/availability concept — every listed service is offered.
    available: true,
  });
}

/**
 * A {@link CatalogAdapter} over the real bazaar's REST discovery API.
 *
 * @throws AgentPassError `NetworkError` on an unreachable host, a non-2xx
 * status, a non-JSON body, or a body that does not match the expected shape.
 * @throws AgentPassError `InvalidProduct` when a row's price is in an asset
 * this adapter cannot map, or otherwise fails {@link parseProduct}.
 */
async function fetchServiceCards(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<readonly z.infer<typeof serviceCardSchema>[]> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/discovery/search?query=*`);
  } catch (error) {
    throw networkError("could not reach the bazaar's discovery API", baseUrl, { cause: error });
  }

  if (!response.ok) {
    throw networkError("the bazaar's discovery API answered with a non-2xx status", baseUrl, {
      extra: { status: response.status },
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw networkError("the bazaar's discovery API did not answer with JSON", baseUrl, { cause: error });
  }

  const parsed = discoverySearchResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw networkError("the bazaar's discovery API answered with an unexpected shape", baseUrl, {
      extra: {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
  }
  if (!parsed.data.ok) {
    throw networkError("the bazaar's discovery API reported a failed search", baseUrl);
  }

  return parsed.data.results.map((row) => row.resource);
}

/**
 * A {@link CatalogAdapter} over the real bazaar's REST discovery API.
 *
 * @throws AgentPassError `NetworkError` on an unreachable host, a non-2xx
 * status, a non-JSON body, or a body that does not match the expected shape.
 * @throws AgentPassError `InvalidProduct` when a row's price is in an asset
 * this adapter cannot map, or otherwise fails {@link parseProduct}.
 */
export function createBazaarCatalog(options: BazaarCatalogOptions): CatalogAdapter {
  const venueId = options.venueId ?? BAZAAR_VENUE_ID;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function fetchProducts(): Promise<readonly Product[]> {
    const cards = await fetchServiceCards(baseUrl, fetchImpl);
    return cards.map((card) => toProduct(card, venueId));
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

export interface BazaarServiceRoute {
  readonly id: string;
  /** e.g. `/api/x402/swap-risk?pair={pair}&amount={amount}&side={side}`. */
  readonly routeTemplate: string;
  readonly input: readonly { readonly name: string; readonly type: string; readonly required: boolean }[];
}

/**
 * The paid route for one bazaar product — what {@link executeBazaarPayment}
 * (T24) needs to actually hit the `402` challenge, and that `CatalogAdapter`
 * has no field for (T9's `Product` is deliberately venue-agnostic).
 *
 * @throws AgentPassError `ProductNotFound` when the bazaar has no such id.
 * @throws AgentPassError `InvalidProduct` when the card has no paid route —
 * every card this bazaar has served so far does, but a future one might not.
 */
export async function getBazaarServiceRoute(
  options: BazaarCatalogOptions,
  productId: string,
): Promise<BazaarServiceRoute> {
  const venueId = options.venueId ?? BAZAAR_VENUE_ID;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

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
