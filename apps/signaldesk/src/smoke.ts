#!/usr/bin/env node
/**
 * Buys from SignalDesk for real, on Stellar testnet, and checks the receipt
 * the way a stranger would (T79).
 *
 * This is the merchant proving itself without AgentPey in the picture: it
 * starts SignalDesk, pays it with an x402 client, and then verifies the signed
 * receipt using only SignalDesk's **public** key and the artefact's own bytes.
 * If that verification passes, the receipt is evidence rather than a claim —
 * which is the entire argument of `PILOTO-F9.md` § 5.3.
 *
 * It also asks twice with the same settled payment, because "one payment, one
 * delivery" is only worth asserting against the real settlement path.
 *
 * Needs a payer holding testnet USDC. Run with `pnpm run signaldesk:smoke`.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer, STELLAR_TESTNET_CAIP2 } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { Keypair } from "@stellar/stellar-sdk";

import { artifactHash } from "./artifacts.js";
import { readEnv } from "./env.js";
import { DISCOVERY_PATH, startSignalDesk } from "./merchant.js";
import { verifyReceipt, type SignedReceipt } from "./receipts.js";

const ENV_PATH = resolve(fileURLToPath(new URL("../../..", import.meta.url)), ".env.local");

const env = await readEnv(ENV_PATH);

function required(key: string): string {
  const value = env.get(key);
  if (value === undefined || value === "") throw new Error(`${key} is missing from .env.local`);
  return value;
}

const merchantSecret = required("SIGNALDESK_SECRET_KEY");
const merchantPayTo = Keypair.fromSecret(merchantSecret).publicKey();
const payerSecret = required("AGENT_SECRET_KEY");
const payerAddress = Keypair.fromSecret(payerSecret).publicKey();

const merchant = await startSignalDesk({
  merchantPayTo,
  merchantSecret,
  facilitatorSecret: required("SIGNALDESK_FACILITATOR_SECRET"),
  port: 0,
});
const baseUrl = `http://127.0.0.1:${merchant.port}`;

const http = new x402HTTPClient(
  x402Client.fromConfig({
    schemes: [
      {
        network: STELLAR_TESTNET_CAIP2,
        client: new ExactStellarScheme(createEd25519Signer(payerSecret, STELLAR_TESTNET_CAIP2)),
      },
    ],
  }),
);

/** One x402 purchase: read the challenge, sign a payload, pay, and hand back the body. */
async function buy(resourceUrl: string): Promise<Record<string, unknown>> {
  const challenge = await fetch(resourceUrl);
  if (challenge.status !== 402) throw new Error(`expected 402, got ${challenge.status}`);

  const required = http.getPaymentRequiredResponse((name) => challenge.headers.get(name), await challenge.json());
  const payload = await http.createPaymentPayload(required);
  const paid = await fetch(resourceUrl, { headers: http.encodePaymentSignatureHeader(payload) });
  const result = await http.processResponse(paid);
  if (result.paymentStatus !== "settled") throw new Error(`payment did not settle: ${result.paymentStatus}`);
  return result.body as Record<string, unknown>;
}

try {
  const catalogue = (await (await fetch(`${baseUrl}${DISCOVERY_PATH}`)).json()) as {
    results: { resource: { id: string; payment: { amount: string } } }[];
  };
  process.stdout.write(`catalogue:\n`);
  for (const row of catalogue.results) {
    process.stdout.write(`  ${row.resource.id}  ${row.resource.payment.amount} USDC\n`);
  }

  const resourceUrl = `${baseUrl}/api/x402/market-brief?pair=XLM/USDC`;
  process.stdout.write(`\npaying ${resourceUrl} from ${payerAddress}\n`);

  const delivery = (await buy(resourceUrl)) as unknown as {
    delivery_id: string;
    artifact_url: string;
    artifact_hash: string;
    receipt_url: string;
  };
  process.stdout.write(`\ndelivered  ${delivery.delivery_id}\n`);

  const artifact = await (await fetch(delivery.artifact_url)).text();
  const recomputed = artifactHash(artifact);
  process.stdout.write(`artifact hash matches the delivery: ${recomputed === delivery.artifact_hash}\n`);

  const receipt = (await (await fetch(delivery.receipt_url)).json()) as { ok: boolean } & SignedReceipt;
  const verification = verifyReceipt(receipt);
  process.stdout.write(`receipt signed by ${receipt.signedBy}\n`);
  process.stdout.write(`receipt verifies with nothing but that public key: ${verification.valid}\n`);
  process.stdout.write(`receipt commits to the delivered bytes: ${receipt.receipt.artifact_hash === recomputed}\n`);
  process.stdout.write(`payment tx  ${receipt.receipt.payment_tx}\n`);

  const credits = `${baseUrl}/api/x402/ai-credits?account=${payerAddress}`;
  process.stdout.write(`\npaying ${credits}\n`);
  const granted = (await buy(credits)) as unknown as { balance: number; transferable: boolean };
  process.stdout.write(`credits balance ${granted.balance}, transferable ${granted.transferable}\n`);
} finally {
  await merchant.close();
}
