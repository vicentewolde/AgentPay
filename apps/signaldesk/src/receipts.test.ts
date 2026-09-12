import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { receiptHash, signReceipt, verifyReceipt, type Receipt } from "./receipts.js";

const MERCHANT = Keypair.random();
const OTHER = Keypair.random();

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    delivery_id: "01J7QW8VQEJPAXEPAYSIGNAL01",
    product_id: "signaldesk:market-brief-xlm-usdc",
    buyer: "GBHD27INOTFHFPHVGQMKSW2EGRK3T6E47OHIVR7L44JGHWUJKXIZBXSR",
    amount: "2500000",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    pay_to: MERCHANT.publicKey(),
    payment_tx: "b8e0a1f2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e",
    artifact_hash: "a".repeat(64),
    delivered_at: "2026-09-12T12:00:00.000Z",
    ...overrides,
  };
}

describe("receiptHash", () => {
  it("does not depend on the order the fields were built in", () => {
    const built = receipt();
    const reordered: Receipt = {
      delivered_at: built.delivered_at,
      artifact_hash: built.artifact_hash,
      payment_tx: built.payment_tx,
      pay_to: built.pay_to,
      asset: built.asset,
      amount: built.amount,
      buyer: built.buyer,
      product_id: built.product_id,
      delivery_id: built.delivery_id,
    };
    expect(receiptHash(reordered)).toBe(receiptHash(built));
  });

  it("changes when any field changes", () => {
    expect(receiptHash(receipt({ amount: "2500001" }))).not.toBe(receiptHash(receipt()));
    expect(receiptHash(receipt({ artifact_hash: "b".repeat(64) }))).not.toBe(receiptHash(receipt()));
  });
});

describe("verifyReceipt", () => {
  it("verifies a receipt with nothing but the merchant's public key", () => {
    const signed = signReceipt(receipt(), MERCHANT.secret());

    expect(signed.signedBy).toBe(MERCHANT.publicKey());
    expect(verifyReceipt(signed)).toEqual({ valid: true });
  });

  /**
   * The point of `artifact_hash` being in the signed body: a merchant cannot
   * sign a truthful receipt and then serve different bytes.
   */
  it("refuses a receipt whose body was altered after signing", () => {
    const signed = signReceipt(receipt(), MERCHANT.secret());
    const tampered = { ...signed, receipt: { ...signed.receipt, artifact_hash: "c".repeat(64) } };

    expect(verifyReceipt(tampered)).toEqual({ valid: false, reason: "hash-mismatch" });
  });

  it("refuses a receipt whose hash was altered to match an altered body", () => {
    const signed = signReceipt(receipt(), MERCHANT.secret());
    const forged = receipt({ amount: "9900000" });
    const tampered = { ...signed, receipt: forged, receiptHash: receiptHash(forged) };

    // The content and the hash now agree, so the failure has to come from the
    // signature — which is the check that cannot be reproduced without the key.
    expect(verifyReceipt(tampered)).toEqual({ valid: false, reason: "bad-signature" });
  });

  it("refuses a receipt attributed to a different merchant", () => {
    const signed = signReceipt(receipt(), MERCHANT.secret());

    expect(verifyReceipt({ ...signed, signedBy: OTHER.publicKey() })).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("refuses a malformed receipt before looking at any signature", () => {
    const signed = signReceipt(receipt(), MERCHANT.secret());
    const broken = { ...signed, receipt: { ...signed.receipt, extra: "field" } as unknown as Receipt };

    expect(verifyReceipt(broken)).toEqual({ valid: false, reason: "malformed" });
  });

  it("refuses a signature that is not a signature at all, without throwing", () => {
    const signed = signReceipt(receipt(), MERCHANT.secret());

    expect(verifyReceipt({ ...signed, signature: "not base64 !!" }).valid).toBe(false);
    expect(verifyReceipt({ ...signed, signedBy: "not-an-account" }).valid).toBe(false);
  });
});
