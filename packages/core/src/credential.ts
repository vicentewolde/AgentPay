/**
 * The AgentPass credential: a W3C VC 2.0 data model, validated with zod and
 * serialised as a compact JWS (see vc-jwt.ts). No JSON-LD processing, no
 * canonicalisation, no Data Integrity proofs — the VC-JWT profile only.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { z } from "zod";

import { stellarDidSchema } from "./did.js";

export const VC_CONTEXT_V2 = "https://www.w3.org/ns/credentials/v2";
export const AGENTPASS_CREDENTIAL_TYPE = "AgentPassCredential";
export const AGENTPASS_STATUS_TYPE = "AgentPassRegistry2026";

/** A Soroban contract id (`C...`). */
export const stellarContractIdSchema = z
  .string()
  .refine((value) => StrKey.isValidContract(value), {
    message: "expected a Soroban contract id (C...)",
  });

/**
 * A decimal amount as a string. Stellar carries seven decimal places, and
 * amounts stay strings end to end so no float ever rounds a limit.
 */
export const decimalAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,7})?$/, "expected a non-negative decimal with at most 7 places");

export const agentDescriptorSchema = z.strictObject({
  name: z.string().min(1),
  model: z.string().min(1),
  operator: z.string().min(1),
});

/**
 * Declarative in this phase: signed and transported, enforced by nothing yet.
 * Enforcement is a later milestone — do not add it here.
 */
export const scopeLimitsSchema = z.strictObject({
  perTx: decimalAmountSchema,
  perDay: decimalAmountSchema,
  currency: z.string().min(1),
});

export const scopeSchema = z.strictObject({
  actions: z.array(z.string().min(1)).min(1),
  venues: z.array(z.string().min(1)),
  assets: z.array(z.string().min(1)),
  limits: scopeLimitsSchema,
});

export const credentialSubjectSchema = z.strictObject({
  id: stellarDidSchema,
  agent: agentDescriptorSchema,
  principal: stellarDidSchema,
  scope: scopeSchema,
});

/**
 * Points at the registry that holds this credential's status.
 *
 * It deliberately does **not** carry the credential's own hash. The anchored
 * key is `sha256(compact JWS)`, and a JWS cannot contain a hash of itself —
 * signing would change the very value being embedded. The verifier hashes the
 * JWS it received, which is also the only trustworthy source: a self-declared
 * hash could be pointed at some other, still-active credential.
 */
export const credentialStatusSchema = z.strictObject({
  type: z.literal(AGENTPASS_STATUS_TYPE),
  registry: stellarContractIdSchema,
});

export const agentPassCredentialSchema = z.strictObject({
  "@context": z.tuple([z.literal(VC_CONTEXT_V2)]),
  type: z.tuple([z.literal("VerifiableCredential"), z.literal(AGENTPASS_CREDENTIAL_TYPE)]),
  issuer: stellarDidSchema,
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  credentialSubject: credentialSubjectSchema,
  credentialStatus: credentialStatusSchema,
});

export type AgentPassCredential = z.infer<typeof agentPassCredentialSchema>;
export type CredentialSubject = z.infer<typeof credentialSubjectSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type ScopeLimits = z.infer<typeof scopeLimitsSchema>;
export type AgentDescriptor = z.infer<typeof agentDescriptorSchema>;
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;
