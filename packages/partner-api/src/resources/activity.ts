/**
 * `GET /v1/tenants/{id}/activity` — everything F9 asks a platform to be able
 * to show its own user about their own agent, and nothing that belongs to
 * anyone else.
 *
 * `PILOTO-F9.md` §6 lists what the person must be able to consult: their
 * active Mandate and its permissions, their purchases, their refused attempts
 * with an understandable reason, how much of today's limit they have used,
 * and the balance of the rail paying for it. Every one of those numbers is
 * already computed somewhere in this repo — `apps/status-dashboard` (T71)
 * reads all of them for the internal panel. This resource is the *shape* they
 * take when a partner reads them for one tenant, over an API key.
 *
 * **It never recomputes anything.** `C-73` settled this when the internal
 * panel was built: the spend shown must come from the same `spentOn` the
 * authorisation itself calls, never a second sum that could drift from the
 * one that actually decides. The same rule binds this route. A dashboard
 * that disagrees with the enforcement is worse than no dashboard.
 *
 * **It is strictly read-only,** and it is guarded by `vault:read`/
 * `payments:read` rather than by whatever key can spend — a platform showing
 * someone their history has no business holding a key that could buy on
 * their behalf.
 */
import { stellarContractIdSchema } from "@agentpass/core";
import { mandateIdSchema, tenantIdSchema } from "@agentpey/directory";
import { mandateGrantSchema } from "@agentpey/mandate";
import { z } from "zod";

import { mandateStatusSchema } from "./mandates.js";
import { purchaseResourceSchema } from "./purchases.js";

/**
 * The active Mandate as a person needs to see it: what it permits, until
 * when, and whether it is still in force. `grant` is `mandateGrantSchema`
 * verbatim — including `products` (T73) — for the same reason
 * `consent-sessions.ts` reuses it: the permissions displayed after signing
 * have to be the permissions that were signed, and a second description of
 * the same shape is a second place for the two to drift.
 */
export const activeMandateSchema = z.strictObject({
  id: mandateIdSchema,
  status: mandateStatusSchema,
  grant: mandateGrantSchema,
  valid_from: z.iso.datetime(),
  valid_until: z.iso.datetime(),
  /** The transaction that anchored it — the buyer's own proof, not ours. */
  anchor_tx: z.string().min(1),
});

/**
 * Today's spending against the Mandate's own `perDay`, in the Mandate's own
 * currency. `near_limit` is computed here rather than left to each caller so
 * that "close to the limit" means one thing across the platform — the same
 * 80% threshold the internal panel has used since T71.
 */
export const perDayUsageSchema = z.strictObject({
  limit: z.string(),
  spent_today: z.string(),
  remaining: z.string(),
  currency: z.string().min(1),
  near_limit: z.boolean(),
});

/**
 * The tenant's own `policy_rail` and what is left in it. `null` until the
 * tenant's first purchase deploys one — the lazy creation of T58, surfaced
 * rather than hidden, because "you have not paid for anything yet" and "your
 * rail is empty" are very different things to show a person.
 */
export const railStatusSchema = z.strictObject({
  contract_id: stellarContractIdSchema,
  balance: z.string(),
  asset: z.string().min(1),
  /**
   * F9 funds a tenant's first rail from a reserve the project holds, and the
   * interface has to say so in those words: this is sponsored testnet credit,
   * not money (`PILOTO-F9.md` §6).
   */
  sponsored: z.boolean(),
});

/**
 * A refused attempt, as the vault already recorded it. The code is what an
 * integrator branches on; the reason is what a person reads.
 */
export const refusalSchema = z.strictObject({
  at: z.iso.datetime(),
  code: z.string().min(1),
  reason: z.string().min(1),
  intent_id: z.uuid().nullable(),
});

export const tenantActivityResourceSchema = z.strictObject({
  tenant_id: tenantIdSchema,
  /** `null` when nothing has been signed for this tenant yet. */
  mandate: activeMandateSchema.nullable(),
  /** `null` when there is no active Mandate to have a daily limit. */
  per_day: perDayUsageSchema.nullable(),
  rail: railStatusSchema.nullable(),
  purchases: z.array(purchaseResourceSchema),
  refusals: z.array(refusalSchema),
});

export type TenantActivityResource = z.infer<typeof tenantActivityResourceSchema>;
export type ActiveMandate = z.infer<typeof activeMandateSchema>;
export type PerDayUsage = z.infer<typeof perDayUsageSchema>;
export type RailStatus = z.infer<typeof railStatusSchema>;
export type Refusal = z.infer<typeof refusalSchema>;
