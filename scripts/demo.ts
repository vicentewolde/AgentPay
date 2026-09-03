#!/usr/bin/env node
/**
 * `pnpm demo` — the phase-2 walkthrough in one command: issue a credential,
 * hand the agent a Spanish purchase instruction, get a signed intent back,
 * revoke the credential from outside the agent, and watch the identical
 * instruction fail the second time — without touching the agent, the
 * instruction, or the intent it already produced.
 *
 * Runs against real Stellar testnet for the credential: `issue()` anchors it,
 * `revoke()` cuts it. That is what makes the revocation real rather than
 * illustrated — the same reason `deploy-registry.ts` and the CLI's full
 * walkthrough (T8) also touch the network. The catalogue stays mocked
 * (`--adapter=mock`, the default and, until T15 answers the ambassador's
 * questions, the only one implemented); the phase's acceptance criterion is
 * that swapping in `--adapter=bazaar` later needs no change here.
 *
 * Everything before the first network call — argument parsing, reading
 * `.env.local`, reading the interpreted instruction — fails fast and offline,
 * the same discipline the CLI (T8) already uses.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentPassCredential, CredentialRequest } from "@agentpass/core";
import {
  AGENTPASS_CREDENTIAL_TYPE,
  AGENTPASS_STATUS_TYPE,
  AgentPassError,
  VC_CONTEXT_V2,
  credentialRequestSchema,
  isAgentPassError,
  stellarAddressToDid,
} from "@agentpass/core";
import { createAgentPass } from "@agentpass/sdk";
import { Keypair } from "@stellar/stellar-sdk";

import type { CreatePurchaseIntentResult } from "@agentpay/agent";
import { createAgent, createMockCatalog, interpretPurchase } from "@agentpay/agent";

import { parseDemoArgs } from "./lib/demo-args.js";
import { readEnvFile } from "./lib/env-file.js";
import { TESTNET } from "./lib/network.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = resolve(REPO_ROOT, ".env.local");
const SCOPE_PATH = resolve(REPO_ROOT, "examples/scope-bazaar.json");

/** The credential's own validity window is not what this demo tests — the
 * revocation is — so a short window is enough. */
const CREDENTIAL_VALID_DAYS = 1;

function requireEnv(env: ReadonlyMap<string, string>, key: string): string {
  const value = env.get(key);
  if (value === undefined || value === "") {
    throw new AgentPassError("ConfigError", `${key} is missing from .env.local`, {
      details: { fix: "run `pnpm run bootstrap` and `pnpm run deploy:registry` first", key },
    });
  }
  return value;
}

/**
 * Reads `examples/scope-bazaar.json` — the pilot scope, venue and asset already
 * filled in, unlike `examples/scope.json`'s deliberately empty ones (B-1). Same
 * file shape and the same schema the CLI's `issue --scope` reads (T8): only
 * `id` and `principal` are missing, and only because they need a live keypair
 * to compute.
 */
