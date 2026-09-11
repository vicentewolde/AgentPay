import { createHash } from "node:crypto";

import { AgentPassError, stellarAddressToDid } from "@agentpass/core";
import {
  newId,
  newTenantId,
  type AgentInstance,
  type ApiKey,
  type IdempotencyRecord,
  type MandateRecord,
  type Tenant,
} from "@agentpay/directory";
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
  revoke(secret: string): void;
  createTenantCalls: number;
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
  apiKeys.set(SECRET_A, { partnerId: PARTNER_A, scopes: ["tenants:read", "tenants:write", "agents:read", "mandates:read"], revoked: false });
  apiKeys.set(SECRET_B, { partnerId: PARTNER_B, scopes: ["tenants:read", "tenants:write", "agents:read", "mandates:read"], revoked: false });

  const tenants = new Map<string, Tenant>();
  const agentsByTenant = new Map<string, AgentInstance[]>();
  const mandatesById = new Map<string, MandateRecord>();
  const mandatesByTenant = new Map<string, MandateRecord[]>();
  const idempotency = new Map<string, IdempotencyRecord>();
  let createTenantCalls = 0;

  return {
    get createTenantCalls() {
      return createTenantCalls;
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
    expect(statusForError(new AgentPassError("NotImplemented", "x"))).toBe(500);
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
