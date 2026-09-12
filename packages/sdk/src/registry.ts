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
import { randomUUID } from "node:crypto";

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

/** Mirrors `CredRecord` in the contract — verified against a real deployment before writing this. */
const credRecordSchema = z.strictObject({
  issuer: z.string(),
  subject: z.string(),
  issued_at: z.bigint(),
  expires_at: z.bigint(),
  revoked: z.boolean(),
});

export interface CredRecord {
  readonly issuer: string;
  readonly subject: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly revoked: boolean;
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

/** A wallet's own `signTransaction` — same shape Freighter and every other
 * Stellar wallet returns, so a browser's answer can be forwarded here
 * unchanged (see `Registry.submitSigned`). */
type WalletSignTransaction = (xdr: string) => Promise<{ readonly signedTxXdr: string }>;

interface AssembledCall {
  readonly result: unknown;
  signAndSend(options?: {
    readonly signTransaction?: WalletSignTransaction;
  }): Promise<{ readonly sendTransactionResponse?: { readonly hash?: string } }>;
  /** Serialises the assembled-but-unsigned transaction so a wallet can sign it — T35. */
  toXdr(): string;
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

/** What `prepareAnchor`/`prepareRevoke` hand back for a wallet to sign — T35. */
export interface PreparedRegistryWrite {
  readonly requestId: string;
  readonly xdr: string;
}

/**
 * What a `prepareAnchor`/`prepareRevoke` call needs to be redone, once a
 * wallet's signature comes back — G12. Deliberately just the public call
 * parameters, not the assembled-and-simulated transaction itself: those are
 * small, JSON-safe, and enough to re-simulate the exact same call in
 * `submitSigned`, which is all `signAndSend` ends up needing (it replaces
 * whatever it simulated with the wallet's own signed XDR before sending —
 * see `submitSigned`'s own comment).
 */
export type PendingWrite =
  | { readonly kind: "anchor"; readonly issuerAddress: string; readonly credentialHash: string; readonly subject: string; readonly expiresAt: string }
  | { readonly kind: "revoke"; readonly issuerAddress: string; readonly credentialHash: string };

/**
 * Where a `Registry` keeps a `PendingWrite` between `prepareAnchor`/
 * `prepareRevoke` and `submitSigned` — the two-phase wallet write's whole
 * reason to exist (T35). The default, in-memory implementation below only
 * ever survives within one process; a caller whose wallet-anchor flow must
 * survive more than one process (`apps/web`, G12) supplies its own backed by
 * shared storage instead — `Registry` never has to know the difference.
 */
export interface PendingWriteStore {
  save(requestId: string, write: PendingWrite, ttlMs: number): Promise<void>;
  /** Reads and consumes — a `requestId` cannot be replayed. `undefined` if absent or expired. */
  take(requestId: string): Promise<PendingWrite | undefined>;
}

/** How long an unsigned transaction waits for its signature before it is
 * forgotten — long enough for a human to approve it in their wallet, short
 * enough that an abandoned one does not leak forever. */
const PENDING_WRITE_TTL_MS = 10 * 60_000;

/** `PendingWriteStore`'s original shape, before G12 — a `Map` scoped to one process. */
function createInMemoryPendingWriteStore(): PendingWriteStore {
  const entries = new Map<string, { readonly write: PendingWrite; readonly expiresAt: number }>();

  function pruneExpired(): void {
    const now = Date.now();
    for (const [id, entry] of entries) {
      if (entry.expiresAt < now) entries.delete(id);
    }
  }

  return {
    async save(requestId, write, ttlMs) {
      pruneExpired();
      entries.set(requestId, { write, expiresAt: Date.now() + ttlMs });
    },
    async take(requestId) {
      pruneExpired();
      const entry = entries.get(requestId);
      entries.delete(requestId);
      return entry?.write;
    },
  };
}

export class Registry {
  private constructor(
    private readonly config: AgentPassConfig,
    private readonly reader: RegistryMethods,
    private readonly pendingWrites: PendingWriteStore,
  ) {}

