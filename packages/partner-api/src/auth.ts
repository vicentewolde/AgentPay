/**
 * The `/v1` authentication contract: one header, one secret format, one
 * decision — a partner's API key either covers the route it called or it
 * does not. `PLATAFORMA-PARTNERS.md` §2.7 proposed the shape (`Authorization:
 * Bearer`, `ap_test_...`); this freezes it into something a route can call.
 *
 * `authorizeRequest` is deliberately framework-agnostic: it takes the raw
 * header value and an injected `authenticate`, and returns a decision or
 * throws a typed `AgentPassError`. Whatever wires `/v1` to Node's `http`
 * (T49) calls this once per route with `directory.authenticate` — the
 * decision itself is not re-litigated there, only transported.
 */
import { AgentPassError, isAgentPassError } from "@agentpass/core";
import type { ApiKey } from "@agentpey/directory";

import { type ApiScope, apiScopeCovers } from "./scopes.js";

/** Node lower-cases incoming header names; this is the name to read. */
export const AUTHORIZATION_HEADER = "authorization";

/**
 * `ap_test_` names the environment in the secret itself (`directory.ts`,
 * `issueApiKey`) — this is the same shape, checked here only to fail fast on
 * an obviously wrong value before a database round trip. The authoritative
 * check is always `authenticate`.
 */
export const API_KEY_SECRET_PATTERN = /^ap_test_[A-Za-z0-9_-]{16,}$/;

export interface AuthorizedRequest {
  readonly apiKeyId: string;
  readonly partnerId: string;
  readonly scopes: readonly string[];
}

/** The one call this contract needs from `@agentpey/directory` — injected so this package never opens a connection of its own. */
export type AuthenticateApiKey = (secret: string) => Promise<ApiKey | undefined>;

function extractBearerSecret(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined || authorizationHeader.trim().length === 0) {
    throw new AgentPassError("MissingApiKey", "the Authorization header is missing");
  }
  const match = /^Bearer\s+(\S+)$/.exec(authorizationHeader.trim());
  if (match?.[1] === undefined) {
    throw new AgentPassError("InvalidApiKey", "the Authorization header must be `Bearer <api key secret>`");
  }
  return match[1];
}

/**
 * Authenticates the request and asserts it holds `requiredScope`.
 *
 * @throws AgentPassError `MissingApiKey` — no `Authorization` header at all.
 * @throws AgentPassError `InvalidApiKey` — malformed, unknown, or revoked;
 * one code for all three on purpose, see the code's own doc comment.
 * @throws AgentPassError `ScopeNotGranted` — authenticated, but this key was
 * never issued the scope the route requires.
 */
export async function authorizeRequest(
  authorizationHeader: string | undefined,
  requiredScope: ApiScope,
  authenticate: AuthenticateApiKey,
): Promise<AuthorizedRequest> {
  const secret = extractBearerSecret(authorizationHeader);
  if (!API_KEY_SECRET_PATTERN.test(secret)) {
    throw new AgentPassError("InvalidApiKey", "the api key secret is not well-formed");
  }

  let apiKey: ApiKey | undefined;
  try {
    apiKey = await authenticate(secret);
  } catch (error) {
    if (isAgentPassError(error)) throw error;
    throw new AgentPassError("InvalidApiKey", "could not verify the api key", { cause: error });
  }
  if (apiKey === undefined) {
    throw new AgentPassError("InvalidApiKey", "unknown or revoked api key");
  }

  if (!apiScopeCovers(apiKey.scopes, requiredScope)) {
    throw new AgentPassError("ScopeNotGranted", `this api key does not have the '${requiredScope}' scope`, {
      details: { required: requiredScope, granted: apiKey.scopes },
    });
  }

  return { apiKeyId: apiKey.id, partnerId: apiKey.partnerId, scopes: apiKey.scopes };
}
