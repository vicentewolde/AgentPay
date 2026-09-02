/**
 * Signing and verifying AgentPass credentials as compact JWS (VC-JWT profile).
 *
 * `verifyCredential` covers the first two of the three checks a full
 * verification needs: the signature, and the validity window. The third —
 * `status(sha256(jws)) == Active` and the issuer still active — needs the
 * registry, so it lives in @agentpass/sdk. Both checks here are offline.
 */
import { createHash } from "node:crypto";

import type { Keypair } from "@stellar/stellar-sdk/base";
import { CompactSign, compactVerify, decodeProtectedHeader, importJWK } from "jose";
import { z } from "zod";

import type { AgentPassCredential } from "./credential.js";
import { agentPassCredentialSchema } from "./credential.js";
import type { StellarDid } from "./did.js";
import { parseStellarDid, stellarDidSchema } from "./did.js";
import { AgentPassError } from "./errors.js";
import { AGENTPASS_JWS_ALG, didToPublicJWK, stellarKeypairToJWK } from "./jwk.js";

/** The media type of the JWS body, per the W3C VC 2.0 JOSE profile. */
export const AGENTPASS_JWS_TYP = "vc+jwt";

export interface SignedCredential {
  /** The compact JWS. This is the credential as it travels. */
  readonly jws: string;
  /** `sha256(jws)` in lowercase hex — the key anchored on-chain. */
  readonly hash: string;
}

export interface VerifiedCredential extends SignedCredential {
  readonly credential: AgentPassCredential;
  readonly issuer: StellarDid;
  readonly subject: StellarDid;
}

export interface VerifyOptions {
  /** Injectable clock. Defaults to now. */
  readonly now?: Date;
}

/**
 * The registry key for a credential: the SHA-256 of its compact JWS, hex.
 * Computed from the JWS the verifier actually holds — never read out of the
 * payload, which could point anywhere.
 */
export function credentialHash(jws: string): string {
  return createHash("sha256").update(jws, "utf8").digest("hex");
}

/** Only `issuer` is read before the signature is checked, to find the key. */
const issuerPeekSchema = z.object({ issuer: stellarDidSchema });

function decodePayload(jws: string): unknown {
  const segments = jws.split(".");
  if (segments.length !== 3) {
    throw new AgentPassError("InvalidJws", "expected a compact JWS with three segments", {
      details: { segments: segments.length },
    });
  }

  const [, payload] = segments as [string, string, string];
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch (error) {
    throw new AgentPassError("InvalidJws", "the JWS payload is not valid JSON", { cause: error });
  }
}

function parseCredential(payload: unknown): AgentPassCredential {
  const parsed = agentPassCredentialSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AgentPassError("InvalidCredential", "payload does not match the AgentPass schema", {
      details: { issues: z.treeifyError(parsed.error) },
    });
  }
  return parsed.data;
}

/**
 * Signs a credential into a compact JWS.
 *
 * Refuses to sign with a key that is not the credential's own issuer: doing so
 * would produce a credential that can never verify, and the failure would only
 * surface later, somewhere else.
 */
export async function signCredential(
  credential: AgentPassCredential,
  keypair: Keypair,
): Promise<SignedCredential> {
  const validated = parseCredential(credential);

  // Compare against the issuer's own network rather than assuming one.
  const { address } = parseStellarDid(validated.issuer);
  if (address !== keypair.publicKey()) {
    throw new AgentPassError(
      "ConfigError",
      "the signing key is not the credential's issuer, so the result could never verify",
      { details: { issuer: validated.issuer, signer: keypair.publicKey() } },
    );
  }

  const privateKey = await importJWK(stellarKeypairToJWK(keypair), AGENTPASS_JWS_ALG);

  const jws = await new CompactSign(
    new TextEncoder().encode(JSON.stringify(validated)),
  )
    .setProtectedHeader({
      alg: AGENTPASS_JWS_ALG,
      typ: AGENTPASS_JWS_TYP,
      // A did:stellar has exactly one key, so the DID alone identifies it.
      kid: validated.issuer,
    })
    .sign(privateKey);

  return { jws, hash: credentialHash(jws) };
}

/**
 * Verifies signature and validity window. Does **not** consult the registry —
 * that is @agentpass/sdk's job.
 *
 * The verification key comes from the payload's `issuer`, never from `kid`:
 * `kid` is attacker-controlled, and trusting it would let a forged credential
 * nominate the key that verifies it. `kid` is only cross-checked for agreement.
 */
export async function verifyCredential(
  jws: string,
  options: VerifyOptions = {},
): Promise<VerifiedCredential> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(jws);
  } catch (error) {
    throw new AgentPassError("InvalidJws", "the JWS protected header is unreadable", {
      cause: error,
    });
  }

  if (header.alg !== AGENTPASS_JWS_ALG) {
    throw new AgentPassError("InvalidJws", `expected alg ${AGENTPASS_JWS_ALG}`, {
      details: { alg: header.alg },
    });
  }
  if (header.typ !== AGENTPASS_JWS_TYP) {
    throw new AgentPassError("InvalidJws", `expected typ ${AGENTPASS_JWS_TYP}`, {
      details: { typ: header.typ },
    });
  }

  const peeked = issuerPeekSchema.safeParse(decodePayload(jws));
  if (!peeked.success) {
    throw new AgentPassError("InvalidCredential", "payload carries no usable issuer DID", {
      details: { issues: z.treeifyError(peeked.error) },
    });
  }
  const issuer = peeked.data.issuer;

  if (header.kid !== undefined && header.kid !== issuer) {
    throw new AgentPassError("InvalidJws", "the header's kid disagrees with the payload's issuer", {
      details: { kid: header.kid, issuer },
    });
  }

  const publicKey = await importJWK(didToPublicJWK(issuer), AGENTPASS_JWS_ALG);

  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(jws, publicKey, {
      algorithms: [AGENTPASS_JWS_ALG],
    }));
  } catch (error) {
    throw new AgentPassError("InvalidSignature", "the signature does not verify against the issuer", {
      cause: error,
      details: { issuer },
    });
  }

  // Full schema validation runs only on bytes the issuer actually signed.
  const credential = parseCredential(JSON.parse(Buffer.from(payload).toString("utf8")) as unknown);

  const now = options.now ?? new Date();
  const validFrom = new Date(credential.validFrom);
  const validUntil = new Date(credential.validUntil);

  if (now.getTime() < validFrom.getTime()) {
    throw new AgentPassError("CredentialNotYetValid", "the credential is not valid yet", {
      details: { now: now.toISOString(), validFrom: credential.validFrom },
    });
  }
  if (now.getTime() > validUntil.getTime()) {
    throw new AgentPassError("CredentialExpired", "the credential has expired", {
      details: { now: now.toISOString(), validUntil: credential.validUntil },
    });
  }

  return {
    jws,
    hash: credentialHash(jws),
    credential,
    issuer: credential.issuer,
    subject: credential.credentialSubject.id,
  };
}
