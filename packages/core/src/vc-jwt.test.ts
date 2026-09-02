import { createHash, randomBytes } from "node:crypto";

import { Keypair, StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";

import type { AgentPassCredential } from "./credential.js";
import { stellarAddressToDid } from "./did.js";
import { hasErrorCode } from "./errors.js";
import { AGENTPASS_JWS_TYP, credentialHash, signCredential, verifyCredential } from "./vc-jwt.js";

const REGISTRY = StrKey.encodeContract(randomBytes(32));

function credentialFor(
  issuer: Keypair,
  agent: Keypair,
  window: { validFrom: string; validUntil: string } = {
    validFrom: "2026-09-01T00:00:00Z",
    validUntil: "2026-12-01T00:00:00Z",
  },
): AgentPassCredential {
  const issuerDid = stellarAddressToDid(issuer.publicKey(), "testnet");

  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "AgentPassCredential"],
    issuer: issuerDid,
    validFrom: window.validFrom,
    validUntil: window.validUntil,
    credentialSubject: {
      id: stellarAddressToDid(agent.publicKey(), "testnet"),
      agent: { name: "compras-demo", model: "claude-sonnet-4-6", operator: "agentpass-pilot" },
      principal: issuerDid,
      scope: {
        actions: ["catalog:read", "intent:create"],
        venues: [`bazaar-aliado:${REGISTRY}`],
        assets: ["USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"],
        limits: { perTx: "50.00", perDay: "200.00", currency: "USDC" },
      },
    },
    credentialStatus: { type: "AgentPassRegistry2026", registry: REGISTRY },
  };
}

const INSIDE_WINDOW = new Date("2026-10-01T00:00:00Z");

/** Re-encodes a payload the issuer never signed, keeping the original signature. */
function tamperPayload(jws: string, mutate: (credential: AgentPassCredential) => void): string {
  const [header, payload, signature] = jws.split(".") as [string, string, string];
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AgentPassCredential;

  mutate(decoded);

  const reencoded = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
  return `${header}.${reencoded}.${signature}`;
}

function reheader(jws: string, header: Record<string, unknown>): string {
  const [, payload, signature] = jws.split(".") as [string, string, string];
  const encoded = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  return `${encoded}.${payload}.${signature}`;
}

