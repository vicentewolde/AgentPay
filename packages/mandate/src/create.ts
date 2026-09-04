/**
 * Building an unsigned mandate.
 *
 * Assembling the VC envelope by hand at every call site is how the `@context`
 * tuple, the `type` tuple and the status block end up subtly different in three
 * places. This is the one constructor, and everything that reaches it goes
 * through zod first.
 *
 * `validUntil` is **required**. A mandate with no stated end is a standing
 * authorisation, which is the thing this whole phase exists to avoid — so
 * there is no default, and no way to omit it.
 */
import { randomUUID } from "node:crypto";

import {
  AGENTPASS_STATUS_TYPE,
  AgentPassError,
  VC_CONTEXT_V2,
  stellarContractIdSchema,
  stellarDidSchema,
} from "@agentpass/core";
import { z } from "zod";

import type { AgentPayMandate } from "./mandate.js";
import { AGENTPAY_MANDATE_TYPE, agentPayMandateSchema, mandateGrantSchema } from "./mandate.js";

export const mandateRequestSchema = z.strictObject({
  /** The principal, who will sign this. */
  principal: stellarDidSchema,
  /** The agent being empowered. */
  agent: stellarDidSchema,
  // `mandateGrantSchema`, not `scopeSchema` (M-14): the latter is strict and
  // has no `payTo`, so a caller could never set it — this is the one place a
  // grant is built, and validating it against the narrower schema would
  // silently make the field unreachable everywhere else.
  grant: mandateGrantSchema,
  /** The registry that will answer for this mandate's status. */
  registry: stellarContractIdSchema,
  /** When the consent takes effect. Defaults to `now`. */
  validFrom: z.iso.datetime().optional(),
  /** When the consent lapses on its own. No default, on purpose. */
  validUntil: z.iso.datetime(),
  /** Supply one to make the document reproducible; otherwise a fresh uuid. */
  mandateId: z.uuid().optional(),
});

export type MandateRequest = z.input<typeof mandateRequestSchema>;

export interface CreateMandateOptions {
  /** Injectable clock, used only for a `validFrom` that was left out. */
  readonly now?: Date;
}

/**
 * Assembles an unsigned mandate. Sign it with `signMandate`.
 *
 * @throws AgentPassError `InvalidMandate` if the request is malformed, or if
 * the window it describes is empty — a mandate that expires before it begins
 * authorises nothing, and is far more likely a swapped pair of dates than an
 * intention.
 */
export function createMandate(
  request: MandateRequest,
  options: CreateMandateOptions = {},
): AgentPayMandate {
  const parsed = mandateRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new AgentPassError("InvalidMandate", "the mandate request is not valid", {
      cause: parsed.error,
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  const value = parsed.data;

  const validFrom = value.validFrom ?? (options.now ?? new Date()).toISOString();
  if (new Date(value.validUntil).getTime() < new Date(validFrom).getTime()) {
    throw new AgentPassError("InvalidMandate", "the mandate would expire before it begins", {
      details: { validFrom, validUntil: value.validUntil },
    });
  }

  const mandate: AgentPayMandate = {
    "@context": [VC_CONTEXT_V2],
    type: ["VerifiableCredential", AGENTPAY_MANDATE_TYPE],
    mandateId: value.mandateId ?? randomUUID(),
    issuer: value.principal,
    validFrom,
    validUntil: value.validUntil,
    credentialSubject: {
      id: value.agent,
      grant: value.grant,
    },
    credentialStatus: {
      type: AGENTPASS_STATUS_TYPE,
      registry: value.registry,
    },
  };

  // Belt and braces: the constructor's own output goes through the document
  // schema too, so a field added to the schema without being added here fails
  // loudly at the source instead of at signing time.
  const validated = agentPayMandateSchema.safeParse(mandate);
  if (!validated.success) {
    throw new AgentPassError("InvalidMandate", "the assembled mandate is not valid", {
      cause: validated.error,
    });
  }
  return validated.data;
}
