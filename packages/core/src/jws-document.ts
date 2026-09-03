/**
 * Signing and verifying an arbitrary structured document as a compact JWS,
 * with a `did:stellar` key.
 *
 * Phase 1 established this shape for credentials (`vc-jwt.ts`) and phase 2
 * reapplied it, by hand, for purchase intents. Phase 3 needs it a third time
 * for the Mandate — so the mechanics live here once, parameterised by a
 * {@link JwsDocumentProfile}, instead of being copied again.
 *
 * The two rules phase 1 settled are baked in and are not options:
 *
 * - **`kid` never chooses the verification key.** The key always comes from a
 *   field inside the payload. `kid` is chosen by whoever built the JWS, so
 *   trusting it would let a forged document nominate the key that validates it.
 *   It is only cross-checked for agreement.
 * - **The signature is checked before anything else about the content.** Full
 *   schema validation runs only on bytes the signer actually signed, and the
 *   validity window is deliberately *not* checked here at all (see below) — so
 *   a forged document can never be reported as merely "expired", which would
 *   hide the forgery.
 *
 * What this deliberately does **not** do: check a validity window. Each
 * document names its window with its own field names and reports it with its
 * own error codes — `validFrom`/`validUntil` for a credential or a mandate,
 * `issuedAt`/`expiresAt` for an intent. Folding that in would need a second
 * layer of configuration to express a difference that is one `if` at each call
 * site. The caller checks the window on the value this returns, which is
 * already the correct ordering.
 *
 * `vc-jwt.ts` and the agent's intent signing are **not** rewritten to use this.
 * They belong to closed phases, and unifying all three is a proposal (see
 * `M-5`), not a change to make in passing.
 */
import { createHash } from "node:crypto";

import type { Keypair } from "@stellar/stellar-sdk/base";
import { CompactSign, compactVerify, decodeProtectedHeader, importJWK } from "jose";
import { z } from "zod";

import type { StellarDid } from "./did.js";
import { parseStellarDid, stellarDidSchema } from "./did.js";
import type { AgentPassErrorCode } from "./errors.js";
import { AgentPassError } from "./errors.js";
import { AGENTPASS_JWS_ALG, didToPublicJWK, stellarKeypairToJWK } from "./jwk.js";

/**
 * Everything that differs between one signed document type and another.
 *
 * `signerField` and `signerDid` name the same field twice, on purpose: the
 * first reads it out of an *unvalidated* payload to find the verification key
 * before any signature exists to trust, the second reads it type-safely once
 * the document has parsed. A profile whose two disagree would verify against
 * one key and report another, so it is worth a test of its own.
 */
export interface JwsDocumentProfile<T> {
  /** The JWS `typ` header. Distinct per document type, e.g. `mandate+jwt`. */
  readonly typ: string;
  /** The full schema. Applied only to bytes the signature covered. */
  readonly schema: z.ZodType<T>;
  /** Name of the payload field holding the signer's DID, for the pre-signature peek. */
  readonly signerField: string;
  /** The same field, read from a parsed document. */
  readonly signerDid: (document: T) => StellarDid;
  /** The error code raised for a malformed JWS or a payload off-schema. */
  readonly invalidCode: AgentPassErrorCode;
}

export interface SignedJwsDocument<T> {
  /** The compact JWS. This is the document as it travels. */
  readonly jws: string;
  /** `sha256(jws)`, lowercase hex — the stable handle for this document. */
  readonly hash: string;
  readonly document: T;
}

export interface VerifiedJwsDocument<T> extends SignedJwsDocument<T> {
  /** The DID whose key the signature actually verified against. */
  readonly signer: StellarDid;
}

/**
 * `sha256` of a compact JWS, lowercase hex.
 *
 * Always computed over the JWS the holder actually has, never read out of the
 * payload: a document cannot carry its own hash, and a self-declared one could
 * be pointed at a different, still-active document.
 */
export function jwsDocumentHash(jws: string): string {
  return createHash("sha256").update(jws, "utf8").digest("hex");
}

