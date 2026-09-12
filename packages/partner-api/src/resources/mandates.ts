/**
 * `/v1/mandates` — read-only in this alcance. A partner needs to know
 * whether the mandate it holds is still good, not replay the raw signed
 * document: `document`, `signature` and `jws` stay inside
 * `@agentpey/directory`'s `MandateRecord` and do not cross into this
 * resource. Exposing the parsed `grant` is deliberately left out of T45 —
 * `document` is stored unvalidated (`@agentpey/directory` never judges a
 * mandate, only stores it), so shaping a public field from it is a decision
 * for whichever ticket builds the route, informed by what a real partner
 * integration actually asks for.
 */
import { agentIdSchema, mandateIdSchema, tenantIdSchema, type MandateRecord } from "@agentpey/directory";
import { z } from "zod";

export const mandateStatusSchema = z.enum(["pending", "active", "expired", "revoked"]);

export type MandateStatus = z.infer<typeof mandateStatusSchema>;

/**
 * A revocation is permanent regardless of the validity window — a mandate
 * revoked before it even took effect is still `"revoked"`, not `"pending"`.
 */
export function computeMandateStatus(mandate: Pick<MandateRecord, "revokedAt" | "validFrom" | "validUntil">, now: Date): MandateStatus {
  if (mandate.revokedAt !== null) return "revoked";
  if (now < mandate.validFrom) return "pending";
  if (now > mandate.validUntil) return "expired";
  return "active";
}

export const mandateResourceSchema = z.strictObject({
  id: mandateIdSchema,
  tenant_id: tenantIdSchema,
  agent_id: agentIdSchema,
  mandate_hash: z.string().regex(/^[0-9a-f]{64}$/),
  status: mandateStatusSchema,
  valid_from: z.iso.datetime(),
  valid_until: z.iso.datetime(),
  anchor_tx: z.string().min(1),
  revoked_at: z.iso.datetime().nullable(),
  supersedes_id: mandateIdSchema.nullable(),
  created_at: z.iso.datetime(),
});

export type MandateResource = z.infer<typeof mandateResourceSchema>;

export function toMandateResource(mandate: MandateRecord, now: Date = new Date()): MandateResource {
  return mandateResourceSchema.parse({
    id: mandate.id,
    tenant_id: mandate.tenantId,
    agent_id: mandate.agentId,
    mandate_hash: mandate.mandateHash,
    status: computeMandateStatus(mandate, now),
    valid_from: mandate.validFrom.toISOString(),
    valid_until: mandate.validUntil.toISOString(),
    anchor_tx: mandate.anchorTx,
    revoked_at: mandate.revokedAt === null ? null : mandate.revokedAt.toISOString(),
    supersedes_id: mandate.supersedesId,
    created_at: mandate.createdAt.toISOString(),
  });
}
