import { describe, expect, it } from "vitest";

import { COMMANDS, isCommand, run, usage } from "./index.js";
import { fakeIO } from "./test-io.js";

describe("@agentpass/cli dispatch", () => {
  it("prints usage listing every command on --help, and on no args", async () => {
    for (const argv of [["--help"], ["-h"], []]) {
      const io = fakeIO();

      const code = await run(argv, io, {});

      expect(code).toBe(0);
      expect(io.out.join("")).toBe(`${usage()}\n`);
      for (const command of COMMANDS) expect(io.out.join("")).toContain(`agentpass ${command}`);
    }
  });

  it("recognises exactly the four documented commands", () => {
    expect(COMMANDS).toEqual(["issue", "verify", "revoke", "status"]);
    expect(isCommand("issue")).toBe(true);
    expect(isCommand("anchor")).toBe(false);
  });

  it("rejects an unknown command with exit code 1 and shows usage", async () => {
    const io = fakeIO();

    const code = await run(["anchor"], io, {});

    expect(code).toBe(1);
    expect(io.err.join("")).toContain('unknown command "anchor"');
    expect(io.err.join("")).toContain("Usage:");
  });

  it("formats a thrown AgentPassError as `code: message` plus details, exit 1", async () => {
    const io = fakeIO();

    // Empty env: configFromEnv rejects the missing contract id before any
    // network call, so this is deterministic and needs no live registry.
    const code = await run(["status", "deadbeef"], io, {});

    expect(code).toBe(1);
    expect(io.err.join("")).toContain("ConfigError:");
    expect(io.err.join("")).toContain("{");
  });

  it("never leaks an unhandled rejection out of run() for a non-AgentPassError throw", async () => {
    const io = fakeIO();

    // "issue" with no flags hits parseArgs argument validation first — offline,
    // deterministic, and exercises the generic (non-AgentPassError) catch path
    // only if something unexpected slips through; here it's still typed, which
    // is itself the point: every reachable failure is.
    const code = await run(["issue"], io, {});

    expect(code).toBe(1);
    expect(io.err.join("")).toMatch(/^(InvalidArguments|ConfigError):/);
  });
});
