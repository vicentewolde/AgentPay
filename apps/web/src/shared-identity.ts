/**
 * Bootstraps the one Stellar agent identity every visitor still shares —
 * `AGENT_SECRET_KEY` — as a row in `@agentpay/directory`, so a tenant's
 * mandate and credential can name a real, findable `agentId` before F4
 * wires a distinct derived identity per tenant.
 *
 * **Why this exists, and why it is temporary.** `@agentpay/directory`'s
 * shape (T38) assumes the F4 world: one Stellar identity per tenant,
 * `directory_agents.address` unique. That is not true yet — every visitor's
 * mandate is still signed by the one shared `AGENT_SECRET_KEY`
 * (`C-16`/`C-20`, deferred to F4 on purpose). Rather than relax the
 * uniqueness the schema protects, or invent a second, looser shape for this
 * transitional period, T39 represents the truth plainly: there is exactly
 * **one** agent row, shared by every tenant, clearly labelled as such. `C-33`
 * records this as a deliberate, temporary compromise — superseded the day
 * F4 gives each tenant its own `deriveTenantKeypair` output instead of this
 * function's fixed address.
 *
 * `idempotent by address`: {@link findAgentByAddress} is the directory's own
 * unique-by-address lookup, so calling this on every request is safe and
 * correct — the first call ever creates the row, every call after that finds
 * it. A narrow interface, not the full {@link Directory} port, both so the
 * dependency is explicit and so a test can supply a small fake instead of a
 * live database.
 */
import { AgentPassError, stellarAddressToDid } from "@agentpass/core";
import type { AgentInstance, Directory, Tenant } from "@agentpay/directory";

export interface SharedAgentIdentity {
  readonly partnerId: string;
  /**
   * The tenant that formally owns the shared agent row — not a real
   * visitor's tenant, just where the row has to live for the schema's
   * foreign keys. No mandate or credential is ever recorded against this
   * tenant itself.
   */
  readonly bootstrapTenantId: string;
  readonly agent: AgentInstance;
}

/** The slice of {@link Directory} this bootstrap actually depends on. */
export type SharedIdentityDirectory = Pick<
  Directory,
  "findAgentByAddress" | "createPartner" | "createTenant" | "findTenant" | "createAgent" | "setAgentOnchainState"
>;

const BOOTSTRAP_PARTNER_NAME = "AgentPay web — identidad compartida (pre-F4)";
const BOOTSTRAP_EXTERNAL_REF = "shared-legacy-agent";
const BOOTSTRAP_AGENT_LABEL =
  "Identidad compartida de apps/web (AGENT_SECRET_KEY) — reemplazada por una derivada por tenant en F4";

/**
 * Finds or creates the directory row for the shared agent identity at
 * `address`. Safe to call on every request: the common case is one
 * `findAgentByAddress` query.
 *
 * The creation path only ever runs once in the life of a deployment — after
 * that, every call short-circuits on the first branch. It still has to
 * handle two callers racing to create it for the very first time (this
 * pilot runs one Node process, but that process still serves concurrent
 * requests): the loser's insert fails on `directory_agents.address`'s unique
 * constraint, caught here and turned into a second lookup rather than a
 * thrown error — the row the winner created is exactly what the loser was
 * about to create anyway.
 *
 * @throws whatever the second lookup's underlying error was, in the
 * unlikely case the row still cannot be found after a failed creation
 * attempt — that failure is not a race, and hiding it would be worse than
 * surfacing it.
 */
export async function ensureSharedAgentIdentity(
  directory: SharedIdentityDirectory,
  address: string,
  network: "testnet" | "public" = "testnet",
): Promise<SharedAgentIdentity> {
  const existing = await directory.findAgentByAddress(address);
  if (existing !== undefined) {
    return { partnerId: (await requireTenantsPartner(directory, existing)).partnerId, bootstrapTenantId: existing.tenantId, agent: existing };
  }

  try {
    const partner = await directory.createPartner({ name: BOOTSTRAP_PARTNER_NAME });
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: BOOTSTRAP_EXTERNAL_REF });
    const agent = await directory.createAgent({
      tenantId: tenant.id,
      label: BOOTSTRAP_AGENT_LABEL,
      derive: () => ({ address, did: stellarAddressToDid(address, network) }),
    });
    // Known to already be live on testnet — it is `AGENT_SECRET_KEY`, not a
    // freshly derived key nobody has funded yet (`C-21`'s "derived" default
    // describes the F4 world, not this one).
    const funded = await directory.setAgentOnchainState(agent.id, "funded");
    return { partnerId: partner.id, bootstrapTenantId: tenant.id, agent: funded };
  } catch (raceError) {
    const afterRace = await directory.findAgentByAddress(address);
    if (afterRace === undefined) throw raceError;
    return { partnerId: (await requireTenantsPartner(directory, afterRace)).partnerId, bootstrapTenantId: afterRace.tenantId, agent: afterRace };
  }
}

async function requireTenantsPartner(directory: SharedIdentityDirectory, agent: AgentInstance): Promise<{ readonly partnerId: string }> {
  const tenant = await directory.findTenant(agent.tenantId);
  if (tenant === undefined) {
    // The agent's own foreign key guarantees this tenant exists — reaching
    // here would mean the directory's own referential integrity broke.
    throw new AgentPassError("TenantNotFound", "the shared agent names a tenant the directory cannot find", {
      details: { agentId: agent.id, tenantId: agent.tenantId },
    });
  }
  return { partnerId: tenant.partnerId };
}

/**
 * The visitor's own tenant — one per connected wallet, under the bootstrap
 * partner {@link ensureSharedAgentIdentity} resolves. A Stellar address is
 * an appropriate `externalRef` here: it is a public, pseudonymous
 * identifier, and `apps/web` visiting itself is the direct pilot, not a
 * third party's user being minimised into an opaque reference — the case
 * `assertOpaqueExternalRef` (`@agentpay/directory`) guards against. `D6`
 * already accepted, for testnet, that the same wallet is correlatable
 * across partners; this is the same wallet correlatable with itself, which
 * is not a new exposure.
 */
export type VisitorTenantDirectory = Pick<Directory, "findTenantByExternalRef" | "createTenant">;

/**
 * Finds or creates the tenant for `walletAddress` under `partnerId`. Same
 * idempotent-by-lookup shape as {@link ensureSharedAgentIdentity}: the
 * common case is one query, and a creation race (two requests for a wallet's
 * very first connection, arriving together) resolves by re-querying rather
 * than surfacing the `TenantAlreadyExists` the loser's insert would raise.
 */
export async function ensureVisitorTenant(
  directory: VisitorTenantDirectory,
  partnerId: string,
  walletAddress: string,
): Promise<Tenant> {
  const existing = await directory.findTenantByExternalRef(partnerId, walletAddress);
  if (existing !== undefined) return existing;

  try {
    return await directory.createTenant({ partnerId, externalRef: walletAddress });
  } catch (raceError) {
    const afterRace = await directory.findTenantByExternalRef(partnerId, walletAddress);
    if (afterRace === undefined) throw raceError;
    return afterRace;
  }
}
