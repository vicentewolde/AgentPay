/**
 * The typed edge of the `agent_registry` contract.
 *
 * `Client.from` builds its methods from the interface spec it fetches off the
 * chain, so TypeScript cannot know them ahead of time. That untyped boundary is
 * confined to this module: every value crossing it is validated with zod before
 * anything else in the SDK sees it. The alternative — converting ScVal by hand —
 * means reimplementing the mapping the contract's own spec already describes,
 * which is a worse place to be wrong.
 */
import { AgentPassError } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";
import { Client, basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { z } from "zod";

import type { AgentPassConfig } from "./config.js";
import { credentialHashToBytes as hex } from "./guards.js";

/** Mirrors `CredStatus` in the contract. */
export const CRED_STATUSES = ["Unknown", "Active", "Revoked", "Expired"] as const;
export type CredStatus = (typeof CRED_STATUSES)[number];

/**
 * A Soroban unit-variant enum arrives as a tagged object, `{ tag: "Active" }` —
 * not the bare string the CLI prints. Parsed rather than assumed.
 */
const credStatusSchema = z
  .object({ tag: z.enum(CRED_STATUSES) })
  .transform((value) => value.tag);

const issuerRecordSchema = z.strictObject({
  active: z.boolean(),
  meta_hash: z.unknown(),
});

export interface IssuerRecord {
  readonly active: boolean;
}

/** A Rust `Result<T, E>` arrives wrapped; unwrapping an `Err` throws. */
function unwrapResult(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "unwrap" in value) {
    const candidate = (value as { unwrap: unknown }).unwrap;
    if (typeof candidate === "function") {
      return (value as { unwrap: () => unknown }).unwrap();
    }
  }
  return value;
}

interface AssembledCall {
  readonly result: unknown;
  signAndSend(): Promise<{ readonly sendTransactionResponse?: { readonly hash?: string } }>;
}

/**
 * Per-call options. Reads simulate from a null account, but a write's source
 * account must be the signer, so `publicKey` is supplied on every write.
 */
interface CallOptions {
  readonly publicKey: string;
}

/** The contract's surface as this SDK uses it. See the module comment. */
interface RegistryMethods {
  status(args: { cred_hash: Buffer }): Promise<AssembledCall>;
  get_issuer(args: { issuer: string }): Promise<AssembledCall>;
  get_credential(args: { cred_hash: Buffer }): Promise<AssembledCall>;
  anchor(
    args: { issuer: string; cred_hash: Buffer; subject: string; expires_at: bigint },
    options: CallOptions,
  ): Promise<AssembledCall>;
  revoke(args: { issuer: string; cred_hash: Buffer }, options: CallOptions): Promise<AssembledCall>;
  register_issuer(
    args: { issuer: string; meta_hash: Buffer },
    options: CallOptions,
  ): Promise<AssembledCall>;
  deactivate_issuer(args: { issuer: string }, options: CallOptions): Promise<AssembledCall>;
}

export class Registry {
  private constructor(
    private readonly config: AgentPassConfig,
    private readonly reader: RegistryMethods,
  ) {}

  /** Fetches the contract's interface spec once and reuses it. */
  static async connect(config: AgentPassConfig): Promise<Registry> {
    try {
      const client = await Client.from({
        contractId: config.contractId,
        networkPassphrase: config.networkPassphrase,
        rpcUrl: config.rpcUrl,
        publicKey: undefined,
      });
      return new Registry(config, client as unknown as RegistryMethods);
    } catch (error) {
      throw new AgentPassError("NetworkError", "could not reach the registry contract", {
        cause: error,
        details: { contractId: config.contractId, rpcUrl: config.rpcUrl },
      });
    }
  }

