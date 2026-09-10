/**
 * Each tenant's own signing identity — the piece F4 (T40) adds. Before this,
 * every tenant's credential subject and Mandato `agent` field named the same
 * shared `AGENT_SECRET_KEY` (`C-33`). From here, each tenant gets its own
 * derived Stellar keypair via `@agentpay/tenancy`'s `deriveTenantKeypair`,
 * scoped by its own `directory_agents` row and `key_index`.
 *
 * **What this identity is for, and what it deliberately is not.** It is the
 * credential subject, the Mandato's `agent`, and the key that signs purchase
 * intents (`apps/agent/src/intent/sign.ts` — a JWS, off-chain, no Stellar
 * transaction, so it needs no funding at all). It is **not** who pays: F6
 * gives each tenant its own funded `policy_rail`; until then, payment stays
 * on the shared account `shared-identity.ts` bootstraps (`C-20`, and the
 * user's own explicit choice when this milestone was scoped — see
 * `evidencia/T40.md`). Confirmed by reading `apps/agent/src/agent.ts`
 * before writing this: `createAgent()` fails closed if `signer` does not
 * match the credential's subject address, but nothing anywhere requires that
 * same key to also be the one `executeBazaarPayment` pays with — those are
 * two independent parameters at the call site in `server.ts`.
 *
 * **The secret is never stored — only the index is.** `directory_agents`
 * carries `keyIndex`, a plain integer, never a secret. Every call here
 * re-derives the actual keypair from `masterMnemonic` + that index, which is
 * deterministic and free: the same inputs always produce the same keypair,
 * so "the tenant's agent" survives a restart the same way its credential and
 * Mandato already do (T39) — nothing about its private key is ever written
 * to Postgres.
 */
import { stellarAddressToDid } from "@agentpass/core";
import type { AgentInstance, Directory } from "@agentpay/directory";
import { deriveTenantKeypair } from "@agentpay/tenancy";
import { Keypair } from "@stellar/stellar-sdk";

export interface TenantAgent {
  readonly instance: AgentInstance;
  readonly keypair: Keypair;
}

/** The slice of {@link Directory} this depends on. */
export type TenantAgentDirectory = Pick<Directory, "listAgents" | "createAgent">;

function deriveKeypair(masterMnemonic: string, keyIndex: number): Keypair {
  const { secret } = deriveTenantKeypair(masterMnemonic, keyIndex, "agent");
  return Keypair.fromSecret(secret);
}

/**
 * Finds this tenant's own agent, deriving and creating it on the first call.
 * A tenant has at most one agent in this pilot's scope — `listAgents` can
 * return more (the directory's own model allows several per tenant, for
 * later), but nothing here creates a second one, so the first (oldest, by
 * `key_index`) is always the right one to use.
 *
 * Idempotent by lookup, same shape as `shared-identity.ts`'s two bootstraps:
 * a creation race (two requests for one brand-new tenant's very first agent,
 * arriving together) resolves by re-listing rather than surfacing whatever
 * error the loser's insert raised — nothing in `@agentpay/directory` maps
 * that error to a typed code yet (`createAgent` has no unique-violation
 * handling of its own), so this treats *any* failure during creation as a
 * possible race and re-checks before giving up.
 *
 * @throws whatever the creation attempt raised, if a second lookup still
 * finds nothing — that is not a race, and hiding it would leave a session
 * with no agent at all.
 */
export async function ensureTenantAgent(
  directory: TenantAgentDirectory,
  masterMnemonic: string,
  tenantId: string,
): Promise<TenantAgent> {
  const existing = await directory.listAgents(tenantId);
  const record = existing[0];
  if (record !== undefined) {
    return { instance: record, keypair: deriveKeypair(masterMnemonic, record.keyIndex) };
  }

  try {
    const created = await directory.createAgent({
      tenantId,
      label: "Identidad del agente — derivada por SEP-0005 desde el seed maestro (F4/T40)",
      derive: (keyIndex) => {
        const { publicKey } = deriveTenantKeypair(masterMnemonic, keyIndex, "agent");
        return { address: publicKey, did: stellarAddressToDid(publicKey, "testnet") };
      },
    });
    return { instance: created, keypair: deriveKeypair(masterMnemonic, created.keyIndex) };
  } catch (raceError) {
    const afterRace = await directory.listAgents(tenantId);
    const winner = afterRace[0];
    if (winner === undefined) throw raceError;
    return { instance: winner, keypair: deriveKeypair(masterMnemonic, winner.keyIndex) };
  }
}
