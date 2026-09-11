import { readFile } from "node:fs/promises";

import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer, STELLAR_TESTNET_CAIP2 } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { z } from "zod";

import { DISCOVERY_PATH, PAID_PATH, startReferenceMerchant } from "./merchant.js";

const envSchema = z.object({
  MERCHANT_PAY_TO: z.string(),
  FACILITATOR_SECRET_KEY: z.string(),
  PAYER_SECRET_KEY: z.string(),
  REFERENCE_USDC_CONTRACT: z.string().optional(),
});

class PurchaseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

async function readEnv(): Promise<z.output<typeof envSchema>> {
  const raw = await readFile(new URL(".env.local", import.meta.url), "utf8");
  const entries = raw
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)] as const;
    });
  return envSchema.parse(Object.fromEntries(entries));
}

const env = await readEnv();
const merchant = await startReferenceMerchant({
  merchantPayTo: env.MERCHANT_PAY_TO,
  facilitatorSecret: env.FACILITATOR_SECRET_KEY,
  asset: env.REFERENCE_USDC_CONTRACT,
  port: 0,
});
const baseUrl = `http://127.0.0.1:${merchant.port}`;
const account = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

try {
  const discovery = await fetch(`${baseUrl}${DISCOVERY_PATH}?query=account`);
  if (!discovery.ok) throw new PurchaseError(`discovery failed: ${discovery.status}`);
  const catalog: unknown = await discovery.json();
  process.stdout.write(`Discovery: ${JSON.stringify(catalog)}\n`);

  const resourceUrl = `${baseUrl}${PAID_PATH}?account=${account}`;
  const challenge = await fetch(resourceUrl);
  if (challenge.status !== 402) throw new PurchaseError(`expected 402, got ${challenge.status}`);

  const client = x402Client.fromConfig({
    schemes: [
      {
        network: STELLAR_TESTNET_CAIP2,
        client: new ExactStellarScheme(createEd25519Signer(env.PAYER_SECRET_KEY, STELLAR_TESTNET_CAIP2)),
      },
    ],
  });
  const http = new x402HTTPClient(client);
  const required = http.getPaymentRequiredResponse((name) => challenge.headers.get(name), await challenge.json());
  const payload = await http.createPaymentPayload(required);
  const paid = await fetch(resourceUrl, { headers: http.encodePaymentSignatureHeader(payload) });
  const result = await http.processResponse(paid);
  if (result.paymentStatus !== "settled" || result.header === undefined || !("transaction" in result.header)) {
    throw new PurchaseError(`payment did not settle: ${result.paymentStatus}`);
  }

  const receipt = result.header;
  process.stdout.write(`TESTNET_TRANSACTION_HASH=${receipt.transaction}\n`);
  process.stdout.write(`TESTNET_EXPLORER=https://stellar.expert/explorer/testnet/tx/${receipt.transaction}\n`);
  process.stdout.write(`RESOURCE=${JSON.stringify(result.body)}\n`);
} catch (error) {
  const message = error instanceof PurchaseError ? error.message : "could not complete the x402 purchase";
  process.stderr.write(`PurchaseFailed: ${message}\n`);
  process.exitCode = 1;
} finally {
  await merchant.close();
}
