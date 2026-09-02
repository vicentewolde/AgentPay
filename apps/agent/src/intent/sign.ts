/**
 * Signing and verifying a purchase intent.
 *
 * Same machinery as the credential in phase 1, deliberately: `did:stellar`, a
 * compact JWS signed with EdDSA, the JWK derived from the Stellar seed, and the
 * rule that `kid` never chooses the verification key. Phase 3's Mandato should
 * inherit this too — a different document, not a different cryptography.
 *
 * The one thing that differs from a credential is who holds the pen. A
 * credential is signed by its issuer; an intent is signed by the **agent
 * itself**, with the key its credential names as the subject. That is what ties
 * "the thing that asked to buy" to "the thing the principal authorised".
 */
import {
  AGENTPASS_JWS_ALG,
  AgentPassError,
  didToPublicJWK,
  parseStellarDid,
  stellarDidSchema,
  stellarKeypairToJWK,
} from "@agentpass/core";
import type { Keypair } from "@stellar/stellar-sdk/base";
import { CompactSign, compactVerify, decodeProtectedHeader, importJWK } from "jose";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { PurchaseIntent } from "./intent.js";
import { purchaseIntentSchema } from "./intent.js";

/** The media type of an intent's JWS body. */
export const AGENTPAY_INTENT_TYP = "intent+jwt";

export interface SignedIntent {
  /** The compact JWS. This is the intent as it travels. */
  readonly jws: string;
  /** `sha256(jws)`, lowercase hex — the stable handle for this document. */
  readonly hash: string;
  readonly intent: PurchaseIntent;
}

export interface VerifiedIntent extends SignedIntent {
  /** The DID whose key the signature verified against. */
  readonly agent: string;
}

export interface VerifyIntentOptions {
  /** Injectable clock. Defaults to now. */
  readonly now?: Date;
}

/** `sha256` of a compact JWS, hex. Same convention as the credential's hash. */
export function intentHash(jws: string): string {
  return createHash("sha256").update(jws, "utf8").digest("hex");
}

function parseIntent(value: unknown): PurchaseIntent {
  const result = purchaseIntentSchema.safeParse(value);
  if (!result.success) {
    throw new AgentPassError("InvalidIntent", "the payload is not a valid purchase intent", {
      cause: result.error,
      details: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}

/**
 * Signs an intent with the agent's own key.
 *
 * @throws AgentPassError `InvalidIntent` if the document does not validate.
 * @throws AgentPassError `SignerMismatch` if the key is not the intent's agent —
 * signing anyway would produce a document that can never verify, and the
 * failure would surface later and somewhere else.
 */
export async function signIntent(intent: PurchaseIntent, keypair: Keypair): Promise<SignedIntent> {
  const validated = parseIntent(intent);

  const { address } = parseStellarDid(validated.agent);
  if (address !== keypair.publicKey()) {
    throw new AgentPassError(
      "SignerMismatch",
      "the signing key is not the intent's agent, so the result could never verify",
      { details: { agent: validated.agent, signer: keypair.publicKey() } },
    );
  }

  const privateKey = await importJWK(stellarKeypairToJWK(keypair), AGENTPASS_JWS_ALG);

  const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(validated)))
    .setProtectedHeader({
      alg: AGENTPASS_JWS_ALG,
      typ: AGENTPAY_INTENT_TYP,
      // A did:stellar has exactly one key, so the DID alone identifies it.
      kid: validated.agent,
    })
    .sign(privateKey);

  return { jws, hash: intentHash(jws), intent: validated };
}

/** Only `agent` is read before the signature is checked, to find the key. */
const agentPeekSchema = z.object({ agent: stellarDidSchema });

function decodePayload(jws: string): unknown {
  const segments = jws.split(".");
  if (segments.length !== 3) {
    throw new AgentPassError("InvalidIntent", "expected a compact JWS with three segments", {
      details: { segments: segments.length },
    });
  }

  try {
    return JSON.parse(Buffer.from(segments[1] ?? "", "base64url").toString("utf8")) as unknown;
  } catch (error) {
    throw new AgentPassError("InvalidIntent", "the JWS payload is not readable JSON", {
      cause: error,
    });
  }
}

/**
 * Verifies an intent's signature and its window. Offline, always.
 *
 * What it deliberately does **not** check: whether the credential named in
 * `credential.hash` is still active. That needs the registry, and it is the
 * caller's decision which registry to trust — the same rule phase 1 settled
 * with `RegistryMismatch`. An intent that verifies here is authentic and
 * current; whether the authority behind it still stands is the next question,
 * not this one.
 *
 * The verification key comes from the payload's `agent`, never from `kid`.
 * `kid` is chosen by whoever built the JWS, so trusting it would let a forged
 * intent nominate the key that validates it.
 */
export async function verifyIntent(
  jws: string,
  options: VerifyIntentOptions = {},
): Promise<VerifiedIntent> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(jws);
  } catch (error) {
    throw new AgentPassError("InvalidIntent", "the JWS protected header is unreadable", {
      cause: error,
    });
  }

  if (header.alg !== AGENTPASS_JWS_ALG) {
    throw new AgentPassError("InvalidIntent", `expected alg ${AGENTPASS_JWS_ALG}`, {
      details: { alg: header.alg },
    });
  }
  if (header.typ !== AGENTPAY_INTENT_TYP) {
    throw new AgentPassError("InvalidIntent", `expected typ ${AGENTPAY_INTENT_TYP}`, {
      details: { typ: header.typ },
    });
  }

  const peeked = agentPeekSchema.safeParse(decodePayload(jws));
  if (!peeked.success) {
    throw new AgentPassError("InvalidIntent", "the payload carries no usable agent DID", {
      details: { issues: z.treeifyError(peeked.error) },
    });
  }
  const agent = peeked.data.agent;

  if (header.kid !== undefined && header.kid !== agent) {
    throw new AgentPassError("InvalidIntent", "the header's kid disagrees with the payload's agent", {
      details: { kid: header.kid, agent },
    });
  }

  const publicKey = await importJWK(didToPublicJWK(agent), AGENTPASS_JWS_ALG);

  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(jws, publicKey, { algorithms: [AGENTPASS_JWS_ALG] }));
  } catch (error) {
    throw new AgentPassError("InvalidSignature", "the signature does not verify against the agent", {
      cause: error,
      details: { agent },
    });
  }

  // Full schema validation runs only on bytes the agent actually signed.
  const intent = parseIntent(JSON.parse(Buffer.from(payload).toString("utf8")) as unknown);

  // Signature before clock, for the same reason phase 1 does it: otherwise a
  // forged *and* stale intent reports as "expired" and hides the forgery.
  const now = options.now ?? new Date();
  if (now.getTime() < new Date(intent.issuedAt).getTime()) {
    throw new AgentPassError("IntentNotYetValid", "the intent is dated in the future", {
      details: { now: now.toISOString(), issuedAt: intent.issuedAt },
    });
  }
  if (now.getTime() > new Date(intent.expiresAt).getTime()) {
    throw new AgentPassError("IntentExpired", "the intent has expired", {
      details: { now: now.toISOString(), expiresAt: intent.expiresAt },
    });
  }

  return { jws, hash: intentHash(jws), intent, agent };
}
