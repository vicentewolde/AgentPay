#!/usr/bin/env node
/**
 * Prepares SignalDesk's own Stellar accounts (T79).
 *
 * SignalDesk is a merchant, not AgentPey. Its keys are its own: one account it
 * is paid at and signs receipts with, and one that submits settlement to the
 * network. Neither is ever an AgentPey key, and this script refuses to replace
 * keys that already exist — a merchant whose payout account silently changed
 * would also have silently changed its venue identity, which is the identity
 * signed Mandates name.
 *
 * What it does: mints the pair if `.env.local` has none, funds both with
 * Friendbot, gives the merchant a USDC trustline so it can actually be paid,
 * and prints the row to add to `venues.json`.
 *
 * Run with `pnpm run signaldesk:setup`.
 */
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import { readEnvFile } from "./lib/env-file.js";

const ENV_PATH = resolve(fileURLToPath(new URL("..", import.meta.url)), ".env.local");
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
/** Circle's real USDC issuer on testnet — the same identity AgentPey already uses. */
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC = new Asset("USDC", USDC_ISSUER);

const horizon = new Horizon.Server(HORIZON_URL);

async function fundIfNeeded(address: string): Promise<"existed" | "funded"> {
  try {
    await horizon.loadAccount(address);
    return "existed";
  } catch {
    const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`);
    if (!response.ok) throw new Error(`Friendbot rejected ${address}: ${response.status}`);
    return "funded";
  }
}

async function ensureTrustline(keypair: Keypair): Promise<"existed" | "created"> {
  const account = await horizon.loadAccount(keypair.publicKey());
  const has = account.balances.some(
    (balance) =>
      balance.asset_type === "credit_alphanum4" &&
      balance.asset_code === "USDC" &&
      balance.asset_issuer === USDC_ISSUER,
  );
  if (has) return "existed";

  const transaction = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  transaction.sign(keypair);
  await horizon.submitTransaction(transaction);
  return "created";
}

const env = await readEnvFile(ENV_PATH);

let merchantSecret = env.get("SIGNALDESK_SECRET_KEY");
let facilitatorSecret = env.get("SIGNALDESK_FACILITATOR_SECRET");

if (merchantSecret === undefined || merchantSecret === "") {
  const merchant = Keypair.random();
  const facilitator = Keypair.random();
  merchantSecret = merchant.secret();
  facilitatorSecret = facilitator.secret();
  await appendFile(
    ENV_PATH,
    [
      "",
      "# SignalDesk (T79) — the merchant's own keys. Not AgentPey's, and never interchangeable with them.",
      `SIGNALDESK_SECRET_KEY=${merchantSecret}`,
      `SIGNALDESK_FACILITATOR_SECRET=${facilitatorSecret}`,
      "",
    ].join("\n"),
    { encoding: "utf8" },
  );
  process.stdout.write("Minted SignalDesk's keys and appended them to .env.local\n");
} else {
  process.stdout.write("SignalDesk already has keys in .env.local — leaving them alone\n");
}

if (facilitatorSecret === undefined || facilitatorSecret === "") {
  throw new Error("SIGNALDESK_SECRET_KEY is set but SIGNALDESK_FACILITATOR_SECRET is not");
}

const merchant = Keypair.fromSecret(merchantSecret);
const facilitator = Keypair.fromSecret(facilitatorSecret);

const [merchantFunding, facilitatorFunding] = await Promise.all([
  fundIfNeeded(merchant.publicKey()),
  fundIfNeeded(facilitator.publicKey()),
]);
const trustline = await ensureTrustline(merchant);

process.stdout.write(`\nmerchant     ${merchant.publicKey()}  (${merchantFunding}, trustline ${trustline})\n`);
process.stdout.write(`facilitator  ${facilitator.publicKey()}  (${facilitatorFunding})\n`);
process.stdout.write(`\nvenue identity: signaldesk:${merchant.publicKey()}\n`);
process.stdout.write(`\nRow for apps/agent/src/catalog/venues.json:\n`);
process.stdout.write(
  `${JSON.stringify(
    {
      slug: "signaldesk",
      address: merchant.publicKey(),
      baseUrl: "https://signaldesk.example",
      assets: [{ code: "USDC", issuer: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA" }],
    },
    null,
    2,
  )}\n`,
);
