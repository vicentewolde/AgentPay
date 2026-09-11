import { newId, newTenantId, type Tenant } from "@agentpay/directory";
import { describe, expect, it } from "vitest";

import { createTenantRequestSchema, toTenantResource } from "./tenants.js";

const partnerId = newId("partner");
const tenantId = newTenantId(partnerId);

function fakeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: tenantId,
    partnerId,
    externalRef: "usr_123",
    label: null,
    status: "active",
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    updatedAt: new Date("2026-09-10T00:00:00.000Z"),
    ...overrides,
  };
}

describe("createTenantRequestSchema", () => {
  it("accepts an external_ref alone", () => {
    expect(createTenantRequestSchema.safeParse({ external_ref: "usr_123" }).success).toBe(true);
  });

  it("rejects a partner_id or any field a partner should never send — this request is scoped by the api key, not by the body", () => {
    expect(createTenantRequestSchema.safeParse({ external_ref: "usr_123", partner_id: "ptn_x" }).success).toBe(false);
  });
});

describe("toTenantResource", () => {
  it("maps the internal Tenant to the public, snake_case DTO, without partnerId or updatedAt", () => {
    const resource = toTenantResource(fakeTenant({ label: "Vinny's shop" }));
    expect(resource).toEqual({
      id: tenantId,
      external_ref: "usr_123",
      label: "Vinny's shop",
      status: "active",
      created_at: "2026-09-10T00:00:00.000Z",
    });
    expect(Object.keys(resource)).not.toContain("partnerId");
    expect(Object.keys(resource)).not.toContain("updatedAt");
  });
});
