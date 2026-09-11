/**
 * Loads {@link ./venues.json} — the registry every venue in this repo ships
 * with — through {@link loadVenueRegistry}. Kept separate from `registry.ts`
 * itself so that module stays pure and testable against arbitrary rows,
 * with no dependency on this specific file's contents.
 */
import venueRows from "./venues.json" with { type: "json" };
import { loadVenueRegistry, type VenueRegistry } from "./registry.js";

export const DEFAULT_VENUE_REGISTRY: VenueRegistry = loadVenueRegistry(venueRows);
