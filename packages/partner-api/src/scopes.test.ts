import { describe, expect, it } from "vitest";

import { API_SCOPES, apiScopeCovers, apiScopeSchema, areValidApiScopes } from "./scopes.js";

describe("apiScopeSchema", () => {
  it("accepts every frozen scope", () => {
    for (const scope of API_SCOPES) {
      expect(apiScopeSchema.safeParse(scope).success).toBe(true);
    }
  });

  it("rejects a scope from the credential/mandate Scope vocabulary, and anything else unknown", () => {
    expect(apiScopeSchema.safeParse("catalog:read").success).toBe(false);
    expect(apiScopeSchema.safeParse("intent:create").success).toBe(false);
    expect(apiScopeSchema.safeParse("").success).toBe(false);
  });

  it("still rejects a permission whose route nobody has implemented", () => {
    // The rule this file has followed since T45: a permission is added the
    // day its route exists, never before. T73 added the three F9 needs;
    // revocation is still the principal's own wallet-signed action, not
    // something a partner key can trigger.
    expect(apiScopeSchema.safeParse("mandates:revoke").success).toBe(false);
    expect(apiScopeSchema.safeParse("agents:write").success).toBe(false);
  });

  it("accepts the three T73 added, so a key can actually be granted them", () => {
    expect(apiScopeSchema.safeParse("payments:authorize").success).toBe(true);
    expect(apiScopeSchema.safeParse("payments:read").success).toBe(true);
    expect(apiScopeSchema.safeParse("vault:read").success).toBe(true);
  });
});

describe("areValidApiScopes", () => {
  it("is true only when every element is a known scope", () => {
    expect(areValidApiScopes(["tenants:read", "mandates:read"])).toBe(true);
    expect(areValidApiScopes([])).toBe(true);
    expect(areValidApiScopes(["tenants:read", "vault:read"])).toBe(true);
    expect(areValidApiScopes(["tenants:read", "mandates:revoke"])).toBe(false);
  });
});

describe("apiScopeCovers", () => {
  it("is true exactly when the required scope is among the granted ones", () => {
    expect(apiScopeCovers(["tenants:read", "agents:read"], "tenants:read")).toBe(true);
    expect(apiScopeCovers(["tenants:read"], "tenants:write")).toBe(false);
    expect(apiScopeCovers([], "mandates:read")).toBe(false);
  });
});
