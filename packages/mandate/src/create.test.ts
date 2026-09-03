import { randomBytes } from "node:crypto";


import { Keypair, StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";

import { createMandate } from "./create.js";
import { agentPayMandateSchema } from "./mandate.js";
import { TEST_GRANT, TEST_REGISTRY, didOf } from "./testing.js";

const principal = Keypair.random();
const agent = Keypair.random();

/** Every rejection here is the same typed error; assert the code, never text. */
function expectInvalidMandate(run: () => unknown): void {
  expect(run).toThrowError(
    expect.objectContaining({ name: "AgentPassError", code: "InvalidMandate" }),
  );
}

const base = {
  principal: didOf(principal),
  agent: didOf(agent),
  grant: TEST_GRANT,
  registry: TEST_REGISTRY,
  validUntil: "2026-12-01T00:00:00.000Z",
};

describe("createMandate", () => {
  it("assembles a document that passes the mandate schema", () => {
    const mandate = createMandate(base);
    expect(agentPayMandateSchema.safeParse(mandate).success).toBe(true);
  });

  it("puts the principal in `issuer` and the agent in the subject", () => {
    const mandate = createMandate(base);

    expect(mandate.issuer).toBe(didOf(principal));
    expect(mandate.credentialSubject.id).toBe(didOf(agent));
  });

  it("defaults validFrom to now, from the injected clock", () => {
    const mandate = createMandate(base, { now: new Date("2026-09-15T12:00:00.000Z") });
    expect(mandate.validFrom).toBe("2026-09-15T12:00:00.000Z");
  });

  it("mints a fresh uuid per mandate, and honours one that is supplied", () => {
    expect(createMandate(base).mandateId).not.toBe(createMandate(base).mandateId);

    const fixed = "11111111-2222-4333-8444-555555555555";
    expect(createMandate({ ...base, mandateId: fixed }).mandateId).toBe(fixed);
  });

  it("refuses a window that ends before it begins", () => {
    expectInvalidMandate(() => createMandate({ ...base, validFrom: "2026-12-02T00:00:00.000Z" }));
  });

  it("allows a zero-length window, which authorises exactly one instant", () => {
    // Not an error: the edges are inclusive, so this is a mandate valid at
    // exactly one moment. Odd, but coherent — and refusing it would mean
    // encoding a minimum duration nobody asked for.
    const instant = "2026-10-01T00:00:00.000Z";
    const mandate = createMandate({ ...base, validFrom: instant, validUntil: instant });
    expect(mandate.validFrom).toBe(mandate.validUntil);
  });

  it("refuses a request with no validUntil", () => {
    const { validUntil: _dropped, ...withoutEnd } = base;

    expectInvalidMandate(() => createMandate(withoutEnd as typeof base));
  });

  it("refuses an unknown field rather than silently dropping it", () => {
    expectInvalidMandate(() => createMandate({ ...base, perDay: "999" } as unknown as typeof base));
  });

  it("refuses a registry that is not a contract id", () => {
    expectInvalidMandate(() =>
      createMandate({ ...base, registry: StrKey.encodeEd25519PublicKey(randomBytes(32)) }),
    );
  });

  it("refuses a grant with no actions, because an empty grant is not a consent", () => {
    expectInvalidMandate(() => createMandate({ ...base, grant: { ...TEST_GRANT, actions: [] } }));
  });

  it("permits an empty venues list, which means 'nothing' (B-1)", () => {
    // Fail-closed is the checker's job, not the constructor's: a mandate that
    // authorises no venue is a perfectly well-formed mandate that permits
    // nothing. Rejecting it here would push the fail-closed rule into two
    // places, and the checker is the one that has to hold it.
    const mandate = createMandate({ ...base, grant: { ...TEST_GRANT, venues: [] } });
    expect(mandate.credentialSubject.grant.venues).toEqual([]);
  });
});
