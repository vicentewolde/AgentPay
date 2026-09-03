import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { DEFAULT_INSTRUCTION, parseDemoArgs } from "./demo-args.js";

describe("parseDemoArgs", () => {
  it("defaults to the mock adapter and the default instruction", () => {
    expect(parseDemoArgs([])).toEqual({ adapter: "mock", instruction: DEFAULT_INSTRUCTION });
  });

  it("accepts --adapter=mock explicitly", () => {
    expect(parseDemoArgs(["--adapter=mock"]).adapter).toBe("mock");
  });

  it("joins multiple positional words into one instruction", () => {
    expect(parseDemoArgs(["Comprame", "dos", "mates"]).instruction).toBe("Comprame dos mates");
  });

  it("takes a single quoted positional as the whole instruction", () => {
    expect(parseDemoArgs(["Comprame dos mates de calabaza"]).instruction).toBe(
      "Comprame dos mates de calabaza",
    );
  });

  it("refuses an unimplemented adapter, naming T15", () => {
    try {
      parseDemoArgs(["--adapter=bazaar"]);
      expect.unreachable("expected parseDemoArgs to throw");
    } catch (error) {
      expect(hasErrorCode(error, "NotImplemented")).toBe(true);
      expect((error as { details: { milestone: string } }).details.milestone).toBe("T15");
    }
  });

  it("refuses an empty --adapter the same way as an unknown one", () => {
    try {
      parseDemoArgs(["--adapter="]);
      expect.unreachable("expected parseDemoArgs to throw");
    } catch (error) {
      expect(hasErrorCode(error, "NotImplemented")).toBe(true);
    }
  });

  it("refuses arguments node:util's parser itself rejects", () => {
    try {
      parseDemoArgs(["--unknown-flag"]);
      expect.unreachable("expected parseDemoArgs to throw");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidArguments")).toBe(true);
    }
  });
});
