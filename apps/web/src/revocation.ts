/**
 * Hosted revocation: letting the person who signed a Mandate take it back,
 * from AgentPey's own domain, with their own wallet.
 *
 * **Why this is not a partner API call.** `packages/partner-api/src/scopes.ts`
 * has kept `mandates:revoke` out of the scope list since T45, deliberately:
 * revoking is a wallet-signed act the principal performs, not something a
 * platform's API key triggers on their behalf. A pilot that handed RealOps a
 * revoke scope to save a milestone would stop proving the thing it claims to
 * prove. So revocation gets a hosted page, the same shape consent already has.
 *
 * **Where the authority actually lives.** Not here. The registry contract
 * refuses a revoke transaction that is not signed by the address that anchored
 * the Mandate — that is the enforcement, on chain, and nothing in this file can
 * weaken it. What this module adds is a *better refusal*: checking the
 * connected wallet against the stored principal before preparing anything, so
 * someone who opens the wrong link is told "esa no es la wallet" instead of
 * signing a transaction that fails for reasons only a Soroban error explains.
 *
 * **Minimal disclosure before proof.** A Mandate id is shared with the partner
 * that created it, so it is a weaker secret than a consent-session id. Before
 * the wallet proves itself, the page is told only whether the Mandate is still
 * active and when it expires. The grant — the limits, the venue, the product —
 * is shown only after. Someone holding a stray id learns nothing about what the
 * person was authorised to spend.
 */
import { AgentPassError, verifyStellarMessage } from "@agentpass/core";
import type { MandateRecord, Principal } from "@agentpey/directory";

/** The slice of the directory revocation reads. Narrow, and read-only except for the final mirror. */
export interface RevocationDirectory {
  findMandateById(id: string): Promise<MandateRecord | undefined>;
  findPrincipalByAddress(address: string): Promise<Principal | undefined>;
  revokeMandate(mandateHash: string, revokeTx: string, at?: Date): Promise<void>;
}

/** What the page may show before anyone has proved anything. */
export interface PublicRevocationView {
  readonly mandateId: string;
  readonly status: "active" | "expired" | "revoked";
  readonly validUntil: string;
}

/** What it may show once the wallet has proved it is the principal. */
export interface PrivateRevocationView extends PublicRevocationView {
  readonly mandateHash: string;
  readonly grant: unknown;
  readonly anchorTx: string;
}

function statusOf(mandate: MandateRecord, now: Date): PublicRevocationView["status"] {
  if (mandate.revokedAt !== null) return "revoked";
  return mandate.validUntil.getTime() <= now.getTime() ? "expired" : "active";
}

/**
 * @throws AgentPassError `MandateNotFound`
 */
export async function readPublicView(
  directory: RevocationDirectory,
  mandateId: string,
  now: Date,
): Promise<PublicRevocationView> {
  const mandate = await requireMandate(directory, mandateId);
  return {
    mandateId: mandate.id,
    status: statusOf(mandate, now),
    validUntil: mandate.validUntil.toISOString(),
  };
}

async function requireMandate(directory: RevocationDirectory, mandateId: string): Promise<MandateRecord> {
  const mandate = await directory.findMandateById(mandateId);
  if (mandate === undefined) {
    throw new AgentPassError("MandateNotFound", "no existe ese permiso", { details: { mandateId } });
  }
  return mandate;
}

export interface WalletProof {
  readonly address: string;
  readonly nonce: string;
  readonly signature: string;
}

export interface ProofContext {
  /** Consumes the one-time challenge. `false` when it never existed, expired, or was already used. */
  readonly takeChallenge: (nonce: string) => Promise<boolean>;
  /** The exact message the wallet was asked to sign. */
  readonly challengeMessage: (nonce: string) => string;
}

/**
 * Proves that whoever is asking holds the key of the Mandate's principal, and
 * hands back the Mandate.
 *
 * The three refusals stay distinct on purpose. "Ese desafío ya se usó" is an
 * operational hiccup, "la firma no corresponde" is a broken client, and "esa no
 * es la wallet" is a person on the wrong account — and only the last one has an
 * action attached ("conectá la otra"). Collapsing them into "no autorizado"
 * would make the common case unsolvable by the person experiencing it.
 *
 * @throws AgentPassError `MandateNotFound`, `InvalidArguments`,
 * `InvalidSignature`, `MandatePrincipalMismatch`
 */
export async function proveOwnership(
  directory: RevocationDirectory,
  context: ProofContext,
  mandateId: string,
  proof: WalletProof,
): Promise<MandateRecord> {
  const mandate = await requireMandate(directory, mandateId);

  // One-time, and consumed before anything else looks at it: a challenge that
  // survived a failed check could be replayed against a different one.
  if (!(await context.takeChallenge(proof.nonce))) {
    throw new AgentPassError("InvalidArguments", "ese desafío no existe, ya se usó, o venció — pedí uno nuevo", {
      details: { mandateId },
    });
  }

  if (!verifyStellarMessage(proof.address, context.challengeMessage(proof.nonce), proof.signature)) {
    throw new AgentPassError("InvalidSignature", "la firma no corresponde a esa wallet", { details: { mandateId } });
  }

  const principal = await directory.findPrincipalByAddress(proof.address);
  // No principal row at all means this wallet has never signed anything here,
  // so it certainly did not sign this. Same refusal as the wrong wallet:
  // distinguishing them would tell a stranger whether an address is known to
  // the system, which is not theirs to learn.
  if (principal === undefined || principal.id !== mandate.principalId) {
    throw new AgentPassError(
      "MandatePrincipalMismatch",
      "esa wallet no es la que firmó este permiso — conectá la que usaste para firmarlo",
      { details: { mandateId } },
    );
  }

  return mandate;
}

export function toPrivateView(mandate: MandateRecord, now: Date): PrivateRevocationView {
  const document = mandate.document as { readonly credentialSubject?: { readonly grant?: unknown } };
  return {
    mandateId: mandate.id,
    status: statusOf(mandate, now),
    validUntil: mandate.validUntil.toISOString(),
    mandateHash: mandate.mandateHash,
    grant: document.credentialSubject?.grant ?? null,
    anchorTx: mandate.anchorTx,
  };
}

/**
 * Whether there is anything left to revoke.
 *
 * An already-revoked Mandate is refused rather than quietly re-revoked: the
 * person needs to know it was already done, and a second on-chain write that
 * changes nothing costs a fee and muddies the audit trail. An expired one is
 * refused for a blunter reason — it already authorises nothing, and asking
 * someone to sign a transaction that buys them nothing is wasting their time.
 *
 * @throws AgentPassError `MandateRevoked`, `MandateExpired`
 */
export function requireRevocable(mandate: MandateRecord, now: Date): void {
  const status = statusOf(mandate, now);
  if (status === "revoked") {
    throw new AgentPassError("MandateRevoked", "este permiso ya estaba revocado", {
      details: { mandateId: mandate.id, revokeTx: mandate.revokeTx },
    });
  }
  if (status === "expired") {
    throw new AgentPassError("MandateExpired", "este permiso ya venció, así que no autoriza nada", {
      details: { mandateId: mandate.id, validUntil: mandate.validUntil.toISOString() },
    });
  }
}
