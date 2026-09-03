import { AgentPassError } from "@agentpass/core";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { z } from "zod";

export const TESTNET = {
  network: "testnet",
  passphrase: Networks.TESTNET,
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
} as const;

const REQUEST_TIMEOUT_MS = 30_000;

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new AgentPassError("NetworkError", `request to ${url} failed`, {
      cause: error,
      details: { url },
    });
  }
}

async function parseJson<T>(response: Response, schema: z.ZodType<T>, url: string): Promise<T> {
  const body: unknown = await response.json().catch((error: unknown) => {
    throw new AgentPassError("NetworkError", `${url} returned a non-JSON body`, { cause: error });
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AgentPassError("NetworkError", `${url} returned an unexpected shape`, {
      details: { url, issues: z.treeifyError(parsed.error) },
    });
  }
  return parsed.data;
}

const versionInfoSchema = z.object({
  result: z.object({
    version: z.string(),
    protocolVersion: z.number().int().positive(),
    captiveCoreVersion: z.string().optional(),
  }),
});

export interface LiveVersion {
  readonly protocolVersion: number;
  readonly rpcVersion: string;
  readonly coreVersion: string | undefined;
}

/**
 * The live protocol version of the network, straight from the RPC node. Never
 * inferred from the CLI or SDK version — those drift ahead of and behind it.
 */
export async function getLiveVersion(rpcUrl: string): Promise<LiveVersion> {
  const response = await request(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getVersionInfo" }),
  });

  if (!response.ok) {
    throw new AgentPassError("NetworkError", `getVersionInfo failed with ${response.status}`, {
      details: { url: rpcUrl, status: response.status },
    });
  }

  const { result } = await parseJson(response, versionInfoSchema, rpcUrl);
  return {
    protocolVersion: result.protocolVersion,
    rpcVersion: result.version,
    coreVersion: result.captiveCoreVersion,
  };
}

const accountSchema = z.object({
  balances: z.array(z.object({ asset_type: z.string(), balance: z.string() })),
});

export interface AccountState {
  readonly funded: boolean;
  readonly nativeBalance: string | undefined;
}

/** 404 from Horizon means "not funded yet", which is a normal state, not a failure. */
export async function getAccountState(
  horizonUrl: string,
  address: string,
): Promise<AccountState> {
  const url = `${horizonUrl}/accounts/${address}`;
  const response = await request(url);

  if (response.status === 404) {
    return { funded: false, nativeBalance: undefined };
  }
  if (!response.ok) {
    throw new AgentPassError("NetworkError", `Horizon answered ${response.status}`, {
      details: { url, status: response.status },
    });
  }

  const account = await parseJson(response, accountSchema, url);
  const native = account.balances.find((balance) => balance.asset_type === "native");
  return { funded: true, nativeBalance: native?.balance };
}

/**
 * Funds an account through Friendbot. Treats "already exists" as success so a
 * repeated run, or a race with another bootstrap, is not an error.
 */
export async function fundWithFriendbot(friendbotUrl: string, address: string): Promise<void> {
  const url = `${friendbotUrl}/?addr=${encodeURIComponent(address)}`;
  const response = await request(url);

  if (response.ok) return;

  const body = await response.text().catch(() => "");
  if (response.status === 400 && body.includes("op_already_exists")) return;

  throw new AgentPassError("NetworkError", `Friendbot answered ${response.status}`, {
    details: { url, status: response.status, body: body.slice(0, 500) },
  });
}

const trustlineAccountSchema = z.object({
  balances: z.array(
    z.object({
      asset_type: z.string(),
      asset_code: z.string().optional(),
      asset_issuer: z.string().optional(),
      balance: z.string(),
    }),
  ),
});

export interface TrustlineState {
  readonly exists: boolean;
  readonly balance: string | undefined;
}

/** Whether `address` already trusts `code:issuer`. An unfunded account (404) reads as "no trustline". */
export async function getTrustline(
  horizonUrl: string,
  address: string,
  code: string,
  issuer: string,
): Promise<TrustlineState> {
  const url = `${horizonUrl}/accounts/${address}`;
  const response = await request(url);

  if (response.status === 404) return { exists: false, balance: undefined };
  if (!response.ok) {
    throw new AgentPassError("NetworkError", `Horizon answered ${response.status}`, {
      details: { url, status: response.status },
    });
  }

  const account = await parseJson(response, trustlineAccountSchema, url);
  const line = account.balances.find(
    (balance) => balance.asset_code === code && balance.asset_issuer === issuer,
  );
  return { exists: line !== undefined, balance: line?.balance };
}

/**
 * Opens a trustline for `code:issuer` on `source`'s account. `source` must
 * already be a funded classic account — this only submits `change_trust`,
 * it does not fund anything.
 */
export async function openTrustline(params: {
  readonly horizonUrl: string;
  readonly networkPassphrase: string;
  readonly source: Keypair;
  readonly code: string;
  readonly issuer: string;
}): Promise<string> {
  const server = new Horizon.Server(params.horizonUrl);

  const account = await server.loadAccount(params.source.publicKey()).catch((error: unknown) => {
    throw new AgentPassError("NetworkError", "could not load the source account from Horizon", {
      cause: error,
      details: { horizonUrl: params.horizonUrl, address: params.source.publicKey() },
    });
  });

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: new Asset(params.code, params.issuer) }))
    .setTimeout(30)
    .build();
  transaction.sign(params.source);

  const result = await server.submitTransaction(transaction).catch((error: unknown) => {
    throw new AgentPassError("NetworkError", "change_trust submission failed", {
      cause: error,
      details: { horizonUrl: params.horizonUrl, code: params.code, issuer: params.issuer },
    });
  });
  return result.hash;
}
