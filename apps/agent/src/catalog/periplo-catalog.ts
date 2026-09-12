/**
 * A {@link CatalogSource} over Periplo — the public x402 discovery catalogue
 * of the Stellar ecosystem, adopted in `C-77` to *discover* and denied every
 * kind of authority.
 *
 * **Why this is a new adapter and not a parameter on `createX402Catalog`.**
 * The two speak different protocols. `x402-catalog.ts` reads a venue's own
 * `ServiceCard` feed: `{ ok, results: [{ resource: { id, name, payment: {
 * asset, amount, destination }, routeTemplate } }] }` — a merchant describing
 * its own products, with ids and paid routes. Periplo answers the x402
 * Bazaar discovery shape instead: `{ x402Version, items | resources: [{
 * resource, accepts: [{ asset, payTo, amount, scheme, network }],
 * description, extensions }] }` — an index of *URLs* across many merchants,
 * with no product id and no name anywhere. There is no flag that turns one
 * into the other; pretending otherwise would have meant a parser that half
 * understands both and fully understands neither.
 *
 * **What it refuses to believe, which is everything.** Periplo names `payTo`,
 * `asset` and `amount` for each row, and this adapter reads none of them into
 * a candidate. Not because they are likely wrong, but because a value that is
 * never carried cannot later be compared against a Mandate by mistake — the
 * only `payTo` and the only price that reach a decision are the ones in the
 * merchant's own 402 invoice, fetched by AgentPey itself.
 *
 * What the `accepts` rows *are* used for is the opposite of trust: a row with
 * no offer on this network, under the `exact` scheme, is not a candidate at
 * all. That single rule is what drops `periplo-phase2-test.example` — a live
 * integration-test row with `accepts: []` sitting in the public catalogue
 * today. Junk in a public index is not a hypothesis, and the shape of the
 * junk is not knowable in advance, so every row is parsed on its own and a
 * row that fails is skipped rather than failing the search.
 */
import { AgentPassError } from "@agentpass/core";
import { z } from "zod";

import {
  MAX_CANDIDATES,
  parseQuery,
  toCandidate,
  type CatalogSource,
  type ServiceCandidate,
} from "./discovery.js";
import type { VenueRegistry } from "./registry.js";

/** The scheme this project settles under. A row offering anything else is not for us. */
const SUPPORTED_SCHEME = "exact";

/** Stellar testnet, spelled the way x402 spells it. Mainnet rows are not candidates here. */
export const PERIPLO_NETWORK = "stellar:testnet";

/** The live deployment verified in `C-77`. Testnet only, by the operator's own declaration. */
export const PERIPLO_BASE_URL = "https://periplo-testnet.fly.dev";

/**
 * One payment offer on a row. Loose on purpose: a catalogue may add fields
 * (`extra`, `maxTimeoutSeconds`, …) and a strict schema would turn a harmless
 * upstream addition into an outage.
 */
const acceptSchema = z.object({
  scheme: z.string(),
  network: z.string(),
});

/** One indexed resource. Only what is actually read is required. */
const resourceSchema = z.object({
  resource: z.string(),
  description: z.string().optional(),
  accepts: z.array(z.unknown()).optional(),
});

/**
 * The envelope. Periplo returns its rows under `items` on
 * `/discovery/resources` and under `resources` on `/discovery/search` — both
 * observed live, both accepted here, because guessing which one a deployment
 * will use is not a thing to be right about only most of the time.
 */
const responseSchema = z.object({
  items: z.array(z.unknown()).optional(),
  resources: z.array(z.unknown()).optional(),
});

export interface PeriploCatalogOptions {
  /** Defaults to {@link PERIPLO_BASE_URL}. */
  readonly baseUrl?: string;
  /** The registry that decides which candidates are payable. */
  readonly registry: VenueRegistry;
  /** Defaults to {@link PERIPLO_NETWORK}. */
  readonly network?: string;
  /** Injected for tests, and wrapped in a timeout by the caller in production. */
  readonly fetchImpl?: typeof fetch;
}

function networkError(message: string, baseUrl: string, extra?: Record<string, unknown>): AgentPassError {
  return new AgentPassError("NetworkError", message, { details: { baseUrl, source: "periplo", ...extra } });
}

/** Whether a row offers to be paid the way this project pays, on the network it pays on. */
function hasUsableOffer(row: z.infer<typeof resourceSchema>, network: string): boolean {
  return (row.accepts ?? []).some((entry) => {
    const parsed = acceptSchema.safeParse(entry);
    return parsed.success && parsed.data.scheme === SUPPORTED_SCHEME && parsed.data.network === network;
  });
}

/**
 * Periplo as a {@link CatalogSource}.
 *
 * @throws AgentPassError `NetworkError` when the catalogue is unreachable,
 * answers non-2xx, answers something that is not JSON, or answers an envelope
 * with neither `items` nor `resources`. Never for an individual bad row.
 */
export function createPeriploCatalog(options: PeriploCatalogOptions): CatalogSource {
  const baseUrl = (options.baseUrl ?? PERIPLO_BASE_URL).replace(/\/+$/, "");
  const network = options.network ?? PERIPLO_NETWORK;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    sourceId: "periplo",

    async search(rawQuery: string): Promise<readonly ServiceCandidate[]> {
      const query = parseQuery(rawQuery);
      const url = `${baseUrl}/discovery/search?query=${encodeURIComponent(query)}`;

      let response: Response;
      try {
        response = await fetchImpl(url);
      } catch (error) {
        throw new AgentPassError("NetworkError", "could not reach the public catalogue", {
          cause: error,
          details: { baseUrl, source: "periplo" },
        });
      }

      if (!response.ok) {
        throw networkError("the public catalogue answered with a non-2xx status", baseUrl, {
          status: response.status,
        });
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new AgentPassError("NetworkError", "the public catalogue did not answer with JSON", {
          cause: error,
          details: { baseUrl, source: "periplo" },
        });
      }

      const parsed = responseSchema.safeParse(body);
      const rows = parsed.success ? (parsed.data.resources ?? parsed.data.items) : undefined;
      if (rows === undefined) {
        throw networkError("the public catalogue answered with an unexpected shape", baseUrl);
      }

      const candidates: ServiceCandidate[] = [];
      for (const raw of rows) {
        if (candidates.length >= MAX_CANDIDATES) break;

        const row = resourceSchema.safeParse(raw);
        if (!row.success) continue;
        if (!hasUsableOffer(row.data, network)) continue;

        const candidate = toCandidate(options.registry, {
          source: "periplo",
          resourceUrl: row.data.resource,
          // Bazaar rows carry no name field. Leaving this `undefined` is the
          // honest answer; inventing a title from the URL would be this
          // module deciding what a third party meant.
          title: undefined,
          description: row.data.description,
        });
        if (candidate !== undefined) candidates.push(candidate);
      }

      return candidates;
    },
  };
}
