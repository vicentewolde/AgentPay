/**
 * Verifying a Mandate whose principal signed with a **connected wallet**
 * instead of a key this codebase ever held — Fase 6, T35.
 *
 * `sign.ts`'s `signMandate`/`verifyMandate` are a compact JWS: EdDSA over the
 * header/payload bytes directly, no pre-hashing. A wallet's `signMessage`
 * (SEP-0043's interface, SEP-0053's byte format — `@agentpass/core`'s
 * `sep53.ts`) signs `sha256("Stellar Signed Message:\n" + message)` instead —
 * a different signature over different bytes, by design, so a site can never
 * trick a wallet into producing a signature that doubles as something else.
 * There is no reformatting that bridges the two: a wallet cannot produce a
 * mandate JWS, ever, and this module does not try to make it.
 *
 * What it does instead: define the mandate's canonical byte representation
 * once (`canonicalMandateJson`), and verify a SEP-53 signature over a
 * challenge message that embeds its hash. Same guarantee `verifyMandate`
 * gives — this exact document, this exact principal, checked before
 * anything else about the content — over a different signature scheme.
 */
import { createHash } from "node:crypto";

import { AgentPassError, didToStellarAddress, verifyStellarMessage } from "@agentpass/core";
import type { StellarDid } from "@agentpass/core";

import type { AgentPayMandate } from "./mandate.js";
import { agentPayMandateSchema } from "./mandate.js";

/**
 * Deterministic JSON for a mandate: keys sorted recursively, so the exact
 * same document always serialises to the exact same bytes no matter which
 * order its fields were constructed in (the browser building the challenge
 * to display, and the server reconstructing it to verify, must agree
 * byte-for-byte, or a mandate whose fields happened to enumerate differently
 * would fail to verify for no reason tied to its actual content).
 */
export function canonicalMandateJson(mandate: AgentPayMandate): string {
  return JSON.stringify(sortKeysDeep(mandate));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** `sha256` of a mandate's canonical JSON, hex — the wallet-signed analogue of `mandateHash` (`sign.ts`). */
export function walletMandateHash(mandate: AgentPayMandate): string {
  return createHash("sha256").update(canonicalMandateJson(mandate), "utf8").digest("hex");
}

/**
 * The message a connected wallet signs to authorise a mandate — plain text a
 * human can read in their wallet's approval popup, not a bare hash: what
 * they are authorising (agent, limits, validity), plus the mandate's own
 * hash to bind the signature to these exact bytes and no others.
 */
export function mandateChallengeMessage(mandate: AgentPayMandate): string {
  const { grant } = mandate.credentialSubject;
  return [
    "AgentPay Mandate",
    `Agent: ${mandate.credentialSubject.id}`,
    `Limit: ${grant.limits.perTx} per purchase, ${grant.limits.perDay} per day, ${grant.limits.currency}`,
    `Valid until: ${mandate.validUntil}`,
    `Hash: ${walletMandateHash(mandate)}`,
  ].join("\n");
}

export interface WalletVerifiedMandate {
  readonly hash: string;
  readonly mandate: AgentPayMandate;
  readonly principal: StellarDid;
  readonly agent: StellarDid;
}

export interface VerifyWalletSignedMandateOptions {
  readonly now?: Date;
}

/**
 * Verifies a mandate's wallet signature and its validity window. Offline,
 * always — same division of labour as `verifyMandate`: this checks that the
 * document is authentic and in-window; whether it is still active in the
 * registry is `verifyWalletSignedMandateOnChain` (`anchor.ts`), the next
 * question, not this one.
 *
 * @throws AgentPassError `InvalidMandate` if the payload is off-schema.
 * @throws AgentPassError `InvalidSignature` if the signature does not verify
 * against `mandate.issuer`'s address.
 * @throws AgentPassError `MandateNotYetValid` / `MandateExpired` for a window
 * that has not started, or has closed — checked only after the signature,
 * for the same reason `verifyMandate` orders it that way: a forged and
 * expired mandate must never report merely as "expired".
 */
export async function verifyWalletSignedMandate(
  mandate: unknown,
  signature: string,
  options: VerifyWalletSignedMandateOptions = {},
): Promise<WalletVerifiedMandate> {
  const parsed = agentPayMandateSchema.safeParse(mandate);
  if (!parsed.success) {
    throw new AgentPassError("InvalidMandate", "the payload does not match the mandate schema", {
      cause: parsed.error,
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
    });
  }
  const document = parsed.data;

  const address = didToStellarAddress(document.issuer);
  const message = mandateChallengeMessage(document);
  if (!verifyStellarMessage(address, message, signature)) {
    throw new AgentPassError("InvalidSignature", "the wallet signature does not verify against the principal", {
      details: { principal: document.issuer },
    });
  }

  const now = options.now ?? new Date();
  const validFrom = new Date(document.validFrom);
  const validUntil = new Date(document.validUntil);

  if (now.getTime() < validFrom.getTime()) {
    throw new AgentPassError("MandateNotYetValid", "the mandate is not valid yet", {
      details: { now: now.toISOString(), validFrom: document.validFrom },
    });
  }
  if (now.getTime() > validUntil.getTime()) {
    throw new AgentPassError("MandateExpired", "the mandate has expired", {
      details: { now: now.toISOString(), validUntil: document.validUntil },
    });
  }

  return {
    hash: walletMandateHash(document),
    mandate: document,
    principal: document.issuer,
    agent: document.credentialSubject.id,
  };
}
