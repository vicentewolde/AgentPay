import { describe, expect, it } from "vitest";

import { hasErrorCode } from "@agentpass/core";

import { COMMANDS, isCommand, run, usage } from "./index.js";

describe("@agentpass/cli", () => {
  it("prints usage listing every command when asked for help", async () => {
    const output = await run(["--help"]);

    expect(output).toBe(usage());
    for (const command of COMMANDS) {
      expect(output).toContain(`agentpass ${command}`);
    }
  });

  it("recognises exactly the four documented commands", () => {
    expect(COMMANDS).toEqual(["issue", "verify", "revoke", "status"]);
    expect(isCommand("issue")).toBe(true);
    expect(isCommand("anchor")).toBe(false);
  });

  it("surfaces the sdk's typed error through the cli → sdk → core chain", async () => {
    await expect(run(["status", "deadbeef"])).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "NotImplemented"),
    );
  });
});
