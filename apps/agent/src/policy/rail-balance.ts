/**
 * A SEP-41 `balance()` simulation of a tenant's `policy_rail` (F6/T58) —
 * never a `transfer` — the same read `scripts/check-rail-balances.ts` (T60)
 * makes as an operator script.
 *
 * Written for the status dashboard in T71 and moved here in T76, when
 * `/v1/tenants/{id}/activity` needed the same number. It sits next to
 * `BAZAAR_USDC_ISSUER` and `fromScaledAmount`, the two things it reads, and
 * both callers now import the one implementation rather than keeping a copy
 * each — a second way to read a balance is a second way for two screens to
 * disagree about the same rail.
 */
import { Networks, contract } from "@stellar/stellar-sdk";

import { BAZAAR_USDC_ISSUER } from "../catalog/bazaar.js";
import { fromScaledAmount } from "../scope/amount.js";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

interface SacBalance {
  balance(args: { readonly id: string }): Promise<contract.AssembledTransaction<bigint>>;
}

/** Reads a rail's USDC balance by simulating `balance()` on the SEP-41 asset contract — no signing, no transfer. */
export async function readRailUsdcBalance(railContractId: string): Promise<string> {
  const client = await contract.Client.from<SacBalance>({
    contractId: BAZAAR_USDC_ISSUER,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const assembled = await client.balance({ id: railContractId });
  return fromScaledAmount(assembled.result);
}
