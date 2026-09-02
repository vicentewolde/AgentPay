import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { fakeIO } from "../test-io.js";
import { runStatus } from "./status.js";

describe("runStatus — offline argument handling", () => {
  it("requires a positional hash", async () => {
    try {
      await runStatus([], {}, fakeIO());
      expect.unreachable("expected InvalidArguments");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidArguments")).toBe(true);
    }
  });

  it("fails on missing registry config before any network call", async () => {
    try {
      await runStatus(["deadbeef"], {}, fakeIO());
      expect.unreachable("expected ConfigError");
    } catch (error) {
      expect(hasErrorCode(error, "ConfigError")).toBe(true);
    }
  });
});
