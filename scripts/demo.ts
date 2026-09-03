#!/usr/bin/env node
/**
 * `pnpm demo` — the phase-2 walkthrough, extended for phase 3 (T23): issue a
 * credential and a Mandate, hand the agent a Spanish purchase instruction,
 * get a signed intent back, ask for the identical purchase again the same
 * day and watch the Mandate's own daily limit say no, then revoke the
 * *Mandate* — not the credential — from outside the agent and watch the same
 * instruction fail a third way, while `check_my_credential` still reports
 * the credential itself as Active.
 *
 * That last step is phase 3's whole claim, staged: the principal's consent
 * is a structure the agent cannot argue with and cannot see revoked from the
 * inside, independent of whether its own credential is still good. Phase 2's
 * `pnpm demo` already proved credential revocation (T14); this one proves
 * the Mandate is a second, independent authority — not decoration on top of
 * the first.
 *
 * Runs against real Stellar testnet for both documents: `issue()` anchors
 * the credential, `anchorMandate()` anchors the Mandate, `revoke()` cuts the
 * Mandate at the end. That is what makes the revocation real rather than
 * illustrated — the same reason `deploy-registry.ts` and the CLI's full
 * walkthrough (T8) also touch the network. The catalogue defaults to the mock
 * (`--adapter=mock`); `--adapter=bazaar` (T15) reads the real bazaar's live
 * discovery API instead — the phase's acceptance criterion, kept: swapping
 * adapters needed no change to T9–T14, only a scope naming the venue and
 * asset each catalogue actually uses (`examples/scope-bazaar.json` vs.
 * `examples/scope-stellar-bazaar.json`).
 *
 * Everything before the first network call — argument parsing, reading
 * `.env.local`, reading the interpreted instruction — fails fast and offline,
 * the same discipline the CLI (T8) already uses.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentPassCredential, CredentialRequest, Scope } from "@agentpass/core";
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

import { anchorMandate, createMandate, revokeMandate } from "@agentpay/mandate";

import type { CreatePurchaseIntentResult } from "@agentpay/agent";
import {
  type CatalogAdapter,
  createAgent,
  createBazaarCatalog,
  createMockCatalog,
  createOnChainMandateVerifier,
  interpretPurchase,
} from "@agentpay/agent";

import { parseDemoArgs, type DemoAdapter } from "./lib/demo-args.js";
import { readEnvFile } from "./lib/env-file.js";
import { TESTNET } from "./lib/network.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = resolve(REPO_ROOT, ".env.local");

/** Each catalogue names a different venue and asset, so each needs its own scope. */
const SCOPE_PATH: Readonly<Record<DemoAdapter, string>> = {
  mock: resolve(REPO_ROOT, "examples/scope-bazaar.json"),
  bazaar: resolve(REPO_ROOT, "examples/scope-stellar-bazaar.json"),
};

/** The live deployment this was verified against, 2026-09-03 — overridable via `.env.local`. */
const DEFAULT_BAZAAR_BASE_URL = "https://stellar-bazaar-x402.vercel.app";

/** The credential's own validity window is not what this demo tests — the
 * revocation is — so a short window is enough. */
const CREDENTIAL_VALID_DAYS = 1;

/**
 * Narrower than each adapter's own scope `perDay` on purpose: two purchases
 * of the demo's default product fit comfortably under the credential's scope
 * but not under this — which is what makes the Mandate, not the credential,
 * the one that says no in step 5. `perTx` is left untouched so it never
 * interferes; this demo is about the daily memory `B-16` deferred and
 * T18/T19 built, not the per-transaction limit T12 already demonstrated in
 * phase 2. Sized per adapter because the two catalogues price at completely
 * different scales — the mock's 18.50 vs. the real bazaar's 0.001.
 */
const DEMO_MANDATE_PER_DAY: Readonly<Record<DemoAdapter, string>> = {
  mock: "30.00",
  bazaar: "0.0015",
};

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
async function readDemoScope(scopePath: string): Promise<CredentialRequest> {
  const raw = await readFile(scopePath, "utf8").catch((error: unknown) => {
    throw new AgentPassError("ConfigError", `could not read ${scopePath}`, { cause: error });
  });

  const parsed = credentialRequestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new AgentPassError("ConfigError", `${scopePath} does not match the expected shape`, {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
    });
  }
  return parsed.data;
}

