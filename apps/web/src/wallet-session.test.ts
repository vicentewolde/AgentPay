import { randomUUID } from "node:crypto";

import { newId, newTenantId } from "@agentpey/directory";
import { describe, expect, it } from "vitest";

import { SESSION_COOKIE, challengeMessage, isValidSessionId, parseCookies } from "./wallet-session.js";

describe("parseCookies", () => {
  it("returns nothing for a request with no cookie header", () => {
    expect(parseCookies(undefined).size).toBe(0);
  });

  it("reads one cookie among several", () => {
    const cookies = parseCookies(`other=1; ${SESSION_COOKIE}=abc; last=2`);
    expect(cookies.get(SESSION_COOKIE)).toBe("abc");
  });

  it("decodes percent-encoded values", () => {
    expect(parseCookies("k=a%20b").get("k")).toBe("a b");
  });

  it("skips malformed pairs instead of throwing", () => {
    const cookies = parseCookies("novalue; =noname; good=yes");
    expect(cookies.get("good")).toBe("yes");
    expect(cookies.has("")).toBe(false);
  });
});

describe("isValidSessionId", () => {
  // This is what stops a forged cookie from being used as somebody else's
  // identity when reading, writing or rehydrating their rows.
  it("accepts a classic-path id (randomUUID)", () => {
    expect(isValidSessionId(randomUUID())).toBe(true);
  });

  it("accepts a wallet-path id — a real @agentpey/directory tenant id, since T39 (`C-25`/`D4`)", () => {
    expect(isValidSessionId(newTenantId(newId("partner")))).toBe(true);
  });

  it("rejects anything that is not shaped like either", () => {
    for (const forged of [
      undefined,
      "",
      "../../etc/passwd",
      "'; drop table vault_records; --",
      "not-a-uuid",
      `${randomUUID()}extra`,
      `${randomUUID()} `,
      "ptn_short:short", // right prefix, wrong-length ULIDs
      newId("partner"), // a partner id alone is not a tenant id — needs the ":<ULID>" half too
    ]) {
      expect(isValidSessionId(forged)).toBe(false);
    }
  });
});

describe("challengeMessage", () => {
  it("carries the nonce, so a signature proves which challenge was answered", () => {
    const nonce = randomUUID();
    expect(challengeMessage(nonce)).toContain(nonce);
  });

  it("is the brand the user reads inside their wallet", () => {
    expect(challengeMessage("n")).toContain("AgentPey");
  });
});
