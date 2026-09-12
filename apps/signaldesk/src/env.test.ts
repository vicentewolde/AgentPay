import { describe, expect, it } from "vitest";

import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  /**
   * The bug this test exists for: this repo writes `KEY="value"`, and a reader
   * that kept the quotes handed a 58-character string to `Keypair.fromSecret`,
   * which rejected it as a malformed seed. Found by running the real smoke
   * purchase, not by reading the code.
   */
  it("strips the quotes this repo writes its .env.local with", () => {
    const parsed = parseEnv('SIGNALDESK_SECRET_KEY="SABC"\nPLAIN=value\n');

    expect(parsed.get("SIGNALDESK_SECRET_KEY")).toBe("SABC");
    expect(parsed.get("PLAIN")).toBe("value");
  });

  it("handles single quotes, escapes and `export`", () => {
    const parsed = parseEnv([`SINGLE='value'`, `ESCAPED="a\\"b"`, `export EXPORTED="x"`].join("\n"));

    expect(parsed.get("SINGLE")).toBe("value");
    expect(parsed.get("ESCAPED")).toBe('a"b');
    expect(parsed.get("EXPORTED")).toBe("x");
  });

  it("skips comments, blanks and lines that are not assignments", () => {
    const parsed = parseEnv(["# a comment", "", "not an assignment", "KEY=value"].join("\n"));

    expect([...parsed.keys()]).toEqual(["KEY"]);
  });

  it("keeps a value that contains an equals sign intact", () => {
    expect(parseEnv('DATABASE_URL="postgres://u:p@h/db?x=1&y=2"').get("DATABASE_URL")).toBe(
      "postgres://u:p@h/db?x=1&y=2",
    );
  });
});
