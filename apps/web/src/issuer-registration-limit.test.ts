import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { createIssuerRegistrationLimiter } from "./issuer-registration-limit.js";

describe("createIssuerRegistrationLimiter", () => {
  it("allows exactly maxPerWindow calls, then refuses the next one", () => {
    const limiter = createIssuerRegistrationLimiter({ maxPerWindow: 3, windowMs: 60_000, clock: () => 1_000 });

    limiter.consume();
    limiter.consume();
    limiter.consume();

    expect(() => limiter.consume()).toThrow();
    try {
      limiter.consume();
      expect.unreachable("must have thrown");
    } catch (error) {
      expect(hasErrorCode(error, "IssuerRegistrationRateLimited")).toBe(true);
    }
  });

  it("frees up a slot once the oldest consumption falls outside the window", () => {
    let now = 0;
    const limiter = createIssuerRegistrationLimiter({ maxPerWindow: 2, windowMs: 1_000, clock: () => now });

    now = 0;
    limiter.consume();
    now = 100;
    limiter.consume();
    expect(() => limiter.consume()).toThrow();

    // The first consumption (at t=0) is now outside a 1000ms window from t=1001.
    now = 1_001;
    expect(() => limiter.consume()).not.toThrow();
  });

  it("never counts a wallet that was already a registered issuer — checked at the call site, not here", () => {
    // The limiter itself has no notion of "already registered"; this is a
    // guard against a misreading of the module, not a behavior of the
    // limiter — every call to consume() counts, always. The exemption for
    // an already-registered wallet lives in ensureWalletIsRegisteredIssuer,
    // which only calls consume() when it is about to actually register one.
    const limiter = createIssuerRegistrationLimiter({ maxPerWindow: 1, windowMs: 60_000, clock: () => 0 });
    limiter.consume();
    expect(() => limiter.consume()).toThrow();
  });

  it("reports how many milliseconds until a slot frees up", () => {
    let now = 0;
    const limiter = createIssuerRegistrationLimiter({ maxPerWindow: 1, windowMs: 1_000, clock: () => now });
    limiter.consume();
    now = 400;
    try {
      limiter.consume();
      expect.unreachable("must have thrown");
    } catch (error) {
      if (!hasErrorCode(error, "IssuerRegistrationRateLimited")) throw error;
      expect(error.details.retryAfterMs).toBe(600);
    }
  });
});
