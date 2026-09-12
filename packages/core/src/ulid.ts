/**
 * ULID minting, shared.
 *
 * This lived in `@agentpey/directory` until T79, where it mints the identity
 * of every partner and tenant. It moved here when a second, deliberately
 * *unrelated* service needed it: SignalDesk (`apps/signaldesk`) is a merchant,
 * not part of AgentPey, and it must not depend on the payment platform's
 * tenant database just to number its own deliveries. `@agentpass/core` is the
 * neutral base both can sit on. The directory re-exports it, so nothing that
 * imported it from there had to change.
 *
 * A ULID, not `randomUUID()`, because these ids sort by creation time
 * lexicographically, which is what a cursor-paginated listing needs.
 * Sortability is to the millisecond; two ids minted in the same millisecond
 * sort arbitrarily relative to each other, and nothing relies on the stricter
 * monotonic guarantee the ULID spec makes optional.
 *
 * Implemented rather than taken from a package: it is thirty lines of a
 * fully-specified format, and the alternative is a dependency in the path that
 * mints identity.
 */
import { randomBytes } from "node:crypto";

import { AgentPassError } from "./errors.js";

/**
 * Crockford's base32: no `I`, `L`, `O` or `U`, so an id cannot be misread
 * between `1/I/L`, `0/O`, or turn into a word by accident.
 */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
export const ULID_LENGTH = TIME_LENGTH + RANDOM_LENGTH;

/** The largest timestamp a 10-character Crockford time component can hold. */
const MAX_ULID_TIME = 2 ** 48 - 1;

function encodeTime(milliseconds: number): string {
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > MAX_ULID_TIME) {
    throw new AgentPassError("InvalidArguments", `a ULID timestamp must be an integer in [0, ${MAX_ULID_TIME}]`, {
      details: { milliseconds },
    });
  }
  let remaining = milliseconds;
  let out = "";
  for (let i = 0; i < TIME_LENGTH; i += 1) {
    out = CROCKFORD_ALPHABET[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

/**
 * `byte % 32` is uniform here and not a modulo bias: 256 is exactly eight
 * times 32, so every symbol is reachable from exactly eight byte values.
 */
function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LENGTH);
  let out = "";
  for (const byte of bytes) out += CROCKFORD_ALPHABET[byte % 32];
  return out;
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}
