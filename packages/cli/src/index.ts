import { isAgentPassError } from "@agentpass/core";

import { runIssue } from "./commands/issue.js";
import { runRevoke } from "./commands/revoke.js";
import { runStatus } from "./commands/status.js";
import { runVerify } from "./commands/verify.js";
import type { CliIO } from "./io.js";

export const COMMANDS = ["issue", "verify", "revoke", "status"] as const;

export type Command = (typeof COMMANDS)[number];

export function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

export function usage(): string {
  return [
    "agentpass — AgentPass credentials on Stellar testnet",
    "",
    "Usage:",
    "  agentpass issue --subject <G...> --scope <file.json> [--out <file>] [--valid-days <n>]",
    "  agentpass verify <jws|file>",
    "  agentpass revoke <hash>",
    "  agentpass status <hash>",
    "",
    "Requires .env.local — run `pnpm run bootstrap` and `pnpm run deploy:registry` first.",
  ].join("\n");
}

/**
 * Dispatches a parsed argv against an already-loaded environment.
 *
 * Returns the process exit code rather than throwing: every command error —
 * typed or not — is caught here, once, so no command has to duplicate the
 * formatting. `io` is a seam for tests; `bin.ts` wires it to the real streams.
 */
export async function run(
  argv: readonly string[],
  io: CliIO,
  env: Record<string, string>,
): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    io.stdout(`${usage()}\n`);
    return 0;
  }

  if (!isCommand(command)) {
    io.stderr(`unknown command "${command}"\n\n${usage()}\n`);
    return 1;
  }

  try {
    switch (command) {
      case "issue":
        await runIssue(rest, env, io);
        break;
      case "verify":
        await runVerify(rest, env, io);
        break;
      case "revoke":
        await runRevoke(rest, env, io);
        break;
      case "status":
        await runStatus(rest, env, io);
        break;
    }
    return 0;
  } catch (error) {
    if (isAgentPassError(error)) {
      io.stderr(`${error.code}: ${error.message}\n`);
      if (Object.keys(error.details).length > 0) {
        io.stderr(`${JSON.stringify(error.details, null, 2)}\n`);
      }
    } else {
      io.stderr(`Unexpected failure: ${String(error)}\n`);
    }
    return 1;
  }
}
