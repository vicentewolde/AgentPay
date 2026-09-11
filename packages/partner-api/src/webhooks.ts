/**
 * The webhook contract: event names, the envelope every event ships in, and
 * the signing scheme — `PLATAFORMA-PARTNERS.md` §2.7's "firmados con secreto
 * por endpoint, con timestamp y ventana de replay de cinco minutos", made
 * concrete. Published now, ahead of T49, specifically to unblock T48: that
 * ticket builds the *delivery* worker (POST, backoff, retries), and needs a
 * shape and a signature to deliver — it does not need, and this file does
 * not define, *when* a given event fires. That decision stays wherever the
 * mandate/payment logic that would trigger it lives (T49 or later), per
 * `PLATAFORMA-PARTNERS.md` § 6.1: Codex builds the mechanical *how*, never
 * the *when* of something this security-relevant.
 *
 * `data` is deliberately `z.record(z.string(), z.unknown())` rather than a
 * per-event schema: `mandate.*` events could be typed today against
 * `mandateResourceSchema`, but `payment.*` events describe a resource F7
 * (generic commerce) has not designed yet. Freezing four of seven event
 * payloads now and leaving three as `unknown` would be a worse contract than
 * freezing the envelope and letting every payload firm up when the code that
 * emits it is built.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const WEBHOOK_EVENT_TYPES = [
  "mandate.activated",
  "mandate.revoked",
  "mandate.expiring",
  "payment.authorized",
  "payment.refused",
  "payment.settled",
  "agent.retired",
] as const;

export const webhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);

export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

export const webhookEventSchema = z.strictObject({
  id: z.string().min(1),
  type: webhookEventTypeSchema,
  created_at: z.iso.datetime(),
  data: z.record(z.string(), z.unknown()),
});

export type WebhookEvent = z.infer<typeof webhookEventSchema>;

/** Carries the signature; the timestamp is signed over, not carried separately, so a header cannot be swapped without invalidating it. */
export const WEBHOOK_SIGNATURE_HEADER = "agentpay-signature";

/** `PLATAFORMA-PARTNERS.md` §2.7: "ventana de replay de cinco minutos". */
export const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * `AgentPay-Signature: t=<unix ms>,v1=<hex hmac>` — modelled on Stripe's
 * webhook header, a shape partner integrators are likely to already have
 * tooling for. `v1` signs `${t}.${rawBody}`, so a timestamp cannot be
 * replayed against a different signature or vice versa.
 */
export function signWebhookPayload(secret: string, timestampMs: number, rawBody: string): string {
  const signature = createHmac("sha256", secret).update(`${timestampMs}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestampMs},v1=${signature}`;
}

export type WebhookVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "malformed-header" | "bad-signature" | "stale-timestamp" };

/**
 * Verifies a received webhook: the header parses, the HMAC matches, and the
 * timestamp is inside the replay window relative to `now`. All three must
 * hold — a valid signature over a five-minute-old timestamp is still a
 * replay, and a fresh timestamp with a wrong signature is still a forgery.
 */
export function verifyWebhookSignature(
  secret: string,
  header: string,
  rawBody: string,
  now: number = Date.now(),
): WebhookVerification {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (match?.[1] === undefined || match[2] === undefined) return { ok: false, reason: "malformed-header" };

  const timestampMs = Number(match[1]);
  const expected = createHmac("sha256", secret).update(`${timestampMs}.${rawBody}`, "utf8").digest("hex");

  const provided = Buffer.from(match[2], "hex");
  const wanted = Buffer.from(expected, "hex");
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    return { ok: false, reason: "bad-signature" };
  }

  if (Math.abs(now - timestampMs) > WEBHOOK_REPLAY_WINDOW_MS) return { ok: false, reason: "stale-timestamp" };

  return { ok: true };
}
