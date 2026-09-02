import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { AgentPassError } from "@agentpass/core";
import { configFromEnv, createAgentPass } from "@agentpass/sdk";

import type { CliIO } from "../io.js";

const USAGE = "agentpass verify <jws|file>";

/** A compact JWS is exactly three dot-separated base64url segments. */
const JWS_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

async function resolveJws(input: string): Promise<string> {
  if (JWS_SHAPE.test(input)) return input;

  try {
    return (await readFile(input, "utf8")).trim();
  } catch (error) {
    throw new AgentPassError(
      "InvalidArguments",
      `"${input}" is neither a compact JWS nor a readable file`,
      { cause: error, details: { input } },
    );
  }
}

export async function runVerify(
  argv: readonly string[],
  env: Record<string, string>,
  io: CliIO,
): Promise<void> {
  const { positionals } = parseArgs({ args: [...argv], allowPositionals: true, strict: true });
  const [input] = positionals;
  if (input === undefined) {
    throw new AgentPassError("InvalidArguments", "a JWS or file path is required", {
      details: { usage: USAGE },
    });
  }

  const jws = await resolveJws(input);
  const agentpass = await createAgentPass(configFromEnv(env));
  const verified = await agentpass.verify(jws);

  io.stdout(
    `${[
      `status            ${verified.status}`,
      `hash              ${verified.hash}`,
      `issuer            ${verified.issuerAddress}`,
      `subject           ${verified.credential.credentialSubject.id}`,
      `agent             ${verified.credential.credentialSubject.agent.name}`,
      `validUntil        ${verified.credential.validUntil}`,
    ].join("\n")}\n`,
  );
}
