import { hasErrorCode, signStellarMessage, stellarAddressToDid } from "@agentpass/core";
import type { MandateRecord, Principal } from "@agentpey/directory";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  proveOwnership,
  readPublicView,
  requireRevocable,
  toPrivateView,
  type RevocationDirectory,
} from "./revocation.js";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const PRINCIPAL = Keypair.random();
const STRANGER = Keypair.random();

const MANDATE_ID = "mnd_01J7QW8VQEJPAXEPAYREVOKE01";
const PRINCIPAL_ID = "prn_01J7QW8VQEJPAXEPAYREVOKE02";

function mandate(overrides: Partial<MandateRecord> = {}): MandateRecord {
  return {
    id: MANDATE_ID,
    tenantId: "ptn_01J7QW8VQEJPAXEPAY000001:01J7QW8VQEJPAXEPAY000002",
    agentId: "agt_01J7QW8VQEJPAXEPAYREVOKE03",
    principalId: PRINCIPAL_ID,
    mandateHash: "a".repeat(64),
    signatureKind: "wallet",
    document: {
      credentialSubject: {
        grant: { limits: { perTx: "0.30", perDay: "0.60", currency: "USDC" }, products: ["signaldesk:market-brief-xlm-usdc"] },
      },
    },
    signature: "sig",
    jws: null,
    validFrom: new Date("2026-09-01T00:00:00.000Z"),
    validUntil: new Date("2026-10-12T00:00:00.000Z"),
    anchorTx: "b".repeat(64),
    supersedesId: null,
    revokedAt: null,
    revokeTx: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  } as MandateRecord;
}

function principal(address: string, id: string): Principal {
  return {
    id,
    address,
    did: stellarAddressToDid(address, "testnet"),
    createdAt: NOW,
  } as Principal;
}

interface FakeOptions {
  readonly record?: MandateRecord | undefined;
  readonly principals?: readonly Principal[];
}

function fakeDirectory(options: FakeOptions = {}) {
  const revocations: { hash: string; tx: string }[] = [];
  const principals = options.principals ?? [principal(PRINCIPAL.publicKey(), PRINCIPAL_ID)];
  const record = "record" in options ? options.record : mandate();

  const directory: RevocationDirectory = {
    async findMandateById(id) {
      return record !== undefined && record.id === id ? record : undefined;
    },
    async findPrincipalByAddress(address) {
      return principals.find((candidate) => candidate.address === address);
    },
    async revokeMandate(hash, tx) {
      revocations.push({ hash, tx });
    },
  };
  return { directory, revocations };
}

const challengeMessage = (nonce: string): string => `AgentPey quiere verificar tu wallet: ${nonce}`;

function proofContext(valid = true) {
  const taken: string[] = [];
  return {
    taken,
    context: {
      takeChallenge: async (nonce: string) => {
        taken.push(nonce);
        return valid;
      },
      challengeMessage,
    },
  };
}

function signedProof(keypair: Keypair, nonce = "nonce-1") {
  return {
    address: keypair.publicKey(),
    nonce,
    signature: signStellarMessage(keypair, challengeMessage(nonce)),
  };
}

describe("readPublicView", () => {
  /**
   * A Mandate id is shared with the partner that created it, so it is a weaker
   * secret than a consent-session id. What someone holding a stray one learns
   * has to be worth nothing.
   */
  it("says only whether it is live and until when — never the limits", async () => {
    const { directory } = fakeDirectory();

    const view = await readPublicView(directory, MANDATE_ID, NOW);

    expect(view).toEqual({
      mandateId: MANDATE_ID,
      status: "active",
      validUntil: "2026-10-12T00:00:00.000Z",
    });
    expect(JSON.stringify(view)).not.toContain("0.30");
    expect(JSON.stringify(view)).not.toContain("signaldesk");
  });

  it("reports revoked and expired distinctly", async () => {
    const revoked = fakeDirectory({ record: mandate({ revokedAt: NOW, revokeTx: "c".repeat(64) }) });
    const expired = fakeDirectory({ record: mandate({ validUntil: new Date("2026-09-01T00:00:00.000Z") }) });

    expect((await readPublicView(revoked.directory, MANDATE_ID, NOW)).status).toBe("revoked");
    expect((await readPublicView(expired.directory, MANDATE_ID, NOW)).status).toBe("expired");
  });

  it("refuses an id that names nothing", async () => {
    const { directory } = fakeDirectory({ record: undefined });

    await expect(readPublicView(directory, MANDATE_ID, NOW)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "MandateNotFound"),
    );
  });
});

