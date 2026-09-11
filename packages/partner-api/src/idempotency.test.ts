import { describe, expect, it, vi } from "vitest";

import { canonicalize, hashRequestBody, IDEMPOTENCY_TTL_MS, resolveIdempotency, type IdempotencyRecord } from "./idempotency.js";

describe("canonicalize / hashRequestBody", () => {
  it("hashes two objects with the same fields in different key order identically", () => {
    const a = { external_ref: "usr_1", label: "Vinny" };
    const b = { label: "Vinny", external_ref: "usr_1" };
    expect(hashRequestBody(a)).toBe(hashRequestBody(b));
  });

  it("keeps array order significant", () => {
    const a = { venues: ["a", "b"] };
    const b = { venues: ["b", "a"] };
    expect(hashRequestBody(a)).not.toBe(hashRequestBody(b));
  });

  it("hashes a different body to a different value", () => {
    expect(hashRequestBody({ external_ref: "usr_1" })).not.toBe(hashRequestBody({ external_ref: "usr_2" }));
  });

  it("canonicalize leaves primitives untouched", () => {
    expect(canonicalize(null)).toBe(null);
    expect(canonicalize(42)).toBe(42);
    expect(canonicalize("x")).toBe("x");
  });
});

function fakeRecord(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return {
    partnerId: "ptn_1",
    key: "req-1",
    requestHash: hashRequestBody({ external_ref: "usr_1" }),
    responseStatus: 201,
    responseBody: { ok: true, data: { id: "tnt_1" } },
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    ...overrides,
  };
}

describe("resolveIdempotency", () => {
  it("throws IdempotencyKeyRequired when the header is missing", async () => {
    const lookup = vi.fn();
    await expect(
      resolveIdempotency({ partnerId: "ptn_1", idempotencyKeyHeader: undefined, body: {}, lookup }),
    ).rejects.toEqual(expect.objectContaining({ code: "IdempotencyKeyRequired" }));
    expect(lookup).not.toHaveBeenCalled();
  });

  it("throws IdempotencyKeyRequired when the header is blank", async () => {
    const lookup = vi.fn();
    await expect(
      resolveIdempotency({ partnerId: "ptn_1", idempotencyKeyHeader: "   ", body: {}, lookup }),
    ).rejects.toEqual(expect.objectContaining({ code: "IdempotencyKeyRequired" }));
  });

  it("proceeds when no record exists yet for this key", async () => {
    const lookup = vi.fn().mockResolvedValue(undefined);
    const outcome = await resolveIdempotency({
      partnerId: "ptn_1",
      idempotencyKeyHeader: "req-1",
      body: { external_ref: "usr_1" },
      lookup,
    });
    expect(outcome).toEqual({ kind: "proceed" });
    expect(lookup).toHaveBeenCalledWith("ptn_1", "req-1");
  });

  it("replays the stored response when the same key repeats the same body", async () => {
    const record = fakeRecord();
    const lookup = vi.fn().mockResolvedValue(record);
    const outcome = await resolveIdempotency({
      partnerId: "ptn_1",
      idempotencyKeyHeader: "req-1",
      body: { external_ref: "usr_1" },
      lookup,
      now: new Date("2026-09-10T01:00:00.000Z"),
    });
    expect(outcome).toEqual({ kind: "replay", record });
  });

  it("throws IdempotencyKeyConflict when the same key repeats with a different body", async () => {
    const record = fakeRecord();
    const lookup = vi.fn().mockResolvedValue(record);
    await expect(
      resolveIdempotency({
        partnerId: "ptn_1",
        idempotencyKeyHeader: "req-1",
        body: { external_ref: "usr_2" },
        lookup,
        now: new Date("2026-09-10T01:00:00.000Z"),
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "IdempotencyKeyConflict" }));
  });

  it("treats an expired record as if it did not exist, even with a different body", async () => {
    const record = fakeRecord();
    const lookup = vi.fn().mockResolvedValue(record);
    const justAfterExpiry = new Date(record.createdAt.getTime() + IDEMPOTENCY_TTL_MS + 1);
    const outcome = await resolveIdempotency({
      partnerId: "ptn_1",
      idempotencyKeyHeader: "req-1",
      body: { external_ref: "usr_2" },
      lookup,
      now: justAfterExpiry,
    });
    expect(outcome).toEqual({ kind: "proceed" });
  });
});
