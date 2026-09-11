export {
  API_SCOPES,
  apiScopeCovers,
  apiScopeSchema,
  areValidApiScopes,
  type ApiScope,
} from "./scopes.js";

export {
  API_KEY_SECRET_PATTERN,
  AUTHORIZATION_HEADER,
  authorizeRequest,
  type AuthenticateApiKey,
  type AuthorizedRequest,
} from "./auth.js";

export {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_TTL_MS,
  canonicalize,
  hashRequestBody,
  idempotencyRecordSchema,
  resolveIdempotency,
  type IdempotencyLookup,
  type IdempotencyOutcome,
  type IdempotencyRecord,
  type ResolveIdempotencyInput,
} from "./idempotency.js";

export { errorEnvelopeSchema, successEnvelope, toErrorEnvelope, type ErrorEnvelope } from "./envelope.js";

export {
  createTenantRequestSchema,
  tenantResourceSchema,
  toTenantResource,
  type CreateTenantRequest,
  type TenantResource,
} from "./resources/tenants.js";

export { agentResourceSchema, toAgentResource, type AgentResource } from "./resources/agents.js";

export {
  computeMandateStatus,
  mandateResourceSchema,
  mandateStatusSchema,
  toMandateResource,
  type MandateResource,
  type MandateStatus,
} from "./resources/mandates.js";

export {
  consentSessionIdSchema,
  consentSessionResourceSchema,
  consentSessionStatusSchema,
  createConsentSessionRequestSchema,
  type ConsentSessionResource,
  type ConsentSessionStatus,
  type CreateConsentSessionRequest,
} from "./resources/consent-sessions.js";
