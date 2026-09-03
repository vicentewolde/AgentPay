import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { checkDailyLimit, dailyLimitError } from "./check-daily-limit.js";

describe("a purchase that fits within what is left today", () => {
  it("is allowed, with the running total worked out exactly", () => {
    const decision = checkDailyLimit("200.00", "150.00", "37.00", "ScopeDailyLimitExceeded");

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) expect.unreachable("expected an allowed decision");
    expect(decision.total).toBe("187.0000000");
    expect(decision.limit).toBe("200.00");
  });

  it("allows the first purchase of the day against an empty ledger", () => {
    expect(checkDailyLimit("200.00", "0.00", "50.00", "ScopeDailyLimitExceeded").allowed).toBe(true);
  });
});

describe("the boundary is inclusive, matching every other limit in the project", () => {
  it("allows a running total that lands exactly on perDay", () => {
    expect(checkDailyLimit("200.00", "150.00", "50.00", "ScopeDailyLimitExceeded").allowed).toBe(true);
    expect(checkDailyLimit("200.00", "0.00", "200.00", "MandateDailyLimitExceeded").allowed).toBe(true);
  });

  it("refuses one unit past it", () => {
    const decision = checkDailyLimit("200.00", "150.00", "50.0000001", "ScopeDailyLimitExceeded");

    expect(decision.allowed).toBe(false);
    if (decision.allowed) expect.unreachable("expected a denial");
    expect(decision.code).toBe("ScopeDailyLimitExceeded");
  });
});

describe("the arithmetic is exact where a float would refuse a legal purchase", () => {
  it.each([
    ["0.1 + 0.1 + 0.1 against 0.3", "0.2", "0.1", "0.3"],
    ["0.07 + 0.07 + 0.07 against 0.21", "0.14", "0.07", "0.21"],
  ])("allows %s", (_label, spentToday, amount, perDay) => {
    expect(checkDailyLimit(perDay, spentToday, amount, "ScopeDailyLimitExceeded").allowed).toBe(true);
  });

  it("stays exact past the range a double can represent", () => {
    const decision = checkDailyLimit(
      "999999999.9999999",
      "0.0000000",
      "999999999.9999999",
      "MandateDailyLimitExceeded",
    );

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) expect.unreachable("expected an allowed decision");
    expect(decision.total).toBe("999999999.9999999");
  });
});

describe("the code the caller chooses is the code that comes back", () => {
  it.each([["ScopeDailyLimitExceeded"], ["MandateDailyLimitExceeded"]] as const)(
    "reports %s when that is what the caller is enforcing",
    (code) => {
      const decision = checkDailyLimit("50.00", "40.00", "20.00", code);

      if (decision.allowed) expect.unreachable("expected a denial");
      expect(decision.code).toBe(code);
    },
  );
});

describe("dailyLimitError", () => {
  it("carries the denial's code and its structured context", () => {
    const decision = checkDailyLimit("200.00", "180.00", "25.00", "ScopeDailyLimitExceeded");

    if (decision.allowed) expect.unreachable("expected a denial");
    const error = dailyLimitError(decision);

    expect(hasErrorCode(error, "ScopeDailyLimitExceeded")).toBe(true);
    expect(error.details).toMatchObject({
      spentToday: "180.00",
      amount: "25.00",
      total: "205.0000000",
      limit: "200.00",
    });
  });
});

describe("invalid amounts fail closed rather than silently", () => {
  it.each([
    ["a malformed perDay", () => checkDailyLimit("not-a-number", "0.00", "10.00", "ScopeDailyLimitExceeded")],
    ["a malformed spentToday", () => checkDailyLimit("50.00", "not-a-number", "10.00", "ScopeDailyLimitExceeded")],
    ["a malformed amount", () => checkDailyLimit("50.00", "0.00", "not-a-number", "ScopeDailyLimitExceeded")],
  ])("throws InvalidAmount for %s", (_label, run) => {
    expect(run).toThrow(expect.objectContaining({ code: "InvalidAmount" }));
  });
});
