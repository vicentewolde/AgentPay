/**
 * The exact idempotency semantics for `/v1`, as a pure decision — not a
 * store. `PLATAFORMA-PARTNERS.md` §2.7: every `POST` that creates state
 * requires `Idempotency-Key`; the same key replays the first response
 * instead of creating a second thing; the same key with a different body is
 * a caller bug, refused rather than guessed at.
 *
 * `resolveIdempotency` takes an injected `lookup` (whatever ends up backing
 * `(partner_id, key) → response`, not decided by T45) and a `now`, and
 * returns one of two outcomes. Storing the response after a fresh `"proceed"`
 * is the caller's job — this function only ever reads.
 */
import { createHash } from "node:crypto";

import { AgentPassError } from "@agentpass/core";
import { z } from "zod";

/** Case-sensitive per HTTP, but Node lower-cases incoming header names. */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/** `PLATAFORMA-PARTNERS.md` §2.7: "vencimiento de 24 h". */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const idempotencyRecordSchema = z.strictObject({
  partnerId: z.string().min(1),
  key: z.string().min(1).max(255),
  /** `sha256` of the canonicalised request body — what "the same body" means. */
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** The HTTP status the first call answered with, replayed verbatim. */
  responseStatus: z.number().int().min(200).max(599),
  responseBody: z.unknown(),
  createdAt: z.date(),
});

export type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>;

export type IdempotencyLookup = (partnerId: string, key: string) => Promise<IdempotencyRecord | undefined>;

export type IdempotencyOutcome =
  | { readonly kind: "proceed" }
  | { readonly kind: "replay"; readonly record: IdempotencyRecord };

/**
 * Canonical JSON: keys sorted at every level, so `{a:1,b:2}` and `{b:2,a:1}`
 * hash identically. Arrays keep their order — order is part of their meaning.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, canonicalize(entryValue)]));
  }
  return value;
}

export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(body)), "utf8").digest("hex");
}

export interface ResolveIdempotencyInput {
  readonly partnerId: string;
  /** The raw `Idempotency-Key` header value, if the caller sent one. */
  readonly idempotencyKeyHeader: string | undefined;
  readonly body: unknown;
  readonly lookup: IdempotencyLookup;
  readonly now?: Date;
}

/**
 * @throws AgentPassError `IdempotencyKeyRequired` — the header is missing or
 * blank, on a route where T45 requires it.
 * @throws AgentPassError `IdempotencyKeyConflict` — the same key was already
 * used, within its TTL, for a request with a different body.
 */
export async function resolveIdempotency(input: ResolveIdempotencyInput): Promise<IdempotencyOutcome> {
  const key = input.idempotencyKeyHeader?.trim();
  if (key === undefined || key.length === 0) {
    throw new AgentPassError("IdempotencyKeyRequired", "this route requires an Idempotency-Key header");
  }

  const existing = await input.lookup(input.partnerId, key);
  if (existing === undefined) return { kind: "proceed" };

  const now = input.now ?? new Date();
  const expiresAt = new Date(existing.createdAt.getTime() + IDEMPOTENCY_TTL_MS);
  if (now.getTime() >= expiresAt.getTime()) return { kind: "proceed" };

  const requestHash = hashRequestBody(input.body);
  if (requestHash !== existing.requestHash) {
    throw new AgentPassError("IdempotencyKeyConflict", "this Idempotency-Key was already used with a different request body", {
      details: { key },
    });
  }

  return { kind: "replay", record: existing };
}
