/**
 * Every failure AgentPass raises is an {@link AgentPassError} carrying a
 * machine-readable `code`. Callers branch on `code`, never on message text.
 *
 * New codes are added here as the tasks that need them land; the union is the
 * single source of truth for what can go wrong across core, sdk and cli.
 */
export type AgentPassErrorCode =
  /** A placeholder surface exists but its behaviour has not landed yet. */
  | "NotImplemented"
  /** Local configuration is missing, malformed or internally inconsistent. */
  | "ConfigError"
  /** A remote call failed, timed out, or answered with something unparseable. */
  | "NetworkError"
  /** A string is not a well-formed `did:stellar:<network>:<address>`. */
  | "InvalidDid"
  /** A string is not a valid Stellar Ed25519 account address (`G...`). */
  | "InvalidStellarAddress"
  /** A compact JWS is malformed, or its header is not the AgentPass profile. */
  | "InvalidJws"
  /** A credential payload does not match the AgentPass schema. */
  | "InvalidCredential"
  /** The signature does not verify against the issuer's key. */
  | "InvalidSignature"
  /** `now` is past `validUntil`. */
  | "CredentialExpired"
  /** `now` is before `validFrom`. */
  | "CredentialNotYetValid"
  /** An external command exited non-zero or produced unusable output. */
  | "CommandFailed"
  /** The registry reports this credential as revoked. */
  | "CredentialRevoked"
  /** The registry has never seen this credential hash. */
  | "CredentialUnknown"
  /** The credential's issuer exists in the registry but is deactivated. */
  | "IssuerInactive"
  /** The credential's issuer is not registered at all. */
  | "IssuerNotRegistered"
  /** The credential names a different registry than the verifier trusts. */
  | "RegistryMismatch"
  /** A CLI command's arguments are missing, malformed, or mutually exclusive. */
  | "InvalidArguments"
  /** A string is not a well-formed `<slug>:<contract id>` venue id. */
  | "InvalidVenueId"
  /** A string is not a well-formed `<CODE>:<issuer>` asset id. */
  | "InvalidAssetId"
  /** A catalogue entry does not match the product schema. */
  | "InvalidProduct"
  /** The catalogue has no product with the requested id. */
  | "ProductNotFound"
  /** No tool by that name is in the agent's tool set — including because it was withheld. */
  | "UnknownTool"
  /** A tool call's arguments do not match that tool's input schema. */
  | "InvalidToolInput"
  /** A value that should have been a non-negative decimal amount is not one. */
  | "InvalidAmount"
  /** `scope.actions` does not permit the action being attempted. */
  | "ScopeActionNotAllowed"
  /** `scope.venues` does not list the venue the purchase would happen at. */
  | "ScopeVenueNotAllowed"
  /** `scope.assets` does not list the asset the purchase would be paid in. */
  | "ScopeAssetNotAllowed"
  /** The spending limit is denominated in a different asset than the price. */
  | "ScopeCurrencyMismatch"
  /** The total would exceed `scope.limits.perTx`. */
  | "ScopeAmountExceeded"
  /** A purchase intent's payload does not match the intent schema. */
  | "InvalidIntent"
  /** `now` is past the intent's `expiresAt`. */
  | "IntentExpired"
  /** `now` is before the intent's `issuedAt`. */
  | "IntentNotYetValid"
  /** The signing key is not the one the document's subject identifies. */
  | "SignerMismatch"
  /** A natural-language purchase instruction matched no catalogue product. */
  | "InstructionNotUnderstood"
  /** A mandate's JWS is malformed, or its payload does not match the schema. */
  | "InvalidMandate"
  /** `now` is past the mandate's `validUntil`. */
  | "MandateExpired"
  /** `now` is before the mandate's `validFrom`. */
  | "MandateNotYetValid"
  /** The registry reports this mandate's anchored hash as revoked. */
  | "MandateRevoked"
  /** The registry has never seen this mandate's anchored hash. */
  | "MandateUnknown"
  /** The mandate's `credentialSubject.id` does not name the intent's agent. */
  | "MandateAgentMismatch"
  /** The mandate's `issuer` does not name the intent's principal. */
  | "MandatePrincipalMismatch"
  /** `grant.actions` does not permit the action an intent requires. */
  | "MandateActionNotAllowed"
  /** `grant.venues` does not list the venue an intent would purchase at. */
  | "MandateVenueNotAllowed"
  /** `grant.assets` does not list the asset an intent would spend. */
  | "MandateAssetNotAllowed"
  /** The mandate's spending limit is denominated in a different asset than the price. */
  | "MandateCurrencyMismatch"
  /** An intent's `issuedAt` falls outside the mandate's validity window. */
  | "MandateWindowMismatch"
  /** The total would exceed `grant.limits.perTx`. */
  | "MandateAmountExceeded"
  /** Today's running total plus this purchase would exceed `scope.limits.perDay`. */
  | "ScopeDailyLimitExceeded"
  /** Today's running total plus this purchase would exceed `grant.limits.perDay`. */
  | "MandateDailyLimitExceeded"
  /** The venue is asking to be paid for a different venue than the intent names. */
  | "TermsVenueMismatch"
  /** The venue is asking to be paid in a different asset than the intent names. */
  | "TermsAssetMismatch"
  /** The venue is asking for a different amount than the intent's total. */
  | "TermsAmountMismatch"
  /** The mandate's `grant.payTo` does not list the account the venue asks to be paid. */
  | "TermsPayeeNotAllowed";

/** Structured, non-secret context attached to an error for logs and tests. */
export type AgentPassErrorDetails = Readonly<Record<string, unknown>>;

export interface AgentPassErrorOptions {
  readonly cause?: unknown;
  readonly details?: AgentPassErrorDetails;
}

export class AgentPassError extends Error {
  override readonly name = "AgentPassError";
  readonly code: AgentPassErrorCode;
  readonly details: AgentPassErrorDetails;

  constructor(
    code: AgentPassErrorCode,
    message: string,
    options: AgentPassErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.details = options.details ?? {};
  }
}

/** Narrowing guard — safe against errors crossing realm or package boundaries. */
export function isAgentPassError(value: unknown): value is AgentPassError {
  return value instanceof AgentPassError;
}

/** True when `value` is an AgentPassError carrying exactly `code`. */
export function hasErrorCode<C extends AgentPassErrorCode>(
  value: unknown,
  code: C,
): value is AgentPassError & { readonly code: C } {
  return isAgentPassError(value) && value.code === code;
}
