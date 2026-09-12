import { AgentPassError } from "@agentpass/core";
import type { MandateRecord, Tenant } from "@agentpey/directory";
import type { VaultRecord, VaultVerification } from "@agentpey/vault";

/**
 * The dashboard's deliberately small read-only view of the directory. Keeping
 * the write methods out of this type makes them unavailable to every route.
 */
export interface StatusDirectory {
  findTenant(id: string): Promise<Tenant | undefined>;
  listMandates(tenantId: string): Promise<readonly MandateRecord[]>;
}

/** The vault's read-only half; append operations are intentionally not present. */
export interface VaultReader {
  list(subject?: string): readonly VaultRecord[];
  verify(): VaultVerification;
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