  /** Fetches the contract's interface spec once and reuses it. `store` defaults to an in-process `Map` — see `PendingWriteStore`. */
  static async connect(config: AgentPassConfig, store: PendingWriteStore = createInMemoryPendingWriteStore()): Promise<Registry> {
    try {
      const client = await Client.from({
        contractId: config.contractId,
        networkPassphrase: config.networkPassphrase,
        rpcUrl: config.rpcUrl,
        publicKey: undefined,
      });
      return new Registry(config, client as unknown as RegistryMethods, store);
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

  /**
   * The full anchored record for a hash — who anchored it, for whom, when,
   * until when, and whether it has been revoked since. `status()` collapses
   * all of that into one of four words; this is what it collapses.
   *
   * `undefined` when the hash was never anchored.
   */
  async getCredential(credentialHash: string): Promise<CredRecord | undefined> {
    const raw = unwrapResult(
      (await this.call(() => this.reader.get_credential({ cred_hash: hex(credentialHash) }))).result,
    );
    if (raw === undefined || raw === null) return undefined;

    const parsed = credRecordSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AgentPassError("NetworkError", "the registry returned an unreadable credential record", {
        details: { credentialHash, issues: z.treeifyError(parsed.error) },
      });
    }
    return {
      issuer: parsed.data.issuer,
      subject: parsed.data.subject,
      issuedAt: new Date(Number(parsed.data.issued_at) * 1000),
      expiresAt: new Date(Number(parsed.data.expires_at) * 1000),
      revoked: parsed.data.revoked,
    };
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

  /**
   * `anchor`'s two-phase twin — for a principal this process never holds the
   * secret key for. Builds and simulates the same call with `issuerAddress`
   * as the transaction's source, same as `anchor()` does with a `Keypair`'s
   * public key, but stops before signing: only that address's own wallet can
   * produce a signature the contract's `issuer.require_auth()` accepts.
   */
  async prepareAnchor(params: {
    issuerAddress: string;
    credentialHash: string;
    subject: string;
    expiresAt: Date;
  }): Promise<PreparedRegistryWrite> {
    const assembled = await this.call(() => this.simulateAnchor(params));
    return this.stashForSigning({
      kind: "anchor",
      issuerAddress: params.issuerAddress,
      credentialHash: params.credentialHash,
      subject: params.subject,
      expiresAt: params.expiresAt.toISOString(),
    }, assembled);
  }

  /** `revoke`'s two-phase twin — see {@link prepareAnchor} for why one is needed at all. */
  async prepareRevoke(params: { issuerAddress: string; credentialHash: string }): Promise<PreparedRegistryWrite> {
    const assembled = await this.call(() => this.simulateRevoke(params));
    return this.stashForSigning({ kind: "revoke", issuerAddress: params.issuerAddress, credentialHash: params.credentialHash }, assembled);
  }

  /** The exact simulate-only call `prepareAnchor` makes, factored out so `submitSigned` can redo it from a stored `PendingWrite` — G12. */
  private simulateAnchor(params: { issuerAddress: string; credentialHash: string; subject: string; expiresAt: Date }): Promise<AssembledCall> {
    return this.reader.anchor(
      {
        issuer: params.issuerAddress,
        cred_hash: hex(params.credentialHash),
        subject: params.subject,
        expires_at: BigInt(Math.floor(params.expiresAt.getTime() / 1000)),
      },
      { publicKey: params.issuerAddress },
    );
  }

  /** The exact simulate-only call `prepareRevoke` makes — see {@link simulateAnchor}. */
  private simulateRevoke(params: { issuerAddress: string; credentialHash: string }): Promise<AssembledCall> {
    return this.reader.revoke(
      { issuer: params.issuerAddress, cred_hash: hex(params.credentialHash) },
      { publicKey: params.issuerAddress },
    );
  }

  private async stashForSigning(write: PendingWrite, assembled: AssembledCall): Promise<PreparedRegistryWrite> {
    const requestId = randomUUID();
    await this.pendingWrites.save(requestId, write, PENDING_WRITE_TTL_MS);
    return { requestId, xdr: assembled.toXdr() };
  }

  /**
   * Finishes a `prepareAnchor`/`prepareRevoke` call once a wallet has signed
   * the XDR it returned. The signed XDR is forwarded to the underlying SDK
   * exactly as a wallet returned it — this method never re-derives or
   * re-checks whose key produced it; the network is the one that accepts or
   * refuses the signature, the same way it always has for `anchor`/`revoke`.
   *
   * G12: does not reuse the `AssembledCall` `prepareAnchor`/`prepareRevoke`
   * built — that object lives only in this process's memory, and cannot
   * survive `pendingWrites` being backed by shared storage. Instead it
   * re-simulates the exact same call from the stored `PendingWrite`'s public
   * parameters. This is safe because `AssembledTransaction.sign()` (the
   * underlying SDK) discards whatever it just simulated the moment a
   * `signTransaction` callback returns its own `signedTxXdr` — as this one
   * does — and rebuilds the transaction to send entirely from that string.
   * The simulation only ever existed to produce the unsigned XDR a wallet
   * signs; a fresh one produces an equivalent transaction to sign onto.
   *
   * @throws AgentPassError `ConfigError` if `requestId` names no pending
   * transaction — already submitted, or its TTL passed.
   */
  async submitSigned(requestId: string, signedTxXdr: string): Promise<string> {
    const write = await this.pendingWrites.take(requestId);
    if (write === undefined) {
      throw new AgentPassError("ConfigError", "no pending transaction for this requestId — it may have expired", {
        details: { requestId },
      });
    }

    const assembled = await this.call(() =>
      write.kind === "anchor"
        ? this.simulateAnchor({ ...write, expiresAt: new Date(write.expiresAt) })
        : this.simulateRevoke(write),
    );

    try {
      const sent = await assembled.signAndSend({ signTransaction: async () => ({ signedTxXdr }) });
      return sent.sendTransactionResponse?.hash ?? "";
    } catch (error) {
      throw new AgentPassError("NetworkError", "the wallet-signed transaction was rejected by the network", {
        cause: error,
        details: { requestId, contractId: this.config.contractId },
      });
    }
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
