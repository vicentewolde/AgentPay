import { stellarAddressToDid } from "@agentpass/core";
import type { CredentialRecord, MandateRecord } from "@agentpay/directory";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { decideRehydration } from "./session-rehydration.js";

const ISSUER_DID = stellarAddressToDid(Keypair.random().publicKey(), "testnet");
const PRINCIPAL_DID = stellarAddressToDid(Keypair.random().publicKey(), "testnet");

function credential(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    id: "crd_00000000000000000000000001",
    agentId: "agt_00000000000000000000000001",
    tenantId: "ptn_00000000000000000000000001:00000000000000000000000001",
    credentialHash: "a".repeat(64),
    issuerDid: ISSUER_DID,
    principalDid: PRINCIPAL_DID,
    jws: "eyJ.header.signature",
    validFrom: new Date("2026-09-10T00:00:00.000Z"),
    validUntil: new Date("2026-09-11T00:00:00.000Z"),
    anchorTx: "tx-cred",
    revokedAt: null,
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    ...overrides,
  };
}

function mandate(overrides: Partial<MandateRecord> = {}): MandateRecord {
  return {
    id: "mdt_00000000000000000000000001",
    tenantId: "ptn_00000000000000000000000001:00000000000000000000000001",
    agentId: "agt_00000000000000000000000001",
    principalId: "prc_00000000000000000000000001",
    mandateHash: "b".repeat(64),
    signatureKind: "wallet-sep53",
    document: {},
    signature: "sig",
    jws: null,
    validFrom: new Date("2026-09-10T00:00:00.000Z"),
    validUntil: new Date("2026-09-11T00:00:00.000Z"),
    anchorTx: "tx-mandate",
    supersedesId: null,
    revokedAt: null,
    revokeTx: null,
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    ...overrides,
  };
}

describe("decideRehydration", () => {
  it("rehydrates when a credential and an active mandate share the same agent", () => {
    const cred = credential();
    const active = mandate();
    const decision = decideRehydration({ latestCredential: cred, activeMandates: [active], latestMandate: active });
    expect(decision).toEqual({ kind: "rehydrate", credential: cred, mandate: active });
  });

  it("issues fresh documents for a brand new tenant — nothing recorded yet", () => {
    const decision = decideRehydration({ latestCredential: undefined, activeMandates: [], latestMandate: undefined });
    expect(decision).toEqual({ kind: "issue", supersedes: undefined });
  });

  it("issues fresh documents, chained to the prior one, when the only mandate on file has expired", () => {
    const cred = credential();
    const expired = mandate({ mandateHash: "c".repeat(64) });
    // No active mandates — this one fell outside its window — but it is
    // still the latest, so a renewal must supersede it, not orphan it.
    const decision = decideRehydration({ latestCredential: cred, activeMandates: [], latestMandate: expired });
    expect(decision).toEqual({ kind: "issue", supersedes: expired });
  });

  it("issues fresh documents when the only mandate on file was revoked", () => {
    const cred = credential();
    const revoked = mandate({ mandateHash: "d".repeat(64), revokedAt: new Date("2026-09-10T06:00:00.000Z") });
    const decision = decideRehydration({ latestCredential: cred, activeMandates: [], latestMandate: revoked });
    expect(decision).toEqual({ kind: "issue", supersedes: revoked });
  });

  it("issues fresh documents when there is an active mandate but no credential on file", () => {
    // Should not happen under normal operation (the two are always recorded
    // together), but a half-written state must fail toward re-issuing, not
    // toward rehydrating something incomplete.
    const active = mandate();
    const decision = decideRehydration({ latestCredential: undefined, activeMandates: [active], latestMandate: active });
    expect(decision).toEqual({ kind: "issue", supersedes: active });
  });

  it("issues fresh documents when the credential itself was independently revoked", () => {
    const revokedCred = credential({ revokedAt: new Date("2026-09-10T06:00:00.000Z") });
    const active = mandate();
    const decision = decideRehydration({ latestCredential: revokedCred, activeMandates: [active], latestMandate: active });
    expect(decision).toEqual({ kind: "issue", supersedes: active });
  });

  it("refuses to rehydrate a mandate whose agent does not match the credential's — the check that will matter after F4", () => {
    const cred = credential({ agentId: "agt_00000000000000000000000001" });
    const mismatched = mandate({ agentId: "agt_99999999999999999999999999" });
    const decision = decideRehydration({ latestCredential: cred, activeMandates: [mismatched], latestMandate: mismatched });
    expect(decision).toEqual({ kind: "issue", supersedes: mismatched });
  });

  it("picks the most recently created active mandate when more than one exists", () => {
    const cred = credential();
    const older = mandate({ id: "mdt_00000000000000000000000001", mandateHash: "e".repeat(64) });
    const newer = mandate({ id: "mdt_00000000000000000000000002", mandateHash: "f".repeat(64) });
    const decision = decideRehydration({
      latestCredential: cred,
      activeMandates: [older, newer],
      latestMandate: newer,
    });
    expect(decision).toEqual({ kind: "rehydrate", credential: cred, mandate: newer });
  });
});
