/**
 * The `/v1` partner API, wired for real against `@agentpay/directory` — T49.
 *
 * `routePartnerRequest` is pure apart from the `Directory` calls it makes
 * through an injected, narrowly-typed dependency (same seam
 * `tenant-agent.ts` already uses): it never touches `req`/`res`, so it is
 * tested the same way `session-documents.ts`/`session-rehydration.ts` are —
 * with a fake, no HTTP server, no Postgres. `server.ts` calls this once for
 * every `/v1/*` request and translates the `{status, body}` it returns into
 * `sendJson`.
 *
 * Every route that reads or lists by id checks tenant ownership explicitly
 * and answers `404` (never `403`) when the resource belongs to a different
 * partner — the same "don't confirm existence to someone who shouldn't see
 * it" rule `InvalidApiKey` already applies to a revoked key.
 */
import { AgentPassError, isAgentPassError } from "@agentpass/core";
import type { AgentInstance, Directory, MandateRecord, Tenant } from "@agentpay/directory";
import {
  authorizeRequest,
  createTenantRequestSchema,
  hashRequestBody,
  resolveIdempotency,
  successEnvelope,
  toAgentResource,
  toErrorEnvelope,
  toMandateResource,
  toTenantResource,
  type ApiScope,
} from "@agentpay/partner-api";
import { z } from "zod";

export type PartnerRoutesDirectory = Pick<
  Directory,
  | "authenticate"
  | "createTenant"
  | "findTenant"
  | "findTenantByExternalRef"
  | "listAgents"
  | "findMandateById"
  | "listMandates"
  | "findIdempotentResponse"
  | "recordIdempotentResponse"
>;

export interface PartnerRouteRequest {
  readonly method: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly authorizationHeader: string | undefined;
  readonly idempotencyKeyHeader: string | undefined;
  readonly body: unknown;
  readonly directory: PartnerRoutesDirectory;
  readonly now?: Date;
}

export interface PartnerRouteResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Every `/v1`-relevant `AgentPassError` code this route layer can produce or pass through, mapped to its HTTP status. Anything else is a 500 — an error this layer did not anticipate should never masquerade as a client mistake. */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  MissingApiKey: 401,
  InvalidApiKey: 401,
  ScopeNotGranted: 403,
  IdempotencyKeyRequired: 400,
  IdempotencyKeyConflict: 409,
  InvalidArguments: 400,
  InvalidExternalRef: 400,
  TenantAlreadyExists: 409,
  PartnerNotFound: 404,
  TenantNotFound: 404,
  AgentNotFound: 404,
  MandateNotFound: 404,
  ConsentSessionNotFound: 404,
};

export function statusForError(error: unknown): number {
  if (isAgentPassError(error)) return STATUS_BY_CODE[error.code] ?? 500;
  return 500;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AgentPassError("InvalidArguments", "request body does not match the expected shape", { cause: result.error });
  }
  return result.data;
}

function requireQueryParam(searchParams: URLSearchParams, name: string): string {
  const value = searchParams.get(name);
  if (value === null || value.trim().length === 0) {
    throw new AgentPassError("InvalidArguments", `missing required query parameter '${name}'`, { details: { name } });
  }
  return value;
}

/** `404`, never `403`, when the tenant exists but belongs to another partner. */
async function requireOwnedTenant(directory: PartnerRoutesDirectory, tenantId: string, partnerId: string): Promise<Tenant> {
  const tenant = await directory.findTenant(tenantId);
  if (tenant === undefined || tenant.partnerId !== partnerId) {
    throw new AgentPassError("TenantNotFound", "no tenant with that id", { details: { tenantId } });
  }
  return tenant;
}

async function requireOwnedMandate(directory: PartnerRoutesDirectory, mandateId: string, partnerId: string): Promise<MandateRecord> {
  const mandate = await directory.findMandateById(mandateId);
  if (mandate === undefined) {
    throw new AgentPassError("MandateNotFound", "no mandate with that id", { details: { mandateId } });
  }
  const tenant = await directory.findTenant(mandate.tenantId);
  if (tenant === undefined || tenant.partnerId !== partnerId) {
    throw new AgentPassError("MandateNotFound", "no mandate with that id", { details: { mandateId } });
  }
  return mandate;
}

async function respondOrCache(
  directory: PartnerRoutesDirectory,
  partnerId: string,
  idempotencyKey: string,
  body: unknown,
  execute: () => Promise<PartnerRouteResponse>,
): Promise<PartnerRouteResponse> {
  const result = await execute().catch((error: unknown) => ({ status: statusForError(error), body: toErrorEnvelope(error) }));
  await directory.recordIdempotentResponse({
    partnerId,
    key: idempotencyKey,
    requestHash: hashRequestBody(body),
    responseStatus: result.status,
    responseBody: result.body,
  });
  return result;
}