  async status(credentialHash: string): Promise<CredStatus> {
    const raw = unwrapResult((await this.call(() => this.reader.status({ cred_hash: hex(credentialHash) }))).result);
    const parsed = credStatusSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AgentPassError("NetworkError", "the registry returned an unknown status", {
        details: { status: String(raw), expected: [...CRED_STATUSES] },
      });
    }
    return parsed.data;
  }

  /** `undefined` when the issuer has never been registered. */
  async issuer(address: string): Promise<IssuerRecord | undefined> {
    const raw = unwrapResult((await this.call(() => this.reader.get_issuer({ issuer: address }))).result);
    if (raw === undefined || raw === null) return undefined;

    const parsed = issuerRecordSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AgentPassError("NetworkError", "the registry returned an unreadable issuer record", {
        details: { address, issues: z.treeifyError(parsed.error) },
      });
    }
    return { active: parsed.data.active };
  }

  async anchor(params: {
    issuer: Keypair;
    credentialHash: string;
    subject: string;
    expiresAt: Date;
  }): Promise<string> {
    return this.send(
      () =>
        this.reader.anchor(
          {
            issuer: params.issuer.publicKey(),
            cred_hash: hex(params.credentialHash),
            subject: params.subject,
            expires_at: BigInt(Math.floor(params.expiresAt.getTime() / 1000)),
          },
          { publicKey: params.issuer.publicKey() },
        ),
      params.issuer,
      "anchor",
    );
  }

  /**
   * Admin operation, outside the issue/verify/revoke surface. It lives here
   * because this is the only module that talks to the contract, and without a
   * supported way to register an issuer nobody could run the cycle from a fresh
   * clone.
   */
  async registerIssuer(params: {
    admin: Keypair;
    issuer: string;
    metaHash: string;
  }): Promise<string> {
    return this.send(
      () =>
        this.reader.register_issuer(
          { issuer: params.issuer, meta_hash: hex(params.metaHash) },
          { publicKey: params.admin.publicKey() },
        ),
      params.admin,
      "register_issuer",
    );
  }

  /** Admin operation. Stops new anchors; does not retroactively revoke. */
  async deactivateIssuer(params: { admin: Keypair; issuer: string }): Promise<string> {
    return this.send(
      () =>
        this.reader.deactivate_issuer(
          { issuer: params.issuer },
          { publicKey: params.admin.publicKey() },
        ),
      params.admin,
      "deactivate_issuer",
    );
  }

  async revoke(params: { issuer: Keypair; credentialHash: string }): Promise<string> {
    return this.send(
      () =>
        this.reader.revoke(
          { issuer: params.issuer.publicKey(), cred_hash: hex(params.credentialHash) },
          { publicKey: params.issuer.publicKey() },
        ),
      params.issuer,
      "revoke",
    );
  }

  private async call(build: () => Promise<AssembledCall>): Promise<AssembledCall> {
    try {
      return await build();
    } catch (error) {
      throw new AgentPassError("NetworkError", "the registry call failed", {
        cause: error,
        details: { contractId: this.config.contractId },
      });
    }
  }

  /**
   * Signs and submits. The signer is passed per call rather than held on the
   * client, because anchoring and revoking are authorised by the issuer while
   * the registry's own admin operations are not the SDK's business.
   */
  private async send(
    build: () => Promise<AssembledCall>,
    signer: Keypair,
    operation: string,
  ): Promise<string> {
    const assembled = await this.call(build);
    const { signTransaction } = basicNodeSigner(signer, this.config.networkPassphrase);

    try {
      const sent = await (
        assembled as AssembledCall & {
          signAndSend(options: { signTransaction: typeof signTransaction }): Promise<{
            sendTransactionResponse?: { hash?: string };
          }>;
        }
      ).signAndSend({ signTransaction });

      return sent.sendTransactionResponse?.hash ?? "";
    } catch (error) {
      throw new AgentPassError("NetworkError", `${operation} was rejected by the network`, {
        cause: error,
        details: { operation, contractId: this.config.contractId, signer: signer.publicKey() },
      });
    }
  }
}
