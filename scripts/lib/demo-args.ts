/**
 * Argument parsing for `pnpm demo`, pulled out of `demo.ts` so it can be
 * tested without touching testnet — the same split every other script under
 * `scripts/` follows: orchestration at the top level, testable logic in `lib/`.
 */
import { parseArgs } from "node:util";

import { AgentPassError } from "@agentpass/core";

export const DEFAULT_INSTRUCTION = "Comprame un mate de calabaza curado, por favor.";

export interface DemoArgs {
  readonly adapter: "mock";
  readonly instruction: string;
}

/**
 * @throws AgentPassError `InvalidArguments` for anything `node:util`'s parser
 * itself rejects.
 * @throws AgentPassError `NotImplemented` for any `--adapter` other than
 * `mock` — `bazaar` is T15, blocked on the ambassador's answers, and this is
 * the seam the roadmap's acceptance criterion names: swapping adapters must
 * not require touching this file or anything upstream of it.
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
      details: { usage: 'pnpm demo [--adapter=mock] ["instruccion en espanol"]' },
    });
  }

  if (values.adapter !== "mock") {
    throw new AgentPassError(
      "NotImplemented",
      `--adapter=${String(values.adapter)} lands in T15, against the ambassador's real bazaar`,
      { details: { adapter: values.adapter, milestone: "T15" } },
    );
  }

  return {
    adapter: "mock",
    instruction: positionals.length > 0 ? positionals.join(" ") : DEFAULT_INSTRUCTION,
  };
}
