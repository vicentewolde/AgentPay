/**
 * Bootstraps the shared payer — `AGENT_SECRET_KEY` — as a row in
 * `@agentpey/directory`, and finds or creates each visitor's own tenant
 * under the partner that row anchors.
 *
 * **Renamed in F4 (T40), on purpose.** Through T39 this module's main export
 * was `ensureSharedAgentIdentity`: `AGENT_SECRET_KEY` was every tenant's
 * *identity* — the credential subject, the mandate's `agent`, the intent
 * signer — because nothing distinguished one tenant's agent from another's.
 * F4 gives each tenant its own derived signing identity (`./tenant-agent.ts`)
 * while leaving *payment* shared until F6 gives each tenant its own funded
 * `policy_rail` (`C-20`). What this function bootstraps now is only that:
 * the account whose key signs the actual Stellar transfer, on the classic
 * path or as a `policy_rail` owner. Calling it "shared agent identity" after
 * F4 would be actively misleading — it no longer is one.
 *
 * `idempotent by address`: {@link findAgentByAddress} is the directory's own
 * unique-by-address lookup, so calling this on every request is safe and
 * correct — the first call ever creates the row, every call after that finds
 * it. A narrow interface, not the full {@link Directory} port, both so the
 * dependency is explicit and so a test can supply a small fake instead of a
 * live database.
 */
import { AgentPassError, stellarAddressToDid } from "@agentpass/core";
import type { AgentInstance, Directory, Tenant } from "@agentpey/directory";

export interface SharedPayerIdentity {
  readonly partnerId: string;
  /**
   * The tenant that formally owns the shared payer row — not a real
   * visitor's tenant, just where the row has to live for the schema's
   * foreign keys. No mandate or credential is ever recorded against this
   * tenant itself, and since F4 this row is never used as an `agentId`
   * either — see the module docstring.
   */
  readonly bootstrapTenantId: string;
  readonly payer: AgentInstance;
}

/** The slice of {@link Directory} this bootstrap actually depends on. */
export type SharedPayerDirectory = Pick<
  Directory,
  "findAgentByAddress" | "createPartner" | "createTenant" | "findTenant" | "createAgent" | "setAgentOnchainState"
>;

const BOOTSTRAP_PARTNER_NAME = "AgentPey web — pagador compartido";
const BOOTSTRAP_EXTERNAL_REF = "shared-payer";
const BOOTSTRAP_PAYER_LABEL =
  "Cuenta pagadora compartida de apps/web (AGENT_SECRET_KEY) — cada tenant tiene su propia identidad desde F4; paga esta hasta que F6 le dé a cada tenant su propio policy_rail fondeado";

/**
 * Finds or creates the directory row for the shared payer account at
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
export async function ensureSharedPayerIdentity(
  directory: SharedPayerDirectory,
  address: string,
  network: "testnet" | "public" = "testnet",
): Promise<SharedPayerIdentity> {
  const existing = await directory.findAgentByAddress(address);
  if (existing !== undefined) {
    return { partnerId: (await requireTenantsPartner(directory, existing)).partnerId, bootstrapTenantId: existing.tenantId, payer: existing };
  }

  try {
    const partner = await directory.createPartner({ name: BOOTSTRAP_PARTNER_NAME });
    const tenant = await directory.createTenant({ partnerId: partner.id, externalRef: BOOTSTRAP_EXTERNAL_REF });
    const payer = await directory.createAgent({
      tenantId: tenant.id,
      label: BOOTSTRAP_PAYER_LABEL,
      derive: () => ({ address, did: stellarAddressToDid(address, network) }),
    });
    // Known to already be live on testnet — it is `AGENT_SECRET_KEY`, not a
    // freshly derived key nobody has funded yet (`C-21`'s "derived" default
    // describes a tenant's own agent, not this one).
    const funded = await directory.setAgentOnchainState(payer.id, "funded");
    return { partnerId: partner.id, bootstrapTenantId: tenant.id, payer: funded };
  } catch (raceError) {
    const afterRace = await directory.findAgentByAddress(address);
    if (afterRace === undefined) throw raceError;
    return { partnerId: (await requireTenantsPartner(directory, afterRace)).partnerId, bootstrapTenantId: afterRace.tenantId, payer: afterRace };
  }
}

async function requireTenantsPartner(directory: SharedPayerDirectory, payer: AgentInstance): Promise<{ readonly partnerId: string }> {
  const tenant = await directory.findTenant(payer.tenantId);
  if (tenant === undefined) {
    // The payer's own foreign key guarantees this tenant exists — reaching
    // here would mean the directory's own referential integrity broke.
    throw new AgentPassError("TenantNotFound", "the shared payer names a tenant the directory cannot find", {
      details: { agentId: payer.id, tenantId: payer.tenantId },
    });
  }
  return { partnerId: tenant.partnerId };
}

/**
 * The visitor's own tenant — one per connected wallet, under the bootstrap
 * partner {@link ensureSharedPayerIdentity} resolves. A Stellar address is
 * an appropriate `externalRef` here: it is a public, pseudonymous
 * identifier, and `apps/web` visiting itself is the direct pilot, not a
 * third party's user being minimised into an opaque reference — the case
 * `assertOpaqueExternalRef` (`@agentpey/directory`) guards against. `D6`
 * already accepted, for testnet, that the same wallet is correlatable
 * across partners; this is the same wallet correlatable with itself, which
 * is not a new exposure.
 */
export type VisitorTenantDirectory = Pick<Directory, "findTenantByExternalRef" | "createTenant">;

/**
 * Finds or creates the tenant for `walletAddress` under `partnerId`. Same
 * idempotent-by-lookup shape as {@link ensureSharedPayerIdentity}: the
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
