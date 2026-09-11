/**
 * The `/v1` response envelope — the same `{ ok, code, message, details }`
 * shape `apps/web`'s `errorBody()` already returns on every route, frozen
 * into a zod schema so T46 can generate `/v1`'s OpenAPI error response from
 * it instead of hand-writing a second description of the same thing.
 */
import { isAgentPassError } from "@agentpass/core";
import { z } from "zod";

export const errorEnvelopeSchema = z.strictObject({
  ok: z.literal(false),
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown(),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** Same mapping `apps/web/src/server.ts`'s `errorBody` uses — kept in sync deliberately, not shared code, so `/v1` does not gain a runtime dependency on `apps/web`. */
export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (isAgentPassError(error)) {
    return { ok: false, code: error.code, message: error.message, details: error.details };
  }
  return { ok: false, code: "unknown", message: String(error), details: {} };
}

/** `/v1`'s success envelope wraps the resource under `data`, so every response — success or failure — is `{ ok, ... }` at the top level. */
export function successEnvelope<T>(data: T): { readonly ok: true; readonly data: T } {
  return { ok: true, data };
}
