import { parseArgs } from "node:util";

import { AgentPassError } from "@agentpass/core";
import { configFromEnv, createAgentPass } from "@agentpass/sdk";

import type { CliIO } from "../io.js";

const USAGE = "agentpass status <hash>";

export async function runStatus(
  argv: readonly string[],
  env: Record<string, string>,
  io: CliIO,
): Promise<void> {
  const { positionals } = parseArgs({ args: [...argv], allowPositionals: true, strict: true });
  const [hash] = positionals;
  if (hash === undefined) {
    throw new AgentPassError("InvalidArguments", "a credential hash is required", {
      details: { usage: USAGE },
    });
  }

  const agentpass = await createAgentPass(configFromEnv(env));
  const status = await agentpass.status(hash);

  io.stdout(`${status}\n`);
}
