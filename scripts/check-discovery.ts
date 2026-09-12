#!/usr/bin/env node
/**
 * Asks both discovery catalogues what they have, and prints what survived
 * (T78).
 *
 * Strictly read-only, and deliberately shows the part that matters most: for
 * every candidate, whether `venues.json` vouches for it. A row the public
 * catalogue advertises and the registry does not know prints as
 * `unregistered` — which is the whole point, not a warning. It is what a
 * purchase would refuse before making a single network call to that host.
 *
 * Run with `pnpm run check:discovery`.
 */
import {
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_VENUE_REGISTRY,
  createAgentPeyDiscovery,
  createPeriploCatalog,
  createX402Catalog,
  fetchWithTimeout,
  withCatalogFallback,
  type CatalogSource,
  type ServiceCandidate,
} from "@agentpey/agent";

const query = process.argv[2] ?? "*";
const timedFetch = fetchWithTimeout(fetch, DEFAULT_DISCOVERY_TIMEOUT_MS);

const periplo = createPeriploCatalog({ registry: DEFAULT_VENUE_REGISTRY, fetchImpl: timedFetch });

const agentpey = createAgentPeyDiscovery({
  registry: DEFAULT_VENUE_REGISTRY,
  catalogFor: (venueId) =>
    createX402Catalog({ venueId, registry: DEFAULT_VENUE_REGISTRY, fetchImpl: timedFetch }),
  onVenueError: (venueId, error) => {
    console.log(`  ! ${venueId} did not answer: ${error instanceof Error ? error.message : "unknown error"}`);
  },
});

function render(candidates: readonly ServiceCandidate[]): void {
  if (candidates.length === 0) {
    console.log("  (nothing)");
    return;
  }
  for (const candidate of candidates) {
    const vouched = candidate.registered ? `registered → ${candidate.venueId}` : "unregistered → not payable";
    console.log(`  ${candidate.resourceUrl}`);
    console.log(`    ${vouched}`);
    if (candidate.productId !== undefined) console.log(`    product: ${candidate.productId}`);
  }
}

async function report(label: string, source: CatalogSource): Promise<void> {
  console.log(`\n${label} (query: ${query})`);
  try {
    render(await source.search(query));
  } catch (error) {
    console.log(`  unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

await report("periplo — the public catalogue", periplo);
await report("agentpey — our own index over venues.json", agentpey);

await report(
  "fallback with periplo unreachable",
  withCatalogFallback({
    primary: createPeriploCatalog({
      baseUrl: "https://periplo-testnet.invalid",
      registry: DEFAULT_VENUE_REGISTRY,
      fetchImpl: timedFetch,
    }),
    fallback: agentpey,
    onFallback: () => console.log("  (periplo failed; falling back to our own index)"),
  }),
);
