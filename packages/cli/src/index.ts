import { notImplemented } from "@agentpass/sdk";

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
    "  agentpass issue --subject <G...> --scope <file.json>",
    "  agentpass verify <jws|file>",
    "  agentpass revoke <hash>",
    "  agentpass status <hash>",
  ].join("\n");
}

/**
 * Dispatches a parsed argv. Command bodies land in T8; today every command
 * defers to the sdk, which raises `AgentPassError` with code `NotImplemented`.
 */
export async function run(argv: readonly string[]): Promise<string> {
  const [command] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    return usage();
  }

  if (!isCommand(command)) {
    return notImplemented(`unknown command "${command}"`);
  }

  return notImplemented(`command ${command}`);
}
