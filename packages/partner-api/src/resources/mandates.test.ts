import { newId, newTenantId, type MandateRecord } from "@agentpey/directory";
import { describe, expect, it } from "vitest";

import { computeMandateStatus, toMandateResource } from "./mandates.js";

const tenantId = newTenantId(newId("partner"));

function fakeMandate(overrides: Partial<MandateRecord> = {}): MandateRecord {
  return {
    id: newId("mandate"),
    tenantId,
    agentId: newId("agent"),
    principalId: newId("principal"),
    mandateHash: "a".repeat(64),
    signatureKind: "wallet-sep53",
    document: {},
    signature: "sig",
    jws: null,
    validFrom: new Date("2026-09-01T00:00:00.000Z"),
    validUntil: new Date("2026-12-01T00:00:00.000Z"),
    anchorTx: "fake-tx",
    supersedesId: null,
    revokedAt: null,
    revokeTx: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("computeMandateStatus", () => {
  const window = { validFrom: new Date("2026-09-01T00:00:00.000Z"), validUntil: new Date("2026-12-01T00:00:00.000Z") };

  it("is 'pending' before validFrom", () => {
    expect(computeMandateStatus({ ...window, revokedAt: null }, new Date("2026-08-01T00:00:00.000Z"))).toBe("pending");
  });

  it("is 'active' inside the window", () => {
    expect(computeMandateStatus({ ...window, revokedAt: null }, new Date("2026-10-01T00:00:00.000Z"))).toBe("active");
  });

  it("is 'expired' after validUntil", () => {
    expect(computeMandateStatus({ ...window, revokedAt: null }, new Date("2027-01-01T00:00:00.000Z"))).toBe("expired");
  });

  it("is 'revoked' even if the window would otherwise say pending or active — revocation is permanent", () => {
    const revokedAt = new Date("2026-07-01T00:00:00.000Z");
    expect(computeMandateStatus({ ...window, revokedAt }, new Date("2026-08-01T00:00:00.000Z"))).toBe("revoked");
    expect(computeMandateStatus({ ...window, revokedAt }, new Date("2026-10-01T00:00:00.000Z"))).toBe("revoked");
  });
});

describe("toMandateResource", () => {
  it("maps the internal MandateRecord to the public DTO, without document, signature or jws", () => {
    const mandate = fakeMandate();
    const resource = toMandateResource(mandate, new Date("2026-10-01T00:00:00.000Z"));

    expect(resource).toEqual({
      id: mandate.id,
      tenant_id: tenantId,
      agent_id: mandate.agentId,
      mandate_hash: mandate.mandateHash,
      status: "active",
      valid_from: "2026-09-01T00:00:00.000Z",
      valid_until: "2026-12-01T00:00:00.000Z",
      anchor_tx: "fake-tx",
      revoked_at: null,
      supersedes_id: null,
      created_at: "2026-09-01T00:00:00.000Z",
    });
    for (const secret of ["document", "signature", "jws", "principalId", "signatureKind"]) {
      expect(secret in resource).toBe(false);
    }
  });

  it("defaults `now` to the current time when the caller does not pass one", () => {
    const resource = toMandateResource(fakeMandate({ validUntil: new Date(Date.now() - 1000) }));
    expect(resource.status).toBe("expired");
  });
});