function createCatalog(adapter: DemoAdapter, env: ReadonlyMap<string, string>): CatalogAdapter {
  if (adapter === "mock") return createMockCatalog();
  const baseUrl = env.get("BAZAAR_BASE_URL") ?? DEFAULT_BAZAAR_BASE_URL;
  return createBazaarCatalog({ baseUrl });
}

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(15)} ${value}\n`);
}

const DEMO_STEPS = 6;

function step(n: number, title: string): void {
  process.stdout.write(`\n[${n}/${DEMO_STEPS}] ${title}\n`);
}

async function main(): Promise<void> {
  const { adapter, instruction } = parseDemoArgs(process.argv.slice(2));
  const env = await readEnvFile(ENV_PATH);

  const issuer = Keypair.fromSecret(requireEnv(env, "ISSUER_SECRET_KEY"));
  const agentKeypair = Keypair.fromSecret(requireEnv(env, "AGENT_SECRET_KEY"));
  const contractId = requireEnv(env, "AGENT_REGISTRY_CONTRACT_ID");

  const catalog = createCatalog(adapter, env);

  process.stdout.write(`\nAgentPay demo · Fase 2 + Fase 3 · Stellar testnet · catálogo: ${adapter}\n`);

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
    readDemoScope(SCOPE_PATH[adapter]),
  ]);

  // 2. Issue — a real credential, signed and anchored on chain.
  step(2, "Emitir credencial y mandato (firmados, anclados en testnet)");
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
  line("tx", issued.transactionHash);
  line("subject", agentKeypair.publicKey());
  line("venue", demoScope.scope.venues[0] ?? "(none)");
  line("perTx", `${demoScope.scope.limits.perTx} ${demoScope.scope.limits.currency}`);

  // The principal's own consent (Fase 3, T16/T20) — same principal, same
  // agent as the credential, but its own `perDay` (see `DEMO_MANDATE_PER_DAY`
  // above) — `M-4`'s "two limits, the narrower wins" made concrete, not just
  // asserted. Anchored on the same registry, through the same generic
  // `anchor()` the credential just used (`M-17`/`M-18`): no separate
  // registration step, no separate contract.
  const mandatePerDay = DEMO_MANDATE_PER_DAY[adapter];
  const mandateGrant: Scope = {
    ...demoScope.scope,
    limits: { ...demoScope.scope.limits, perDay: mandatePerDay },
  };
  const mandate = createMandate({
    principal: issuerDid,
    agent: stellarAddressToDid(agentKeypair.publicKey(), "testnet"),
    grant: mandateGrant,
    registry: agentpass.config.contractId,
    validFrom: now.toISOString(),
    validUntil: new Date(
      now.getTime() + CREDENTIAL_VALID_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  });
  const anchoredMandate = await anchorMandate(agentpass, { mandate, principal: issuer });
  line("mandato", anchoredMandate.hash);
  line("tx", anchoredMandate.transactionHash);
  line("perDay (mandato)", `${mandatePerDay} ${demoScope.scope.limits.currency}`);

  // 3. Start the agent: it verifies that same credential — and now the
  //    mandate too (T21) — against the real registry (T11) before deciding
  //    which tools it has.
  step(3, "El agente verifica su credencial y su mandato, y arranca");
  const agent = await createAgent({
    credential: issued.jws,
    mandate: anchoredMandate.jws,
    catalog,
    verifier: agentpass,
    mandateVerifier: createOnChainMandateVerifier(agentpass),
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

  // 4. Ask for a signed purchase intent. T12's scope check, T17's mandate
  //    check and T19's PolicyRail all run inside this one call, and all
  //    three currently agree: 18.50 fits under every limit in play.
  step(4, "Primera compra del día — dentro de todos los límites");
  const first = (await agent.tools.invoke("create_purchase_intent", {
    product_id: productId,
    quantity,
  })) as CreatePurchaseIntentResult;
  line("intent_id", first.intent_id);
  line("total", `${first.total_amount} ${first.asset.split(":")[0] ?? ""}`);
  line("jws", `${first.jws.slice(0, 40)}… (${first.jws.length} caracteres)`);
  line("expira", first.expires_at);

  // 5. The identical instruction, the same day: 18.50 + 18.50 = 37.00, still
  //    comfortably under the credential's own perDay (200.00) but over the
  //    Mandate's narrower one (30.00). This is `perDay` — the limit B-16
  //    explicitly deferred in phase 2 and T18/T19 built — actually refusing
  //    something, not just being present in a signed document nobody reads.
  step(5, "Segunda compra el mismo día — el Mandato dice que no");
  try {
    await agent.tools.invoke("create_purchase_intent", { product_id: productId, quantity });
    process.stderr.write("\n  segunda compra  NO FUE RECHAZADA — esto es un fallo del demo\n");
    process.exitCode = 1;
    return;
  } catch (error) {
    if (!isAgentPassError(error)) throw error;
    line("rechazada", `${error.code}`);
    line("detalle", JSON.stringify(error.details));
  }

  // 6. Revoke the Mandate — not the credential — from outside the agent,
  //    then ask for the identical purchase a third time. Phase 3's claim,
  //    staged: the principal's consent is a second, independent authority.
  //    `agentpass.status()` reads the registry directly, live, to prove the
  //    credential's own status never moved — nothing about the agent's
  //    identity changed, only what its principal still consents to.
  step(6, "Revocar el Mandato (no la credencial) desde afuera, y reintentar");
  const revokeTx = await revokeMandate(agentpass, { mandateHash: anchoredMandate.hash, principal: issuer });
  line("mandato revocado", anchoredMandate.hash);
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

  const credentialStatus = await agentpass.status(issued.hash);
  line("credencial (en vivo)", credentialStatus);

  process.stdout.write(
    "\nListo. Dos rechazos, dos motivos distintos: el primero porque el gasto de\n" +
      "hoy ya pasó lo que el Mandato consiente; el segundo porque ese consentimiento\n" +
      "se cortó desde afuera. En ningún momento cambió la credencial del agente —\n" +
      "sigue activa en el registro — ni el agente mismo. El límite de gasto y el\n" +
      "consentimiento del principal viven en un lugar que el agente no puede\n" +
      "reescribir, y eso es lo que esta fase existe para probar.\n\n",
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
