import { describe, expect, it } from "vitest";

import { hasErrorCode } from "@agentpass/core";

import { ID_PREFIXES, ULID_LENGTH, isId, newId, newTenantId, parseTenantId, ulid } from "./ids.js";

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;

describe("ulid", () => {
  it("is 26 characters of Crockford base32", () => {
    const value = ulid();
    expect(value).toHaveLength(ULID_LENGTH);
    expect(value).toMatch(CROCKFORD);
  });

  it("never contains the letters Crockford excludes", () => {
    // The whole reason for this alphabet: I/L look like 1, O looks like 0,
    // and U is excluded so an id cannot spell an unfortunate word.
    const sample = Array.from({ length: 200 }, () => ulid()).join("");
    for (const letter of ["I", "L", "O", "U"]) expect(sample).not.toContain(letter);
  });

  it("sorts lexicographically by creation time", () => {
    const earlier = ulid(new Date("2026-01-01T00:00:00.000Z").getTime());
    const later = ulid(new Date("2026-09-10T00:00:00.000Z").getTime());
    expect(earlier < later).toBe(true);
  });

  it("encodes the same millisecond into the same time component", () => {
    const at = new Date("2026-09-10T12:34:56.789Z").getTime();
    expect(ulid(at).slice(0, 10)).toBe(ulid(at).slice(0, 10));
  });

  it("does not repeat its random component", () => {
    const at = Date.now();
    const values = new Set(Array.from({ length: 1000 }, () => ulid(at)));
    expect(values.size).toBe(1000);
  });

  it("refuses a timestamp outside the 48-bit range", () => {
    expect.assertions(2);
    try {
      ulid(2 ** 48);
    } catch (error) {
      expect(hasErrorCode(error, "InvalidArguments")).toBe(true);
      expect((error as { details: { milliseconds: number } }).details.milliseconds).toBe(2 ** 48);
    }
  });
});

describe("newId / isId", () => {
  it("prefixes each kind distinctly", () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("recognises its own ids and rejects another kind's", () => {
    const partner = newId("partner");
    expect(isId("partner", partner)).toBe(true);
    expect(isId("agent", partner)).toBe(false);
  });

  it("rejects a well-formed id of the right kind with a mangled body", () => {
    // `I` is not in the alphabet, so this is not a ULID even though it is
    // the right length behind the right prefix.
    expect(isId("partner", `${ID_PREFIXES.partner}_${"I".repeat(ULID_LENGTH)}`)).toBe(false);
  });

  it("rejects a bare ULID with no prefix", () => {
    expect(isId("partner", ulid())).toBe(false);
  });
});

describe("newTenantId / parseTenantId", () => {
  it("carries the partner inside the tenant id", () => {
    const partnerId = newId("partner");
    const tenantId = newTenantId(partnerId);
    expect(parseTenantId(tenantId)).toEqual({ tenantId, partnerId });
  });

  it("gives two partners different tenant ids even in the same millisecond", () => {
    const at = Date.now();
    const a = newTenantId(newId("partner"), at);
    const b = newTenantId(newId("partner"), at);
    expect(a).not.toBe(b);
    expect(parseTenantId(a).partnerId).not.toBe(parseTenantId(b).partnerId);
  });

  it("refuses to build a tenant id on something that is not a partner id", () => {
    expect(() => newTenantId(newId("agent"))).toThrowError();
    expect(() => newTenantId("ptn_short")).toThrowError();
  });

  it("fails closed on a tenant id it cannot parse", () => {
    // A request whose scope cannot be established is refused, not guessed at.
    for (const bad of ["", "no-separator", "ptn_x:y", `${newId("partner")}:`, `:${ulid()}`]) {
      expect(() => parseTenantId(bad), bad).toThrowError();
    }
  });

  it("reports the failure as InvalidArguments, not a raw Error", () => {
    expect.assertions(1);
    try {
      parseTenantId("nonsense");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidArguments")).toBe(true);
    }
  });
});
