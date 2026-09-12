/**
 * Public discovery: how the agent learns that a service *might* exist, and
 * why learning that can never be the same thing as being allowed to pay for
 * it.
 *
 * The rule this module exists to make unbreakable, in one line:
 * **the catalogue chooses who gets asked for a price; `venues.json` chooses
 * who may be paid.** A public catalogue is third-party input — it can list a
 * merchant that does not exist, a merchant that is malicious, a row of
 * integration-test junk, or nothing at all because it is down. None of those
 * may produce a payment. At most they produce a candidate that resolves to
 * no venue, and `executeTenantPurchase` never hears about it.
 *
 * **The type is the enforcement, not a convention.** A {@link ServiceCandidate}
 * is a discriminated union: an {@link UnregisteredCandidate} has no `venueId`
 * field to read, so code that wants to buy something cannot reach a venue id
 * without first narrowing on `registered === true` — which is only ever set
 * by {@link resolveCandidateVenue} matching the candidate's own origin
 * against a row of the venue registry. A caller cannot forget the check,
 * because there is nothing to forget: the value it needs does not exist
 * until the check has run.
 *
 * **And a candidate carries no price.** Not a discounted one, not an
 * "estimated" one, not one behind a cautious field name. `C-77` says the
 * catalogue's declared price is discarded and the only price that counts is
 * the venue's own 402 invoice, compared against the signed Mandate by
 * `reconcileTerms`. A field that does not exist cannot be threaded into a
 * decision by a later refactor that means well.
 */
import { AgentPassError } from "@agentpass/core";

import { thirdPartyNameSchema, thirdPartyTextSchema } from "./catalog.js";
import type { VenueId } from "./ids.js";
import type { VenueRegistry } from "./registry.js";

/** Which catalogue answered. Provenance, for display and logs — never an input to a decision. */
export type CatalogSourceId = string;

interface CandidateBase {
  /** The catalogue this came from, e.g. `"periplo"` or `"agentpey"`. */
  readonly source: CatalogSourceId;
  /** The absolute URL the catalogue advertised. Third-party data. */
  readonly resourceUrl: string;
  /**
   * The service's name, when the catalogue names it. Periplo's Bazaar rows
   * carry no name field at all, so this is genuinely `undefined` there rather
   * than a label invented from the URL.
   *
   * Third-party text: displayed, never interpreted.
   */
  readonly title: string | undefined;
  /** Third-party text: displayed, never interpreted. */
  readonly description: string;
  /**
   * The venue's own product id, when the catalogue is one that knows product
   * ids. Periplo indexes URLs, not products, so a Periplo candidate leaves
   * this `undefined` and {@link resolvePayableService} asks the venue itself.
   */
  readonly productId: string | undefined;
}

/** A candidate whose origin is a row in the venue registry. Payable, subject to every layer downstream. */
export interface RegisteredCandidate extends CandidateBase {
  readonly registered: true;
  readonly venueId: VenueId;
}

/** A candidate the registry does not know. Deliberately has no `venueId` to read. */
export interface UnregisteredCandidate extends CandidateBase {
  readonly registered: false;
  readonly venueId?: undefined;
}

export type ServiceCandidate = RegisteredCandidate | UnregisteredCandidate;

/**
 * Anything the agent can search for candidates: the public Periplo catalogue,
 * AgentPey's own index over the registry, or a fallback wrapping both.
 */
export interface CatalogSource {
  readonly sourceId: CatalogSourceId;
  /**
   * Candidates matching a free-text query. `"*"` or an empty query means
   * "everything this catalogue has".
   *
   * @throws AgentPassError `NetworkError` or `CatalogUnavailable` when the
   * catalogue cannot be reached or answered with a shape this cannot read.
   * An implementation never throws for an individual malformed row — junk in
   * a public catalogue is expected, and is skipped.
   */
  search(query: string): Promise<readonly ServiceCandidate[]>;
}

/** A query longer than this is a bug or an attack, not a search. */
export const MAX_QUERY_LENGTH = 200;

/** No catalogue answer, from any source, may exceed this many candidates. */
export const MAX_CANDIDATES = 50;

/**
 * Normalises a query or a piece of catalogue text for matching: lowercase,
 * accents stripped, everything that is not a letter or digit collapsed to a
 * space. Same normalisation `interpret.ts` applies for the same reason —
 * matching text is cosmetic, and cosmetics must not depend on an accent.
 */
function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whether a candidate's text answers a query: every query token must appear
 * somewhere in the haystack. `"*"` and an empty query match everything.
 *
 * This is a search filter, not an authorisation check. It may be as wrong as
 * it likes — the worst it can do is show a person a service they did not ask
 * for, which they then have to choose, which the Mandate then has to allow.
 */
export function matchesQuery(query: string, haystack: readonly (string | undefined)[]): boolean {
  const normalisedQuery = normalise(query);
  if (normalisedQuery === "" || query.trim() === "*") return true;
  const text = normalise(haystack.filter((part): part is string => part !== undefined).join(" "));
  return normalisedQuery.split(" ").every((token) => text.includes(token));
}

/**
 * Rejects a query that is too long or carries control characters, before it
 * is put in a URL bound for a third-party catalogue.
 *
 * @throws AgentPassError `InvalidArguments`
 */
