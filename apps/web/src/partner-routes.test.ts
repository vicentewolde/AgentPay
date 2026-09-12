import { createHash } from "node:crypto";

import { AgentPassError, stellarAddressToDid } from "@agentpass/core";
import {
  newId,
  newTenantId,
  type AgentInstance,
  type ApiKey,
  type ConsentSessionRecord,
  type IdempotencyRecord,
  type MandateRecord,
  type Tenant,
} from "@agentpey/directory";
import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it } from "vitest";

import { routePartnerRequest, statusForError, type PartnerRoutesDirectory } from "./partner-routes.js";

const PARTNER_A = newId("partner");
const PARTNER_B = newId("partner");
const SECRET_A = "ap_test_partner-a-secret";
const SECRET_B = "ap_test_partner-b-secret";

interface FakeDirectory extends PartnerRoutesDirectory {
  seedTenant(overrides?: Partial<Tenant>): Tenant;
  seedAgent(tenantId: string, overrides?: Partial<AgentInstance>): AgentInstance;
  seedMandate(tenantId: string, overrides?: Partial<MandateRecord>): MandateRecord;
  seedConsentSession(tenantId: string, overrides?: Partial<ConsentSessionRecord>): ConsentSessionRecord;
  revoke(secret: string): void;
  createTenantCalls: number;
  createConsentSessionCalls: number;
}

function fakeApiKeyRecord(partnerId: string, scopes: readonly string[]): ApiKey {
  return {
    id: newId("apiKey"),
    partnerId,
    name: "test key",
    keyHash: "0".repeat(64),
    scopes: [...scopes],
    createdAt: new Date(),
    revokedAt: null,
  };
}

