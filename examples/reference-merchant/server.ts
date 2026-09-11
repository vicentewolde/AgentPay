import { readFile } from "node:fs/promises";

import { z } from "zod";

import { startReferenceMerchant } from "./merchant.js";

const envSchema = z.object({
  MERCHANT_PAY_TO: z.string(),
  FACILITATOR_SECRET_KEY: z.string(),
  REFERENCE_MERCHANT_PORT: z.coerce.number().int().min(1).max(65_535).default(4020),
  REFERENCE_USDC_CONTRACT: z.string().optional(),
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

const env = await readEnv();
const merchant = await startReferenceMerchant({
  merchantPayTo: env.MERCHANT_PAY_TO,
  facilitatorSecret: env.FACILITATOR_SECRET_KEY,
  asset: env.REFERENCE_USDC_CONTRACT,
  port: env.REFERENCE_MERCHANT_PORT,
});

process.stdout.write(`Reference merchant listening at http://127.0.0.1:${merchant.port}\n`);
