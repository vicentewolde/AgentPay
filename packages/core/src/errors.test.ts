import { describe, expect, it } from "vitest";

import { AgentPassError, hasErrorCode, isAgentPassError } from "./index.js";

describe("AgentPassError", () => {
  it("carries a machine-readable code, details and cause", () => {
    const cause = new RangeError("underlying");
    const error = new AgentPassError("NotImplemented", "issue() is not wired yet", {
      cause,
      details: { surface: "issue" },
    });

    expect(error.code).toBe("NotImplemented");
    expect(error.name).toBe("AgentPassError");
    expect(error.details).toEqual({ surface: "issue" });
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(Error);
  });

  it("narrows through isAgentPassError and hasErrorCode", () => {
    const error: unknown = new AgentPassError("NotImplemented", "nope");

    expect(isAgentPassError(error)).toBe(true);
    expect(hasErrorCode(error, "NotImplemented")).toBe(true);
    expect(isAgentPassError(new Error("plain"))).toBe(false);
    expect(hasErrorCode(new Error("plain"), "NotImplemented")).toBe(false);
  });
});
