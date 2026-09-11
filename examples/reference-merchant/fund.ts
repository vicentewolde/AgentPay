import { readFile } from "node:fs/promises";

import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { z } from "zod";

const envSchema = z.object({
  MERCHANT_SECRET_KEY: z.string().regex(/^S[A-Z2-7]{55}$/),
  MERCHANT_PAY_TO: z.string().regex(/^G[A-Z2-7]{55}$/),
  FACILITATOR_ADDRESS: z.string().regex(/^G[A-Z2-7]{55}$/),
  PAYER_SECRET_KEY: z.string().regex(/^S[A-Z2-7]{55}$/),
  PAYER_ADDRESS: z.string().regex(/^G[A-Z2-7]{55}$/),
});

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

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIEND_BOT_URL = "https://friendbot.stellar.org";
/** Circle's actual USDC issuer on Stellar testnet (the same identity AgentPay uses). */
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC = new Asset("USDC", USDC_ISSUER);

class SetupError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

async function friendbot(address: string): Promise<void> {
  const response = await fetch(`${FRIEND_BOT_URL}?addr=${encodeURIComponent(address)}`);
  if (!response.ok) throw new SetupError(`Friendbot rejected ${address}: ${response.status} ${await response.text()}`);
}

async function fundIfNeeded(server: Horizon.Server, address: string): Promise<void> {
  try {
    await server.loadAccount(address);
    return;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "response" in error) {
      const response = (error as { response?: { status?: number } }).response;
      if (response?.status === 404) {
        await friendbot(address);
        return;
      }
    }
    throw new SetupError(`could not look up ${address} on Horizon`, error);
  }
}

async function ensureTrustline(server: Horizon.Server, account: Keypair): Promise<void> {
  const loaded = await server.loadAccount(account.publicKey());
  const exists = loaded.balances.some(
    (balance) => balance.asset_type === "credit_alphanum4" && balance.asset_code === "USDC" && balance.asset_issuer === USDC_ISSUER,
  );
  if (exists) return;
  const transaction = new TransactionBuilder(loaded, { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  transaction.sign(account);
  await server.submitTransaction(transaction);
}

const env = await readEnv();
const horizon = new Horizon.Server(HORIZON_URL);
const merchant = Keypair.fromSecret(env.MERCHANT_SECRET_KEY);
const payer = Keypair.fromSecret(env.PAYER_SECRET_KEY);

try {
  await Promise.all([
    fundIfNeeded(horizon, env.MERCHANT_PAY_TO),
    fundIfNeeded(horizon, env.FACILITATOR_ADDRESS),
    fundIfNeeded(horizon, env.PAYER_ADDRESS),
  ]);
  await Promise.all([ensureTrustline(horizon, merchant), ensureTrustline(horizon, payer)]);

  process.stdout.write("Friendbot funded merchant, facilitator, and payer. USDC trustlines are ready.\n");
  process.stdout.write(`Fund the payer with Circle's testnet USDC faucet: ${env.PAYER_ADDRESS}\n`);
} catch (error) {
  const message = error instanceof SetupError ? error.message : "could not fund accounts or create USDC trustlines";
  process.stderr.write(`SetupFailed: ${message}\n`);
  process.exitCode = 1;
}
