import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import type { AgentPassCredential, CredentialRequest } from "@agentpass/core";
import {
  AGENTPASS_CREDENTIAL_TYPE,
  AGENTPASS_STATUS_TYPE,
  AgentPassError,
  VC_CONTEXT_V2,
  credentialRequestSchema,
  stellarAddressSchema,
  stellarAddressToDid,
} from "@agentpass/core";
import { configFromEnv, createAgentPass } from "@agentpass/sdk";
import { z } from "zod";

import type { CliIO } from "../io.js";
import { requireIssuerKeypair } from "./shared.js";

const DEFAULT_VALID_DAYS = 90;
const USAGE = "agentpass issue --subject <G...> --scope <file.json> [--out <file>] [--valid-days <n>]";

interface IssueArgs {
  readonly subject: string;
  readonly scopePath: string;
  readonly out: string | undefined;
  readonly validDays: number;
}

function parseIssueArgs(argv: readonly string[]): IssueArgs {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        subject: { type: "string" },
        scope: { type: "string" },
        out: { type: "string" },
        "valid-days": { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (error) {
    throw new AgentPassError("InvalidArguments", "could not parse arguments for issue", {
      cause: error,
      details: { usage: USAGE },
    });
  }

  const { subject, scope, out } = values;
  const validDaysRaw = values["valid-days"];

  if (typeof subject !== "string") {
    throw new AgentPassError("InvalidArguments", "--subject is required", { details: { usage: USAGE } });
  }
  if (typeof scope !== "string") {
    throw new AgentPassError("InvalidArguments", "--scope is required", { details: { usage: USAGE } });
  }

  const subjectParsed = stellarAddressSchema.safeParse(subject);
  if (!subjectParsed.success) {
    throw new AgentPassError(
      "InvalidArguments",
      "--subject must be a Stellar account address (G...), not a DID or a secret key",
      { details: { subject } },
    );
  }

  let validDays = DEFAULT_VALID_DAYS;
  if (typeof validDaysRaw === "string") {
    const parsedDays = Number(validDaysRaw);
    if (!Number.isInteger(parsedDays) || parsedDays <= 0) {
      throw new AgentPassError("InvalidArguments", "--valid-days must be a positive integer", {
        details: { value: validDaysRaw },
      });
    }
    validDays = parsedDays;
  }

  return {
    subject: subjectParsed.data,
    scopePath: scope,
    out: typeof out === "string" ? out : undefined,
    validDays,
  };
}

/**
 * The `--scope` file supplies everything about the agent except `id` (the
 * `--subject`) and `principal` (always the issuer, in this pilot) — see
 * `credentialRequestSchema` in `@agentpass/core`.
 */
async function readScopeFile(path: string): Promise<CredentialRequest> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new AgentPassError("InvalidArguments", `could not read ${path}`, {
      cause: error,
      details: { path },
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new AgentPassError("InvalidArguments", `${path} is not valid JSON`, {
      cause: error,
      details: { path },
    });
  }

  const parsed = credentialRequestSchema.safeParse(json);
  if (!parsed.success) {
    throw new AgentPassError(
      "InvalidArguments",
      `${path} does not match the expected shape — see docs/credential-schema.md`,
      { details: { path, issues: z.treeifyError(parsed.error) } },
    );
  }
  return parsed.data;
}

export async function runIssue(
  argv: readonly string[],
  env: Record<string, string>,
  io: CliIO,
): Promise<void> {
  const { subject, scopePath, out, validDays } = parseIssueArgs(argv);
  const issuer = requireIssuerKeypair(env);
  const request = await readScopeFile(scopePath);

  const agentpass = await createAgentPass(configFromEnv(env));

  const issuerDid = stellarAddressToDid(issuer.publicKey(), "testnet");
  const now = new Date();
  const validUntil = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);

  const credential: AgentPassCredential = {
    "@context": [VC_CONTEXT_V2],
    type: ["VerifiableCredential", AGENTPASS_CREDENTIAL_TYPE],
    issuer: issuerDid,
    validFrom: now.toISOString(),
    validUntil: validUntil.toISOString(),
    credentialSubject: {
      id: stellarAddressToDid(subject, "testnet"),
      agent: request.agent,
      principal: issuerDid,
      scope: request.scope,
    },
    credentialStatus: { type: AGENTPASS_STATUS_TYPE, registry: agentpass.config.contractId },
  };

  const issued = await agentpass.issue({ credential, issuer });

  const summary = [
    `hash              ${issued.hash}`,
    `subject           ${subject}`,
    `agent             ${request.agent.name}`,
    `validUntil        ${credential.validUntil}`,
    `transactionHash   ${issued.transactionHash}`,
  ].join("\n");

  if (out !== undefined) {
    await writeFile(out, `${issued.jws}\n`, "utf8");
    io.stdout(`Wrote ${out}\n\n${summary}\n`);
  } else {
    io.stdout(`${issued.jws}\n`);
    io.stderr(`${summary}\n`);
  }
}
