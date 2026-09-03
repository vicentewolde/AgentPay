/**
 * The full cycle against **live Stellar testnet**. Nothing here is mocked: the
 * contract calls go to the deployed `agent_registry` and the transactions are
 * real — the same contract, the same deployment, `packages/sdk`'s own
 * integration suite already exercises for credentials.
 *
 *   pnpm run test:integration
 *
 * Requires `.env.local` — run `pnpm run bootstrap` and `pnpm run deploy:registry`
 * first. `ISSUER_SECRET_KEY` plays the mandate's principal: it is already
 * registered as an issuer for the credential suite, and `M-3`/`M-17` count on
 * exactly that — a principal registers through the same generic
 * `AgentPass.registerIssuer()` a credential issuer does, no mandate-specific
 * registration exists or is needed.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { hasErrorCode } from "@agentpass/core";
import { configFromEnv, createAgentPass, type AgentPass } from "@agentpass/sdk";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";

import { anchorMandate, revokeMandate, verifyMandateOnChain } from "./anchor.js";
import { makeTestMandate } from "./testing.js";

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
let principal: Keypair;
let agent: Keypair;
let admin: Keypair;

beforeAll(async () => {
  const env = await loadEnv();
  admin = Keypair.fromSecret(env["ADMIN_SECRET_KEY"] ?? "");
  principal = Keypair.fromSecret(env["ISSUER_SECRET_KEY"] ?? "");
  agent = Keypair.fromSecret(env["AGENT_SECRET_KEY"] ?? "");

  agentpass = await createAgentPass(configFromEnv(env));

  const status = await agentpass.issuerStatus(principal.publicKey());
  if (!status.registered || !status.active) {
    await agentpass.registerIssuer({
      admin,
      issuer: principal.publicKey(),
      metaHash: randomBytes(32).toString("hex"),
    });
  }
}, 3 * MINUTE);

describe("the full cycle on live testnet", () => {
  it(
    "anchors, verifies, revokes, and then refuses to verify",
    async () => {
      const mandate = makeTestMandate(principal, agent, { registry: agentpass.config.contractId });

      const anchored = await anchorMandate(agentpass, { mandate, principal });

      expect(anchored.jws.split(".")).toHaveLength(3);
      expect(anchored.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(anchored.transactionHash).not.toBe("");

      // Anchored and active on chain — the same `agent_registry`, the same
      // `status()` a credential's hash would be checked against.
      await expect(agentpass.status(anchored.hash)).resolves.toBe("Active");

      // All four checks pass.
      const verified = await verifyMandateOnChain(agentpass, anchored.jws);
      expect(verified.status).toBe("Active");
      expect(verified.hash).toBe(anchored.hash);
      expect(verified.principalAddress).toBe(principal.publicKey());

      // The principal cuts it from outside the agent.
      await revokeMandate(agentpass, { mandateHash: anchored.hash, principal });

      await expect(agentpass.status(anchored.hash)).resolves.toBe("Revoked");

      // The same JWS, byte for byte, no longer verifies — and with the
      // mandate's own code, not the credential path's.
      try {
        await verifyMandateOnChain(agentpass, anchored.jws);
        expect.unreachable("a revoked mandate must not verify");
      } catch (error) {
        expect(hasErrorCode(error, "MandateRevoked")).toBe(true);
      }
    },
    5 * MINUTE,
  );

  it(
    "refuses a validly signed mandate that was never anchored",
    async () => {
      const { signMandate } = await import("./sign.js");
      const mandate = makeTestMandate(principal, agent, { registry: agentpass.config.contractId });
      const signed = await signMandate(mandate, principal);

      await expect(agentpass.status(signed.hash)).resolves.toBe("Unknown");
      await expect(verifyMandateOnChain(agentpass, signed.jws)).rejects.toSatisfy((error: unknown) =>
        hasErrorCode(error, "MandateUnknown"),
      );
    },
    3 * MINUTE,
  );

  it(
    "refuses a mandate that names a registry this client does not trust",
    async () => {
      const { signMandate } = await import("./sign.js");
      const foreign = makeTestMandate(principal, agent, {
        registry: StrKey.encodeContract(randomBytes(32)),
      });
      const signed = await signMandate(foreign, principal);

      await expect(verifyMandateOnChain(agentpass, signed.jws)).rejects.toSatisfy((error: unknown) =>
        hasErrorCode(error, "RegistryMismatch"),
      );
    },
    3 * MINUTE,
  );
});
