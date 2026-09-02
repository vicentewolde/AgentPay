import { describe, expect, it } from "vitest";

import { formatEnvLine, parseEnv, readEnvFile, upsertEnvValue } from "./env-file.js";

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

describe("upsertEnvValue", () => {
  const original = [
    "# a header comment",
    "",
    'ADMIN_PUBLIC_KEY="GAAA"',
    'ADMIN_SECRET_KEY="SAAA"',
    "",
    "# written by deploy:registry",
    'AGENT_REGISTRY_CONTRACT_ID=""',
    "",
  ].join("\n");

  it("replaces one value and leaves every other line untouched", () => {
    const updated = upsertEnvValue(original, "AGENT_REGISTRY_CONTRACT_ID", "CBBB");

    expect(parseEnv(updated).get("AGENT_REGISTRY_CONTRACT_ID")).toBe("CBBB");
    expect(updated).toContain("# a header comment");
    expect(updated).toContain("# written by deploy:registry");
    expect(updated).toContain('ADMIN_SECRET_KEY="SAAA"');
    expect(updated.split("\n")).toHaveLength(original.split("\n").length);
  });

  it("appends the key when it is absent", () => {
    const updated = upsertEnvValue('A="1"\n', "B", "2");

    expect(parseEnv(updated)).toEqual(new Map([["A", "1"], ["B", "2"]]));
  });

  it("appends cleanly to a file with no trailing newline", () => {
    const updated = upsertEnvValue('A="1"', "B", "2");

    expect(updated).toBe('A="1"\nB="2"\n');
  });

  it("does not touch a key that merely shares a prefix", () => {
    const contents = ['ADMIN_PUBLIC_KEY="G1"', 'ADMIN_PUBLIC_KEY_OLD="G2"'].join("\n");

    const parsed = parseEnv(upsertEnvValue(contents, "ADMIN_PUBLIC_KEY", "G3"));

    expect(parsed.get("ADMIN_PUBLIC_KEY")).toBe("G3");
    expect(parsed.get("ADMIN_PUBLIC_KEY_OLD")).toBe("G2");
  });

  it("round-trips a value through parseEnv", () => {
    const updated = upsertEnvValue(original, "STELLAR_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");

    expect(parseEnv(updated).get("STELLAR_NETWORK_PASSPHRASE")).toBe(
      "Test SDF Network ; September 2015",
    );
  });
});
