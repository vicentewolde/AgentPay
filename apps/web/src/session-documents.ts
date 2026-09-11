/**
 * Building the two signed documents a session runs on: the agent's AgentPass
 * credential and the principal's Mandate.
 *
 * Extracted from `server.ts` in T36 so the invariant that ties them together
 * can be tested without a network, a registry, or a running server. That
 * invariant is not decorative — breaking it took down every purchase in a
 * wallet-backed session (`C-17`).
 */
import type { AgentPassCredential, CredentialRequest, StellarDid } from "@agentpass/core";
import {
  AGENTPASS_CREDENTIAL_TYPE,
  AGENTPASS_STATUS_TYPE,
  VC_CONTEXT_V2,
  stellarAddressToDid,
} from "@agentpass/core";
import { createMandate, type AgentPayMandate, type MandateGrant } from "@agentpay/mandate";

export interface SessionDocumentsParams {
  /** The platform key that issues (and signs) the credential. */
  readonly issuerAddress: string;
  /** The agent the credential is about — its subject. */
  readonly agentAddress: string;
  /**
   * The connected wallet, when there is one (T34/T35). Absent is the classic
   * path, where the platform is its own principal.
   */
  readonly walletAddress: string | undefined;
  readonly scope: CredentialRequest;
  /**
   * What the Mandate grants. Defaults to `scope.scope` — every call site
   * before T51 relied on this default, and still does; the credential's
   * `credentialSubject.scope` always gets `scope.scope` regardless, since a
   * plain `Scope` is all that field can express. Only diverges when a
   * partner-proposed grant (T51's `consent_sessions`) carries a `payTo` a
   * credential cannot carry (`M-14`) but a Mandate can.
   */
  readonly grant?: MandateGrant;
  readonly registryContractId: string;
  readonly now: Date;
  readonly validUntil: Date;
}

export interface SessionDocuments {
  readonly credential: AgentPassCredential;
  readonly mandate: AgentPayMandate;
  /** Who both documents name as the principal — the wallet, or the platform. */
  readonly principal: StellarDid;
}

/**
 * Builds both documents from a single principal, so they cannot disagree.
 *
 * `checkMandate` (T17) refuses any intent whose principal — read off the
 * credential — is not the Mandate's own issuer. T35 made a connected wallet
 * sign the Mandate but left the credential naming the platform, and every
 * purchase in a wallet session died with `MandatePrincipalMismatch`. The
 * principal is derived once here and used by both, which is what makes that
 * class of bug unrepresentable rather than merely fixed.
 *
 * The credential's `issuer` stays the platform either way: attesting the
 * agent's identity and scope is a different role from being the principal it
 * acts for (`C-17`).
 */
export function buildSessionDocuments(params: SessionDocumentsParams): SessionDocuments {
  const issuerDid = stellarAddressToDid(params.issuerAddress, "testnet");
  const agentDid = stellarAddressToDid(params.agentAddress, "testnet");
  const principal =
    params.walletAddress === undefined ? issuerDid : stellarAddressToDid(params.walletAddress, "testnet");

  const validFrom = params.now.toISOString();
  const validUntil = params.validUntil.toISOString();

  const credential: AgentPassCredential = {
    "@context": [VC_CONTEXT_V2],
    type: ["VerifiableCredential", AGENTPASS_CREDENTIAL_TYPE],
    issuer: issuerDid,
    validFrom,
    validUntil,
    credentialSubject: { id: agentDid, agent: params.scope.agent, principal, scope: params.scope.scope },
    credentialStatus: { type: AGENTPASS_STATUS_TYPE, registry: params.registryContractId },
  };

  // Same limits as the scope, not narrower (contrast `pnpm demo`, `G-8`): a
  // real purchase authorises twice — once structurally in
  // `create_purchase_intent`, once against the real 402 in
  // `executeBazaarPayment` — and `checkDailyLimit` has no notion of
  // `intentId`, so the second call's `spentToday` already includes the
  // first call's recorded amount. A `perDay` tight enough to demonstrate a
  // rejection here would reject the very first purchase.
  const mandate = createMandate({
    principal,
    agent: agentDid,
    grant: params.grant ?? params.scope.scope,
    registry: params.registryContractId,
    validFrom,
    validUntil,
  });

  return { credential, mandate, principal };
}
