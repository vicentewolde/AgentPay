import { describe, expect, it } from "vitest";

import { tenantActivityResourceSchema } from "./activity.js";

const TENANT = "ptn_01JB0000000000000000000000:01JB0000000000000000000001";
const RAIL = "CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";

const full = {
  tenant_id: TENANT,
  mandate: {
    id: "mdt_01JB0000000000000000000004",
    status: "active" as const,
    grant: {
      actions: ["catalog:read", "intent:create"],
      venues: ["signaldesk:" + RAIL],
      assets: ["USDC:CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"],
      limits: { perTx: "0.5000000", perDay: "1.0000000", currency: "USDC" },
      payTo: ["GAK6E5E7L63ZYFZZZFXDTYVG6MVAKILSHI5FITGH5U4ORACEZQ4GFP2K"],
      products: ["signaldesk:market-brief-xlm-usdc"],
    },
    valid_from: "2026-09-12T00:00:00.000Z",
    valid_until: "2026-10-12T00:00:00.000Z",
    anchor_tx: "a".repeat(64),
  },
  per_day: { limit: "1.0000000", spent_today: "0.8500000", remaining: "0.1500000", currency: "USDC", near_limit: true },
  rail: { contract_id: RAIL, balance: "0.1500000", asset: "USDC", sponsored: true },
  purchases: [],
  refusals: [
    { at: "2026-09-12T01:00:00.000Z", code: "MandateProductNotAllowed", reason: "tu Mandato no permite este producto", intent_id: null },
  ],
};

describe("tenantActivityResourceSchema", () => {
  it("accepts a tenant with everything filled in", () => {
    expect(tenantActivityResourceSchema.safeParse(full).success).toBe(true);
  });

  it("carries the signed product allowlist, not a paraphrase of it", () => {
    const parsed = tenantActivityResourceSchema.parse(full);
    expect(parsed.mandate?.grant.products).toEqual(["signaldesk:market-brief-xlm-usdc"]);
  });

  it("accepts a tenant that has signed nothing and paid for nothing", () => {
    const empty = { tenant_id: TENANT, mandate: null, per_day: null, rail: null, purchases: [], refusals: [] };
    expect(tenantActivityResourceSchema.safeParse(empty).success).toBe(true);
  });

  it("accepts a signed tenant whose rail does not exist yet — lazy deploy, T58", () => {
    expect(tenantActivityResourceSchema.safeParse({ ...full, rail: null }).success).toBe(true);
  });

  it("refuses an unknown top-level field rather than passing it through", () => {
    expect(tenantActivityResourceSchema.safeParse({ ...full, email: "alguien@ejemplo.cl" }).success).toBe(false);
  });

  it("refuses a rail whose contract id is not a contract id", () => {
    expect(tenantActivityResourceSchema.safeParse({ ...full, rail: { ...full.rail, contract_id: "no-soy-un-contrato" } }).success).toBe(false);
  });
});
