import { AgentPassError } from "@agentpass/core";
import { Networks } from "@stellar/stellar-sdk";
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