export function parseQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw new AgentPassError("InvalidArguments", "a catalogue query must be a string", {
      details: { received: typeof value },
    });
  }
  if (value.length > MAX_QUERY_LENGTH) {
    throw new AgentPassError(
      "InvalidArguments",
      `a catalogue query is at most ${MAX_QUERY_LENGTH} characters, got ${value.length}`,
      { details: { length: value.length } },
    );
  }
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    throw new AgentPassError("InvalidArguments", "a catalogue query may not contain control characters", {
      details: {},
    });
  }
  return value;
}

/**
 * The origin of a URL, or `undefined` when it is not an absolute http(s) URL.
 *
 * A catalogue row whose `resource` is a relative path, a `data:` URI or a
 * hostname with embedded credentials resolves to no origin and therefore to
 * no venue — refused by absence, with nothing special-cased.
 */
function originOf(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (parsed.username !== "" || parsed.password !== "") return undefined;
  return parsed.origin;
}

/**
 * The venue a candidate URL belongs to, matched by origin against the
 * registry's `baseUrl` rows — or `undefined` when no row claims that origin.
 *
 * Origin, not prefix: a merchant registered at `https://shop.example/api`
 * must not be matched by `https://shop.example.attacker.test/api`, and a
 * prefix comparison on strings is exactly how that mistake is usually made.
 */
export function resolveCandidateVenue(registry: VenueRegistry, resourceUrl: string): VenueId | undefined {
  const origin = originOf(resourceUrl);
  if (origin === undefined) return undefined;

  for (const venue of registry.venues.values()) {
    if (venue.baseUrl === undefined) continue;
    if (originOf(venue.baseUrl) === origin) return venue.venueId;
  }
  return undefined;
}

export interface CandidateDraft {
  readonly source: CatalogSourceId;
  readonly resourceUrl: string;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly productId?: string | undefined;
}

/**
 * The only way a raw catalogue row becomes a {@link ServiceCandidate} — the
 * sibling of `parseProduct`, and the single place where the registry decides
 * whether a candidate is payable.
 *
 * Returns `undefined` for a row whose text does not survive validation,
 * rather than throwing: one malformed row in a public catalogue must not
 * take down a search over the others. A row that is fine but names an
 * unknown origin comes back as an {@link UnregisteredCandidate} — visible,
 * and unusable.
 */
export function toCandidate(registry: VenueRegistry, draft: CandidateDraft): ServiceCandidate | undefined {
  if (originOf(draft.resourceUrl) === undefined) return undefined;

  const title = draft.title === undefined ? undefined : thirdPartyNameSchema.safeParse(draft.title);
  if (title !== undefined && !title.success) return undefined;

  const description = thirdPartyTextSchema.safeParse(draft.description ?? "");
  if (!description.success) return undefined;

  const base = {
    source: draft.source,
    resourceUrl: draft.resourceUrl,
    title: title?.data,
    description: description.data,
    productId: draft.productId,
  };

  const venueId = resolveCandidateVenue(registry, draft.resourceUrl);
  return venueId === undefined ? { ...base, registered: false } : { ...base, registered: true, venueId };
}

/** Only the candidates the registry vouches for — the ones a purchase may be built from. */
export function registeredOnly(candidates: readonly ServiceCandidate[]): readonly RegisteredCandidate[] {
  return candidates.filter((candidate): candidate is RegisteredCandidate => candidate.registered);
}

export interface FallbackOptions {
  /** Tried first. */
  readonly primary: CatalogSource;
  /** Used when `primary` throws — a catalogue that is down must not be an outage here. */
  readonly fallback: CatalogSource;
  /** Called when the primary failed and the fallback is about to be used. For logs. */
  readonly onFallback?: (error: unknown) => void;
}

/**
 * Two catalogues, one interface: the public one when it answers, ours when
 * it does not.
 *
 * Acceptance case 9 ("catalogue down, with no payment attempted") is the
 * reason this exists, and the reason it fails the way it does: when *both*
 * sources fail there is no silent empty list, because an empty list and
 * "nobody could tell me" are different facts, and a caller that cannot tell
 * them apart will eventually report the wrong one to a person. It throws
 * `CatalogUnavailable` carrying both failures instead.
 *
 * @throws AgentPassError `CatalogUnavailable` when neither source answered.
 */
export function withCatalogFallback(options: FallbackOptions): CatalogSource {
  const { primary, fallback, onFallback } = options;
  return {
    sourceId: `${primary.sourceId}+${fallback.sourceId}`,
    async search(query: string): Promise<readonly ServiceCandidate[]> {
      try {
        return await primary.search(query);
      } catch (primaryError) {
        onFallback?.(primaryError);
        try {
          return await fallback.search(query);
        } catch (fallbackError) {
          throw new AgentPassError("CatalogUnavailable", "no catalogue could answer this search", {
            cause: primaryError,
            details: {
              primary: { source: primary.sourceId, message: String(primaryError) },
              fallback: { source: fallback.sourceId, message: String(fallbackError) },
            },
          });
        }
      }
    },
  };
}

/**
 * A `fetch` that gives up after `timeoutMs` instead of hanging.
 *
 * Deliberately applied here and not inside `createX402Catalog`: that adapter
 * also sits on the *purchase* path, where changing when a call gives up
 * changes payment behaviour, and this hito has no business doing that.
 * Discovery is a read with no consequences, so it is where an unbounded wait
 * gets fixed first. The purchase path's own missing timeout is noted, not
 * changed.
 */
export function fetchWithTimeout(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  return async (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/** What a discovery call waits before deciding the catalogue is not there. */
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 5_000;
