import { newId, newTenantId } from "@agentpay/directory";
import { describe, expect, it } from "vitest";

import {
  consentSessionIdSchema,
  consentSessionResourceSchema,
  createConsentSessionRequestSchema,
} from "./consent-sessions.js";

const tenantId = newTenantId(newId("partner"));

const validGrant = {
  actions: ["catalog:read", "intent:create"],
  venues: ["mock-bazaar:CCL57L4ZQVQCGTQKGQMOAX7QDPEDW4LX2QSPBQMTMLB7BFQ7I3TM7F4A"],
  assets: ["USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"],
  limits: { perTx: "50.0000000", perDay: "200.0000000", currency: "USDC" },
};

describe("createConsentSessionRequestSchema", () => {
  it("accepts a tenant, a grant reusing @agentpay/mandate's shape, and a validUntil", () => {
    const result = createConsentSessionRequestSchema.safeParse({
      tenant_id: tenantId,
      grant: validGrant,
      valid_until: "2026-12-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a grant with an empty payee-less venues array element removed — actions must be non-empty, same rule as a Mandate's grant", () => {
    const result = createConsentSessionRequestSchema.safeParse({
      tenant_id: tenantId,
      grant: { ...validGrant, actions: [] },
      valid_until: "2026-12-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("requires valid_until", () => {
    const result = createConsentSessionRequestSchema.safeParse({ tenant_id: tenantId, grant: validGrant });
    expect(result.success).toBe(false);
  });
});

describe("consentSessionIdSchema", () => {
  it("accepts the cns_ prefix in the same ULID shape @agentpay/directory uses for its own ids", () => {
    expect(consentSessionIdSchema.safeParse(`cns_${newId("agent").slice(4)}`).success).toBe(true);
  });

  it("rejects another entity's prefix", () => {
    expect(consentSessionIdSchema.safeParse(newId("agent")).success).toBe(false);
  });
});

describe("consentSessionResourceSchema", () => {
  it("allows consent_url and mandate_id to be null — the two states of a session that is not yet completed", () => {
    const result = consentSessionResourceSchema.safeParse({
      id: `cns_${newId("agent").slice(4)}`,
      tenant_id: tenantId,
      status: "pending",
      consent_url: "https://agentpay.example/consent/abc",
      mandate_id: null,
      created_at: "2026-09-10T00:00:00.000Z",
      expires_at: "2026-09-10T01:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});
