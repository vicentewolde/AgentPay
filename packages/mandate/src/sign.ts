/**
 * Signing and verifying a Mandate.
 *
 * A different document, not a different cryptography: `did:stellar`, a compact
 * JWS signed with EdDSA, the JWK derived from the Stellar seed, and `kid` never
 * choosing the verification key. All of that lives in `signJwsDocument` /
 * `verifyJwsDocument` in `@agentpass/core`; what is here is the mandate's own
 * profile and its own validity window.
 *
 * Who holds the pen: the **principal**. A credential is signed by its issuer,
 * an intent by the agent itself, a mandate by the person the agent acts for.
 * That is the whole point of the document — a consent nobody but the principal
 * can produce, and, because it is anchored, one the principal can withdraw
 * without the agent's cooperation.
 */
import type { StellarDid } from "@agentpass/core";
import {
  AgentPassError,
  jwsDocumentHash,
  signJwsDocument,
  verifyJwsDocument,
} from "@agentpass/core";
import type { JwsDocumentProfile } from "@agentpass/core";
import type { Keypair } from "@stellar/stellar-sdk/base";

import type { AgentPayMandate } from "./mandate.js";
import { agentPayMandateSchema } from "./mandate.js";

/** The media type of a mandate's JWS body. */
export const AGENTPAY_MANDATE_TYP = "mandate+jwt";

/** Everything that makes a mandate a mandate, as far as the JWS layer cares. */
export const mandateProfile: JwsDocumentProfile<AgentPayMandate> = {
  typ: AGENTPAY_MANDATE_TYP,
  schema: agentPayMandateSchema,
  signerField: "issuer",
  signerDid: (mandate) => mandate.issuer,
  invalidCode: "InvalidMandate",
};

export interface SignedMandate {
  /** The compact JWS. This is the mandate as it travels. */
  readonly jws: string;
  /** `sha256(jws)`, lowercase hex — the key the registry answers about. */
  readonly hash: string;
  readonly mandate: AgentPayMandate;
}

export interface VerifiedMandate extends SignedMandate {
  /** The principal, whose key the signature verified against. */
  readonly principal: StellarDid;
  /** The agent this mandate empowers. */
  readonly agent: StellarDid;
}

export interface VerifyMandateOptions {
  /** Injectable clock. Defaults to now. */
  readonly now?: Date;
}

/**
 * `sha256` of a mandate's compact JWS, hex. Same convention as a credential's
 * hash, and for the same reason: it is what gets anchored.
 */
export function mandateHash(jws: string): string {
  return jwsDocumentHash(jws);
}

/**
 * Signs a mandate with the principal's key.
 *
 * @throws AgentPassError `InvalidMandate` if the document is off-schema.
 * @throws AgentPassError `SignerMismatch` if the key is not the mandate's
 * issuer — signing anyway would produce a consent that can never verify.
 */
export async function signMandate(
  mandate: AgentPayMandate,
  keypair: Keypair,
): Promise<SignedMandate> {
  const signed = await signJwsDocument(mandateProfile, mandate, keypair);
  return { jws: signed.jws, hash: signed.hash, mandate: signed.document };
}

/**
 * Verifies a mandate's signature and its validity window. Offline, always.
 *
 * What it deliberately does **not** check: whether the mandate is still active
 * in the registry. That needs the network, and which registry to trust is the
 * caller's decision — the same rule phase 1 settled with `RegistryMismatch`. A
 * mandate that verifies here is authentic and in-window; whether the principal
 * has since withdrawn it is the next question, not this one.
 *
 * Nor does it compare the mandate against any intent. That is `checkMandate`,
 * and keeping it separate is what lets the comparison stay a pure function.
 *
 * The window is checked **after** the signature, for the reason phase 1 fixed:
 * otherwise a forged *and* expired mandate reports as "expired" and the forgery
 * never surfaces.
 */
export async function verifyMandate(
  jws: string,
  options: VerifyMandateOptions = {},
): Promise<VerifiedMandate> {
  const verified = await verifyJwsDocument(mandateProfile, jws);
  const mandate = verified.document;

  const now = options.now ?? new Date();
  const validFrom = new Date(mandate.validFrom);
  const validUntil = new Date(mandate.validUntil);

  if (now.getTime() < validFrom.getTime()) {
    throw new AgentPassError("MandateNotYetValid", "the mandate is not valid yet", {
      details: { now: now.toISOString(), validFrom: mandate.validFrom },
    });
  }
  // Inclusive upper edge, matching `validUntil` in phase 1 and `expires_at` in
  // the contract, so the three never disagree about the last valid instant.
  if (now.getTime() > validUntil.getTime()) {
    throw new AgentPassError("MandateExpired", "the mandate has expired", {
      details: { now: now.toISOString(), validUntil: mandate.validUntil },
    });
  }

  return {
    jws: verified.jws,
    hash: verified.hash,
    mandate,
    principal: verified.signer,
    agent: mandate.credentialSubject.id,
  };
}
