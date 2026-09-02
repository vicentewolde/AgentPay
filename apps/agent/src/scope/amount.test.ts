import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { fromScaledAmount, multiplyAmount, toScaledAmount } from "./amount.js";

describe("toScaledAmount", () => {
  it.each([
    ["0", 0n],
    ["0.0000001", 1n],
    ["1", 10_000_000n],
    ["1.5", 15_000_000n],
    ["18.50", 185_000_000n],
    ["50.00", 500_000_000n],
    ["0.1", 1_000_000n],
    ["9999999999.9999999", 99_999_999_999_999_999n],
  ])("scales %s exactly", (value, expected) => {
    expect(toScaledAmount(value)).toBe(expected);
  });

  it.each([
    ["negative", "-1.00"],
    ["over seven decimals", "1.12345678"],
    ["padded", " 1.00"],
    ["trailing space", "1.00 "],
    ["empty", ""],
    ["not a number", "cincuenta"],
    ["leading zeros", "01.00"],
    ["a bare dot", "1."],
    ["scientific notation", "5e1"],
    ["a thousands separator", "1,000.00"],
  ])("rejects %s with InvalidAmount", (_label, value) => {
    try {
      toScaledAmount(value);
      expect.unreachable("expected toScaledAmount to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidAmount")).toBe(true);
    }
  });
});

describe("fromScaledAmount", () => {
  it("round-trips every representable amount", () => {
    for (const value of ["0", "0.0000001", "1", "18.50", "50.00", "220.00", "9999999.1234567"]) {
      expect(fromScaledAmount(toScaledAmount(value))).toBe(
        fromScaledAmount(toScaledAmount(fromScaledAmount(toScaledAmount(value)))),
      );
      expect(toScaledAmount(fromScaledAmount(toScaledAmount(value)))).toBe(toScaledAmount(value));
    }
  });

  it("always renders seven decimal places", () => {
    expect(fromScaledAmount(toScaledAmount("18.5"))).toBe("18.5000000");
    expect(fromScaledAmount(0n)).toBe("0.0000000");
  });
});

describe("multiplyAmount", () => {
  /**
   * The reason amounts are strings and the arithmetic is integer. In floating
   * point, 0.1 * 3 is 0.30000000000000004 and 22.00 * 10 is 220.00000000000003
   * — either of which can push a total across a limit it did not actually
   * cross, or keep it under one it did.
   */
  it("computes totals a float would get wrong", () => {
    expect(fromScaledAmount(multiplyAmount("0.1", 3))).toBe("0.3000000");
    expect(0.1 * 3).not.toBe(0.3);

    expect(fromScaledAmount(multiplyAmount("22.00", 10))).toBe("220.0000000");
    expect(fromScaledAmount(multiplyAmount("1.15", 3))).toBe("3.4500000");
    expect(fromScaledAmount(multiplyAmount("0.0000001", 7))).toBe("0.0000007");
  });

  it("stays exact past the safe-integer range, where Number would not", () => {
    const total = multiplyAmount("9999999.9999999", 1_000_000);

    expect(fromScaledAmount(total)).toBe("9999999999999.9000000");
    expect(total).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it("treats a zero quantity as a zero total", () => {
    expect(fromScaledAmount(multiplyAmount("18.50", 0))).toBe("0.0000000");
  });

  it.each([
    ["a fractional quantity", 1.5],
    ["a negative quantity", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["an unsafe integer", Number.MAX_SAFE_INTEGER + 2],
  ])("rejects %s with InvalidAmount", (_label, quantity) => {
    try {
      multiplyAmount("1.00", quantity);
      expect.unreachable("expected multiplyAmount to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidAmount")).toBe(true);
    }
  });
});
