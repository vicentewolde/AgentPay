/**
 * The only piece of `status.ts` that reads Stellar directly (T71). A SEP-41
 * `balance()` simulation of a tenant's `policy_rail` (F6/T58) — never a
 * `transfer` — same call `scripts/check-rail-balances.ts` (T60) already
 * makes as an operator script; this makes the same read reachable from the
 * dashboard, per tenant, instead of only a full server-wide CLI listing.
 */
import { BAZAAR_USDC_ISSUER, fromScaledAmount } from "@agentpey/agent";
import { Networks, contract } from "@stellar/stellar-sdk";

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
