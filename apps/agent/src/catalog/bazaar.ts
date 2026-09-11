/**
 * The real bazaar (`stellar-bazaar-x402`), now one row in {@link DEFAULT_VENUE_REGISTRY}
 * (`venues.json`) read through the generic {@link createX402Catalog} adapter
 * (`x402-catalog.ts`). This file used to hardcode the bazaar's HTTP-fetching
 * logic and its single recognised asset directly — F7 moved that logic into
 * `x402-catalog.ts` and that data into `venues.json`, so a second x402
 * merchant no longer needs a file shaped like this one. What stays here is
 * just the bazaar's own identity, as named constants for the call sites
 * (`scripts/demo.ts`, `payment/x402.ts`) that already import them.
 *
 * T19 already established this is not a Soroban contract to query: it is an
 * MCP/REST discovery API. `createX402Catalog` talks to the one transport
 * verified working against the live deployment — `GET /api/discovery/search`
 * — after probing the MCP endpoint (`POST /api/mcp`, `tools/call` and even a
 * bare `initialize`) and finding it answers every request with an empty
 * `500`. That was checked twice, not assumed from a single flaky call.
 *
 * The bazaar's own `/api/discovery/resources/{id}` — documented in its
 * `/llms.txt` agent guide as the single-resource lookup — also 404s on the
 * live deployment (a cached, edge-served 404, not a transient error). So
 * `getProduct` is implemented by listing and filtering rather than a direct
 * fetch; if that route starts working this can switch to it without changing
 * the interface.
 *
 * Two identity gaps the bazaar's own shape leaves open, resolved in
 * `venues.json` the same way `mock.ts` resolves its own:
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
 *   name this id specifically.
 */
import { makeAssetId, makeVenueId, type AssetId, type VenueId } from "./ids.js";
import { DEFAULT_VENUE_REGISTRY } from "./default-registry.js";
import { mapAssetIssuerForVenue, type VenueRegistry } from "./registry.js";
import {
  createX402Catalog,
  getX402ServiceRoute,
  type X402CatalogOptions,
  type X402ServiceRoute,
} from "./x402-catalog.js";
import type { CatalogAdapter } from "./catalog.js";

/** `sha256("agentpay:phase2:stellar-bazaar")`, StrKey-encoded. Not deployed. */
export const BAZAAR_VENUE_CONTRACT_ID = "CBDWMXZEE44NJ3RA6RS7K4EK36KDFW5S7KHP276HCMM4I52MIUUHEF5B";

export const BAZAAR_VENUE_ID: VenueId = makeVenueId("stellar-bazaar", BAZAAR_VENUE_CONTRACT_ID);

/**
 * The Stellar Asset Contract for USDC on testnet, as named in the bazaar's
 * own `/llms.txt` ("Testnet Configuration"). Verified live 2026-09-03.
 */
export const BAZAAR_USDC_ISSUER = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export const BAZAAR_USDC: AssetId = makeAssetId("USDC", BAZAAR_USDC_ISSUER);

export interface BazaarCatalogOptions {
  /** Defaults to {@link BAZAAR_VENUE_ID}. */
  readonly venueId?: VenueId;
  /** Overrides `venues.json`'s `baseUrl` for the bazaar's row — for a test double. */
  readonly baseUrl?: string;
  /** Defaults to {@link DEFAULT_VENUE_REGISTRY} (`venues.json`). */
  readonly registry?: VenueRegistry;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

function resolveOptions(options: BazaarCatalogOptions): X402CatalogOptions {
  return {
    venueId: options.venueId ?? BAZAAR_VENUE_ID,
    registry: options.registry ?? DEFAULT_VENUE_REGISTRY,
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
  };
}

/**
 * A {@link CatalogAdapter} over the real bazaar's REST discovery API —
 * {@link createX402Catalog} configured with the bazaar's registry row.
 *
 * @throws AgentPassError `NetworkError` on an unreachable host, a non-2xx
 * status, a non-JSON body, or a body that does not match the expected shape.
 * @throws AgentPassError `InvalidProduct` when a row's price is in an asset
 * this venue's registry row does not name, or otherwise fails `parseProduct`.
 */
export function createBazaarCatalog(options: BazaarCatalogOptions = {}): CatalogAdapter {
  return createX402Catalog(resolveOptions(options));
}

/**
 * The sibling of `mapAsset` for a real x402 payment challenge: a live
 * `PaymentRequirements.asset` names the SAC contract address directly
 * (`CBIELTK6...`), not the bare code the discovery `ServiceCard` uses —
 * confirmed by hitting a real bazaar route (T24). Same fail-closed rule: an
 * address this venue's registry row does not name refuses rather than
 * guesses.
 *
 * @throws AgentPassError `InvalidProduct` for a contract address the venue's
 * registry row does not name.
 */
export function mapAssetContract(contractAddress: string, venueId: VenueId): AssetId {
  return mapAssetIssuerForVenue(DEFAULT_VENUE_REGISTRY, venueId, contractAddress);
}

/**
 * The paid route for one bazaar product — what `executeBazaarPayment` (T24)
 * needs to actually hit the `402` challenge, and that `CatalogAdapter` has no
 * field for (T9's `Product` is deliberately venue-agnostic).
 *
 * @throws AgentPassError `ProductNotFound` when the bazaar has no such id.
 * @throws AgentPassError `InvalidProduct` when the card has no paid route —
 * every card this bazaar has served so far does, but a future one might not.
 */
export async function getBazaarServiceRoute(
  options: BazaarCatalogOptions,
  productId: string,
): Promise<X402ServiceRoute> {
  return getX402ServiceRoute(resolveOptions(options), productId);
}

export type BazaarServiceRoute = X402ServiceRoute;
