/**
 * SEP-0053: signing and verifying an arbitrary message with a Stellar
 * keypair, outside of any transaction. This is what a wallet's `signMessage`
 * (SEP-0043's interface) actually implements — proof that whoever clicked
 * "approve" controls a given account, without a transaction, without the
 * account's secret key ever leaving the wallet.
 *
 * Deliberately not the JWS machinery in `jws-document.ts`: EdDSA over a
 * compact JWS signs the header/payload bytes directly, with no pre-hashing.
 * SEP-0053 signs `sha256(prefix + message)` — a different byte sequence, by
 * a different, older spec that predates this project's own JWS profile and
 * that wallets implement instead of raw signing on purpose (so a site can
 * never trick a wallet into Ed25519-signing something that doubles as a
 * valid transaction or a valid JWS in disguise). A wallet's signature can
 * never verify against `compactVerify`, and this can never verify a JWS —
 * they are not interchangeable, and no amount of reformatting bridges them.
 */
import { createHash } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk/base";

const STELLAR_MESSAGE_PREFIX = "Stellar Signed Message:\n";

function sep53Hash(message: string): Buffer {
  const payload = Buffer.concat([Buffer.from(STELLAR_MESSAGE_PREFIX, "utf8"), Buffer.from(message, "utf8")]);
  return createHash("sha256").update(payload).digest();
}

/**
 * Verifies a signature produced by a wallet's `signMessage` against the
 * address it claims signed it. Never throws — a malformed public key, an
 * empty signature, wrong-length bytes: all of it just means "does not
 * verify", not an exception the caller must guard against.
 */
export function verifyStellarMessage(publicKey: string, message: string, signatureBase64: string): boolean {
  try {
    const signature = Buffer.from(signatureBase64, "base64");
    return Keypair.fromPublicKey(publicKey).verify(sep53Hash(message), signature);
  } catch {
    return false;
  }
}

/**
 * Signs a message per SEP-0053. Exists for tests and tooling that need to
 * produce a fixture without a real wallet — never used by any production
 * path, which always receives an already-signed message from a wallet.
 */
export function signStellarMessage(keypair: Keypair, message: string): string {
  return Buffer.from(keypair.sign(sep53Hash(message))).toString("base64");
}
