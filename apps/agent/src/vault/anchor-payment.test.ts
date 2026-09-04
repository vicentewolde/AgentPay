import type { CredStatus } from "@agentpass/sdk";
import { Keypair } from "@stellar/stellar-sdk/base";
import type { VaultRecord } from "@agentpay/vault";
import { describe, expect, it } from "vitest";

import {
  anchorPaymentDecision,
  paymentLinkHash,
  verifyPaymentAnchor,
  type RegistryAnchor,
  type RegistryAnchorStatus,
} from "./anchor-payment.js";

function recordFor(hash: string): VaultRecord {
  return {
    seq: 0,
    prevHash: "",
    hash,
    entry: {
      kind: "granted",
      subject: "GABC",
      intentId: "i1",
      currency: "USDC",
      amount: "1.00",
      at: "2026-09-04T00:00:00.000Z",
    },
  };
}

describe("paymentLinkHash", () => {
  it("is deterministic for the same record and payment tx", () => {
    const record = recordFor("a".repeat(64));
    expect(paymentLinkHash(record, "tx1")).toBe(paymentLinkHash(record, "tx1"));
  });

  it("differs when the payment tx differs", () => {
    const record = recordFor("a".repeat(64));
    expect(paymentLinkHash(record, "tx1")).not.toBe(paymentLinkHash(record, "tx2"));
  });

  it("differs when the vault record's hash differs", () => {
    expect(paymentLinkHash(recordFor("a".repeat(64)), "tx1")).not.toBe(
      paymentLinkHash(recordFor("b".repeat(64)), "tx1"),
    );
  });

  it("produces a lowercase hex sha256 (64 chars)", () => {
    const hash = paymentLinkHash(recordFor("a".repeat(64)), "tx1");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("anchorPaymentDecision", () => {
  it("anchors the recomputed link hash against the registry, and returns both hashes", async () => {
    const record = recordFor("a".repeat(64));
    const issuer = Keypair.random();
    const calls: unknown[] = [];
    const registry: RegistryAnchor = {
      anchor: async (params) => {
        calls.push(params);
        return "anchor-tx-hash";
      },
    };

    const result = await anchorPaymentDecision(registry, {
      record,
      paymentTx: "payment-tx",
      subject: "GSUBJECT",
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      issuer,
    });

    expect(result.linkHash).toBe(paymentLinkHash(record, "payment-tx"));
    expect(result.transactionHash).toBe("anchor-tx-hash");
    expect(calls).toEqual([
      {
        credentialHash: result.linkHash,
        subject: "GSUBJECT",
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        issuer,
      },
    ]);
  });
});

describe("verifyPaymentAnchor", () => {
  it("recomputes the link hash and asks the registry for its status", async () => {
    const record = recordFor("a".repeat(64));
    const seen: string[] = [];
    const registry: RegistryAnchorStatus = {
      status: async (hash) => {
        seen.push(hash);
        return "Active" satisfies CredStatus;
      },
    };

    const result = await verifyPaymentAnchor(registry, record, "payment-tx");

    expect(result.linkHash).toBe(paymentLinkHash(record, "payment-tx"));
    expect(result.status).toBe("Active");
    expect(seen).toEqual([result.linkHash]);
  });

  it("reports Unknown for a decision that was never anchored", async () => {
    const record = recordFor("a".repeat(64));
    const registry: RegistryAnchorStatus = { status: async () => "Unknown" };

    const result = await verifyPaymentAnchor(registry, record, "payment-tx");

    expect(result.status).toBe("Unknown");
  });
});
