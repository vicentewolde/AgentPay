#!/usr/bin/env node
/**
 * `pnpm run demo:pay-real` — T24's proof that a real x402 payment settles.
 *
 * Deliberately separate from `pnpm demo` (T14/T23), not a `--pay-real` flag
 * bolted onto it: that script's six steps are already the evidence for
 * phases 2 and 3, staged and tested. This script has exactly one job —
 * prove the payment mechanism `executeBazaarPayment` (T24) actually settles
 * against the live bazaar — and keeping it separate means a surprise here
 * cannot regress the narrative `pnpm demo` already proves.
 *
 * Always targets the bazaar's cheapest real product, `swap-risk-quote`
 * (0.001 USDC), by id — no natural-language interpretation, no product
 * choice. That is this script's whole point: fewer moving parts than
 * `pnpm demo`, so a failure here points at the payment path, not at
 * anything upstream of it.
 *
 * Prerequisite: the agent's account needs an open USDC trustline and an
 * actual USDC balance — `pnpm run fund:usdc` opens the trustline; funding
 * the balance is a manual step at a third party's testnet faucet.
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

import { anchorMandate, createMandate } from "@agentpay/mandate";

import type { CreatePurchaseIntentResult } from "@agentpay/agent";
import {
  createAgent,
  createBazaarCatalog,
  createInMemorySpendLedger,
  createLocalPolicyRail,
  createOnChainMandateVerifier,
  executeBazaarPayment,
  fillRouteTemplate,
  getBazaarServiceRoute,
  verifyIntent,
} from "@agentpay/agent";

import { readEnvFile } from "./lib/env-file.js";
import { TESTNET } from "./lib/network.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = resolve(REPO_ROOT, ".env.local");
const SCOPE_PATH = resolve(REPO_ROOT, "examples/scope-stellar-bazaar.json");
const DEFAULT_BAZAAR_BASE_URL = "https://stellar-bazaar-x402.vercel.app";
const CREDENTIAL_VALID_DAYS = 1;

/** The specific product this proof always targets, and its route parameters. */
const PRODUCT_ID = "swap-risk-quote";
const ROUTE_PARAMS = { pair: "XLM/USDC", amount: 100, side: "buy" };

function requireEnv(env: ReadonlyMap<string, string>, key: string): string {
  const value = env.get(key);
  if (value === undefined || value === "") {
    throw new AgentPassError("ConfigError", `${key} is missing from .env.local`, {
      details: { fix: "run `pnpm run bootstrap` and `pnpm run deploy:registry` first", key },
    });
  }
  return value;
}

async function readScope(): Promise<CredentialRequest> {
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

const STEPS = 5;
function step(n: number, title: string): void {
  process.stdout.write(`\n[${n}/${STEPS}] ${title}\n`);
}

async function main(): Promise<void> {
  const env = await readEnvFile(ENV_PATH);
  const issuer = Keypair.fromSecret(requireEnv(env, "ISSUER_SECRET_KEY"));
  const agentKeypair = Keypair.fromSecret(requireEnv(env, "AGENT_SECRET_KEY"));
  const contractId = requireEnv(env, "AGENT_REGISTRY_CONTRACT_ID");
  const baseUrl = env.get("BAZAAR_BASE_URL") ?? DEFAULT_BAZAAR_BASE_URL;

  process.stdout.write("\nAgentPay · pago x402 real · Fase 4 (T24) · Stellar testnet\n");
  line("producto", PRODUCT_ID);
  line("bazaar", baseUrl);

  const catalog = createBazaarCatalog({ baseUrl });
  // The same ledger backs both the agent's own PolicyRail (inside
  // create_purchase_intent) and the one this script builds for
  // executeBazaarPayment — so the second authorise() call, against the real
  // 402 challenge, records the same intentId once, not twice (M-15).
  const ledger = createInMemorySpendLedger();
  const policyRail = createLocalPolicyRail({ ledger });

  const [agentpass, demoScope, route] = await Promise.all([
    createAgentPass({
      contractId,
      rpcUrl: TESTNET.rpcUrl,
      networkPassphrase: TESTNET.passphrase,
      network: TESTNET.network,
    }),
    readScope(),
    getBazaarServiceRoute({ baseUrl }, PRODUCT_ID),
  ]);

  // 1. Issue a credential and a Mandate, same as `pnpm demo` — this proof is
  //    about the payment, not about re-litigating T16–T21.
  step(1, "Emitir credencial y mandato (firmados, anclados en testnet)");
  const issuerDid = stellarAddressToDid(issuer.publicKey(), "testnet");
  const now = new Date();
  const validUntil = new Date(now.getTime() + CREDENTIAL_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const credential: AgentPassCredential = {
    "@context": [VC_CONTEXT_V2],
    type: ["VerifiableCredential", AGENTPASS_CREDENTIAL_TYPE],
    issuer: issuerDid,
    validFrom: now.toISOString(),
    validUntil,
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

  const mandate = createMandate({
    principal: issuerDid,
    agent: stellarAddressToDid(agentKeypair.publicKey(), "testnet"),
    grant: demoScope.scope,
    registry: agentpass.config.contractId,
    validFrom: now.toISOString(),
    validUntil,
  });
  const anchoredMandate = await anchorMandate(agentpass, { mandate, principal: issuer });
  line("mandato", anchoredMandate.hash);

  // 2. Start the agent, with the ledger this script also uses for the real
  //    payment's authorise() call.
  step(2, "El agente verifica su credencial y su mandato, y arranca");
  const agent = await createAgent({
    credential: issued.jws,
    mandate: anchoredMandate.jws,
    catalog,
    verifier: agentpass,
    mandateVerifier: createOnChainMandateVerifier(agentpass),
    signer: agentKeypair,
    ledger,
  });
  line("status", agent.credential.usable ? "Active" : "unusable");

  // 3. A signed intent — structurally authorised, not yet paid.
  step(3, "Intención de compra firmada");
  const intentResult = (await agent.tools.invoke("create_purchase_intent", {
    product_id: PRODUCT_ID,
    quantity: 1,
  })) as CreatePurchaseIntentResult;
  line("intent_id", intentResult.intent_id);
  line("total", `${intentResult.total_amount} ${intentResult.asset.split(":")[0] ?? ""}`);

  const verified = await verifyIntent(intentResult.jws);

  // 4. The real payment: hit the resource, get the real 402, reconcile it
  //    against the signed intent, and only then sign and send.
  step(4, "Pago real contra el bazaar (x402)");
  const resourceUrl = fillRouteTemplate(baseUrl, route, ROUTE_PARAMS);
  line("recurso", resourceUrl);
  const receipt = await executeBazaarPayment(
    { policyRail, signerSecret: agentKeypair.secret() },
    {
      resourceUrl,
      intent: verified.intent,
      scope: demoScope.scope,
      mandate: anchoredMandate.mandate,
      venueId: catalog.venueId,
    },
  );

  // 5. The receipt — a real transaction, or a clear reason it did not settle.
  step(5, "Recibo");
  line("settled", String(receipt.settled));
  line("tx", receipt.transaction ?? "(none)");
  if (receipt.transaction !== undefined) {
    line("explorer", `https://stellar.expert/explorer/testnet/tx/${receipt.transaction}`);
  }
  line("payer", receipt.payer ?? "(none)");
  line("amount", receipt.amount ?? "(none)");

  process.stdout.write(
    "\nListo. El intent firmado en el paso 3 se convirtió en un pago real: el\n" +
      "bazaar pidió el reto 402, PolicyRail lo reconcilió contra lo firmado, y\n" +
      "recién ahí se firmó y envió la autorización de pago.\n\n",
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
