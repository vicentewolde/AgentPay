import { hasErrorCode } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { fakeIO } from "../test-io.js";
import { runRevoke } from "./revoke.js";

async function expectRejects(argv: string[], env: Record<string, string>, code: string) {
  try {
    await runRevoke(argv, env, fakeIO());
    expect.unreachable(`expected ${code}`);
  } catch (error) {
    expect(hasErrorCode(error, code as never)).toBe(true);
  }
}

describe("runRevoke — offline argument handling", () => {
  it("requires a positional hash", async () => {
    await expectRejects([], {}, "InvalidArguments");
  });

  it("requires ISSUER_SECRET_KEY before touching the registry", async () => {
    await expectRejects(["deadbeef"], {}, "ConfigError");
  });

  it("rejects a malformed ISSUER_SECRET_KEY rather than an opaque crash", async () => {
    await expectRejects(["deadbeef"], { ISSUER_SECRET_KEY: "not-a-real-seed" }, "ConfigError");
  });

  it("gets as far as needing the registry once the issuer key is valid", async () => {
    const env = { ISSUER_SECRET_KEY: Keypair.random().secret() };
    await expectRejects(["deadbeef"], env, "ConfigError");
  });
});