async function handleCreateTenant(input: PartnerRouteRequest, now: Date): Promise<PartnerRouteResponse> {
  const auth = await authorizeRequest(input.authorizationHeader, "tenants:write" satisfies ApiScope, input.directory.authenticate);

  const outcome = await resolveIdempotency({
    partnerId: auth.partnerId,
    idempotencyKeyHeader: input.idempotencyKeyHeader,
    body: input.body,
    lookup: input.directory.findIdempotentResponse,
    now,
  });
  if (outcome.kind === "replay") return { status: outcome.record.responseStatus, body: outcome.record.responseBody };

  return respondOrCache(input.directory, auth.partnerId, input.idempotencyKeyHeader!, input.body, async () => {
    const request = parseBody(createTenantRequestSchema, input.body);
    try {
      const tenant = await input.directory.createTenant({
        partnerId: auth.partnerId,
        externalRef: request.external_ref,
        label: request.label ?? undefined,
      });
      return { status: 201, body: successEnvelope(toTenantResource(tenant)) };
    } catch (error) {
      // Re-creating a tenant your own partner already registered for this
      // external_ref is not an error at the business level — it is the same
      // fact asserted twice. Idempotent on the natural key, in addition to
      // (and independent of) the Idempotency-Key mechanism above.
      if (isAgentPassError(error) && error.code === "TenantAlreadyExists") {
        const existing = await input.directory.findTenantByExternalRef(auth.partnerId, request.external_ref);
        if (existing !== undefined) return { status: 200, body: successEnvelope(toTenantResource(existing)) };
      }
      throw error;
    }
  });
}

async function handleGetTenant(input: PartnerRouteRequest, tenantId: string): Promise<PartnerRouteResponse> {
  const auth = await authorizeRequest(input.authorizationHeader, "tenants:read" satisfies ApiScope, input.directory.authenticate);
  const tenant = await requireOwnedTenant(input.directory, tenantId, auth.partnerId);
  return { status: 200, body: successEnvelope(toTenantResource(tenant)) };
}

async function handleListAgents(input: PartnerRouteRequest): Promise<PartnerRouteResponse> {
  const auth = await authorizeRequest(input.authorizationHeader, "agents:read" satisfies ApiScope, input.directory.authenticate);
  const tenantId = requireQueryParam(input.searchParams, "tenant_id");
  await requireOwnedTenant(input.directory, tenantId, auth.partnerId);
  const agents: readonly AgentInstance[] = await input.directory.listAgents(tenantId);
  return { status: 200, body: successEnvelope(agents.map(toAgentResource)) };
}

async function handleGetMandate(input: PartnerRouteRequest, mandateId: string, now: Date): Promise<PartnerRouteResponse> {
  const auth = await authorizeRequest(input.authorizationHeader, "mandates:read" satisfies ApiScope, input.directory.authenticate);
  const mandate = await requireOwnedMandate(input.directory, mandateId, auth.partnerId);
  return { status: 200, body: successEnvelope(toMandateResource(mandate, now)) };
}

async function handleListMandates(input: PartnerRouteRequest, now: Date): Promise<PartnerRouteResponse> {
  const auth = await authorizeRequest(input.authorizationHeader, "mandates:read" satisfies ApiScope, input.directory.authenticate);
  const tenantId = requireQueryParam(input.searchParams, "tenant_id");
  await requireOwnedTenant(input.directory, tenantId, auth.partnerId);
  const mandates: readonly MandateRecord[] = await input.directory.listMandates(tenantId);
  return { status: 200, body: successEnvelope(mandates.map((mandate) => toMandateResource(mandate, now))) };
}

function notFound(method: string, pathname: string): PartnerRouteResponse {
  return { status: 404, body: { ok: false, code: "NotFound", message: `no /v1 route for ${method} ${pathname}`, details: {} } };
}

/**
 * Dispatches one `/v1` request. Never throws — every error, from
 * authentication through a database failure, comes back as `{status, body}`
 * so `server.ts` never needs its own try/catch around this call.
 */
export async function routePartnerRequest(input: PartnerRouteRequest): Promise<PartnerRouteResponse> {
  const now = input.now ?? new Date();
  try {
    if (input.method === "POST" && input.pathname === "/v1/tenants") {
      return await handleCreateTenant(input, now);
    }

    const tenantMatch = /^\/v1\/tenants\/([^/]+)$/.exec(input.pathname);
    if (input.method === "GET" && tenantMatch?.[1] !== undefined) {
      return await handleGetTenant(input, decodeURIComponent(tenantMatch[1]));
    }

    if (input.method === "GET" && input.pathname === "/v1/agents") {
      return await handleListAgents(input);
    }

    const mandateMatch = /^\/v1\/mandates\/([^/]+)$/.exec(input.pathname);
    if (input.method === "GET" && mandateMatch?.[1] !== undefined) {
      return await handleGetMandate(input, decodeURIComponent(mandateMatch[1]), now);
    }

    if (input.method === "GET" && input.pathname === "/v1/mandates") {
      return await handleListMandates(input, now);
    }

    return notFound(input.method, input.pathname);
  } catch (error) {
    return { status: statusForError(error), body: toErrorEnvelope(error) };
  }
}
