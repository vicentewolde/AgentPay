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
  | "CredentialNotYetValid";

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