describe("sign and verify", () => {
  const issuer = Keypair.random();
  const agent = Keypair.random();

  it("round-trips: a signed credential verifies and comes back intact", async () => {
    const credential = credentialFor(issuer, agent);

    const signed = await signCredential(credential, issuer);
    const verified = await verifyCredential(signed.jws, { now: INSIDE_WINDOW });

    expect(verified.credential).toEqual(credential);
    expect(verified.issuer).toBe(credential.issuer);
    expect(verified.subject).toBe(credential.credentialSubject.id);
    expect(verified.hash).toBe(signed.hash);
  });

  it("produces a three-segment compact JWS with the VC-JWT header", async () => {
    const { jws } = await signCredential(credentialFor(issuer, agent), issuer);
    const [header] = jws.split(".") as [string];

    expect(jws.split(".")).toHaveLength(3);
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      alg: "EdDSA",
      typ: AGENTPASS_JWS_TYP,
      kid: stellarAddressToDid(issuer.publicKey(), "testnet"),
    });
  });

  it("anchors sha256 of the compact JWS itself", async () => {
    const { jws, hash } = await signCredential(credentialFor(issuer, agent), issuer);

    expect(hash).toBe(createHash("sha256").update(jws, "utf8").digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(credentialHash(jws)).toBe(hash);
  });

  it("verifies without touching the network", async () => {
    const { jws } = await signCredential(credentialFor(issuer, agent), issuer);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("verification must stay offline");
    }) as typeof fetch;

    try {
      await expect(verifyCredential(jws, { now: INSIDE_WINDOW })).resolves.toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("a tampered payload fails", () => {
  const issuer = Keypair.random();
  const agent = Keypair.random();

  it("rejects a raised spending limit with InvalidSignature", async () => {
    const { jws } = await signCredential(credentialFor(issuer, agent), issuer);

    const forged = tamperPayload(jws, (credential) => {
      credential.credentialSubject.scope.limits.perTx = "5000.00";
    });

    expect(forged).not.toBe(jws);
    await expect(verifyCredential(forged, { now: INSIDE_WINDOW })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidSignature"),
    );
  });

  it("rejects an added action with InvalidSignature", async () => {
    const { jws } = await signCredential(credentialFor(issuer, agent), issuer);

    const forged = tamperPayload(jws, (credential) => {
      credential.credentialSubject.scope.actions.push("payment:execute");
    });

    await expect(verifyCredential(forged, { now: INSIDE_WINDOW })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidSignature"),
    );
  });

  it("rejects a signature with a single bit flipped", async () => {
    const { jws } = await signCredential(credentialFor(issuer, agent), issuer);
    const [header, payload, signature] = jws.split(".") as [string, string, string];

    // Flip a bit in the decoded bytes, not in the base64url text. The final
    // character of a 64-byte signature carries only two significant bits, so
    // rewriting it is a no-op about a quarter of the time.
    const bytes = Uint8Array.from(Buffer.from(signature, "base64url"));
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    const flipped = Buffer.from(bytes).toString("base64url");

    expect(flipped).not.toBe(signature);
    await expect(
      verifyCredential(`${header}.${payload}.${flipped}`, { now: INSIDE_WINDOW }),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "InvalidSignature"));
  });

  it("rejects a full impersonation, where only the signature stands in the way", async () => {
    const attacker = Keypair.random();
    const credential = credentialFor(issuer, agent);

    // The attacker signs the victim's credential with their own key, then
    // rewrites *both* the payload's issuer and the header's kid to the victim.
    // Every self-declared field now names the victim; nothing but the signature
    // distinguishes this from the real thing.
    const forged = await signCredential(
      { ...credential, issuer: stellarAddressToDid(attacker.publicKey(), "testnet") },
      attacker,
    );
    const relabelled = reheader(
      tamperPayload(forged.jws, (payload) => {
        payload.issuer = credential.issuer;
      }),
      { alg: "EdDSA", typ: AGENTPASS_JWS_TYP, kid: credential.issuer },
    );

    try {
      await verifyCredential(relabelled, { now: INSIDE_WINDOW });
      expect.unreachable("an impersonated credential must not verify");
    } catch (error) {
      expect(hasErrorCode(error, "InvalidSignature")).toBe(true);
    }
  });

  it("rejects an issuer swap even when the attacker leaves kid alone", async () => {
    const attacker = Keypair.random();
    const credential = credentialFor(issuer, agent);

    const forged = await signCredential(
      { ...credential, issuer: stellarAddressToDid(attacker.publicKey(), "testnet") },
      attacker,
    );
    const relabelled = tamperPayload(forged.jws, (payload) => {
      payload.issuer = credential.issuer;
    });

    // Caught earlier, by the kid/issuer disagreement — but still caught.
    await expect(verifyCredential(relabelled, { now: INSIDE_WINDOW })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidJws"),
    );
  });
});

describe("the validity window fails distinguishably from the signature", () => {
  const issuer = Keypair.random();
  const agent = Keypair.random();

  it("an expired credential raises CredentialExpired, not InvalidSignature", async () => {
    const { jws } = await signCredential(
      credentialFor(issuer, agent, {
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2026-02-01T00:00:00Z",
      }),
      issuer,
    );

    try {
      await verifyCredential(jws, { now: INSIDE_WINDOW });
      expect.unreachable("an expired credential must not verify");
    } catch (error) {
      expect(hasErrorCode(error, "CredentialExpired")).toBe(true);
      expect(hasErrorCode(error, "InvalidSignature")).toBe(false);
    }
  });

  it("a not-yet-valid credential raises CredentialNotYetValid", async () => {
    const { jws } = await signCredential(
      credentialFor(issuer, agent, {
        validFrom: "2027-01-01T00:00:00Z",
        validUntil: "2027-06-01T00:00:00Z",
      }),
      issuer,
    );

    try {
      await verifyCredential(jws, { now: INSIDE_WINDOW });
      expect.unreachable("a future credential must not verify");
    } catch (error) {
      expect(hasErrorCode(error, "CredentialNotYetValid")).toBe(true);
    }
  });

  it("the signature is checked before the clock, so a forgery never reads as merely expired", async () => {
    const { jws } = await signCredential(
      credentialFor(issuer, agent, {
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2026-02-01T00:00:00Z",
      }),
      issuer,
    );
    const forged = tamperPayload(jws, (credential) => {
      credential.validUntil = "2030-01-01T00:00:00Z";
    });

    await expect(verifyCredential(forged, { now: INSIDE_WINDOW })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidSignature"),
    );
  });

  it("accepts the exact boundary instants", async () => {
    const window = { validFrom: "2026-09-01T00:00:00Z", validUntil: "2026-12-01T00:00:00Z" };
    const { jws } = await signCredential(credentialFor(issuer, agent, window), issuer);

    await expect(
      verifyCredential(jws, { now: new Date(window.validFrom) }),
    ).resolves.toBeDefined();
    await expect(
      verifyCredential(jws, { now: new Date(window.validUntil) }),
    ).resolves.toBeDefined();
  });
});

describe("header and payload shape", () => {
  const issuer = Keypair.random();
  const agent = Keypair.random();

  it("refuses alg: none", async () => {
    const { jws } = await signCredential(credentialFor(issuer, agent), issuer);
    const stripped = reheader(jws, { alg: "none", typ: AGENTPASS_JWS_TYP });

    await expect(verifyCredential(stripped, { now: INSIDE_WINDOW })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidJws"),
    );
  });

  it("refuses a substituted algorithm", async () => {
    const { jws } = await signCredential(credentialFor(issuer, agent), issuer);
    const swapped = reheader(jws, { alg: "HS256", typ: AGENTPASS_JWS_TYP });

    await expect(verifyCredential(swapped, { now: INSIDE_WINDOW })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidJws"),
    );
  });

  it("refuses a kid that disagrees with the payload's issuer", async () => {
    const { jws } = await signCredential(credentialFor(issuer, agent), issuer);
    const swapped = reheader(jws, {
      alg: "EdDSA",
      typ: AGENTPASS_JWS_TYP,
      kid: stellarAddressToDid(Keypair.random().publicKey(), "testnet"),
    });

    await expect(verifyCredential(swapped, { now: INSIDE_WINDOW })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidJws"),
    );
  });

  it("refuses anything that is not a three-segment compact JWS", async () => {
    for (const bad of ["", "a.b", "a.b.c.d", "not-a-jws"]) {
      await expect(verifyCredential(bad, { now: INSIDE_WINDOW })).rejects.toSatisfy(
        (error: unknown) => hasErrorCode(error, "InvalidJws"),
      );
    }
  });
});

describe("schema enforcement at the edge", () => {
  const issuer = Keypair.random();
  const agent = Keypair.random();

  it("refuses to sign a credential with an unknown field", async () => {
    const credential = { ...credentialFor(issuer, agent), rogue: "field" } as AgentPassCredential;

    await expect(signCredential(credential, issuer)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "InvalidCredential"),
    );
  });

  it("refuses to sign a limit that is not a decimal amount", async () => {
    const credential = credentialFor(issuer, agent);
    credential.credentialSubject.scope.limits.perTx = "fifty";

    await expect(signCredential(credential, issuer)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "InvalidCredential"),
    );
  });

  it("refuses to sign a registry that is not a contract id", async () => {
    const credential = credentialFor(issuer, agent);
    credential.credentialStatus.registry = issuer.publicKey();

    await expect(signCredential(credential, issuer)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "InvalidCredential"),
    );
  });

  it("refuses to sign with a key that is not the issuer", async () => {
    const credential = credentialFor(issuer, agent);

    await expect(signCredential(credential, Keypair.random())).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "ConfigError"),
    );
  });
});
