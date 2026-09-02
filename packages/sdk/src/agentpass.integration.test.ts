/**
 * The full cycle against **live Stellar testnet**. Nothing here is mocked: the
 * contract calls go to the deployed registry and the transactions are real.
 *
 *   pnpm run test:integration
 *
 * Requires `.env.local` — run `pnpm run bootstrap` and `pnpm run deploy:registry`
 * first. The test registers the issuer itself if the registry has not seen it,
 * so it works from a fresh deployment.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { AgentPassCredential } from "@agentpass/core";
import { hasErrorCode, stellarAddressToDid } from "@agentpass/core";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";

import type { AgentPass } from "./index.js";
import { configFromEnv, createAgentPass } from "./index.js";

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

let agentpass: AgentPass;
let issuer: Keypair;
let agent: Keypair;
let admin: Keypair;

beforeAll(async () => {
  const env = await loadEnv();
  admin = Keypair.fromSecret(env["ADMIN_SECRET_KEY"] ?? "");
  issuer = Keypair.fromSecret(env["ISSUER_SECRET_KEY"] ?? "");
  agent = Keypair.fromSecret(env["AGENT_SECRET_KEY"] ?? "");

  agentpass = await createAgentPass(configFromEnv(env));

  const status = await agentpass.issuerStatus(issuer.publicKey());
  if (!status.registered || !status.active) {
    await agentpass.registerIssuer({
      admin,
      issuer: issuer.publicKey(),
      metaHash: randomBytes(32).toString("hex"),
    });
  }
}, 3 * MINUTE);

/** A fresh nonce per run, so every credential hashes to something new. */
function credential(overrides: Partial<AgentPassCredential> = {}): AgentPassCredential {
  const issuerDid = stellarAddressToDid(issuer.publicKey(), "testnet");
  const now = Date.now();

  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "AgentPassCredential"],
    issuer: issuerDid,
    validFrom: new Date(now - 60_000).toISOString(),
    validUntil: new Date(now + 24 * 60 * 60_000).toISOString(),
    credentialSubject: {
      id: stellarAddressToDid(agent.publicKey(), "testnet"),
      agent: {
        name: `compras-demo-${randomBytes(6).toString("hex")}`,
        model: "claude-sonnet-4-6",
        operator: "agentpass-pilot",
      },
      principal: issuerDid,
      scope: {
        actions: ["catalog:read", "intent:create"],
        venues: [],
        assets: [],
        limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" },
      },
    },
    credentialStatus: {
      type: "AgentPassRegistry2026",
      registry: agentpass.config.contractId,
    },
    ...overrides,
  };
}

describe("the full cycle on live testnet", () => {
  it(
    "issues, verifies, revokes, and then refuses to verify",
    async () => {
      const issued = await agentpass.issue({ credential: credential(), issuer });

      expect(issued.jws.split(".")).toHaveLength(3);
      expect(issued.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(issued.transactionHash).not.toBe("");

      // Anchored and active on chain.
      await expect(agentpass.status(issued.hash)).resolves.toBe("Active");

      // All three checks pass.
      const verified = await agentpass.verify(issued.jws);
      expect(verified.status).toBe("Active");
      expect(verified.hash).toBe(issued.hash);
      expect(verified.issuerAddress).toBe(issuer.publicKey());

      // The principal cuts it from outside the agent.
      await agentpass.revoke({ credentialHash: issued.hash, issuer });

      await expect(agentpass.status(issued.hash)).resolves.toBe("Revoked");

      // The same JWS, byte for byte, no longer verifies.
      try {
        await agentpass.verify(issued.jws);
        expect.unreachable("a revoked credential must not verify");
      } catch (error) {
        expect(hasErrorCode(error, "CredentialRevoked")).toBe(true);
      }
    },
    5 * MINUTE,
  );

  it(
    "refuses a validly signed credential that was never anchored",
    async () => {
      const { signCredential } = await import("@agentpass/core");
      const signed = await signCredential(credential(), issuer);

      await expect(agentpass.status(signed.hash)).resolves.toBe("Unknown");
      await expect(agentpass.verify(signed.jws)).rejects.toSatisfy((error: unknown) =>
        hasErrorCode(error, "CredentialUnknown"),
      );
    },
    3 * MINUTE,
  );

  it(
    "refuses a credential that names a registry this client does not trust",
    async () => {
      const { signCredential } = await import("@agentpass/core");
      const foreign = credential({
        credentialStatus: {
          type: "AgentPassRegistry2026",
          registry: StrKey.encodeContract(randomBytes(32)),
        },
      });
      const signed = await signCredential(foreign, issuer);

      await expect(agentpass.verify(signed.jws)).rejects.toSatisfy((error: unknown) =>
        hasErrorCode(error, "RegistryMismatch"),
      );
    },
    3 * MINUTE,
  );
});
