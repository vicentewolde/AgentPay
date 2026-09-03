/**
 * Anchoring, verifying and revoking a Mandate against `agent_registry` — T20,
 * `M-3`'s anchoring half.
 *
 * No new contract, and no change to the deployed one. `agent_registry`'s own
 * surface never knew what a credential was either: `anchor()` takes a hash, a
 * subject and an expiry; `status()` and `revoke()` take a hash; `issuerStatus()`
 * takes an address. `@agentpass/sdk`'s `AgentPass.issue()`/`.verify()` bolt
 * credential-specific signing onto that generic surface, but `.anchor()`,
 * `.status()`, `.issuerStatus()` and `.revoke()` are already the raw calls —
 * which is what makes it possible for this module to reuse them without
 * `@agentpass/sdk` learning that a Mandate exists (`RegistryAccess` below names
 * only the four it needs, structurally, the same way `CredentialVerifier` in
 * `apps/agent` narrows `AgentPass` down to one method).
 *
 * The shape mirrors `AgentPass` on purpose: anchor (~issue), verify, revoke —
 * because this is the same three jobs, for a different document. `verifyMandate`
 * (`sign.ts`) is the two offline checks; `verifyMandateOnChain` here adds the
 * two that need the network, in the same order `AgentPass.verify()` already
 * established: is the anchored hash still active, and is whoever anchored it
 * still trusted.
 */
import type { StellarDid } from "@agentpass/core";
import { AgentPassError, didToStellarAddress } from "@agentpass/core";
import type { CredStatus } from "@agentpass/sdk";
import type { Keypair } from "@stellar/stellar-sdk/base";

import type { AgentPayMandate } from "./mandate.js";
import type { SignedMandate, VerifiedMandate, VerifyMandateOptions } from "./sign.js";
import { signMandate, verifyMandate } from "./sign.js";

/**
 * The one capability this module needs from `@agentpass/sdk`. A real
 * `AgentPass` satisfies this structurally — see the compile-time check in
 * `anchor.test.ts` — because every method here is already document-agnostic in
 * the SDK; nothing had to be added *for* Mandate, only exposed.
 */
export interface RegistryAccess {
  readonly config: { readonly contractId: string };
  anchor(params: {
    readonly credentialHash: string;
    readonly subject: string;
    readonly expiresAt: Date;
    readonly issuer: Keypair;
  }): Promise<string>;
  status(hash: string): Promise<CredStatus>;
  issuerStatus(address: string): Promise<{ readonly registered: boolean; readonly active: boolean }>;
  revoke(params: { readonly credentialHash: string; readonly issuer: Keypair }): Promise<string>;
}

export interface AnchorMandateParams {
  readonly mandate: AgentPayMandate;
  readonly principal: Keypair;
}

export interface AnchoredMandate extends SignedMandate {
  /** Hash of the transaction that anchored it. */
  readonly transactionHash: string;
}

export interface RevokeMandateParams {
  readonly mandateHash: string;
  /** Must be the principal that anchored it; the contract refuses otherwise. */
  readonly principal: Keypair;
}

export interface FullyVerifiedMandate extends VerifiedMandate {
  /** Always `"Active"`; anything else has already thrown. */
  readonly status: Extract<CredStatus, "Active">;
  readonly principalAddress: string;
}

function addressOf(did: StellarDid): string {
  return didToStellarAddress(did);
}

/**
 * A mandate names the registry that will answer for it, but the **verifier**
 * decides which registry it trusts — same rule as `assertTrustedRegistry` in
 * `@agentpass/sdk` (`RegistryMismatch`), rewritten here rather than imported:
 * that function's parameter type is `AgentPassCredential`, and widening it to
 * take a Mandate too would be `@agentpass/sdk` learning a later phase's
 * document, the exact thing keeping this package separate (`M-2`) exists to
 * avoid. Three lines is cheaper than that.
 */
function assertTrustedRegistry(mandate: AgentPayMandate, registry: RegistryAccess): void {
  if (mandate.credentialStatus.registry !== registry.config.contractId) {
    throw new AgentPassError("RegistryMismatch", "the mandate names a registry this client does not trust", {
      details: {
        mandateRegistry: mandate.credentialStatus.registry,
        trustedRegistry: registry.config.contractId,
      },
    });
  }
}