describe("proveOwnership", () => {
  it("accepts the wallet that signed the mandate", async () => {
    const { directory } = fakeDirectory();
    const { context } = proofContext();

    const proved = await proveOwnership(directory, context, MANDATE_ID, signedProof(PRINCIPAL));

    expect(proved.id).toBe(MANDATE_ID);
  });

  /** Acceptance case 7: a different wallet than the one expected. */
  it("refuses a different wallet, even with a perfectly valid signature", async () => {
    const { directory } = fakeDirectory({
      principals: [principal(PRINCIPAL.publicKey(), PRINCIPAL_ID), principal(STRANGER.publicKey(), "prn_other")],
    });
    const { context } = proofContext();

    await expect(proveOwnership(directory, context, MANDATE_ID, signedProof(STRANGER))).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "MandatePrincipalMismatch"),
    );
  });

  it("refuses a wallet the system has never seen, with the same refusal", async () => {
    const { directory } = fakeDirectory();
    const { context } = proofContext();

    // Same code as the wrong wallet: telling them apart would reveal whether
    // an address is known to the system, which is not a stranger's to learn.
    await expect(proveOwnership(directory, context, MANDATE_ID, signedProof(STRANGER))).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "MandatePrincipalMismatch"),
    );
  });

  it("refuses a signature that does not match the address", async () => {
    const { directory } = fakeDirectory();
    const { context } = proofContext();
    const proof = { ...signedProof(PRINCIPAL), address: STRANGER.publicKey() };

    await expect(proveOwnership(directory, context, MANDATE_ID, proof)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "InvalidSignature"),
    );
  });

  it("refuses a challenge that was already used or expired", async () => {
    const { directory } = fakeDirectory();
    const { context } = proofContext(false);

    await expect(proveOwnership(directory, context, MANDATE_ID, signedProof(PRINCIPAL))).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidArguments"),
    );
  });

  /**
   * A challenge that survived a failed check could be replayed against a
   * different mandate, so it is consumed before anything else is looked at.
   */
  it("consumes the challenge before checking the signature", async () => {
    const { directory } = fakeDirectory();
    const { context, taken } = proofContext();
    const proof = { ...signedProof(PRINCIPAL), signature: "not-a-signature" };

    await expect(proveOwnership(directory, context, MANDATE_ID, proof)).rejects.toThrow();

    expect(taken).toEqual(["nonce-1"]);
  });
});

describe("toPrivateView", () => {
  it("shows the grant only on this side of the proof", () => {
    const view = toPrivateView(mandate(), NOW);

    expect(JSON.stringify(view.grant)).toContain("0.30");
    expect(view.mandateHash).toBe("a".repeat(64));
    expect(view.anchorTx).toBe("b".repeat(64));
  });

  it("does not fall over on a document shaped differently than expected", () => {
    expect(toPrivateView(mandate({ document: {} }), NOW).grant).toBeNull();
  });
});

describe("requireRevocable", () => {
  it("allows an active mandate", () => {
    expect(() => requireRevocable(mandate(), NOW)).not.toThrow();
  });

  /** Re-revoking costs a fee and changes nothing; the person needs to know it was already done. */
  it("refuses one that was already revoked, and says with which transaction", () => {
    try {
      requireRevocable(mandate({ revokedAt: NOW, revokeTx: "c".repeat(64) }), NOW);
      expect.unreachable("an already-revoked mandate must not be revocable");
    } catch (error) {
      expect(hasErrorCode(error, "MandateRevoked")).toBe(true);
      expect((error as { details: { revokeTx: string } }).details.revokeTx).toBe("c".repeat(64));
    }
  });

  it("refuses one that already expired, rather than asking for a pointless signature", () => {
    expect(() => requireRevocable(mandate({ validUntil: new Date("2026-09-01T00:00:00.000Z") }), NOW)).toThrow(
      expect.objectContaining({ code: "MandateExpired" }),
    );
  });
});