function createFakeDirectory(): FakeDirectory {
  const apiKeys = new Map<string, { partnerId: string; scopes: readonly string[]; revoked: boolean }>();
  apiKeys.set(SECRET_A, { partnerId: PARTNER_A, scopes: ["tenants:read", "tenants:write", "agents:read", "mandates:read", "consent_sessions:read", "consent_sessions:write", "payments:authorize", "payments:read", "vault:read"], revoked: false });
  apiKeys.set(SECRET_B, { partnerId: PARTNER_B, scopes: ["tenants:read", "tenants:write", "agents:read", "mandates:read", "consent_sessions:read", "consent_sessions:write"], revoked: false });

  const tenants = new Map<string, Tenant>();
  const agentsByTenant = new Map<string, AgentInstance[]>();
  const mandatesById = new Map<string, MandateRecord>();
  const mandatesByTenant = new Map<string, MandateRecord[]>();
  const idempotency = new Map<string, IdempotencyRecord>();
  const consentSessions = new Map<string, ConsentSessionRecord>();
  let createTenantCalls = 0;
  let createConsentSessionCalls = 0;

  return {
    get createTenantCalls() {
      return createTenantCalls;
    },

    get createConsentSessionCalls() {
      return createConsentSessionCalls;
    },

    revoke(secret) {
      const key = apiKeys.get(secret);
      if (key !== undefined) key.revoked = true;
    },

    seedTenant(overrides = {}) {
      const tenant: Tenant = {
        id: newTenantId(overrides.partnerId ?? PARTNER_A),
        partnerId: PARTNER_A,
        externalRef: `usr_${tenants.size}`,
        label: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
      tenants.set(tenant.id, tenant);
      return tenant;
    },

    seedAgent(tenantId, overrides = {}) {
      const keypair = Keypair.random();
      const agent: AgentInstance = {
        id: newId("agent"),
        tenantId,
        keyIndex: agentsByTenant.get(tenantId)?.length ?? 0,
        address: keypair.publicKey(),
        did: stellarAddressToDid(keypair.publicKey(), "testnet"),
        label: null,
        status: "active",
        onchainState: "derived",
        policyRailContractId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
      agentsByTenant.set(tenantId, [...(agentsByTenant.get(tenantId) ?? []), agent]);
      return agent;
    },

    seedMandate(tenantId, overrides = {}) {
      const mandate: MandateRecord = {
        id: newId("mandate"),
        tenantId,
        agentId: newId("agent"),
        principalId: newId("principal"),
        mandateHash: createHash("sha256").update(newId("mandate")).digest("hex"),
        signatureKind: "wallet-sep53",
        document: {},
        signature: "sig",
        jws: null,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: new Date("2026-12-01T00:00:00.000Z"),
        anchorTx: "tx-1",
        supersedesId: null,
        revokedAt: null,
        revokeTx: null,
        createdAt: new Date(),
        ...overrides,
      };
      mandatesById.set(mandate.id, mandate);
      mandatesByTenant.set(tenantId, [...(mandatesByTenant.get(tenantId) ?? []), mandate]);
      return mandate;
    },

    seedConsentSession(tenantId, overrides = {}) {
      const now = new Date();
      const session: ConsentSessionRecord = {
        id: newId("consentSession"),
        tenantId,
        status: "pending",
        grant: { actions: ["catalog:read"], venues: [], assets: [], limits: { perTx: "1", perDay: "1", currency: "USDC" } },
        validFrom: now,
        validUntil: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        mandateId: null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        ...overrides,
      };
      consentSessions.set(session.id, session);
      return session;
    },

    async authenticate(secret) {
      const key = apiKeys.get(secret);
      if (key === undefined || key.revoked) return undefined;
      return fakeApiKeyRecord(key.partnerId, key.scopes);
    },

    async createTenant(input) {
      createTenantCalls += 1;
      const existing = [...tenants.values()].find((t) => t.partnerId === input.partnerId && t.externalRef === input.externalRef);
      if (existing !== undefined) {
        throw new AgentPassError("TenantAlreadyExists", "this partner already has a tenant for that external reference");
      }
      const tenant: Tenant = {
        id: newTenantId(input.partnerId),
        partnerId: input.partnerId,
        externalRef: input.externalRef,
        label: input.label ?? null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      tenants.set(tenant.id, tenant);
      return tenant;
    },

    async findTenant(id) {
      return tenants.get(id);
    },

    async findTenantByExternalRef(partnerId, externalRef) {
      return [...tenants.values()].find((t) => t.partnerId === partnerId && t.externalRef === externalRef);
    },

    async listAgents(tenantId) {
      return agentsByTenant.get(tenantId) ?? [];
    },

    async findMandateById(id) {
      return mandatesById.get(id);
    },

    async listMandates(tenantId) {
      return mandatesByTenant.get(tenantId) ?? [];
    },

    async findIdempotentResponse(partnerId, key) {
      return idempotency.get(`${partnerId}:${key}`);
    },

    async recordIdempotentResponse(input) {
      const record: IdempotencyRecord = {
        partnerId: input.partnerId,
        key: input.key,
        requestHash: input.requestHash,
        responseStatus: input.responseStatus,
        responseBody: input.responseBody,
        createdAt: new Date(),
      };
      idempotency.set(`${input.partnerId}:${input.key}`, record);
      return record;
    },

    async createConsentSession(input) {
      createConsentSessionCalls += 1;
      const session: ConsentSessionRecord = {
        id: newId("consentSession"),
        tenantId: input.tenantId,
        status: "pending",
        grant: input.grant,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        mandateId: null,
        createdAt: new Date(),
        expiresAt: input.expiresAt,
      };
      consentSessions.set(session.id, session);
      return session;
    },

    async findConsentSession(id) {
      return consentSessions.get(id);
    },
  };
}

let directory: FakeDirectory;

beforeEach(() => {
  directory = createFakeDirectory();
});

function baseRequest(overrides: Partial<Parameters<typeof routePartnerRequest>[0]> = {}) {
  return {
    method: "GET",
    pathname: "/v1/tenants",
    searchParams: new URLSearchParams(),
    authorizationHeader: `Bearer ${SECRET_A}`,
    idempotencyKeyHeader: undefined,
    body: undefined,
    directory,
    baseUrl: "https://agentpay.example",
    ...overrides,
  };
}

describe("statusForError", () => {
  it("maps every code this route layer produces or passes through", () => {
    expect(statusForError(new AgentPassError("MissingApiKey", "x"))).toBe(401);
    expect(statusForError(new AgentPassError("InvalidApiKey", "x"))).toBe(401);
    expect(statusForError(new AgentPassError("ScopeNotGranted", "x"))).toBe(403);
    expect(statusForError(new AgentPassError("IdempotencyKeyRequired", "x"))).toBe(400);
    expect(statusForError(new AgentPassError("IdempotencyKeyConflict", "x"))).toBe(409);
    expect(statusForError(new AgentPassError("TenantNotFound", "x"))).toBe(404);
    expect(statusForError(new AgentPassError("NotImplemented", "x"))).toBe(501);
    // A code this layer never anticipated must not masquerade as a client mistake.
    expect(statusForError(new AgentPassError("VaultCorrupted", "x"))).toBe(500);
    expect(statusForError(new Error("plain"))).toBe(500);
  });
});

describe("routePartnerRequest — auth", () => {
  it("401s with no Authorization header", async () => {
    const result = await routePartnerRequest(
      baseRequest({ pathname: `/v1/tenants/${newTenantId(PARTNER_A)}`, authorizationHeader: undefined }),
    );
    expect(result.status).toBe(401);
  });

  it("401s once the api key is revoked", async () => {
    directory.revoke(SECRET_A);
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/tenants/${newTenantId(PARTNER_A)}` }));
    expect(result.status).toBe(401);
  });

  it("404s for an unknown /v1 route", async () => {
    const result = await routePartnerRequest(baseRequest({ pathname: "/v1/nope" }));
    expect(result.status).toBe(404);
  });
});

describe("routePartnerRequest — POST /v1/tenants", () => {
  function createRequest(body: unknown, idempotencyKeyHeader?: string) {
    return baseRequest({ method: "POST", pathname: "/v1/tenants", body, idempotencyKeyHeader });
  }

  it("requires an Idempotency-Key", async () => {
    const result = await routePartnerRequest(createRequest({ external_ref: "usr_1" }));
    expect(result.status).toBe(400);
    expect(directory.createTenantCalls).toBe(0);
  });

  it("creates a tenant and returns 201", async () => {
    const result = await routePartnerRequest(createRequest({ external_ref: "usr_1" }, "key-1"));
    expect(result.status).toBe(201);
    expect((result.body as { data: { external_ref: string } }).data.external_ref).toBe("usr_1");
    expect(directory.createTenantCalls).toBe(1);
  });

  it("replays the same response for a repeated Idempotency-Key with the same body, without creating twice", async () => {
    const first = await routePartnerRequest(createRequest({ external_ref: "usr_2" }, "key-2"));
    const second = await routePartnerRequest(createRequest({ external_ref: "usr_2" }, "key-2"));
    expect(second).toEqual(first);
    expect(directory.createTenantCalls).toBe(1);
  });

  it("conflicts when the same Idempotency-Key repeats with a different body", async () => {
    await routePartnerRequest(createRequest({ external_ref: "usr_3" }, "key-3"));
    const result = await routePartnerRequest(createRequest({ external_ref: "usr_different" }, "key-3"));
    expect(result.status).toBe(409);
    expect(directory.createTenantCalls).toBe(1);
  });

  it("is idempotent on (partner, external_ref) at the business level too — a fresh Idempotency-Key still finds the existing tenant", async () => {
    const first = await routePartnerRequest(createRequest({ external_ref: "usr_4" }, "key-4a"));
    const second = await routePartnerRequest(createRequest({ external_ref: "usr_4" }, "key-4b"));
    expect(second.status).toBe(200);
    expect((second.body as { data: { id: string } }).data.id).toBe((first.body as { data: { id: string } }).data.id);
    expect(directory.createTenantCalls).toBe(2);
  });

  it("400s a malformed body without ever calling createTenant", async () => {
    const result = await routePartnerRequest(createRequest({}, "key-5"));
    expect(result.status).toBe(400);
    expect(directory.createTenantCalls).toBe(0);
  });

  it("403s a key that lacks tenants:write, without creating anything", async () => {
    const restricted = "ap_test_readonly-secret-key";
    const scopedDirectory = createFakeDirectory();
    // Reach into the fake to add a read-only key by authenticating through the normal seam.
    const original = scopedDirectory.authenticate.bind(scopedDirectory);
    scopedDirectory.authenticate = async (secret) => (secret === restricted ? fakeApiKeyRecord(PARTNER_A, ["tenants:read"]) : original(secret));

    const result = await routePartnerRequest(
      baseRequest({ method: "POST", pathname: "/v1/tenants", body: { external_ref: "usr_x" }, idempotencyKeyHeader: "key-x", authorizationHeader: `Bearer ${restricted}`, directory: scopedDirectory }),
    );
    expect(result.status).toBe(403);
  });
});

describe("routePartnerRequest — GET /v1/tenants/{id}", () => {
  it("returns the tenant when it belongs to this partner", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A, externalRef: "usr_owned" });
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/tenants/${tenant.id}` }));
    expect(result.status).toBe(200);
    expect((result.body as { data: { id: string } }).data.id).toBe(tenant.id);
  });

  it("404s a tenant that belongs to a different partner, instead of 403 — never confirms it exists", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_B, externalRef: "usr_not_mine" });
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/tenants/${tenant.id}` }));
    expect(result.status).toBe(404);
  });

  it("404s a tenant id that does not exist at all", async () => {
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/tenants/${newTenantId(PARTNER_A)}` }));
    expect(result.status).toBe(404);
  });
});

