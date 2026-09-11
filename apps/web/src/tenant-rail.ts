/**
 * Each wallet-connected tenant's own `policy_rail` (F6/T58) — deployed
 * lazily, the first time that tenant actually pays via the rail, not when
 * the tenant is created. Same cost reasoning `tenant-agent.ts` already
 * applies to the classic account (`C-21`): most tenants in this pilot never
 * spend enough to justify one.
 *
 * **Why this cannot reuse `scripts/deploy-policy-rail.ts`.** That script
 * shells out to the `stellar` CLI (`execFile`) — fine for a human running it
 * once against `.env.local`, but this code runs inside the live web server
 * (Render has no `stellar` CLI installed, and depending on one there would
 * be a new, unnecessary attack surface). `@stellar/stellar-sdk`'s
 * `contract.Client.deploy` does the same job — create a new instance from a
 * wasm hash **already uploaded** to the network — without shelling out to
 * anything: it fetches the contract's spec straight from RPC by wasm hash,
 * so this module never needs the compiled `.wasm` file, only its hash
 * (`POLICY_RAIL_WASM_HASH`, the same hash `deployments/testnet.json` already
 * records for the shared pilot rail — one wasm, many instances).
 *
 * **Who is `owner` and who is `principal`, here.** `owner` is this tenant's
 * own derived agent key (`ensureTenantAgent` — the same key that already
 * signs the tenant's Mandato); it authorises day-to-day spend, same role
 * `AGENT_SECRET_KEY` plays for the shared rail today. `principal` is the
 * wallet this tenant already proved control of before a Mandato could even
 * exist (`directory.bindPrincipal`, called from both `/api/wallet/verify`
 * and the hosted-consent flow) — the only address that can withdraw or
 * rotate `owner` (T57, `C-61`). Both are always real and already resolved by
 * the time a wallet-connected session reaches `buy()`; this module never
 * invents either.
 *
 * **What this does not cover.** The classic, no-wallet demo path (`C-34`)
 * has no tenant identity to own a rail with — it keeps paying from the
 * shared account/rail, exactly as it does today. Balance monitoring is a
 * separate ticket (T59) — this module funds a rail once, at deploy time, and
 * never checks back.
 */
import { AgentPassError } from "@agentpass/core";
import { BAZAAR_USDC_ISSUER, fromScaledAmount, toScaledAmount } from "@agentpay/agent";
import type { Directory } from "@agentpay/directory";
import { Keypair, Networks, StrKey, contract } from "@stellar/stellar-sdk";

import type { TenantAgent } from "./tenant-agent.js";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const FRIENDBOT_URL = "https://friendbot.stellar.org";

/**
 * Same limits the shared rail deploys with (`scripts/deploy-policy-rail.ts`).
 * Making these configurable per tenant or partner is a product decision for
 * later — out of scope here.
 */
const PER_TX = "0.0020000";
const PER_DAY = "0.0100000";
const VALID_DAYS = 365;

/** How much USDC a freshly deployed tenant rail starts with. */
const INITIAL_FUNDING = "0.0500000";

/** The slice of {@link Directory} this depends on. */
export type TenantRailDirectory = Pick<Directory, "setAgentPolicyRail">;

interface UsdcContract {
  transfer(
    args: { readonly from: string; readonly to: string; readonly amount: bigint },
    options?: contract.MethodOptions,
  ): Promise<contract.AssembledTransaction<null>>;
}

function railError(message: string, details: Record<string, unknown>, cause?: unknown): AgentPassError {
  return new AgentPassError("NetworkError", message, { cause, details });
}

/** Funds a classic account through Friendbot. "Already exists" counts as success — testnet only. */
async function fundWithFriendbot(address: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(address)}`);
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  if (response.status === 400 && body.includes("op_already_exists")) return;
  throw railError("Friendbot could not fund the tenant's rail owner account", {
    address,
    status: response.status,
    body: body.slice(0, 500),
  });
}

/** Deploys a fresh `policy_rail` instance from an already-uploaded wasm, owned and paid for by `owner`. */
async function deployRailContract(params: {
  readonly owner: Keypair;
  readonly principalAddress: string;
  readonly wasmHash: string;
}): Promise<string> {
  const validUntil = BigInt(Math.floor(Date.now() / 1000) + VALID_DAYS * 24 * 60 * 60);

  let assembled: contract.AssembledTransaction<contract.Client>;
  try {
    assembled = await contract.Client.deploy(
      {
        owner: Buffer.from(StrKey.decodeEd25519PublicKey(params.owner.publicKey())),
        principal: params.principalAddress,
        asset: BAZAAR_USDC_ISSUER,
        per_tx: toScaledAmount(PER_TX),
        per_day: toScaledAmount(PER_DAY),
        valid_until: validUntil,
      },
      {
        wasmHash: params.wasmHash,
        format: "hex",
        address: params.owner.publicKey(),
        publicKey: params.owner.publicKey(),
        signTransaction: params.owner,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      },
    );
  } catch (error) {
    throw railError("could not build this tenant's policy_rail deployment", {
      owner: params.owner.publicKey(),
      principal: params.principalAddress,
    }, error);
  }

  const sent = await assembled.signAndSend().catch((error: unknown) => {
    throw railError("deploying this tenant's policy_rail failed", {
      owner: params.owner.publicKey(),
      principal: params.principalAddress,
    }, error);
  });

  const contractId = sent.result.options.contractId;
  if (!StrKey.isValidContract(contractId)) {
    throw railError("the deployed rail did not return a usable contract id", { contractId });
  }
  return contractId;
}

/** Moves the initial USDC balance into a freshly deployed rail, from the account that already holds it. */
async function fundRailBalance(rail: { readonly contractId: string; readonly funder: Keypair }): Promise<void> {
  const usdc = await contract.Client.from<UsdcContract>({
    contractId: BAZAAR_USDC_ISSUER,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: rail.funder.publicKey(),
    signTransaction: rail.funder,
  });

  const transfer = await usdc.transfer({
    from: rail.funder.publicKey(),
    to: rail.contractId,
    amount: toScaledAmount(INITIAL_FUNDING),
  });
  await transfer.signAndSend().catch((error: unknown) => {
    throw railError("funding the newly deployed policy_rail with USDC failed", {
      contractId: rail.contractId,
      funder: rail.funder.publicKey(),
      amount: fromScaledAmount(toScaledAmount(INITIAL_FUNDING)),
    }, error);
  });
}

/**
 * Finds this tenant's own `policy_rail`, deploying and funding it on the
 * first call. Idempotent by lookup, same shape as `ensureTenantAgent`: a
 * race between two concurrent first payments resolves in
 * `setAgentPolicyRail` itself (first write wins), not here.
 *
 * @param reserve The account that funds a freshly deployed rail's initial
 * USDC balance — the same account (`AGENT_SECRET_KEY`) that funds the shared
 * rail today.
 */
export async function ensureTenantPolicyRail(
  directory: TenantRailDirectory,
  tenantAgent: TenantAgent,
  principalAddress: string,
  reserve: Keypair,
  wasmHash: string,
): Promise<string> {
  const existing = tenantAgent.instance.policyRailContractId;
  if (existing !== null) return existing;

  await fundWithFriendbot(tenantAgent.keypair.publicKey());
  const contractId = await deployRailContract({
    owner: tenantAgent.keypair,
    principalAddress,
    wasmHash,
  });
  await fundRailBalance({ contractId, funder: reserve });

  const persisted = await directory.setAgentPolicyRail(tenantAgent.instance.id, contractId);
  return persisted.policyRailContractId ?? contractId;
}
