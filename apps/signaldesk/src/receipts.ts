/**
 * Delivery receipts, and why they are worth anything.
 *
 * A receipt that is only credible because AgentPey repeats it is not evidence,
 * it is a claim. So SignalDesk signs its own: the receipt is canonicalised,
 * hashed, and the hash is signed with the merchant's Ed25519 key. Anyone
 * holding SignalDesk's **public** key can reconstruct the receipt from its
 * parts, hash it, and check the signature — with no AgentPey service, no API
 * key and no trust in this repository involved.
 *
 * What the receipt commits to, and why each field is in it:
 *
 * - `delivery_id` — what the buyer quotes when something is wrong.
 * - `product_id`, `buyer` — what was sold, to whom.
 * - `amount`, `asset`, `pay_to` — the terms actually settled, taken from the
 *   settlement response and not from what the request asked for.
 * - `payment_tx` — the Stellar transaction, so the claim is checkable against
 *   the ledger by a third party.
 * - `artifact_hash` — binds the receipt to the exact bytes delivered. Without
 *   it a merchant could sign a truthful receipt and serve a different file.
 * - `delivered_at` — when.
 *
 * `receipt_hash` is over the canonical JSON of exactly those fields. The
 * signature is over the hash's bytes, so a verifier reproduces both steps.
 */
import { createHash } from "node:crypto";

import { canonicalJson } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk";
import { z } from "zod";

/** The signed body. Snake case, because it is a document other systems read. */
export const receiptSchema = z.strictObject({
  delivery_id: z.string(),
  product_id: z.string(),
  buyer: z.string(),
  amount: z.string(),
  asset: z.string(),
  pay_to: z.string(),
  payment_tx: z.string(),
  artifact_hash: z.string(),
  delivered_at: z.string(),
});

export type Receipt = z.infer<typeof receiptSchema>;

export interface SignedReceipt {
  readonly receipt: Receipt;
  /** `sha256` of the receipt's canonical JSON, hex. */
  readonly receiptHash: string;
  /** Base64 Ed25519 signature over the hash's bytes, by the merchant's key. */
  readonly signature: string;
  /** The merchant account whose key signed. Published, so a verifier needs nothing from us. */
  readonly signedBy: string;
}

/** `sha256` of a receipt's canonical JSON, hex. */
export function receiptHash(receipt: Receipt): string {
  return createHash("sha256").update(canonicalJson(receipt), "utf8").digest("hex");
}

/**
 * Signs a receipt with the merchant's key.
 *
 * The signature covers the *hash bytes*, not the JSON, so a verifier who
 * canonicalises the receipt themselves and gets a different hash learns that
 * before checking any signature — a mismatch in content and a mismatch in
 * signature stay distinguishable.
 */
export function signReceipt(receipt: Receipt, merchantSecret: string): SignedReceipt {
  const keypair = Keypair.fromSecret(merchantSecret);
  const hash = receiptHash(receipt);
  return {
    receipt,
    receiptHash: hash,
    signature: Buffer.from(keypair.sign(Buffer.from(hash, "utf8"))).toString("base64"),
    signedBy: keypair.publicKey(),
  };
}

export interface ReceiptVerification {
  readonly valid: boolean;
  /** Present when it is not: which of the two checks failed, and never both at once. */
  readonly reason?: "hash-mismatch" | "bad-signature" | "malformed";
}

/**
 * Verifies a signed receipt using only the merchant's public key.
 *
 * This function is deliberately importable and deliberately trivial: it is the
 * thing a sceptical third party would otherwise have to write themselves, and
 * it uses nothing from AgentPey. Recomputing the hash first is what separates
 * "this receipt was altered" from "this receipt was not signed by them".
 */
export function verifyReceipt(signed: SignedReceipt): ReceiptVerification {
  const parsed = receiptSchema.safeParse(signed.receipt);
  if (!parsed.success) return { valid: false, reason: "malformed" };

  if (receiptHash(parsed.data) !== signed.receiptHash) return { valid: false, reason: "hash-mismatch" };

  let ok: boolean;
  try {
    ok = Keypair.fromPublicKey(signed.signedBy).verify(
      Buffer.from(signed.receiptHash, "utf8"),
      Buffer.from(signed.signature, "base64"),
    );
  } catch {
    return { valid: false, reason: "bad-signature" };
  }
  return ok ? { valid: true } : { valid: false, reason: "bad-signature" };
}
