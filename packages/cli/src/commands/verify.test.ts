import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { fakeIO } from "../test-io.js";
import { runVerify } from "./verify.js";

async function expectRejects(argv: string[], env: Record<string, string>, code: string) {
  try {
    await runVerify(argv, env, fakeIO());
    expect.unreachable(`expected ${code}`);
  } catch (error) {
    expect(hasErrorCode(error, code as never)).toBe(true);
  }
}

describe("runVerify — offline argument handling", () => {
  it("requires a positional argument", async () => {
    await expectRejects([], {}, "InvalidArguments");
  });

  it("rejects input that is neither a compact JWS nor a readable file", async () => {
    await expectRejects(["not-a-jws-and-not-a-file"], {}, "InvalidArguments");
    await expectRejects(["/nonexistent/credential.jws"], {}, "InvalidArguments");
  });

  it("accepts something JWS-shaped and gets as far as needing the registry", async () => {
    // Not a real signature — but shaped like one, so it clears resolveJws and
    // fails on the missing registry config instead, confirming the shape check
    // ran and passed.
    await expectRejects(["aGVhZGVy.cGF5bG9hZA.c2ln"], {}, "ConfigError");
  });
});