describe("routePartnerRequest — GET /v1/agents", () => {
  it("requires tenant_id", async () => {
    const result = await routePartnerRequest(baseRequest({ pathname: "/v1/agents" }));
    expect(result.status).toBe(400);
  });

  it("lists a tenant's agents, mapped to the public resource shape", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const agent = directory.seedAgent(tenant.id);
    const result = await routePartnerRequest(
      baseRequest({ pathname: "/v1/agents", searchParams: new URLSearchParams({ tenant_id: tenant.id }) }),
    );
    expect(result.status).toBe(200);
    expect((result.body as { data: Array<{ id: string }> }).data).toEqual([expect.objectContaining({ id: agent.id })]);
  });

  it("404s when the tenant belongs to a different partner", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_B });
    const result = await routePartnerRequest(
      baseRequest({ pathname: "/v1/agents", searchParams: new URLSearchParams({ tenant_id: tenant.id }) }),
    );
    expect(result.status).toBe(404);
  });
});

describe("routePartnerRequest — GET /v1/mandates/{id} and /v1/mandates", () => {
  it("computes status from validity/revocation the same way toMandateResource does", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const mandate = directory.seedMandate(tenant.id);
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/mandates/${mandate.id}`, now: new Date("2026-06-01T00:00:00.000Z") }));
    expect(result.status).toBe(200);
    expect((result.body as { data: { status: string } }).data.status).toBe("active");
  });

  it("404s a mandate whose tenant belongs to a different partner", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_B });
    const mandate = directory.seedMandate(tenant.id);
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/mandates/${mandate.id}` }));
    expect(result.status).toBe(404);
  });

  it("404s an unknown mandate id", async () => {
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/mandates/${newId("mandate")}` }));
    expect(result.status).toBe(404);
  });

  it("lists every mandate of a tenant regardless of status, not only active ones", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const active = directory.seedMandate(tenant.id);
    const revoked = directory.seedMandate(tenant.id, { revokedAt: new Date("2026-02-01T00:00:00.000Z") });
    const result = await routePartnerRequest(
      baseRequest({ pathname: "/v1/mandates", searchParams: new URLSearchParams({ tenant_id: tenant.id }) }),
    );
    expect(result.status).toBe(200);
    const ids = (result.body as { data: Array<{ id: string }> }).data.map((m) => m.id).sort();
    expect(ids).toEqual([active.id, revoked.id].sort());
  });
});

describe("routePartnerRequest — POST /v1/consent_sessions", () => {
  const validBody = {
    tenant_id: "",
    grant: { actions: ["catalog:read"], venues: [], assets: [], limits: { perTx: "1", perDay: "1", currency: "USDC" } },
    valid_until: "2026-12-01T00:00:00.000Z",
  };

  it("requires an Idempotency-Key", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const result = await routePartnerRequest(
      baseRequest({ method: "POST", pathname: "/v1/consent_sessions", body: { ...validBody, tenant_id: tenant.id } }),
    );
    expect(result.status).toBe(400);
    expect(directory.createConsentSessionCalls).toBe(0);
  });

  it("creates a pending consent session with a consent_url built from baseUrl", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const result = await routePartnerRequest(
      baseRequest({
        method: "POST",
        pathname: "/v1/consent_sessions",
        body: { ...validBody, tenant_id: tenant.id },
        idempotencyKeyHeader: "cs-key-1",
        baseUrl: "https://agentpay.example",
      }),
    );
    expect(result.status).toBe(201);
    const data = (result.body as { data: { id: string; status: string; consent_url: string; tenant_id: string } }).data;
    expect(data.status).toBe("pending");
    expect(data.tenant_id).toBe(tenant.id);
    expect(data.consent_url).toBe(`https://agentpay.example/consent/${data.id}`);
    expect(directory.createConsentSessionCalls).toBe(1);
  });

  it("404s when the tenant belongs to a different partner, and never creates a session", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_B });
    const result = await routePartnerRequest(
      baseRequest({
        method: "POST",
        pathname: "/v1/consent_sessions",
        body: { ...validBody, tenant_id: tenant.id },
        idempotencyKeyHeader: "cs-key-2",
      }),
    );
    expect(result.status).toBe(404);
    expect(directory.createConsentSessionCalls).toBe(0);
  });

  it("400s a malformed grant without creating anything", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const result = await routePartnerRequest(
      baseRequest({
        method: "POST",
        pathname: "/v1/consent_sessions",
        body: { tenant_id: tenant.id, grant: { actions: [] }, valid_until: "2026-12-01T00:00:00.000Z" },
        idempotencyKeyHeader: "cs-key-3",
      }),
    );
    expect(result.status).toBe(400);
    expect(directory.createConsentSessionCalls).toBe(0);
  });
});

