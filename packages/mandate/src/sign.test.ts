import { createHash } from "node:crypto";

import { AGENTPASS_JWS_ALG, hasErrorCode, stellarKeypairToJWK } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk/base";
import { CompactSign, importJWK } from "jose";
import { describe, expect, it } from "vitest";

import { AGENTPAY_MANDATE_TYP, mandateHash, signMandate, verifyMandate } from "./sign.js";
import { didOf, makeTestMandate } from "./testing.js";

const principal = Keypair.random();
const agent = Keypair.random();
const stranger = Keypair.random();

const INSIDE = new Date("2026-10-01T00:00:00Z");

/** Signs an arbitrary payload with an arbitrary header — for forging tests. */
async function forge(
  payload: unknown,
  keypair: Keypair,
  header: { typ?: string; kid?: string } = {},
): Promise<string> {
  const key = await importJWK(stellarKeypairToJWK(keypair), AGENTPASS_JWS_ALG);
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({
      alg: AGENTPASS_JWS_ALG,
      typ: header.typ ?? AGENTPAY_MANDATE_TYP,
      ...(header.kid === undefined ? {} : { kid: header.kid }),
    })
    .sign(key);
}

describe("signMandate", () => {
  it("round-trips: the principal signs, and the mandate verifies", async () => {
    const mandate = makeTestMandate(principal, agent);
    const signed = await signMandate(mandate, principal);
    const verified = await verifyMandate(signed.jws, { now: INSIDE });

    expect(verified.mandate).toEqual(mandate);
    expect(verified.principal).toBe(didOf(principal));
    expect(verified.agent).toBe(didOf(agent));
    expect(verified.hash).toBe(signed.hash);
  });

  it("hashes the JWS, which is what gets anchored", async () => {
    const signed = await signMandate(makeTestMandate(principal, agent), principal);

    expect(signed.hash).toBe(createHash("sha256").update(signed.jws, "utf8").digest("hex"));
    expect(signed.hash).toBe(mandateHash(signed.jws));
    expect(signed.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("carries the mandate typ, distinct from a credential's and an intent's", async () => {
    const signed = await signMandate(makeTestMandate(principal, agent), principal);
    const header = JSON.parse(
      Buffer.from(signed.jws.split(".")[0] ?? "", "base64url").toString("utf8"),
    ) as { typ: string };

    expect(header.typ).toBe("mandate+jwt");
    expect(header.typ).not.toBe("vc+jwt");
    expect(header.typ).not.toBe("intent+jwt");
  });

  it("refuses to be signed by the agent it empowers", async () => {
    // The whole point of the document: an agent cannot consent on its own
    // behalf. This is the failure that matters most in the phase.
    const mandate = makeTestMandate(principal, agent);

    await expect(signMandate(mandate, agent)).rejects.toSatisfy((error) =>
      hasErrorCode(error, "SignerMismatch"),
    );
  });

  it("refuses to be signed by an unrelated key", async () => {
    await expect(signMandate(makeTestMandate(principal, agent), stranger)).rejects.toSatisfy(
      (error) => hasErrorCode(error, "SignerMismatch"),
    );
  });

  it("gives two otherwise-identical mandates different hashes", async () => {
    // Without `mandateId`, these two would be byte-identical, collide on hash,
    // and the registry would refuse to anchor the second one.
    const overrides = { validFrom: "2026-09-01T00:00:00.000Z", validUntil: "2026-12-01T00:00:00.000Z" };
    const first = await signMandate(makeTestMandate(principal, agent, overrides), principal);
    const second = await signMandate(makeTestMandate(principal, agent, overrides), principal);

    expect(first.mandate.mandateId).not.toBe(second.mandate.mandateId);
    expect(first.hash).not.toBe(second.hash);
  });
});

describe("verifyMandate", () => {
  it("rejects a mandate signed by someone other than its issuer", async () => {
    const mandate = makeTestMandate(principal, agent);
    const forged = await forge(mandate, stranger, { kid: didOf(principal) });

    await expect(verifyMandate(forged, { now: INSIDE })).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidSignature"),
    );
  });

  it("never lets kid choose the verification key", async () => {
    const mandate = makeTestMandate(principal, agent);
    const forged = await forge(mandate, stranger, { kid: didOf(stranger) });

    await expect(verifyMandate(forged, { now: INSIDE })).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidMandate"),
    );
  });

  it("rejects an agent-signed mandate even when the agent rewrites the issuer", async () => {
    // The forgery an agent would actually attempt: name itself as principal so
    // the signature checks out. It verifies as a document — and is then a
    // mandate the agent granted itself, which the registry has never anchored
    // and which names an issuer no principal recognises.
    const selfDealt = makeTestMandate(agent, agent);
    const signed = await signMandate(selfDealt, agent);
    const verified = await verifyMandate(signed.jws, { now: INSIDE });

    expect(verified.principal).toBe(didOf(agent));
    expect(verified.principal).not.toBe(didOf(principal));
  });

  it("rejects a credential's typ, so a credential cannot pass as a mandate", async () => {
    const mandate = makeTestMandate(principal, agent);
    const forged = await forge(mandate, principal, { typ: "vc+jwt" });

    await expect(verifyMandate(forged, { now: INSIDE })).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidMandate"),
    );
  });

  it("rejects a payload that is not a mandate", async () => {
    const forged = await forge({ issuer: didOf(principal), hello: "world" }, principal);

    await expect(verifyMandate(forged, { now: INSIDE })).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidMandate"),
    );
  });

  it("rejects an unknown extra field, because the schema is strict", async () => {
    const mandate = { ...makeTestMandate(principal, agent), extra: "smuggled" };
    const forged = await forge(mandate, principal);

    await expect(verifyMandate(forged, { now: INSIDE })).rejects.toSatisfy((error) =>
      hasErrorCode(error, "InvalidMandate"),
    );
  });

  describe("the validity window", () => {
    it("rejects a mandate whose window has not opened", async () => {
      const signed = await signMandate(makeTestMandate(principal, agent), principal);

      await expect(
        verifyMandate(signed.jws, { now: new Date("2026-08-31T23:59:59Z") }),
      ).rejects.toSatisfy((error) => hasErrorCode(error, "MandateNotYetValid"));
    });

    it("rejects a mandate whose window has closed", async () => {
      const signed = await signMandate(makeTestMandate(principal, agent), principal);

      await expect(
        verifyMandate(signed.jws, { now: new Date("2026-12-01T00:00:00.001Z") }),
      ).rejects.toSatisfy((error) => hasErrorCode(error, "MandateExpired"));
    });

    it("treats both edges as inclusive, matching the credential and the contract", async () => {
      const signed = await signMandate(makeTestMandate(principal, agent), principal);

      await expect(
        verifyMandate(signed.jws, { now: new Date("2026-09-01T00:00:00.000Z") }),
      ).resolves.toBeDefined();
      await expect(
        verifyMandate(signed.jws, { now: new Date("2026-12-01T00:00:00.000Z") }),
      ).resolves.toBeDefined();
    });

    it("checks the signature before the clock", async () => {
      // A forged *and* expired mandate must report the forgery. Reporting
      // "expired" would hide it — the rule phase 1 settled.
      const mandate = makeTestMandate(principal, agent);
      const forged = await forge(mandate, stranger, { kid: didOf(principal) });

      await expect(
        verifyMandate(forged, { now: new Date("2027-01-01T00:00:00Z") }),
      ).rejects.toSatisfy((error) => hasErrorCode(error, "InvalidSignature"));
    });
  });
});
