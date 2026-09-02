import { describe, expect, it } from "vitest";

import { formatEnvLine, parseEnv, readEnvFile } from "./env-file.js";

describe("parseEnv", () => {
  it("skips blanks and comments, and takes everything after the first =", () => {
    const parsed = parseEnv(
      ['# a comment', '', 'A="one"', "B=two", "export C=three", "D=has=equals"].join("\n"),
    );

    expect(Object.fromEntries(parsed)).toEqual({
      A: "one",
      B: "two",
      C: "three",
      D: "has=equals",
    });
  });

  it("keeps a passphrase containing spaces and a semicolon intact", () => {
    const passphrase = "Test SDF Network ; September 2015";
    const parsed = parseEnv(formatEnvLine("STELLAR_NETWORK_PASSPHRASE", passphrase));

    expect(parsed.get("STELLAR_NETWORK_PASSPHRASE")).toBe(passphrase);
  });

  it("round-trips values that need escaping", () => {
    for (const value of ['quote " inside', "back \\ slash", 'both \\ and "', "", "  padded  "]) {
      const parsed = parseEnv(formatEnvLine("K", value));
      expect(parsed.get("K")).toBe(value);
    }
  });
});

describe("readEnvFile", () => {
  it("treats a missing file as empty rather than failing", async () => {
    await expect(readEnvFile("/nonexistent/agentpass/.env.local")).resolves.toEqual(new Map());
  });
});
