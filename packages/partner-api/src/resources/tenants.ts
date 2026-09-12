/**
 * `/v1/tenants` — the wire shape a partner sends and receives, distinct from
 * `@agentpey/directory`'s `Tenant` on purpose: a partner never sees
 * `partnerId` (implicit from their own api key) or `updatedAt` (nothing in
 * this alcance updates a tenant after creation), and the wire format is
 * snake_case where the internal one is camelCase.
 */
import { tenantIdSchema, tenantStatusSchema, type Tenant } from "@agentpey/directory";
import { z } from "zod";

export const createTenantRequestSchema = z.strictObject({
  /** Validated for shape and non-PII content by `assertOpaqueExternalRef` — not re-validated here, so the check has exactly one home. */
  external_ref: z.string().min(1).max(128),
  label: z.string().max(200).nullable().optional(),
});

export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

export const tenantResourceSchema = z.strictObject({
  id: tenantIdSchema,
  external_ref: z.string().min(1).max(128),
  label: z.string().max(200).nullable(),
  status: tenantStatusSchema,
  created_at: z.iso.datetime(),
});

export type TenantResource = z.infer<typeof tenantResourceSchema>;

export function toTenantResource(tenant: Tenant): TenantResource {
  return tenantResourceSchema.parse({
    id: tenant.id,
    external_ref: tenant.externalRef,
    label: tenant.label,
    status: tenant.status,
    created_at: tenant.createdAt.toISOString(),
  });
}