async function readDemoScope(): Promise<CredentialRequest> {
  const raw = await readFile(SCOPE_PATH, "utf8").catch((error: unknown) => {
    throw new AgentPassError("ConfigError", `could not read ${SCOPE_PATH}`, { cause: error });
  });

  const parsed = credentialRequestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new AgentPassError("ConfigError", `${SCOPE_PATH} does not match the expected shape`, {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
    });
  }
  return parsed.data;
}

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(15)} ${value}\n`);
}

function step(n: number, title: string): void {
  process.stdout.write(`\n[${n}/5] ${title}\n`);
}

async function main(): Promise<void> {
  const { instruction } = parseDemoArgs(process.argv.slice(2));
  const env = await readEnvFile(ENV_PATH);

  const issuer = Keypair.fromSecret(requireEnv(env, "ISSUER_SECRET_KEY"));
  const agentKeypair = Keypair.fromSecret(requireEnv(env, "AGENT_SECRET_KEY"));
  const contractId = requireEnv(env, "AGENT_REGISTRY_CONTRACT_ID");

  const catalog = createMockCatalog();

  process.stdout.write("\nAgentPay demo · Fase 2 · Stellar testnet\n");

  // 1. Read the Spanish instruction — deterministically, not via an LLM call.
  //    See src/interpret.ts for why, and injection.test.ts for the property
  //    this relies on: interpretPurchase can only ever hand back a productId
  //    and a quantity, never a venue, an asset, or an amount override. Done
  //    first and offline, so an instruction nothing in the catalogue matches
  //    fails before a real testnet transaction is spent finding that out.
  step(1, "Instrucción en español");
  line("instrucción", `"${instruction}"`);
  const { productId, productName, quantity } = interpretPurchase(
    instruction,
    await catalog.listProducts(),
  );
  line("entendido", `${quantity} x ${productName} (${productId})`);

  const [agentpass, demoScope] = await Promise.all([
    createAgentPass({
      contractId,
      rpcUrl: TESTNET.rpcUrl,
      networkPassphrase: TESTNET.passphrase,
      network: TESTNET.network,
    }),
    readDemoScope(),
  ]);

  // 2. Issue — a real credential, signed and anchored on chain.
  step(2, "Emitir credencial (firmada, anclada en testnet)");
  const issuerDid = stellarAddressToDid(issuer.publicKey(), "testnet");
  const now = new Date();
  const credential: AgentPassCredential = {
    "@context": [VC_CONTEXT_V2],
    type: ["VerifiableCredential", AGENTPASS_CREDENTIAL_TYPE],
    issuer: issuerDid,
    validFrom: now.toISOString(),
    validUntil: new Date(
      now.getTime() + CREDENTIAL_VALID_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
    credentialSubject: {
      id: stellarAddressToDid(agentKeypair.publicKey(), "testnet"),
      agent: demoScope.agent,
      principal: issuerDid,
      scope: demoScope.scope,
    },
    credentialStatus: { type: AGENTPASS_STATUS_TYPE, registry: agentpass.config.contractId },
  };

  const issued = await agentpass.issue({ credential, issuer });
  line("hash", issued.hash);
  line("subject", agentKeypair.publicKey());
  line("venue", demoScope.scope.venues[0] ?? "(none)");
  line("perTx", `${demoScope.scope.limits.perTx} ${demoScope.scope.limits.currency}`);

  // 3. Start the agent: it verifies that same credential against the real
  //    registry (T11) before deciding which tools it has.
  step(3, "El agente verifica su credencial y arranca");
  const agent = await createAgent({
    credential: issued.jws,
    catalog,
    verifier: agentpass,
    signer: agentKeypair,
  });
  line("status", agent.credential.usable ? "Active" : "unusable");
  line(
    "tools",
    agent.tools
      .list()
      .map((tool) => tool.name)
      .join(", "),
  );

  // 4. Ask for a signed purchase intent. T12's scope check and T13's signing
  //    both run inside this one call.
  step(4, "Intención de compra firmada");
  const result = (await agent.tools.invoke("create_purchase_intent", {
    product_id: productId,
    quantity,
  })) as CreatePurchaseIntentResult;
  line("intent_id", result.intent_id);
  line("total", `${result.total_amount} ${result.asset.split(":")[0] ?? ""}`);
  line("jws", `${result.jws.slice(0, 40)}… (${result.jws.length} caracteres)`);
  line("expira", result.expires_at);

  // 5. Revoke from outside the agent — nothing about the agent process
  //    changes — then ask for the identical purchase again.
  step(5, "Revocar (desde fuera del agente) y reintentar");
  const revokeTx = await agentpass.revoke({ credentialHash: issued.hash, issuer });
  line("revocado", issued.hash);
  line("tx", revokeTx);

  try {
    await agent.tools.invoke("create_purchase_intent", { product_id: productId, quantity });
    process.stderr.write("\n  reintento       NO FUE RECHAZADO — esto es un fallo del demo\n");
    process.exitCode = 1;
    return;
  } catch (error) {
    const code = isAgentPassError(error) ? error.code : "unknown";
    line("reintento", `rechazado — ${code}`);
  }

  process.stdout.write(
    "\nListo. La misma instrucción, el mismo agente en el mismo proceso: antes de\n" +
      "revocar autorizaba la compra, después ya no. Nada del agente cambió — lo que\n" +
      "cambió fue el registro, desde afuera.\n\n",
  );
}

main().catch((error: unknown) => {
  if (isAgentPassError(error)) {
    process.stderr.write(`\n${error.code}: ${error.message}\n`);
    if (Object.keys(error.details).length > 0) {
      process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    }
  } else {
    process.stderr.write(`\n${String(error)}\n`);
  }
  process.exitCode = 1;
});
