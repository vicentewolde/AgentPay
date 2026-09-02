export {
  AgentPassError,
  hasErrorCode,
  isAgentPassError,
  type AgentPassErrorCode,
  type AgentPassErrorDetails,
  type AgentPassErrorOptions,
} from "./errors.js";

export {
  DID_METHOD,
  DID_SCHEME,
  STELLAR_NETWORKS,
  didToPublicKey,
  didToStellarAddress,
  isStellarAddress,
  isStellarNetwork,
  parseStellarDid,
  stellarAddressSchema,
  stellarAddressToDid,
  stellarDidSchema,
  type ParsedStellarDid,
  type StellarDid,
  type StellarNetwork,
} from "./did.js";

export {
  AGENTPASS_JWS_ALG,
  didToPublicJWK,
  publicKeyToJWK,
  stellarKeypairToJWK,
  type Ed25519PrivateJWK,
  type Ed25519PublicJWK,
} from "./jwk.js";

export {
  AGENTPASS_CREDENTIAL_TYPE,
  AGENTPASS_STATUS_TYPE,
  VC_CONTEXT_V2,
  agentDescriptorSchema,
  agentPassCredentialSchema,
  credentialRequestSchema,
  credentialStatusSchema,
  credentialSubjectSchema,
  decimalAmountSchema,
  scopeLimitsSchema,
  scopeSchema,
  stellarContractIdSchema,
  type AgentDescriptor,
  type AgentPassCredential,
  type CredentialRequest,
  type CredentialStatus,
  type CredentialSubject,
  type Scope,
  type ScopeLimits,
} from "./credential.js";

export {
  AGENTPASS_JWS_TYP,
  credentialHash,
  signCredential,
  verifyCredential,
  type SignedCredential,
  type VerifiedCredential,
  type VerifyOptions,
} from "./vc-jwt.js";
