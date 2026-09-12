/**
 * G12: proves `prepareAnchor`/`prepareRevoke`/`submitSigned` no longer need
 * to run on the *same* `Registry` instance — only the same `PendingWriteStore`.
 * Against **live Stellar testnet**, nothing mocked, same discipline as
 * `agentpass.integration.test.ts`.
 *
 *   pnpm run test:integration
 *
 * Requires `.env.local` — see that file's own header for setup.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { hasErrorCode, stellarAddressToDid } from "@agentpass/core";
import type { AgentPassCredential } from "@agentpass/core";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";

import { configFromEnv, createAgentPass } from "./index.js";
import type { AgentPass } from "./index.js";
import type { PendingWrite, PendingWriteStore } from "./registry.js";

const ENV_PATH = fileURLToPath(new URL("../../../.env.local", import.meta.url));
const MINUTE = 60_000;

async function loadEnv(): Promise<Record<string, string>> {
  const contents = await readFile(ENV_PATH, "utf8").catch(() => {
    throw new Error(
      `${ENV_PATH} is missing. Run \`pnpm run bootstrap\` and \`pnpm run deploy:registry\` first.`,
    );
  });
  const env: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"(.*)"\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) env[match[1]] = match[2];
  }
  return env;
}

/** A `PendingWriteStore` this test can hand to two separate `createAgentPass` calls, standing in for two separate processes sharing durable storage (`apps/web`'s Postgres-backed one, in production). */
function createSharedPendingWriteStore(): PendingWriteStore {
  const entries = new Map<string, PendingWrite>();
  return {
    async save(requestId, write) {
      entries.set(requestId, write);
    },
    async take(requestId) {
      const write = entries.get(requestId);
      entries.delete(requestId);
      return write;
    },
  };
}

let issuer: Keypair;
let admin: Keypair;
let networkPassphrase: string;
let sharedStore: PendingWriteStore;
let agentpassA: AgentPass;
let agentpassB: AgentPass;

beforeAll(async () => {
  const env = await loadEnv();
  admin = Keypair.fromSecret(env["ADMIN_SECRET_KEY"] ?? "");
  issuer = Keypair.fromSecret(env["ISSUER_SECRET_KEY"] ?? "");
  networkPassphrase = env["STELLAR_NETWORK_PASSPHRASE"] ?? "";

  sharedStore = createSharedPendingWriteStore();
  const config = configFromEnv(env);
  // Two independent instances on purpose — nothing about them is shared
  // except `sharedStore`, standing in for two separate `apps/web` processes
  // both pointed at the same Postgres.
  [agentpassA, agentpassB] = await Promise.all([
    createAgentPass(config, { pendingWriteStore: sharedStore }),
    createAgentPass(config, { pendingWriteStore: sharedStore }),
  ]);

  const status = await agentpassA.issuerStatus(issuer.publicKey());
  if (!status.registered || !status.active) {
    const { randomBytes } = await import("node:crypto");
    await agentpassA.registerIssuer({
      admin,
      issuer: issuer.publicKey(),
      metaHash: randomBytes(32).toString("hex"),
    });
  }
}, 3 * MINUTE);

/** Signs an unsigned XDR exactly as a wallet extension (Freighter, etc.) would, so the test never touches a browser. */
function signAsWallet(xdr: string, signer: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  tx.sign(signer);
  return tx.toXDR();
}

async function credential(agentpass: AgentPass): Promise<AgentPassCredential> {
  const { randomBytes } = await import("node:crypto");
  const issuerDid = stellarAddressToDid(issuer.publicKey(), "testnet");
  const now = Date.now();
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "AgentPassCredential"],
    issuer: issuerDid,
    validFrom: new Date(now - 60_000).toISOString(),
    validUntil: new Date(now + 24 * 60 * 60_000).toISOString(),
    credentialSubject: {
      id: issuerDid,
      agent: {
        name: `pending-write-${randomBytes(6).toString("hex")}`,
        model: "claude-sonnet-4-6",
        operator: "agentpass-pilot",
      },
      principal: issuerDid,
      scope: {
        actions: ["catalog:read"],
        venues: [],
        assets: [],
        limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" },
      },
    },
    credentialStatus: { type: "AgentPassRegistry2026", registry: agentpass.config.contractId },
  };
}

describe("G12: a prepared write survives moving to a different Registry instance", () => {
  it(
    "prepareRevoke on instance A, submitSigned on instance B — over the same store, not the same object",
    async () => {
      const cred = await credential(agentpassA);
      const issued = await agentpassA.issue({ credential: cred, issuer });
      await expect(agentpassB.status(issued.hash)).resolves.toBe("Active");

      // Prepared on A: this is where the old code stashed the AssembledCall
      // in A's own in-memory Map — the exact thing G12 could not survive.
      const prepared = await agentpassA.prepareRevoke({
        issuerAddress: issuer.publicKey(),
        credentialHash: issued.hash,
      });
      const signedTxXdr = signAsWallet(prepared.xdr, issuer);

      // Finished on B — a Registry that never called prepareRevoke itself,
      // and never saw the AssembledCall A built. Only `sharedStore` bridges
      // the two: proof the fix does not depend on instance identity.
      const transactionHash = await agentpassB.submitSigned(prepared.requestId, signedTxXdr);
      expect(transactionHash).not.toBe("");

      await expect(agentpassA.status(issued.hash)).resolves.toBe("Revoked");
    },
    5 * MINUTE,
  );

  it(
    "prepareAnchor on instance A, submitSigned on instance B — the path the wallet-connect Mandate flow actually uses",
    async () => {
      const { randomBytes } = await import("node:crypto");
      const subject = Keypair.random().publicKey();
      const credentialHash = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);

      const prepared = await agentpassA.prepareAnchor({
        issuerAddress: issuer.publicKey(),
        credentialHash,
        subject,
        expiresAt,
      });
      const signedTxXdr = signAsWallet(prepared.xdr, issuer);

      const transactionHash = await agentpassB.submitSigned(prepared.requestId, signedTxXdr);
      expect(transactionHash).not.toBe("");

      const record = await agentpassA.getRecord(credentialHash);
      expect(record?.subject).toBe(subject);
      expect(record?.revoked).toBe(false);
    },
    5 * MINUTE,
  );

  it(
    "submitSigned refuses a requestId nobody prepared, on either instance",
    async () => {
      await expect(agentpassB.submitSigned("not-a-real-request-id", "AAAA")).rejects.toSatisfy(
        (error: unknown) => hasErrorCode(error, "ConfigError"),
      );
    },
    MINUTE,
  );
});
