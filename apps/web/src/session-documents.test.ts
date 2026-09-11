import type { CredentialRequest } from "@agentpass/core";
import { didToStellarAddress, stellarAddressToDid } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { buildSessionDocuments, type SessionDocumentsParams } from "./session-documents.js";

const ISSUER = Keypair.random().publicKey();
const AGENT = Keypair.random().publicKey();
const WALLET = Keypair.random().publicKey();
const REGISTRY = "CBDWMXZEE44NJ3RA6RS7K4EK36KDFW5S7KHP276HCMM4I52MIUUHEF5B";

/** The same shape as `examples/scope-stellar-bazaar.json`, which is what the server actually loads. */
const SCOPE: CredentialRequest = {
  agent: { name: "compras-demo", model: "claude-opus-5", operator: "agentpay-pilot" },
  scope: {
    actions: ["catalog:read", "intent:create"],
    venues: ["stellar-bazaar:CBDWMXZEE44NJ3RA6RS7K4EK36KDFW5S7KHP276HCMM4I52MIUUHEF5B"],
    assets: ["USDC:CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"],
    limits: { perTx: "1.00", perDay: "5.00", currency: "USDC" },
  },
};

function params(overrides: Partial<SessionDocumentsParams> = {}): SessionDocumentsParams {
  const now = new Date("2026-09-10T00:00:00.000Z");
  return {
    issuerAddress: ISSUER,
    agentAddress: AGENT,
    walletAddress: undefined,
    scope: SCOPE,
    registryContractId: REGISTRY,
    now,
    validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe("buildSessionDocuments", () => {
  // The regression this whole module exists for. T35 made a connected wallet
  // sign the Mandate but left the credential naming the platform as the
  // agent's principal; `checkMandate` compares exactly those two values, so
  // every purchase in a wallet session died with `MandatePrincipalMismatch`
  // (`C-17`). These two assertions are the invariant, stated once per path.
  it("makes the credential's principal and the mandate's issuer the same party — classic path", () => {
    const { credential, mandate } = buildSessionDocuments(params());
    expect(credential.credentialSubject.principal).toBe(mandate.issuer);
  });

  it("makes the credential's principal and the mandate's issuer the same party — wallet path", () => {
    const { credential, mandate } = buildSessionDocuments(params({ walletAddress: WALLET }));
    expect(credential.credentialSubject.principal).toBe(mandate.issuer);
  });

  it("names the connected wallet as that shared principal, not the platform", () => {
    const { credential, mandate, principal } = buildSessionDocuments(params({ walletAddress: WALLET }));
    expect(didToStellarAddress(principal)).toBe(WALLET);
    expect(credential.credentialSubject.principal).toBe(stellarAddressToDid(WALLET, "testnet"));
    expect(mandate.issuer).toBe(stellarAddressToDid(WALLET, "testnet"));
  });

  it("falls back to the platform as principal when no wallet is connected", () => {
    const { principal } = buildSessionDocuments(params());
    expect(didToStellarAddress(principal)).toBe(ISSUER);
  });

  // The wallet becomes the principal; it never becomes the attester. Getting
  // this backwards would mean claiming the wallet signed a credential it
  // never saw.
  it("keeps the platform as the credential's issuer even when a wallet is the principal", () => {
    const { credential } = buildSessionDocuments(params({ walletAddress: WALLET }));
    expect(credential.issuer).toBe(stellarAddressToDid(ISSUER, "testnet"));
    expect(credential.issuer).not.toBe(credential.credentialSubject.principal);
  });

  it("names the same agent in both documents", () => {
    const { credential, mandate } = buildSessionDocuments(params({ walletAddress: WALLET }));
    expect(credential.credentialSubject.id).toBe(stellarAddressToDid(AGENT, "testnet"));
    expect(mandate.credentialSubject.id).toBe(credential.credentialSubject.id);
  });

  it("gives both documents the same validity window", () => {
    const { credential, mandate } = buildSessionDocuments(params());
    expect(mandate.validFrom).toBe(credential.validFrom);
    expect(mandate.validUntil).toBe(credential.validUntil);
    expect(credential.validFrom).toBe("2026-09-10T00:00:00.000Z");
    expect(credential.validUntil).toBe("2026-09-11T00:00:00.000Z");
  });

  // `G-8`: the mandate grants exactly the scope, not a narrower slice — a
  // purchase authorises twice against the same daily total, so a tighter
  // perDay here would reject the very first purchase.
  it("grants exactly the credential's scope, not a narrower one", () => {
    const { credential, mandate } = buildSessionDocuments(params());
    expect(mandate.credentialSubject.grant).toEqual(credential.credentialSubject.scope);
  });

  it("points both documents at the same registry", () => {
    const { credential, mandate } = buildSessionDocuments(params());
    expect(credential.credentialStatus.registry).toBe(REGISTRY);
    expect(mandate.credentialStatus.registry).toBe(REGISTRY);
  });

  // T51: a partner-proposed grant can carry `payTo`, which a credential's
  // plain `Scope` cannot express (`M-14`). These four assert the explicit
  // `grant` param without touching a single existing call site's behaviour —
  // every test above this one calls `buildSessionDocuments` with no `grant`
  // at all, and still passes unchanged.
  describe("with an explicit grant (T51)", () => {
    const grantWithPayTo = { ...SCOPE.scope, payTo: [WALLET] };

    it("uses the explicit grant for the mandate instead of the credential's scope", () => {
      const { mandate } = buildSessionDocuments(params({ grant: grantWithPayTo }));
      expect(mandate.credentialSubject.grant).toEqual(grantWithPayTo);
    });

    it("still gives the credential only the plain scope — payTo never reaches it", () => {
      const { credential } = buildSessionDocuments(params({ grant: grantWithPayTo }));
      expect(credential.credentialSubject.scope).toEqual(SCOPE.scope);
      expect(credential.credentialSubject.scope).not.toHaveProperty("payTo");
    });

    it("does not disturb the C-17 invariant — principal and issuer still agree", () => {
      const { credential, mandate } = buildSessionDocuments(params({ walletAddress: WALLET, grant: grantWithPayTo }));
      expect(credential.credentialSubject.principal).toBe(mandate.issuer);
    });

    it("falls back to scope.scope when grant is omitted — the default every prior call site relies on", () => {
      const withGrant = buildSessionDocuments(params({ grant: SCOPE.scope }));
      const withoutGrant = buildSessionDocuments(params());
      expect(withoutGrant.mandate.credentialSubject.grant).toEqual(withGrant.mandate.credentialSubject.grant);
    });
  });
});
