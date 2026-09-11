import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";

import { Keypair } from "@stellar/stellar-sdk";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";

const envPath = new URL(".env.local", import.meta.url);

try {
  await access(envPath, constants.F_OK);
  process.stderr.write(".env.local already exists; refusing to replace its ephemeral keys.\n");
  process.exitCode = 1;
} catch {
  const merchant = Keypair.random();
  const facilitator = Keypair.random();
  const payer = Keypair.random();
  const contents = [
    "# Generated for a disposable Stellar testnet reference merchant. Never commit this file.",
    `MERCHANT_SECRET_KEY=${merchant.secret()}`,
    `MERCHANT_PAY_TO=${merchant.publicKey()}`,
    `FACILITATOR_SECRET_KEY=${facilitator.secret()}`,
    `FACILITATOR_ADDRESS=${facilitator.publicKey()}`,
    `PAYER_SECRET_KEY=${payer.secret()}`,
    `PAYER_ADDRESS=${payer.publicKey()}`,
    `REFERENCE_USDC_CONTRACT=${USDC_TESTNET_ADDRESS}`,
    "REFERENCE_MERCHANT_PORT=4020",
    "",
  ].join("\n");
  await writeFile(envPath, contents, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`Created ${envPath.pathname}. Fund PAYER_ADDRESS with Circle testnet USDC before running pnpm run pay.\n`);
}
