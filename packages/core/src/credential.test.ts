import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";

import { credentialRequestSchema, scopeLimitsSchema } from "./credential.js";

const VALID_REQUEST = {
  agent: { name: "compras-demo", model: "claude-sonnet-4-6", operator: "agentpass-pilot" },
  scope: {
    actions: ["catalog:read", "intent:create"],
    venues: [],
    assets: [],
    limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" },
  },
};

describe("credentialRequestSchema", () => {
  it("accepts agent + scope, with no id or principal", () => {
    expect(credentialRequestSchema.safeParse(VALID_REQUEST).success).toBe(true);
  });

  it("rejects an id or principal slipped into the request — those are the CLI's job, not the file's", () => {
    const withId = { ...VALID_REQUEST, id: Keypair.random().publicKey() };
    const withPrincipal = { ...VALID_REQUEST, principal: Keypair.random().publicKey() };

    expect(credentialRequestSchema.safeParse(withId).success).toBe(false);
    expect(credentialRequestSchema.safeParse(withPrincipal).success).toBe(false);
  });

  it("rejects missing agent or scope", () => {
    expect(credentialRequestSchema.safeParse({ scope: VALID_REQUEST.scope }).success).toBe(false);
    expect(credentialRequestSchema.safeParse({ agent: VALID_REQUEST.agent }).success).toBe(false);
  });
});

describe("scopeLimitsSchema amounts", () => {
  it("accepts a plain integer and up to 7 decimal places", () => {
    for (const perTx of ["0", "50", "50.00", "50.0000001"]) {
      expect(scopeLimitsSchema.safeParse({ perTx, perDay: "1", currency: "USDC" }).success).toBe(
        true,
      );
    }
  });

  it("rejects a negative amount, an 8th decimal place, and a leading zero", () => {
    for (const perTx of ["-1", "1.00000001", "01", "1e5", "fifty"]) {
      expect(scopeLimitsSchema.safeParse({ perTx, perDay: "1", currency: "USDC" }).success).toBe(
        false,
      );
    }
  });
});
