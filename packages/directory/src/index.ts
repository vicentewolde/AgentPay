export { createDirectory, type Directory, type DirectoryOptions, type DeriveAgentIdentity } from "./directory.js";
export type {
  BindPrincipalInput,
  CreateAgentInput,
  CreateTenantInput,
  IssuedApiKey,
  RecordCredentialInput,
  RecordMandateInput,
} from "./directory.js";

export { assertOpaqueExternalRef } from "./external-ref.js";

export { ID_PREFIXES, ULID_LENGTH, isId, newId, newTenantId, parseTenantId, ulid, type IdKind, type ParsedTenantId } from "./ids.js";

export { DIRECTORY_SCHEMA_SQL, DIRECTORY_SCHEMA_VERSION } from "./schema-sql.js";

export {
  agentInstanceSchema,
  agentStatusSchema,
  apiKeySchema,
  credentialRecordSchema,
  mandateRecordSchema,
  mandateSignatureKindSchema,
  onchainStateSchema,
  partnerSchema,
  partnerStatusSchema,
  principalBindingSchema,
  principalSchema,
  tenantSchema,
  tenantStatusSchema,
  type AgentInstance,
  type AgentStatus,
  type ApiKey,
  type CredentialRecord,
  type MandateRecord,
  type MandateSignatureKind,
  type OnchainState,
  type Partner,
  type PartnerStatus,
  type Principal,
  type PrincipalBinding,
  type Tenant,
  type TenantStatus,
} from "./entities.js";
