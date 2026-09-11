import { AgentPassError } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { errorEnvelopeSchema, successEnvelope, toErrorEnvelope } from "./envelope.js";

describe("toErrorEnvelope", () => {
  it("carries an AgentPassError's code, message and details", () => {
    const error = new AgentPassError("TenantNotFound", "no tenant with that id", { details: { tenantId: "tnt_1" } });
    const envelope = toErrorEnvelope(error);
    expect(envelope).toEqual({ ok: false, code: "TenantNotFound", message: "no tenant with that id", details: { tenantId: "tnt_1" } });
    expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("falls back to code 'unknown' for anything that is not an AgentPassError", () => {
    const envelope = toErrorEnvelope(new Error("boom"));
    expect(envelope.code).toBe("unknown");
    expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });
});

describe("successEnvelope", () => {
  it("wraps the payload under ok: true, data", () => {
    expect(successEnvelope({ id: "tnt_1" })).toEqual({ ok: true, data: { id: "tnt_1" } });
  });
});
