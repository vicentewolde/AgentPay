import { requireTenant, type ActivityDirectory } from "@agentpey/activity";
import type { MandateRecord, Tenant } from "@agentpey/directory";
import type { VaultRecord, VaultVerification } from "@agentpey/vault";

/**
 * The dashboard's deliberately small read-only view of the directory, and the
 * vault's read-only half. Both are `@agentpey/activity`'s ports (T76) under
 * the dashboard's original names — one definition, so a route here and a
 * route on `/v1` cannot be given different powers by accident.
 */
export type StatusDirectory = ActivityDirectory;
export type { VaultReader, VaultReaderFactory } from "@agentpey/activity";

export interface MandatesStatus {
  readonly tenant: Tenant;
  readonly mandates: readonly MandateRecord[];
}

export interface VaultStatus {
  readonly tenant: Tenant;
  readonly records: readonly VaultRecord[];
  readonly verification: VaultVerification;
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

// ---- T71: métricas/alertas, compartidas desde T76 -------------------------

/**
 * These moved to `@agentpey/activity` in T76, when `/v1/tenants/{id}/activity`
 * needed the same three numbers. Re-exported here rather than reimplemented:
 * `C-73`'s rule is that a number about spending comes from the computation
 * the authorisation itself performs, and two copies of it are two things that
 * can disagree.
 */
export {
  LOW_USDC_WARNING,
  PERDAY_WARNING_RATIO,
  readPerDayUsage,
  readRailBalances,
  recentRefusals,
  type PerDayUsage,
  type RailBalance,
  type RefusalSummary,
} from "@agentpey/activity";
