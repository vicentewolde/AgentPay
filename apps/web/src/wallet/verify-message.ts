/**
 * Verifies a wallet's `signMessage` result (SEP-0043's interface, SEP-0053's
 * byte format) against the address it claims signed it — the cryptographic
 * proof that whoever clicked "Connect wallet" actually controls that Stellar
 * account, without the account ever revealing its secret key to this server.
 *
 * SEP-0053, verbatim: `sha256("Stellar Signed Message:\n" + message)`,
 * verified as a raw Ed25519 signature over that hash — no length prefix, no
 * version byte, no other framing.
 */
import { createHash } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk";

const STELLAR_MESSAGE_PREFIX = "Stellar Signed Message:\n";

export function verifyStellarMessage(publicKey: string, message: string, signatureBase64: string): boolean {
  try {
    const payload = Buffer.concat([Buffer.from(STELLAR_MESSAGE_PREFIX, "utf8"), Buffer.from(message, "utf8")]);
    const hash = createHash("sha256").update(payload).digest();
    const signature = Buffer.from(signatureBase64, "base64");
    return Keypair.fromPublicKey(publicKey).verify(hash, signature);
  } catch {
    // A malformed public key, an empty signature, wrong-length bytes — all of
    // it means "does not verify", never a thrown error the caller must guard.
    return false;
  }
}
