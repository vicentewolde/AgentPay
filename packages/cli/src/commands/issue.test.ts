import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hasErrorCode } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { fakeIO } from "../test-io.js";
import { runIssue } from "./issue.js";

const VALID_SCOPE = {
  agent: { name: "compras-demo", model: "claude-sonnet-4-6", operator: "agentpass-pilot" },
  scope: {
    actions: ["catalog:read"],
    venues: [],
    assets: [],
    limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" },
  },
};

async function scopeFile(contents: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentpass-cli-issue-"));
  const path = join(dir, "scope.json");
  await writeFile(path, JSON.stringify(contents), "utf8");
  return path;
}

async function expectRejects(argv: string[], env: Record<string, string>, code: string) {
  try {
    await runIssue(argv, env, fakeIO());
    expect.unreachable(`expected ${code}`);
  } catch (error) {
    expect(hasErrorCode(error, code as never)).toBe(true);
  }
}

describe("runIssue argument validation — all offline, no registry needed", () => {
  const subject = Keypair.random().publicKey();

  it("requires --subject", async () => {
    await expectRejects(["--scope", "whatever.json"], {}, "InvalidArguments");
  });

  it("requires --scope", async () => {
    await expectRejects(["--subject", subject], {}, "InvalidArguments");
  });

  it("rejects a --subject that is not a Stellar account address", async () => {
    await expectRejects(
      ["--subject", "not-an-address", "--scope", "whatever.json"],
      {},
      "InvalidArguments",
    );
  });

  it("rejects a secret key passed as --subject, not just garbage", async () => {
    await expectRejects(
      ["--subject", Keypair.random().secret(), "--scope", "whatever.json"],
      {},
      "InvalidArguments",
    );
  });

  it("rejects a --valid-days that is not a positive integer", async () => {
    for (const validDays of ["0", "-5", "3.5", "many"]) {
      await expectRejects(
        ["--subject", subject, "--scope", "whatever.json", "--valid-days", validDays],
        {},
        "InvalidArguments",
      );
    }
  });

  it("requires ISSUER_SECRET_KEY before it ever reads the scope file", async () => {
    await expectRejects(["--subject", subject, "--scope", "/nonexistent/scope.json"], {}, "ConfigError");
  });

  it("rejects a scope file that does not exist", async () => {
    const env = { ISSUER_SECRET_KEY: Keypair.random().secret() };
    await expectRejects(["--subject", subject, "--scope", "/nonexistent/scope.json"], env, "InvalidArguments");
  });

  it("rejects a scope file that is not valid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentpass-cli-issue-"));
    const path = join(dir, "scope.json");
    await writeFile(path, "{ not json", "utf8");
    const env = { ISSUER_SECRET_KEY: Keypair.random().secret() };

    await expectRejects(["--subject", subject, "--scope", path], env, "InvalidArguments");
  });

  it("rejects a scope file missing required fields", async () => {
    const path = await scopeFile({ agent: VALID_SCOPE.agent });
    const env = { ISSUER_SECRET_KEY: Keypair.random().secret() };

    await expectRejects(["--subject", subject, "--scope", path], env, "InvalidArguments");
  });

  it("rejects a scope file that already carries id or principal — those are not the file's job", async () => {
    const path = await scopeFile({ ...VALID_SCOPE, id: subject });
    const env = { ISSUER_SECRET_KEY: Keypair.random().secret() };

    await expectRejects(["--subject", subject, "--scope", path], env, "InvalidArguments");
  });

  it("accepts a well-formed scope file and gets as far as needing the registry", async () => {
    // No live registry here, so this must fail — but only once past every
    // offline check, confirming they all passed.
    const path = await scopeFile(VALID_SCOPE);
    const env = { ISSUER_SECRET_KEY: Keypair.random().secret() };

    await expectRejects(["--subject", subject, "--scope", path], env, "ConfigError");
  });
});