describe("routePartnerRequest — GET /v1/consent_sessions/{id}", () => {
  it("returns a pending session with its consent_url", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const session = directory.seedConsentSession(tenant.id);
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/consent_sessions/${session.id}` }));
    expect(result.status).toBe(200);
    const data = (result.body as { data: { status: string; consent_url: string | null } }).data;
    expect(data.status).toBe("pending");
    expect(data.consent_url).toBe(`https://agentpay.example/consent/${session.id}`);
  });

  it("hides consent_url and shows the mandate_id once completed", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const mandateId = newId("mandate");
    const session = directory.seedConsentSession(tenant.id, { status: "completed", mandateId });
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/consent_sessions/${session.id}` }));
    const data = (result.body as { data: { consent_url: string | null; mandate_id: string | null } }).data;
    expect(data.consent_url).toBeNull();
    expect(data.mandate_id).toBe(mandateId);
  });

  it("shows status 'expired' once the invitation window passes, purely computed", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const past = new Date("2026-01-01T00:00:00.000Z");
    const session = directory.seedConsentSession(tenant.id, { expiresAt: past });
    const result = await routePartnerRequest(
      baseRequest({ pathname: `/v1/consent_sessions/${session.id}`, now: new Date("2026-06-01T00:00:00.000Z") }),
    );
    expect((result.body as { data: { status: string } }).data.status).toBe("expired");
  });

  it("404s a consent session belonging to a different partner", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_B });
    const session = directory.seedConsentSession(tenant.id);
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/consent_sessions/${session.id}` }));
    expect(result.status).toBe(404);
  });

  it("404s an id that does not exist", async () => {
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/consent_sessions/${newId("consentSession")}` }));
    expect(result.status).toBe(404);
  });
});

describe("routePartnerRequest — the execution routes T73 froze (T75 implements them)", () => {
  const VENUE = "signaldesk:CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";

  function purchaseBody(tenantId: string, overrides: Record<string, unknown> = {}) {
    return { tenant_id: tenantId, venue: VENUE, product_id: "signaldesk:market-brief-xlm-usdc", quantity: 1, ...overrides };
  }

  it("answers 501, not 404 — the route exists, it just cannot act yet", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const result = await routePartnerRequest(
      baseRequest({ method: "POST", pathname: "/v1/purchases", body: purchaseBody(tenant.id), idempotencyKeyHeader: "pur-1" }),
    );
    expect(result.status).toBe(501);
    expect((result.body as { code: string }).code).toBe("NotImplemented");
  });

  it("refuses a key without payments:authorize before anything else happens", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_B });
    const result = await routePartnerRequest(
      baseRequest({
        method: "POST",
        pathname: "/v1/purchases",
        authorizationHeader: `Bearer ${SECRET_B}`,
        body: purchaseBody(tenant.id),
        idempotencyKeyHeader: "pur-2",
      }),
    );
    expect(result.status).toBe(403);
    expect((result.body as { code: string }).code).toBe("ScopeNotGranted");
  });

  it("still requires an Idempotency-Key — a purchase is never safe to replay blindly", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const result = await routePartnerRequest(
      baseRequest({ method: "POST", pathname: "/v1/purchases", body: purchaseBody(tenant.id) }),
    );
    expect(result.status).toBe(400);
    expect((result.body as { code: string }).code).toBe("IdempotencyKeyRequired");
  });

  it("404s another partner's tenant without revealing whether the body was valid", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_B });
    const result = await routePartnerRequest(
      baseRequest({ method: "POST", pathname: "/v1/purchases", body: purchaseBody(tenant.id), idempotencyKeyHeader: "pur-3" }),
    );
    expect(result.status).toBe(404);
    expect((result.body as { code: string }).code).toBe("TenantNotFound");
  });

  it("400s a malformed body, so the frozen shape is enforced from today", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const result = await routePartnerRequest(
      baseRequest({ method: "POST", pathname: "/v1/purchases", body: purchaseBody(tenant.id, { quantity: 0 }), idempotencyKeyHeader: "pur-4" }),
    );
    expect(result.status).toBe(400);
  });

  it("400s a body carrying a field this route does not know", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const result = await routePartnerRequest(
      baseRequest({ method: "POST", pathname: "/v1/purchases", body: purchaseBody(tenant.id, { pay_to: "GAK6E5E7L63ZYFZZZFXDTYVG6MVAKILSHI5FITGH5U4ORACEZQ4GFP2K" }), idempotencyKeyHeader: "pur-5" }),
    );
    expect(result.status).toBe(400);
  });

  it("does not cache the 501 against the idempotency key, so T75 is not poisoned by it", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    await routePartnerRequest(
      baseRequest({ method: "POST", pathname: "/v1/purchases", body: purchaseBody(tenant.id), idempotencyKeyHeader: "pur-6" }),
    );
    // Reusing the key with a *different* body is the probe: had the 501 been
    // stored, this would come back `IdempotencyKeyConflict` (409). Nothing
    // was stored, so it simply fails the same way again.
    const second = await routePartnerRequest(
      baseRequest({ method: "POST", pathname: "/v1/purchases", body: purchaseBody(tenant.id, { quantity: 7 }), idempotencyKeyHeader: "pur-6" }),
    );
    expect(second.status).toBe(501);
  });

  it("GET /v1/purchases/{id} answers 501 behind payments:read", async () => {
    const result = await routePartnerRequest(baseRequest({ pathname: "/v1/purchases/pur_01JB0000000000000000000003" }));
    expect(result.status).toBe(501);
  });

  it("GET /v1/tenants/{id}/activity answers 501 behind vault:read", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/tenants/${tenant.id}/activity` }));
    expect(result.status).toBe(501);
  });

  it("GET /v1/tenants/{id}/activity 404s another partner's tenant", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_B });
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/tenants/${tenant.id}/activity` }));
    expect(result.status).toBe(404);
  });

  it("does not shadow GET /v1/tenants/{id}, which still returns the tenant", async () => {
    const tenant = directory.seedTenant({ partnerId: PARTNER_A });
    const result = await routePartnerRequest(baseRequest({ pathname: `/v1/tenants/${tenant.id}` }));
    expect(result.status).toBe(200);
  });
});

describe("routePartnerRequest — never throws", () => {
  it("turns even an unexpected directory failure into a response, not a rejection", async () => {
    const explodingDirectory: PartnerRoutesDirectory = {
      ...directory,
      findTenant: async () => {
        throw new Error("connection reset (simulated)");
      },
    };
    const result = await routePartnerRequest(
      baseRequest({ pathname: `/v1/tenants/${newTenantId(PARTNER_A)}`, directory: explodingDirectory }),
    );
    expect(result.status).toBe(500);
  });
});