function parseDocument<T>(profile: JwsDocumentProfile<T>, value: unknown): T {
  const result = profile.schema.safeParse(value);
  if (!result.success) {
    throw new AgentPassError(profile.invalidCode, "the payload does not match the document schema", {
      cause: result.error,
      details: {
        typ: profile.typ,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}

function decodePayload<T>(profile: JwsDocumentProfile<T>, jws: string): unknown {
  const segments = jws.split(".");
  if (segments.length !== 3) {
    throw new AgentPassError(profile.invalidCode, "expected a compact JWS with three segments", {
      details: { typ: profile.typ, segments: segments.length },
    });
  }

  try {
    return JSON.parse(Buffer.from(segments[1] ?? "", "base64url").toString("utf8")) as unknown;
  } catch (error) {
    throw new AgentPassError(profile.invalidCode, "the JWS payload is not readable JSON", {
      cause: error,
      details: { typ: profile.typ },
    });
  }
}

/**
 * Signs a document with the key its own payload names as the signer.
 *
 * @throws AgentPassError `profile.invalidCode` if the document is off-schema.
 * @throws AgentPassError `SignerMismatch` if the key is not that signer.
 * Signing anyway would produce a document that can never verify, and the
 * failure would surface later and somewhere else.
 */
export async function signJwsDocument<T>(
  profile: JwsDocumentProfile<T>,
  document: T,
  keypair: Keypair,
): Promise<SignedJwsDocument<T>> {
  const validated = parseDocument(profile, document);
  const signer = profile.signerDid(validated);

  // Compare against the signer's own network rather than assuming one.
  const { address } = parseStellarDid(signer);
  if (address !== keypair.publicKey()) {
    throw new AgentPassError(
      "SignerMismatch",
      "the signing key is not the document's signer, so the result could never verify",
      { details: { typ: profile.typ, signer, key: keypair.publicKey() } },
    );
  }

  const privateKey = await importJWK(stellarKeypairToJWK(keypair), AGENTPASS_JWS_ALG);

  const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(validated)))
    .setProtectedHeader({
      alg: AGENTPASS_JWS_ALG,
      typ: profile.typ,
      // A did:stellar has exactly one key, so the DID alone identifies it.
      kid: signer,
    })
    .sign(privateKey);

  return { jws, hash: jwsDocumentHash(jws), document: validated };
}

/**
 * Verifies a document's header, signature and schema. Offline, always.
 *
 * Does **not** check any validity window, and does not consult any registry.
 * Both are the caller's next question, not this one.
 */
export async function verifyJwsDocument<T>(
  profile: JwsDocumentProfile<T>,
  jws: string,
): Promise<VerifiedJwsDocument<T>> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(jws);
  } catch (error) {
    throw new AgentPassError(profile.invalidCode, "the JWS protected header is unreadable", {
      cause: error,
      details: { typ: profile.typ },
    });
  }

  if (header.alg !== AGENTPASS_JWS_ALG) {
    throw new AgentPassError(profile.invalidCode, `expected alg ${AGENTPASS_JWS_ALG}`, {
      details: { alg: header.alg },
    });
  }
  if (header.typ !== profile.typ) {
    throw new AgentPassError(profile.invalidCode, `expected typ ${profile.typ}`, {
      details: { typ: header.typ, expected: profile.typ },
    });
  }

  const peeked = z
    .object({ [profile.signerField]: stellarDidSchema })
    .safeParse(decodePayload(profile, jws));
  if (!peeked.success) {
    throw new AgentPassError(profile.invalidCode, "the payload carries no usable signer DID", {
      details: { typ: profile.typ, signerField: profile.signerField },
    });
  }
  // Present and a valid DID: the schema above proved both.
  const signer = peeked.data[profile.signerField] as StellarDid;

  if (header.kid !== undefined && header.kid !== signer) {
    throw new AgentPassError(profile.invalidCode, "the header's kid disagrees with the payload", {
      details: { typ: profile.typ, kid: header.kid, signer },
    });
  }

  const publicKey = await importJWK(didToPublicJWK(signer), AGENTPASS_JWS_ALG);

  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(jws, publicKey, { algorithms: [AGENTPASS_JWS_ALG] }));
  } catch (error) {
    throw new AgentPassError("InvalidSignature", "the signature does not verify against the signer", {
      cause: error,
      details: { typ: profile.typ, signer },
    });
  }

  // Full schema validation runs only on bytes the signer actually signed.
  const document = parseDocument(profile, JSON.parse(Buffer.from(payload).toString("utf8")) as unknown);

  // A payload whose signer field survived the peek but moved during full
  // parsing would verify against one key and report another.
  const parsedSigner = profile.signerDid(document);
  if (parsedSigner !== signer) {
    throw new AgentPassError(profile.invalidCode, "the signed payload names a different signer", {
      details: { typ: profile.typ, peeked: signer, parsed: parsedSigner },
    });
  }

  return { jws, hash: jwsDocumentHash(jws), document, signer };
}
