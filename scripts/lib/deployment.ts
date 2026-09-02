import { readFile, writeFile } from "node:fs/promises";

import { AgentPassError, stellarAddressSchema, stellarContractIdSchema } from "@agentpass/core";
import { z } from "zod";

import { TESTNET } from "./network.js";

export const agentRegistryDeploymentSchema = z.strictObject({
  contractId: stellarContractIdSchema,
  /** SHA-256 of the deployed wasm, hex — the same value Stellar keys uploads by. */
  wasmHash: z.string().regex(/^[0-9a-f]{64}$/),
  admin: stellarAddressSchema,
  schemaVersion: z.number().int().nonnegative(),
  deployedAt: z.iso.datetime(),
  /** The network's protocol version at deploy time. */
  protocolVersion: z.number().int().positive(),
});

export const deploymentSchema = z.strictObject({
  network: z.literal("testnet"),
  networkPassphrase: z.string().min(1),
  rpcUrl: z.string().min(1),
  protocolVersion: z.number().int().positive().nullable(),
  agentRegistry: agentRegistryDeploymentSchema.nullable(),
});

export type Deployment = z.infer<typeof deploymentSchema>;
export type AgentRegistryDeployment = z.infer<typeof agentRegistryDeploymentSchema>;

export const EMPTY_DEPLOYMENT: Deployment = {
  network: "testnet",
  networkPassphrase: TESTNET.passphrase,
  rpcUrl: TESTNET.rpcUrl,
  protocolVersion: null,
  agentRegistry: null,
};

export async function readDeployment(path: string): Promise<Deployment> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_DEPLOYMENT;
    throw new AgentPassError("ConfigError", `could not read ${path}`, {
      cause: error,
      details: { path },
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new AgentPassError("ConfigError", `${path} is not valid JSON`, {
      cause: error,
      details: { path },
    });
  }

  const parsed = deploymentSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new AgentPassError("ConfigError", `${path} does not match the deployment schema`, {
      details: { path, issues: z.treeifyError(parsed.error) },
    });
  }
  return parsed.data;
}

export async function writeDeployment(path: string, deployment: Deployment): Promise<void> {
  // Validate on the way out too: this file is the only artefact the TypeScript
  // and Rust halves of the repo share, so a malformed write is expensive.
  const parsed = deploymentSchema.safeParse(deployment);
  if (!parsed.success) {
    throw new AgentPassError("ConfigError", "refusing to write a malformed deployment record", {
      details: { issues: z.treeifyError(parsed.error) },
    });
  }

  await writeFile(path, `${JSON.stringify(parsed.data, null, 2)}\n`, "utf8");
}
