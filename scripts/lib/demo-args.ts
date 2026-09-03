/**
 * Argument parsing for `pnpm demo`, pulled out of `demo.ts` so it can be
 * tested without touching testnet — the same split every other script under
 * `scripts/` follows: orchestration at the top level, testable logic in `lib/`.
 */
import { parseArgs } from "node:util";

import { AgentPassError } from "@agentpass/core";

export const DEFAULT_INSTRUCTION = "Comprame un mate de calabaza curado, por favor.";

/** Matches "Swap Risk Quote" — the cheapest real product the bazaar lists (0.001 USDC). */
export const DEFAULT_BAZAAR_INSTRUCTION = "Comprame un Swap Risk Quote, por favor.";

const ADAPTERS = ["mock", "bazaar"] as const;
export type DemoAdapter = (typeof ADAPTERS)[number];

export interface DemoArgs {
  readonly adapter: DemoAdapter;
  readonly instruction: string;
}

function isDemoAdapter(value: string): value is DemoAdapter {
  return (ADAPTERS as readonly string[]).includes(value);
}

/**
 * @throws AgentPassError `InvalidArguments` for anything `node:util`'s parser
 * itself rejects, or for an `--adapter` this demo does not know about.
 */
export function parseDemoArgs(argv: readonly string[]): DemoArgs {
  let values: { adapter?: string };
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: { adapter: { type: "string", default: "mock" } },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    throw new AgentPassError("InvalidArguments", "could not parse arguments for demo", {
      cause: error,
      details: { usage: 'pnpm demo [--adapter=mock|bazaar] ["instruccion en espanol"]' },
    });
  }

  const adapterValue = values.adapter ?? "mock";
  if (!isDemoAdapter(adapterValue)) {
    throw new AgentPassError("InvalidArguments", `unknown --adapter "${adapterValue}"`, {
      details: { adapter: adapterValue, supported: ADAPTERS },
    });
  }

  const defaultInstruction = adapterValue === "bazaar" ? DEFAULT_BAZAAR_INSTRUCTION : DEFAULT_INSTRUCTION;

  return {
    adapter: adapterValue,
    instruction: positionals.length > 0 ? positionals.join(" ") : defaultInstruction,
  };
}
