/**
 * The identifiers this directory hands out.
 *
 * Every id is a ULID behind a three-letter prefix that names its kind, so an
 * id read out of a log, a URL or an error's `details` says what it is without
 * a lookup. The prefix is not decoration: mixing up a partner id and a tenant
 * id in a query that scopes access is exactly the class of bug the prefix
 * makes visible at a glance.
 *
 * A ULID, not `randomUUID()`, because these ids sort by creation time
 * lexicographically, which is what a cursor-paginated list endpoint needs
 * (`PLATAFORMA-PARTNERS.md` §2.7). Sortability is to the millisecond; two ids
 * minted in the same millisecond sort arbitrarily relative to each other, and
 * nothing here relies on the stricter monotonic guarantee the ULID spec makes
 * optional.
 *
 * Implemented rather than taken from a package: it is thirty lines of a
 * fully-specified format, and the alternative is a dependency in the path
 * that mints the identity of every partner and tenant.
 */
import { randomBytes } from "node:crypto";

import { AgentPassError } from "@agentpass/core";

/**
 * Crockford's base32: no `I`, `L`, `O` or `U`, so an id cannot be misread
 * between `1/I/L`, `0/O`, or turn into a word by accident.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

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
    out = CROCKFORD[remaining % 32] + out;
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
  for (const byte of bytes) out += CROCKFORD[byte % 32];
  return out;
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

/** What each kind of entity's id is prefixed with. */
export const ID_PREFIXES = {
  partner: "ptn",
  apiKey: "apk",
  principal: "prc",
  binding: "bnd",
  agent: "agt",
  credential: "crd",
  mandate: "mdt",
  consentSession: "cns",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ULID_PATTERN = new RegExp(`^[${CROCKFORD}]{${ULID_LENGTH}}$`);

export function newId(kind: IdKind, now?: number): string {
  return `${ID_PREFIXES[kind]}_${ulid(now)}`;
}

export function isId(kind: IdKind, value: string): boolean {
  const prefix = `${ID_PREFIXES[kind]}_`;
  return value.startsWith(prefix) && ULID_PATTERN.test(value.slice(prefix.length));
}

/**
 * A tenant id is `<partner id>:<ULID>` — `D4`/`C-25`, replacing the
 * `sha256(wallet address)` of T34.
 *
 * The partner is *inside* the id rather than only in a column because this
 * value is what scopes a tenant's rows in `vault_records`, and the failure it
 * has to make impossible is one wallet used with two partners landing on one
 * shared vault. Two partners cannot produce the same tenant id, whatever
 * their users do with their wallets.
 */
export function newTenantId(partnerId: string, now?: number): string {
  if (!isId("partner", partnerId)) {
    throw new AgentPassError("InvalidArguments", "a tenant id must be built on a well-formed partner id", {
      details: { partnerId },
    });
  }
  return `${partnerId}:${ulid(now)}`;
}

export interface ParsedTenantId {
  readonly tenantId: string;
  readonly partnerId: string;
}

/**
 * Reads the partner back out of a tenant id.
 *
 * @throws AgentPassError `InvalidArguments` — a tenant id that does not parse
 * is never treated as "some tenant of an unknown partner": that would be a
 * request whose scope cannot be established, which fails closed like every
 * other ambiguity in this project.
 */
export function parseTenantId(value: string): ParsedTenantId {
  const separator = value.indexOf(":");
  if (separator === -1) {
    throw new AgentPassError("InvalidArguments", "a tenant id must be `<partner id>:<ULID>`", {
      details: { tenantId: value },
    });
  }
  const partnerId = value.slice(0, separator);
  const suffix = value.slice(separator + 1);
  if (!isId("partner", partnerId) || !ULID_PATTERN.test(suffix)) {
    throw new AgentPassError("InvalidArguments", "a tenant id must be `<partner id>:<ULID>`", {
      details: { tenantId: value },
    });
  }
  return { tenantId: value, partnerId };
}
