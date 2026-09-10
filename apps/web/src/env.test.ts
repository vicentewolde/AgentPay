import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isAgentPassError } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { readEnv, readEnvFile, requireEnv, requireSecretKey, unquoteEnvValue } from "./env.js";

async function writeEnvFile(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentpay-env-"));
  const path = join(dir, ".env.local");
  await writeFile(path, contents, "utf8");
  return path;
}

describe("unquoteEnvValue", () => {
  it("leaves a bare value alone", () => {
    expect(unquoteEnvValue("plain")).toBe("plain");
  });

  it("strips matching double or single quotes", () => {
    expect(unquoteEnvValue('"quoted"')).toBe("quoted");
    expect(unquoteEnvValue("'quoted'")).toBe("quoted");
  });

  it("unescapes only inside double quotes, the way a shell does", () => {
    expect(unquoteEnvValue('"a \\"b\\" c"')).toBe('a "b" c');
    expect(unquoteEnvValue("'a \\\"b\\\" c'")).toBe('a \\"b\\" c');
  });

  it("does not strip mismatched or one-sided quotes", () => {
    expect(unquoteEnvValue("\"unbalanced")).toBe('"unbalanced');
    expect(unquoteEnvValue("'mixed\"")).toBe("'mixed\"");
  });
});

describe("readEnvFile", () => {
  it("returns an empty map when the file does not exist, rather than throwing", async () => {
    const env = await readEnvFile(join(tmpdir(), "agentpay-does-not-exist", ".env.local"));
    expect(env.size).toBe(0);
  });

  it("reads keys, skipping comments and blank lines", async () => {
    const path = await writeEnvFile('# a comment\n\nFOO="bar"\nBAZ=qux\n');
    const env = await readEnvFile(path);
    expect(env.get("FOO")).toBe("bar");
    expect(env.get("BAZ")).toBe("qux");
    expect(env.size).toBe(2);
  });

  it("accepts the `export KEY=value` form", async () => {
    const env = await readEnvFile(await writeEnvFile('export FOO="bar"\n'));
    expect(env.get("FOO")).toBe("bar");
  });

  it("keeps a value that itself contains an equals sign", async () => {
    const env = await readEnvFile(await writeEnvFile('DATABASE_URL="postgres://u:p@h/db?sslmode=require"\n'));
    expect(env.get("DATABASE_URL")).toBe("postgres://u:p@h/db?sslmode=require");
  });
});

describe("readEnv", () => {
  // How the same code runs both locally (.env.local on disk) and on Render
  // (config injected straight into the process).
  it("falls back to process.env for keys the file does not have", async () => {
    const path = await writeEnvFile('FROM_FILE="file"\n');
    const env = await readEnv(path, { FROM_PROCESS: "process" });
    expect(env.get("FROM_FILE")).toBe("file");
    expect(env.get("FROM_PROCESS")).toBe("process");
  });

  it("lets the file win over process.env for the same key", async () => {
    const path = await writeEnvFile('SHARED="from-file"\n');
    const env = await readEnv(path, { SHARED: "from-process" });
    expect(env.get("SHARED")).toBe("from-file");
  });

  it("works with no file at all, as on a host that only sets process.env", async () => {
    const env = await readEnv(join(tmpdir(), "agentpay-missing", ".env.local"), { ONLY: "process" });
    expect(env.get("ONLY")).toBe("process");
  });
});

describe("requireEnv", () => {
  it("returns the value when it is set", () => {
    expect(requireEnv(new Map([["KEY", "value"]]), "KEY")).toBe("value");
  });

  it("refuses a missing key with a ConfigError that names it", () => {
    try {
      requireEnv(new Map(), "ADMIN_SECRET_KEY");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAgentPassError(error)).toBe(true);
      if (!isAgentPassError(error)) return;
      expect(error.code).toBe("ConfigError");
      expect(error.message).toContain("ADMIN_SECRET_KEY");
    }
  });

  // An env var set to "" is how a host represents "declared but never filled
  // in" — the shape the first Render failure actually took.
  it("treats an empty string as missing, not as a value", () => {
    expect(() => requireEnv(new Map([["KEY", ""]]), "KEY")).toThrow(/missing/);
  });
});

describe("requireSecretKey", () => {
  it("returns the keypair for a real secret seed", () => {
    const keypair = Keypair.random();
    const env = new Map([["ISSUER_SECRET_KEY", keypair.secret()]]);
    expect(requireSecretKey(env, "ISSUER_SECRET_KEY").publicKey()).toBe(keypair.publicKey());
  });

  // The exact production failure: the admin's *public* key pasted where the
  // secret belongs. The SDK's own error ("invalid version byte. expected 144,
  // got 48") names neither the variable nor the fix.
  it("refuses a public key with an error naming the variable and what it needs", () => {
    const env = new Map([["ADMIN_SECRET_KEY", Keypair.random().publicKey()]]);
    try {
      requireSecretKey(env, "ADMIN_SECRET_KEY");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAgentPassError(error)).toBe(true);
      if (!isAgentPassError(error)) return;
      expect(error.code).toBe("ConfigError");
      expect(error.message).toContain("ADMIN_SECRET_KEY");
      expect(error.message).toContain("S...");
      expect(error.message).not.toContain("version byte");
      expect(error.details).toMatchObject({ key: "ADMIN_SECRET_KEY", startsWith: "G..." });
    }
  });

  it("refuses any other malformed value the same way", () => {
    const env = new Map([["AGENT_SECRET_KEY", "not-a-key-at-all"]]);
    expect(() => requireSecretKey(env, "AGENT_SECRET_KEY")).toThrow(/AGENT_SECRET_KEY/);
  });

  it("never puts the offending value in the error it throws", () => {
    const secretish = "SNOTAVALIDSECRETBUTLOOKSLIKEONE12345678901234567890123";
    const env = new Map([["ISSUER_SECRET_KEY", secretish]]);
    try {
      requireSecretKey(env, "ISSUER_SECRET_KEY");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(JSON.stringify(isAgentPassError(error) ? error.details : {})).not.toContain(secretish);
    }
  });

  it("still refuses a missing key, not just a malformed one", () => {
    expect(() => requireSecretKey(new Map(), "ADMIN_SECRET_KEY")).toThrow(/missing/);
  });
});
