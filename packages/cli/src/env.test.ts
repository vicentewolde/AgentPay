import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadCliEnv } from "./env.js";

async function tempDirWith(contents?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentpass-cli-env-"));
  if (contents !== undefined) await writeFile(join(dir, ".env.local"), contents, "utf8");
  return dir;
}

describe("loadCliEnv", () => {
  it("returns an empty-ish map (just process.env) when .env.local is missing", async () => {
    const dir = await tempDirWith();

    const env = await loadCliEnv(dir);

    expect(env["AGENTPASS_CLI_ENV_TEST_MARKER"]).toBeUndefined();
  });

  it("reads quoted values, including ones containing spaces and a semicolon", async () => {
    const dir = await tempDirWith('STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"\n');

    const env = await loadCliEnv(dir);

    expect(env["STELLAR_NETWORK_PASSPHRASE"]).toBe("Test SDF Network ; September 2015");
  });

  it("skips comments and blank lines", async () => {
    const dir = await tempDirWith(['# a comment', '', 'A="1"'].join("\n"));

    const env = await loadCliEnv(dir);

    expect(env["A"]).toBe("1");
  });

  it("lets an explicit process.env value win over the file", async () => {
    const dir = await tempDirWith('AGENTPASS_CLI_ENV_TEST_MARKER="from-file"\n');
    process.env["AGENTPASS_CLI_ENV_TEST_MARKER"] = "from-shell";

    try {
      const env = await loadCliEnv(dir);
      expect(env["AGENTPASS_CLI_ENV_TEST_MARKER"]).toBe("from-shell");
    } finally {
      delete process.env["AGENTPASS_CLI_ENV_TEST_MARKER"];
    }
  });
});