/**
 * Signs a mandate with the principal's key and anchors its hash.
 *
 * The mapping (`M-3`): `issuer` is the principal, `cred_hash` is `sha256(jws)`,
 * `subject` is the agent, `expires_at` is `validUntil`. The registry enforces
 * that `principal` is already a registered, active issuer — it always has;
 * this module adds no check of its own on top, and no new way to register one:
 * `AgentPass.registerIssuer()` already takes a raw address, so a principal who
 * is not also a credential issuer registers exactly the same way one would
 * (`M-17`).
 *
 * @throws AgentPassError `RegistryMismatch` if the mandate names a different
 * registry than `registry` trusts.
 * @throws AgentPassError `IssuerNotRegistered` / `IssuerInactive` if the
 * principal has not been registered, or was deactivated — the contract's own
 * refusal, surfaced through `registry.anchor()`.
 */
export async function anchorMandate(
  registry: RegistryAccess,
  { mandate, principal }: AnchorMandateParams,
): Promise<AnchoredMandate> {
  assertTrustedRegistry(mandate, registry);

  // core validates the mandate and refuses a key that is not its issuer.
  const signed = await signMandate(mandate, principal);

  const transactionHash = await registry.anchor({
    credentialHash: signed.hash,
    subject: addressOf(mandate.credentialSubject.id),
    expiresAt: new Date(mandate.validUntil),
    issuer: principal,
  });

  return { ...signed, transactionHash };
}

/**
 * The full verification: the two offline checks (`verifyMandate`), then
 * whether the anchored hash is still active, then whether the principal who
 * anchored it is still trusted. Same order `AgentPass.verify()` uses for
 * credentials, for the same reason — a forged document should never get far
 * enough to learn anything about the registry.
 *
 * @throws AgentPassError `MandateRevoked` / `MandateUnknown` if the registry
 * reports the anchored hash as revoked, or never anchored. Named `Mandate*`
 * rather than reusing `CredentialRevoked` / `CredentialUnknown` verbatim,
 * unlike `SignerMismatch`: those two codes carry "credential" in the
 * identifier a caller branches on, not just in a message string, and would
 * misreport what kind of document failed.
 * @throws AgentPassError `MandateExpired` if the registry reports it expired
 * though the signed window has not closed — the same code `verifyMandate`
 * already uses for the offline case, reused verbatim because the meaning is
 * identical: the document is stale.
 * @throws AgentPassError `IssuerNotRegistered` / `IssuerInactive` if the
 * principal is not registered, or was deactivated. Reused verbatim, unlike the
 * two above: the mandate's own schema already names this role `issuer`
 * (`mandate.issuer` *is* the principal, per `mandate.ts`), so nothing about
 * these codes misdescribes a mandate the way "credential" would.
 */
export async function verifyMandateOnChain(
  registry: RegistryAccess,
  jws: string,
  options: VerifyMandateOptions = {},
): Promise<FullyVerifiedMandate> {
  // Offline: signature, then the validity window. No network call yet.
  const verified = await verifyMandate(jws, options);
  assertTrustedRegistry(verified.mandate, registry);

  // Is the anchored hash still active?
  const status = await registry.status(verified.hash);
  switch (status) {
    case "Active":
      break;
    case "Revoked":
      throw new AgentPassError("MandateRevoked", "the registry reports this mandate as revoked", {
        details: { hash: verified.hash, registry: registry.config.contractId },
      });
    case "Unknown":
      throw new AgentPassError("MandateUnknown", "this mandate was never anchored in the registry", {
        details: { hash: verified.hash, registry: registry.config.contractId },
      });
    case "Expired":
      // The signed window said otherwise, so the two disagree. Say so.
      throw new AgentPassError(
        "MandateExpired",
        "the registry reports this mandate as expired, though its signed window has not closed",
        { details: { hash: verified.hash, validUntil: verified.mandate.validUntil } },
      );
  }

  // Is the principal who anchored it still trusted?
  const principalAddress = addressOf(verified.principal);
  const principal = await registry.issuerStatus(principalAddress);
  if (!principal.registered) {
    throw new AgentPassError("IssuerNotRegistered", "the mandate's principal is not registered in the registry", {
      details: { principalAddress, registry: registry.config.contractId },
    });
  }
  if (!principal.active) {
    throw new AgentPassError("IssuerInactive", "the mandate's principal has been deactivated", {
      details: { principalAddress, registry: registry.config.contractId },
    });
  }

  return { ...verified, status: "Active", principalAddress };
}

/**
 * Revokes a mandate — the principal cutting their own consent from outside
 * the agent. Idempotent: revoking twice is not an error (the contract's own
 * rule, unchanged).
 */
export async function revokeMandate(
  registry: RegistryAccess,
  { mandateHash, principal }: RevokeMandateParams,
): Promise<string> {
  return registry.revoke({ credentialHash: mandateHash, issuer: principal });
}
