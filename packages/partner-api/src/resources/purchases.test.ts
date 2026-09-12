import { describe, expect, it } from "vitest";

import {
  createPurchaseRequestSchema,
  purchaseResourceSchema,
  venueIdSchema,
} from "./purchases.js";

const TENANT = "ptn_01JB0000000000000000000000:01JB0000000000000000000001";
const AGENT = "agt_01JB0000000000000000000002";
const PURCHASE = "pur_01JB0000000000000000000003";
const VENUE = "signaldesk:CCL57L4ZDBRRWL2PKHZCYQZRDV4A37LOZRWMSCRQQ5JYRKMJW6I3TM7F";

function request(overrides: Record<string, unknown> = {}) {
  return { tenant_id: TENANT, venue: VENUE, product_id: "signaldesk:market-brief-xlm-usdc", quantity: 1, ...overrides };
}

describe("venueIdSchema", () => {
  it("accepts a slug paired with a contract id", () => {
    expect(venueIdSchema.safeParse(VENUE).success).toBe(true);
  });

  it("refuses a bare slug, which names no venue anyone could be paid at", () => {
    expect(venueIdSchema.safeParse("signaldesk").success).toBe(false);
  });

  it("refuses a slug paired with a classic account — a venue is a contract", () => {
    expect(venueIdSchema.safeParse("signaldesk:GAK6E5E7L63ZYFZZZFXDTYVG6MVAKILSHI5FITGH5U4ORACEZQ4GFP2K").success).toBe(false);
  });

  it("refuses an uppercase or underscored slug, so one venue has one spelling", () => {
    expect(venueIdSchema.safeParse(`SignalDesk:${VENUE.split(":")[1]}`).success).toBe(false);
    expect(venueIdSchema.safeParse(`signal_desk:${VENUE.split(":")[1]}`).success).toBe(false);
  });
});

describe("createPurchaseRequestSchema", () => {
  it("accepts the minimal request", () => {
    expect(createPurchaseRequestSchema.safeParse(request()).success).toBe(true);
  });

  it("accepts an optional partner-side ceiling", () => {
    expect(createPurchaseRequestSchema.safeParse(request({ max_total: "1.5000000" })).success).toBe(true);
  });

  it("refuses a ceiling with more precision than Stellar carries", () => {
    expect(createPurchaseRequestSchema.safeParse(request({ max_total: "1.12345678" })).success).toBe(false);
  });

  it("refuses a quantity of zero or a fraction", () => {
    expect(createPurchaseRequestSchema.safeParse(request({ quantity: 0 })).success).toBe(false);
    expect(createPurchaseRequestSchema.safeParse(request({ quantity: 1.5 })).success).toBe(false);
  });

  it("refuses an unknown field rather than ignoring it", () => {
    // An integrator who believes they constrained a purchase with a field we
    // silently drop has to find out at the boundary, not after a payment.
    expect(createPurchaseRequestSchema.safeParse(request({ per_tx: "0.01" })).success).toBe(false);
    expect(createPurchaseRequestSchema.safeParse(request({ pay_to: "GAK6E5E7L63ZYFZZZFXDTYVG6MVAKILSHI5FITGH5U4ORACEZQ4GFP2K" })).success).toBe(false);
  });

  it("refuses a tenant id that is not one", () => {
    expect(createPurchaseRequestSchema.safeParse(request({ tenant_id: "usuario-42" })).success).toBe(false);
  });
});

describe("purchaseResourceSchema", () => {
  const settled = {
    id: PURCHASE,
    tenant_id: TENANT,
    agent_id: AGENT,
    outcome: "settled" as const,
    code: null,
    reason: null,
    venue: VENUE,
    product_id: "signaldesk:market-brief-xlm-usdc",
    quantity: 1,
    intent_id: "8b0851b3-94e9-45b0-ba36-d6e9e32541d2",
    total: "0.5000000",
    asset: "USDC:CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    pay_to: "GAK6E5E7L63ZYFZZZFXDTYVG6MVAKILSHI5FITGH5U4ORACEZQ4GFP2K",
    transaction_hash: "b".repeat(64),
    explorer_url: "https://stellar.expert/explorer/testnet/tx/" + "b".repeat(64),
    delivery: { delivery_id: "dlv_1", artifact_url: "https://signaldesk.example/d/1", receipt_hash: "c".repeat(64) },
    created_at: "2026-09-12T00:00:00.000Z",
  };

  it("accepts a settled purchase", () => {
    expect(purchaseResourceSchema.safeParse(settled).success).toBe(true);
  });

  it("accepts a refusal, where everything about the payment is absent", () => {
    const refused = {
      ...settled,
      outcome: "refused" as const,
      code: "MandateProductNotAllowed",
      reason: "tu Mandato no permite este producto",
      total: null,
      asset: null,
      pay_to: null,
      transaction_hash: null,
      explorer_url: null,
      delivery: null,
    };
    expect(purchaseResourceSchema.safeParse(refused).success).toBe(true);
  });

  it("refuses a resource that omits a field rather than setting it null", () => {
    const { delivery: _delivery, ...withoutDelivery } = settled;
    expect(purchaseResourceSchema.safeParse(withoutDelivery).success).toBe(false);
  });

  it("refuses an outcome outside the two this route can produce", () => {
    expect(purchaseResourceSchema.safeParse({ ...settled, outcome: "pending" }).success).toBe(false);
  });
});
