#!/usr/bin/env node
/**
 * `pnpm run fund:usdc` — opens a USDC trustline on the demo agent's account.
 *
 * Prerequisite for T24 (a real x402 payment): the agent pays with its own
 * classic Stellar account, and paying in an asset it does not trust is
 * impossible by protocol, not by anything this repo enforces. This script
 * only opens the trustline — it does not, and cannot, fund the balance
 * itself. Circle's testnet USDC faucet is a third party's own web form; run
 * this first, then paste the printed address into that faucet by hand.
 *
 * Idempotent: an account that already trusts the asset is left alone.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentPassError, isAgentPassError } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";

import { USDC_TESTNET, parseAssetId } from "@agentpay/agent";

import { readEnvFile } from "./lib/env-file.js";
import { TESTNET, getTrustline, openTrustline } from "./lib/network.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = resolve(REPO_ROOT, ".env.local");

/** The classic USDC asset every venue in this pilot prices in — same issuer `mock.ts` already uses. */
const { code: USDC_CODE, issuer: USDC_ISSUER } = parseAssetId(USDC_TESTNET);

async function main(): Promise<void> {
  const env = await readEnvFile(ENV_PATH);
  const secret = env.get("AGENT_SECRET_KEY");
  if (secret === undefined || secret === "") {
    throw new AgentPassError("ConfigError", "AGENT_SECRET_KEY is missing from .env.local", {
      details: { fix: "run `pnpm run bootstrap` first" },
    });
  }
  const agent = Keypair.fromSecret(secret);
  const address = agent.publicKey();

  process.stdout.write(`\nFondeo de USDC · Stellar testnet\n\n`);
  process.stdout.write(`  cuenta       ${address}\n`);
  process.stdout.write(`  activo       ${USDC_CODE}:${USDC_ISSUER}\n\n`);

  const before = await getTrustline(TESTNET.horizonUrl, address, USDC_CODE, USDC_ISSUER);
  if (before.exists) {
    process.stdout.write(
      `  trustline    ya existe · saldo ${before.balance ?? "0"} ${USDC_CODE}\n\n`,
    );
    if (before.balance === "0.0000000" || before.balance === undefined) {
      process.stdout.write(
        `  Saldo en cero. Fondeá esta cuenta en el faucet de USDC testnet de Circle\n` +
          `  (buscá "Circle testnet USDC faucet" — es un sitio de terceros, pegá la\n` +
          `  dirección de arriba ahí) antes de correr un pago real.\n\n`,
      );
    }
    return;
  }

  const hash = await openTrustline({
    horizonUrl: TESTNET.horizonUrl,
    networkPassphrase: TESTNET.passphrase,
    source: agent,
    code: USDC_CODE,
    issuer: USDC_ISSUER,
  });
  process.stdout.write(`  trustline    abierta · tx ${hash}\n\n`);
  process.stdout.write(
    `  Ahora fondeá esta cuenta en el faucet de USDC testnet de Circle (sitio de\n` +
      `  terceros — buscá "Circle testnet USDC faucet") pegando la dirección de\n` +
      `  arriba, antes de correr un pago real contra el bazaar.\n\n`,
  );
}

try {
  await main();
} catch (error) {
  if (isAgentPassError(error)) {
    process.stderr.write(`\n${error.code}: ${error.message}\n`);
    if (Object.keys(error.details).length > 0) {
      process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    }
  } else {
    process.stderr.write(`\nUnexpected failure: ${String(error)}\n`);
  }
  process.exitCode = 1;
}
