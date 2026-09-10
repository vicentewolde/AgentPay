import { describe, expect, it } from "vitest";

import { hasErrorCode, isAgentPassError } from "@agentpass/core";

import { assertOpaqueExternalRef } from "./external-ref.js";

describe("assertOpaqueExternalRef", () => {
  it("accepts the shapes a partner's own user id actually takes", () => {
    for (const value of [
      "usr_123",
      "550e8400-e29b-41d4-a716-446655440000",
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "cloudops/workspace-7/user-42",
      "dXNyXzEyMw==",
    ]) {
      expect(assertOpaqueExternalRef(value), value).toBe(value);
    }
  });

  it("returns the value so the check cannot be run and then ignored", () => {
    expect(assertOpaqueExternalRef("usr_123")).toBe("usr_123");
  });

  it("refuses an email address", () => {
    for (const value of ["vinny@cloudops.cl", "a.b+tag@sub.example.com"]) {
      expect(() => assertOpaqueExternalRef(value), value).toThrowError();
    }
  });

  it("refuses a Chilean RUT in the shapes people type", () => {
    for (const value of ["12345678-9", "12.345.678-K", "9876543-2", "1.234.567-k"]) {
      expect(() => assertOpaqueExternalRef(value), value).toThrowError();
    }
  });

  it("refuses an unambiguous phone number", () => {
    for (const value of ["+56912345678", "+1-555-0142", "56-912-345678"]) {
      expect(() => assertOpaqueExternalRef(value), value).toThrowError();
    }
  });

  it("still accepts a bare digit run, which is an ordinary opaque id", () => {
    // Deliberately not rejected: an all-digits key is far more often a user
    // id than a phone number, and refusing it would break honest integrations
    // to catch a case the `+` and separator rules already cover.
    expect(assertOpaqueExternalRef("123456789")).toBe("123456789");
  });

  it("refuses whitespace, quotes and angle brackets", () => {
    for (const value of ["usr 123", 'usr"123', "usr<123>", "usr\n123", "usr;drop"]) {
      expect(() => assertOpaqueExternalRef(value), value).toThrowError();
    }
  });

  it("refuses an empty ref and one over 128 characters", () => {
    expect(() => assertOpaqueExternalRef("")).toThrowError();
    expect(() => assertOpaqueExternalRef("a".repeat(129))).toThrowError();
    expect(assertOpaqueExternalRef("a".repeat(128))).toHaveLength(128);
  });

  it("raises InvalidExternalRef, never a generic Error", () => {
    expect.assertions(2);
    try {
      assertOpaqueExternalRef("vinny@cloudops.cl");
    } catch (error) {
      expect(isAgentPassError(error)).toBe(true);
      expect(hasErrorCode(error, "InvalidExternalRef")).toBe(true);
    }
  });

  it("never echoes the rejected value back into the error", () => {
    // Repeating an email inside an error that will be logged is exactly the
    // leak this function exists to prevent.
    expect.assertions(3);
    const email = "vinny@cloudops.cl";
    try {
      assertOpaqueExternalRef(email);
    } catch (error) {
      const serialised = JSON.stringify({
        message: (error as Error).message,
        details: (error as { details: unknown }).details,
      });
      expect(serialised).not.toContain(email);
      expect(serialised).not.toContain("vinny");
      expect(serialised).toContain(String(email.length));
    }
  });
});
