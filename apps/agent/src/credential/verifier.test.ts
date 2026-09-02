import type { AgentPass } from "@agentpass/sdk";
import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { createStubVerifier, makeTestCredential } from "../testing/credentials.js";
import { checkOwnCredential, type CredentialVerifier } from "./verifier.js";

describe("the port is narrow on purpose", () => {
  /**
   * Compile-time, not runtime: the real SDK satisfies the port as-is, so the
   * agent can be handed an `AgentPass` without an adapter — while the port
   * itself exposes no way to issue, revoke or register anything. If `verify`
   * ever changed shape in the SDK, this stops building.
   */
  it("AgentPass from the SDK satisfies CredentialVerifier", () => {
    const conforms = (agentPass: AgentPass): CredentialVerifier => agentPass;

    expect(typeof conforms).toBe("function");
  });

  it("exposes exactly one method", async () => {
    const verifier = createStubVerifier();

    expect(Object.keys(verifier)).toEqual(["verify"]);
  });
});

describe("checkOwnCredential", () => {
  it("returns a state rather than throwing, for every verification outcome", async () => {
    const credential = await makeTestCredential();

    const active = await checkOwnCredential(createStubVerifier(), credential.jws);
    const revoked = await checkOwnCredential(
      createStubVerifier({ status: "Revoked" }),
      credential.jws,
    );

    expect(active.usable).toBe(true);
    expect(revoked.usable).toBe(false);
    expect(active.hash).toBe(credential.hash);
    expect(revoked.hash).toBe(credential.hash);
  });

  it("computes the hash from the document it holds, even when unverifiable", async () => {
    const state = await checkOwnCredential(createStubVerifier(), "garbage");

    expect(state.usable).toBe(false);
    expect(state.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws ConfigError when handed no credential at all", async () => {
    for (const empty of ["", undefined, null]) {
      await expect(
        checkOwnCredential(createStubVerifier(), empty as unknown as string),
      ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "ConfigError"));
    }
  });

  it("passes the injected clock through to the validity-window check", async () => {
    const credential = await makeTestCredential({
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-02-01T00:00:00.000Z",
    });

    const inside = await checkOwnCredential(createStubVerifier(), credential.jws, {
      now: new Date("2026-01-15T00:00:00.000Z"),
    });
    const after = await checkOwnCredential(createStubVerifier(), credential.jws, {
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(inside.usable).toBe(true);
    expect(after.usable).toBe(false);
    if (after.usable) expect.unreachable("expected the window to have closed");
    expect(after.problem.code).toBe("CredentialExpired");
  });
});
