/**
 * `/v1/consent_sessions` — the hosted flow `PLATAFORMA-PARTNERS.md` §2.5/§3
 * describes: a partner proposes a grant, gets back a `consent_url`, redirects
 * the principal there to connect a wallet and sign the Mandate, and polls or
 * gets a webhook when it resolves. Nothing here persists a session or drives
 * that flow — `@agentpay/directory` has no `consent_sessions` table yet, and
 * adding one is a decision for whichever ticket builds the route (T49 or a
 * successor), not for T45. What T45 freezes is the shape both sides agree on
 * before that exists.
 *
 * The proposed grant reuses `@agentpay/mandate`'s `mandateGrantSchema`
 * verbatim rather than re-describing `actions`/`venues`/`assets`/`limits`/
 * `payTo`: a consent session is proposing exactly the grant a Mandate will
 * carry, and a second definition of the same shape is a second place for the
 * two to drift apart.
 */
import { ULID_LENGTH, tenantIdSchema, mandateIdSchema } from "@agentpay/directory";
import { mandateGrantSchema } from "@agentpay/mandate";
import { z } from "zod";

/**
 * Mirrors `@agentpay/directory`'s ULID-behind-a-prefix id convention
 * (`ids.ts`) without depending on it — that package does not know about
 * consent sessions yet. Whichever ticket adds persistence should mint ids
 * this shape, with prefix `cns`, so the format does not have to change under
 * partners once it is real.
 */
const CROCKFORD_CLASS = "[0-9ABCDEFGHJKMNPQRSTVWXYZ]";
export const consentSessionIdSchema = z.string().regex(new RegExp(`^cns_${CROCKFORD_CLASS}{${ULID_LENGTH}}$`), {
  message: "expected a consent session id (cns_...)",
});

export const consentSessionStatusSchema = z.enum(["pending", "completed", "expired", "cancelled"]);

export type ConsentSessionStatus = z.infer<typeof consentSessionStatusSchema>;

export const createConsentSessionRequestSchema = z.strictObject({
  tenant_id: tenantIdSchema,
  grant: mandateGrantSchema,
  /** Defaults to now, same as `@agentpay/mandate`'s `createMandate`. */
  valid_from: z.iso.datetime().optional(),
  valid_until: z.iso.datetime(),
});

export type CreateConsentSessionRequest = z.infer<typeof createConsentSessionRequestSchema>;

export const consentSessionResourceSchema = z.strictObject({
  id: consentSessionIdSchema,
  tenant_id: tenantIdSchema,
  status: consentSessionStatusSchema,
  /** The page to redirect the principal to. Present only while `"pending"`. */
  consent_url: z.url().nullable(),
  /** Set once the principal signs and the Mandate is anchored. */
  mandate_id: mandateIdSchema.nullable(),
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});

export type ConsentSessionResource = z.infer<typeof consentSessionResourceSchema>;
