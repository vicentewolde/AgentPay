import { describe, expect, it } from "vitest";

import { signWebhookPayload, verifyWebhookSignature, webhookEventSchema, WEBHOOK_REPLAY_WINDOW_MS } from "./webhooks.js";

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({ id: "evt_1", type: "mandate.activated", created_at: "2026-09-10T00:00:00.000Z", data: {} });

describe("webhookEventSchema", () => {
  it("accepts every frozen event type with an arbitrary data payload", () => {
    for (const type of ["mandate.activated", "payment.settled", "agent.retired"] as const) {
      const result = webhookEventSchema.safeParse({
        id: "evt_1",
        type,
        created_at: "2026-09-10T00:00:00.000Z",
        data: { anything: "goes" },
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an event type outside the frozen list", () => {
    expect(webhookEventSchema.safeParse({ id: "evt_1", type: "mandate.deleted", created_at: "2026-09-10T00:00:00.000Z", data: {} }).success).toBe(false);
  });
});

describe("signWebhookPayload / verifyWebhookSignature", () => {
  it("verifies a signature it just produced", () => {
    const now = Date.parse("2026-09-10T00:00:00.000Z");
    const header = signWebhookPayload(SECRET, now, BODY);
    expect(verifyWebhookSignature(SECRET, header, BODY, now)).toEqual({ ok: true });
  });

  it("rejects a signature from the wrong secret", () => {
    const now = Date.parse("2026-09-10T00:00:00.000Z");
    const header = signWebhookPayload("wrong-secret", now, BODY);
    expect(verifyWebhookSignature(SECRET, header, BODY, now)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a signature over a body that was tampered with after signing", () => {
    const now = Date.parse("2026-09-10T00:00:00.000Z");
    const header = signWebhookPayload(SECRET, now, BODY);
    expect(verifyWebhookSignature(SECRET, header, `${BODY} `, now)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a malformed header outright", () => {
    expect(verifyWebhookSignature(SECRET, "not-a-signature-header", BODY).ok).toBe(false);
  });

  it("rejects a signature replayed outside the five-minute window, even though it is genuine", () => {
    const signedAt = Date.parse("2026-09-10T00:00:00.000Z");
    const header = signWebhookPayload(SECRET, signedAt, BODY);
    const tooLate = signedAt + WEBHOOK_REPLAY_WINDOW_MS + 1;
    expect(verifyWebhookSignature(SECRET, header, BODY, tooLate)).toEqual({ ok: false, reason: "stale-timestamp" });
  });

  it("accepts a signature right at the edge of the replay window", () => {
    const signedAt = Date.parse("2026-09-10T00:00:00.000Z");
    const header = signWebhookPayload(SECRET, signedAt, BODY);
    const edge = signedAt + WEBHOOK_REPLAY_WINDOW_MS;
    expect(verifyWebhookSignature(SECRET, header, BODY, edge)).toEqual({ ok: true });
  });
});
