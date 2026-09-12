import { AgentPassError } from "@agentpass/core";
import type { AgentInstance, MandateRecord, Tenant } from "@agentpey/directory";
import { agentPayMandateSchema } from "@agentpey/mandate";
import type { VaultRecord, VaultVerification } from "@agentpey/vault";

/**
 * The dashboard's deliberately small read-only view of the directory. Keeping
 * the write methods out of this type makes them unavailable to every route.
 */
export interface StatusDirectory {
  findTenant(id: string): Promise<Tenant | undefined>;
  listMandates(tenantId: string): Promise<readonly MandateRecord[]>;
  /** T71: which of a tenant's agents have their own `policy_rail` (F6/T58), to read its balance. */
  listAgents(tenantId: string): Promise<readonly AgentInstance[]>;
}

/** The vault's read-only half; append operations are intentionally not present. */
export interface VaultReader {
  list(subject?: string): readonly VaultRecord[];
  verify(): VaultVerification;
  /** T71: today's total for one subject/currency — the same read `PolicyRail.authorise()` makes before deciding. */
  spentOn(subject: string, currency: string, at: Date): Promise<string>;
}

/** Construction is injected so HTTP handling never needs a database write API. */
export type VaultReaderFactory = (tenantId: string) => Promise<VaultReader>;

export interface MandatesStatus {
  readonly tenant: Tenant;
  readonly mandates: readonly MandateRecord[];
}

export interface VaultStatus {
  readonly tenant: Tenant;
  readonly records: readonly VaultRecord[];
  readonly verification: VaultVerification;
}

async function requireTenant(directory: StatusDirectory, tenantId: string): Promise<Tenant> {
  const tenant = await directory.findTenant(tenantId);
  if (tenant === undefined) {
    throw new AgentPassError("TenantNotFound", "no tenant with that id", { details: { tenantId } });
  }
  return tenant;
}

/** Reads a tenant's Mandate history; it does not determine or alter its state. */
export async function readMandatesStatus(directory: StatusDirectory, tenantId: string): Promise<MandatesStatus> {
  const tenant = await requireTenant(directory, tenantId);
  const mandates = await directory.listMandates(tenant.id);
  return { tenant, mandates: mandates.toReversed() };
}

/** Reconstructs and verifies the tenant's durable vault chain without appending to it. */
export async function readVaultStatus(
  directory: StatusDirectory,
  vaultFactory: VaultReaderFactory,
  tenantId: string,
): Promise<VaultStatus> {
  const tenant = await requireTenant(directory, tenantId);
  const vault = await vaultFactory(tenant.id);
  return { tenant, records: vault.list().toReversed(), verification: vault.verify() };
}

// ---- T71: métricas/alertas -------------------------------------------------

/** Same fraction-of-limit convention as an ordinary usage alert: warn with headroom left, not at exhaustion. */
export const PERDAY_WARNING_RATIO = 0.8;

/** Most recent mandate that is neither revoked nor past `validUntil`, as of `now` — `undefined` if there is none. */
function activeMandate(mandates: readonly MandateRecord[], now: Date): MandateRecord | undefined {
  return mandates
    .filter((mandate) => mandate.revokedAt === null && mandate.validUntil.getTime() > now.getTime())
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

export interface PerDayUsage {
  readonly subject: string;
  readonly currency: string;
  readonly perDayLimit: string;
  readonly spentToday: string;
  /** `spentToday / perDayLimit`, `0` if the limit itself is `0`. */
  readonly ratio: number;
  readonly nearLimit: boolean;
}

/**
 * Reads how much of the tenant's active Mandate's `perDay` limit is already
 * spent today — the same `spentOn` read `PolicyRail.authorise()` makes before
 * every purchase decision (`apps/agent/src/policy/policy-rail.ts`), here only
 * ever read, never fed back into a decision. `undefined` when the tenant has
 * no active (unrevoked, unexpired) Mandate to measure against.
 */
export async function readPerDayUsage(
  directory: StatusDirectory,
  vaultFactory: VaultReaderFactory,
  tenantId: string,
  now: Date = new Date(),
): Promise<PerDayUsage | undefined> {
  const tenant = await requireTenant(directory, tenantId);
  const mandates = await directory.listMandates(tenant.id);
  const mandate = activeMandate(mandates, now);
  if (mandate === undefined) return undefined;

  // Re-validated at this boundary, same discipline as every other Postgres
  // row this codebase reads (`wallet-session-store.ts`) — `document` is
  // stored as an opaque record (`@agentpey/directory` never depends on
  // `@agentpey/mandate`'s shape), so this dashboard cannot assume it parses.
  const parsed = agentPayMandateSchema.safeParse(mandate.document);
  if (!parsed.success) return undefined;

  const { id: subject, grant } = parsed.data.credentialSubject;
  const { perDay: perDayLimit, currency } = grant.limits;

  const vault = await vaultFactory(tenant.id);
  const spentToday = await vault.spentOn(subject, currency, now);

  const limitNumber = Number(perDayLimit);
  const ratio = limitNumber > 0 ? Number(spentToday) / limitNumber : 0;
  return { subject, currency, perDayLimit, spentToday, ratio, nearLimit: ratio >= PERDAY_WARNING_RATIO };
}

export interface RefusalSummary {
  readonly at: string;
  readonly intentId: string;
  readonly code: string;
  readonly reason: string;
}

/** The `refused` entries of an already-fetched vault slice, most recent first, capped at `limit`. */
export function recentRefusals(records: readonly VaultRecord[], limit = 20): readonly RefusalSummary[] {
  const refusals = records
    .map((record) => record.entry)
    .filter((entry): entry is Extract<VaultRecord["entry"], { readonly kind: "refused" }> => entry.kind === "refused");

  return refusals
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map(({ at, intentId, code, reason }) => ({ at, intentId, code, reason }));
}

export interface RailBalance {
  readonly agentId: string;
  readonly contractId: string;
  /** The scaled USDC balance as a string, or `"error: <message>"` if the read itself failed. */
  readonly usdc: string;
  readonly low: boolean;
}

/** Below this, a rail is one or two purchases away from failing on an empty balance — same threshold `scripts/check-rail-balances.ts` (T60) uses. */
export const LOW_USDC_WARNING = "0.0050000";

/**
 * Reads the USDC balance of every `policy_rail` the tenant's agents own
 * (F6/T58; `null` until an agent pays for the first time, so most agents in
 * this pilot have none). `readBalance` is injected — a SEP-41 `balance()`
 * simulation of the rail's own address, never a `transfer` — so this module
 * stays ignorant of the Stellar SDK and of which asset it reads (always
 * USDC in this pilot, same as `scripts/check-rail-balances.ts`), same seam
 * `vaultFactory` already uses for Postgres.
 */
export async function readRailBalances(
  directory: StatusDirectory,
  tenantId: string,
  readBalance: (railContractId: string) => Promise<string>,
): Promise<readonly RailBalance[]> {
  const tenant = await requireTenant(directory, tenantId);
  const agents = await directory.listAgents(tenant.id);
  const withRail = agents.filter(
    (agent): agent is AgentInstance & { readonly policyRailContractId: string } => agent.policyRailContractId !== null,
  );

  return Promise.all(
    withRail.map(async (agent) => {
      const { id: agentId, policyRailContractId: contractId } = agent;
      const usdc = await readBalance(contractId).catch((error: unknown) => `error: ${String(error)}`);
      const low = !usdc.startsWith("error") && Number(usdc) < Number(LOW_USDC_WARNING);
      return { agentId, contractId, usdc, low };
    }),
  );
}
