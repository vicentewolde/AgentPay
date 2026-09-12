import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { requireAllowedReturnUrl, returnOriginSchema, returnOriginsSchema } from "./return-urls.js";

const ALLOWED = ["https://realops.example", "https://agentpey-realops.onrender.com"];

function refusalFor(url: string, origins: readonly string[] = ALLOWED): unknown {
  try {
    requireAllowedReturnUrl(url, origins);
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("returnOriginSchema", () => {
  it("accepts a bare origin, with or without a trailing slash", () => {
    expect(returnOriginSchema.safeParse("https://realops.example").success).toBe(true);
    expect(returnOriginSchema.safeParse("https://realops.example/").success).toBe(true);
    expect(returnOriginSchema.safeParse("http://localhost:4040").success).toBe(true);
  });

  it("refuses anything carrying a path, a query or a fragment", () => {
    for (const value of [
      "https://realops.example/volver",
      "https://realops.example?x=1",
      "https://realops.example#x",
    ]) {
      expect(returnOriginSchema.safeParse(value).success).toBe(false);
    }
  });

  it("refuses a non-http scheme and a non-URL", () => {
    expect(returnOriginSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(returnOriginSchema.safeParse("realops.example").success).toBe(false);
  });

  it("caps how many origins a partner can register", () => {
    expect(returnOriginsSchema.safeParse(Array.from({ length: 11 }, () => "https://a.example")).success).toBe(false);
  });
});

describe("requireAllowedReturnUrl", () => {
  it("allows any path under a registered origin", () => {
    for (const url of [
      "https://realops.example",
      "https://realops.example/agentes/rag_1",
      "https://realops.example/agentes/rag_1?firmado=1",
    ]) {
      expect(requireAllowedReturnUrl(url, ALLOWED)).toBe(url);
    }
  });

  /**
   * The attack this exists for. A prefix or suffix comparison accepts each of
   * these, and each of them is a different host.
   */
  it("refuses a lookalike host, however it is dressed up", () => {
    for (const url of [
      "https://realops.example.attacker.test/volver",
      "https://realops.example-attacker.test/volver",
      "https://attacker.test/realops.example",
      "https://notrealops.example/volver",
    ]) {
      expect(hasErrorCode(refusalFor(url), "ReturnUrlNotAllowed")).toBe(true);
    }
  });

  /**
   * `https://realops.example@attacker.test` has origin `https://attacker.test`
   * — the credentials are the trick, and the refusal has to happen before any
   * comparison rather than after parsing them away.
   */
  it("refuses a URL that smuggles the allowed host into credentials", () => {
    expect(hasErrorCode(refusalFor("https://realops.example@attacker.test/volver"), "ReturnUrlNotAllowed")).toBe(true);
    expect(hasErrorCode(refusalFor("https://user:pass@realops.example/volver"), "ReturnUrlNotAllowed")).toBe(true);
  });

  it("treats a different scheme or port as a different origin", () => {
    expect(hasErrorCode(refusalFor("http://realops.example/volver"), "ReturnUrlNotAllowed")).toBe(true);
    expect(hasErrorCode(refusalFor("https://realops.example:8443/volver"), "ReturnUrlNotAllowed")).toBe(true);
  });

  it("refuses a scheme that is not a redirect at all", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>1</script>", "/relativo"]) {
      expect(hasErrorCode(refusalFor(url), "ReturnUrlNotAllowed")).toBe(true);
    }
  });

  /** An empty allowlist allows nothing — the `B-1` reading, applied here. */
  it("refuses every URL for a partner that registered no origins", () => {
    const error = refusalFor("https://realops.example/volver", []);

    expect(hasErrorCode(error, "ReturnUrlNotAllowed")).toBe(true);
    expect((error as { details: { reason: string } }).details.reason).toBe("no-origins-registered");
  });

  it("refuses a URL too long to be one", () => {
    const error = refusalFor(`https://realops.example/${"x".repeat(3000)}`);

    expect((error as { details: { reason: string } }).details.reason).toBe("too-long");
  });

  it("tells the integrator which origin was rejected and what was allowed", () => {
    const error = refusalFor("https://attacker.test/volver") as {
      details: { origin: string; allowed: string[] };
    };

    expect(error.details.origin).toBe("https://attacker.test");
    expect(error.details.allowed).toEqual(ALLOWED);
  });

  it("keeps the four refusal reasons distinct", () => {
    const reasons = [
      refusalFor("/relativo"),
      refusalFor("https://attacker.test/x"),
      refusalFor("https://realops.example/x", []),
      refusalFor(`https://realops.example/${"x".repeat(3000)}`),
    ].map((error) => (error as { details: { reason: string } }).details.reason);

    expect(new Set(reasons).size).toBe(4);
  });
});
