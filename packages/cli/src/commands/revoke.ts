import { parseArgs } from "node:util";

import { AgentPassError } from "@agentpass/core";
import { configFromEnv, createAgentPass } from "@agentpass/sdk";

import type { CliIO } from "../io.js";
import { requireIssuerKeypair } from "./shared.js";

const USAGE = "agentpass revoke <hash>";

export async function runRevoke(
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

  const issuer = requireIssuerKeypair(env);

  const agentpass = await createAgentPass(configFromEnv(env));
  const transactionHash = await agentpass.revoke({ credentialHash: hash, issuer });

  io.stdout(`revoked           ${hash}\ntransactionHash   ${transactionHash}\n`);
}
