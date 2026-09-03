/**
 * The Mandate: the principal's signed consent.
 *
 * A credential (phase 1) says *who this agent is and what its issuer believes
 * it may do*. A purchase intent (phase 2) says *what this agent wants to do
 * right now*. The Mandate is the third statement, and the one that was missing:
 * **the principal's own signature on "I authorise this agent to spend up to
 * this much, at these venues, in these assets, until this date."**
 *
 * It is a different document, not a different cryptography (see `sign.ts`).
 * The envelope is the same W3C VC 2.0 shape phase 1 already uses, for one
 * concrete reason beyond familiarity: the registry's `anchor(issuer, hash,
 * subject, expires_at)` maps onto `issuer` / `sha256(jws)` /
 * `credentialSubject.id` / `validUntil` with nothing left over, so a mandate
 * can be anchored and revoked by the existing contract without changing it.
 *
 * **The issuer *is* the principal.** There is no separate `principal` field
 * duplicating it: two fields that must always agree are a bug waiting for the
 * one code path that forgets to check.
 */
import {
  VC_CONTEXT_V2,
  credentialStatusSchema,
  scopeSchema,
  stellarDidSchema,
} from "@agentpass/core";
import { z } from "zod";

export const AGENTPAY_MANDATE_TYPE = "AgentPayMandate";

/**
 * What the principal authorises, in exactly the shape `scope` already has in
 * the credential.
 *
 * Reusing the shape is the point, not a shortcut: phase 3 compares a mandate's
 * grant against a credential's scope, and the comparison is only meaningful —
 * and only type-safe — if the two are the same shape. `B-1` carries over
 * unchanged: an empty `venues` or `assets` permits nothing.
 */
export const mandateGrantSchema = scopeSchema;

export const mandateSubjectSchema = z.strictObject({
  /** The agent this mandate empowers. Matches the credential's subject. */
  id: stellarDidSchema,
  grant: mandateGrantSchema,
});

export const agentPayMandateSchema = z.strictObject({
  "@context": z.tuple([z.literal(VC_CONTEXT_V2)]),
  type: z.tuple([z.literal("VerifiableCredential"), z.literal(AGENTPAY_MANDATE_TYPE)]),
  /**
   * Unique per mandate.
   *
   * Not decoration: the registry refuses to re-anchor a hash it already holds
   * (phase 1, invariant 1), so two mandates identical in every other field —
   * same agent, same grant, same window — would collide on `sha256(jws)` and
   * the second could never be anchored. A fresh id makes every mandate its own
   * document.
   */
  mandateId: z.uuid(),
  /** The principal. Signs this document, and is who the agent acts for. */
  issuer: stellarDidSchema,
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  credentialSubject: mandateSubjectSchema,
  /**
   * Where this mandate's status is answered — the same registry, with the same
   * `Active | Revoked | Expired | Unknown` semantics, as a credential. Keeping
   * the VC property name (`credentialStatus`) rather than inventing
   * `mandateStatus` is deliberate: it is the W3C property, and generic VC
   * tooling can read it.
   */
  credentialStatus: credentialStatusSchema,
});

export type AgentPayMandate = z.infer<typeof agentPayMandateSchema>;
export type MandateSubject = z.infer<typeof mandateSubjectSchema>;
export type MandateGrant = z.infer<typeof mandateGrantSchema>;
