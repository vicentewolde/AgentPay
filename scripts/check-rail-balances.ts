#!/usr/bin/env node
/**
 * `pnpm run check:rail-balances` — lists every tenant's own `policy_rail`
 * (F6/T58) with its current USDC and XLM balance. T60: the "monitoreo de
 * saldo" entregable F6 left pending after T58 wired the deploy-and-fund
 * path itself.
 *
 * An operator script, not an HTTP route — same posture as
 * `scripts/create-partner.ts`. It only reads: no method it calls on
 * `Directory` writes anything, and every Stellar call is a SEP-41
 * `balance()` simulation, never a `transfer`.
 *
 * `AgentPey` never sees a customer's real bank account, so "fondos
 * atrapados" (`PLATAFORMA-PARTNERS.md` § F6, riesgos) means a rail's
 * spendable balance quietly running low or a deploy leaving it unfunded —
 * this is the check that catches that before a purchase fails on it.
 *
 * **What this does not check.** A Soroban contract instance's own storage
 * rent (its ledger entry's TTL) is a separate concept from its SEP-41
 * balance — reading it needs `getLedgerEntries` and a bump policy, not a
 * `balance()` call, and this script does not do that yet. A rail's XLM
 * balance under the native asset's SAC is not that signal either: it is
 * always zero unless something explicitly transferred XLM into the
 * contract via SEP-41, which nothing here ever does — reporting it would
 * read as a false alarm, so it is deliberately left out.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BAZAAR_USDC_ISSUER, fromScaledAmount } from "@agentpey/agent";
import { createDirectory } from "@agentpey/directory";
import { Networks, contract } from "@stellar/stellar-sdk";

import { readEnvFile } from "./lib/env-file.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV_PATH = resolve(REPO_ROOT, ".env.local");
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

/** Below this, a rail is one or two purchases away from failing on an empty balance. */
const LOW_USDC_WARNING = "0.0050000";

interface SacBalance {
  balance(args: { readonly id: string }): Promise<contract.AssembledTransaction<bigint>>;
}

async function readBalance(assetContractId: string, holder: string): Promise<string> {
  const client = await contract.Client.from<SacBalance>({
    contractId: assetContractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const assembled = await client.balance({ id: holder });
  return fromScaledAmount(assembled.result);
}

async function readDatabaseUrl(): Promise<string> {
  const fromFile = (await readEnvFile(ENV_PATH)).get("DATABASE_URL");
  const databaseUrl = fromFile ?? process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is missing — set it in .env.local or the environment.");
  }
  return databaseUrl;
}

async function main(): Promise<void> {
  const directory = await createDirectory({ connectionString: await readDatabaseUrl() });
  try {
    const agents = await directory.listAgentsWithPolicyRail();
    if (agents.length === 0) {
      console.log("No tenant has deployed its own policy_rail yet.");
      return;
    }

    console.log(`${agents.length} tenant rail(s):\n`);
    for (const agent of agents) {
      const contractId = agent.policyRailContractId;
      if (contractId === null) continue; // narrows the type; listAgentsWithPolicyRail never returns null here

      const usdc = await readBalance(BAZAAR_USDC_ISSUER, contractId).catch(
        (error: unknown) => `error: ${String(error)}`,
      );
      const low = !usdc.startsWith("error") && Number(usdc) < Number(LOW_USDC_WARNING);

      console.log(`  tenant       ${agent.tenantId}`);
      console.log(`  agent        ${agent.id} (${agent.address})`);
      console.log(`  rail         ${contractId}`);
      console.log(`  USDC         ${usdc}${low ? "  ⚠️  low" : ""}`);
      console.log("");
    }
  } finally {
    await directory.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
