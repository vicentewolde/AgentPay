import { describe, expect, it } from "vitest";

import { API_SCOPES, apiScopeCovers, apiScopeSchema, areValidApiScopes } from "./scopes.js";

describe("apiScopeSchema", () => {
  it("accepts every frozen scope", () => {
    for (const scope of API_SCOPES) {
      expect(apiScopeSchema.safeParse(scope).success).toBe(true);
    }
  });

  it("rejects a scope from the credential/mandate Scope vocabulary, and anything else unknown", () => {
    expect(apiScopeSchema.safeParse("payments:authorize").success).toBe(false);
    expect(apiScopeSchema.safeParse("catalog:read").success).toBe(false);
    expect(apiScopeSchema.safeParse("").success).toBe(false);
  });
});

describe("areValidApiScopes", () => {
  it("is true only when every element is a known scope", () => {
    expect(areValidApiScopes(["tenants:read", "mandates:read"])).toBe(true);
    expect(areValidApiScopes([])).toBe(true);
    expect(areValidApiScopes(["tenants:read", "vault:read"])).toBe(false);
  });
});

describe("apiScopeCovers", () => {
  it("is true exactly when the required scope is among the granted ones", () => {
    expect(apiScopeCovers(["tenants:read", "agents:read"], "tenants:read")).toBe(true);
    expect(apiScopeCovers(["tenants:read"], "tenants:write")).toBe(false);
    expect(apiScopeCovers([], "mandates:read")).toBe(false);
  });
});
