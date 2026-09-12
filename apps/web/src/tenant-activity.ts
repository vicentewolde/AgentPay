/**
 * Everything a tenant may be shown about their own agent, assembled for
 * `GET /v1/tenants/{id}/activity`.
 *
 * `PILOTO-F9.md` §6 lists what the person behind a tenant has to be able to
 * consult: their active Mandate and the permissions it carries, their
 * purchases, their refused attempts with a reason they can act on, how much
 * of today's limit is gone, and the balance of the rail paying for it.
 *
 * **Not one of those numbers is computed here.** Every one comes from
 * `@agentpey/activity`, which is the same code `apps/status-dashboard` reads
 * for the internal panel, which in turn calls the same `spentOn` that
 * `PolicyRail.authorise()` calls before deciding. That chain is the whole
 * point of `C-73`: a figure shown to a person about their own spending has
 * to be the figure the enforcement actually used, or the screen is a
 * confident lie. This module's job is arrangement, not arithmetic.
 *
 * It is also read-only by construction — the ports it takes have no write
 * method, so no route built on this can grow one by accident.
 */
import {
  activeMandate,
  readPerDayUsage,
  readRailBalances,
  recentRefusals,
  type ActivityDirectory,
  type VaultReaderFactory,
} from "@agentpey/activity";
import type { Directory, PurchaseRecord } from "@agentpey/directory";
import { agentPayMandateSchema } from "@agentpey/mandate";
import { toPurchaseResource, type TenantActivityResource } from "@agentpey/partner-api";

export type TenantActivityDirectory = ActivityDirectory & Pick<Directory, "listPurchases">;

export interface TenantActivityDeps {
  readonly directory: TenantActivityDirectory;
  readonly vaultFactory: VaultReaderFactory;
  /** A SEP-41 `balance()` simulation — never a `transfer`. Injected, same seam the panel uses. */
  readonly readBalance: (railContractId: string) => Promise<string>;
  readonly now?: Date;
}

/** `subtract`, on Stellar's fixed seven decimals, without ever touching a float. */
function remaining(limit: string, spent: string): string {
  const scale = (value: string): bigint => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole + fraction.padEnd(7, "0").slice(0, 7));
  };
  const left = scale(limit) - scale(spent);
  const clamped = left < 0n ? 0n : left;
  const text = clamped.toString().padStart(8, "0");
  return `${text.slice(0, -7)}.${text.slice(-7)}`;
}

export async function readTenantActivity(
  deps: TenantActivityDeps,
  tenantId: string,
): Promise<TenantActivityResource> {
  const now = deps.now ?? new Date();
  const [mandates, usage, rails, purchases] = await Promise.all([
    deps.directory.listMandates(tenantId),
    readPerDayUsage(deps.directory, deps.vaultFactory, tenantId, now),
    readRailBalances(deps.directory, tenantId, deps.readBalance),
    deps.directory.listPurchases(tenantId),
  ]);

  const mandate = activeMandate(mandates, now);
  // Re-validated rather than trusted for being stored: `document` is an
  // opaque record in the directory, and this is the shape a person is about
  // to be shown as "what you signed".
  const parsed = mandate === undefined ? undefined : agentPayMandateSchema.safeParse(mandate.document);

  const vault = await deps.vaultFactory(tenantId);
  const refusals = recentRefusals(vault.list());

  // The first rail belonging to this tenant, if any. `null` until the first
  // purchase deploys one (T58) — and "you have not paid for anything yet" is
  // a different thing to show a person than "your rail is empty", so it is
  // not flattened into a zero.
  const rail = rails[0];

  return {
    tenant_id: tenantId,
    mandate:
      mandate === undefined || parsed === undefined || !parsed.success
        ? null
        : {
            id: mandate.id,
            status: "active",
            grant: parsed.data.credentialSubject.grant,
            valid_from: mandate.validFrom.toISOString(),
            valid_until: mandate.validUntil.toISOString(),
            anchor_tx: mandate.anchorTx,
          },
    per_day:
      usage === undefined
        ? null
        : {
            limit: usage.perDayLimit,
            spent_today: usage.spentToday,
            remaining: remaining(usage.perDayLimit, usage.spentToday),
            currency: usage.currency,
            near_limit: usage.nearLimit,
          },
    rail:
      rail === undefined
        ? null
        : {
            contract_id: rail.contractId,
            balance: rail.usdc,
            asset: "USDC",
            // Named in the resource, not inferred by the reader: in F9 a
            // tenant's first rail is funded from a reserve the project holds,
            // and the interface has to say so in those words rather than let
            // a balance look like money the person put in.
            sponsored: true,
          },
    purchases: purchases.map((record: PurchaseRecord) => toPurchaseResource(record)),
    refusals: refusals.map((refusal) => ({
      at: refusal.at,
      code: refusal.code,
      reason: refusal.reason,
      intent_id: refusal.intentId,
    })),
  };
}
