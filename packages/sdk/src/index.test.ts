import { describe, expect, it } from "vitest";

import { AgentPassError, hasErrorCode } from "@agentpass/core";

import { issue, notImplemented } from "./index.js";

describe("@agentpass/sdk", () => {
  it("raises core's typed error across the package boundary", () => {
    try {
      notImplemented("issue");
      expect.unreachable("notImplemented must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPassError);
      expect(hasErrorCode(error, "NotImplemented")).toBe(true);
    }
  });

  it("rejects rather than resolving undefined from unwired surfaces", async () => {
    await expect(issue()).rejects.toThrow(AgentPassError);
  });
});
