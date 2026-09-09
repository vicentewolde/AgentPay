import { AgentPassError } from "@agentpass/core";
import StellarHDWallet from "stellar-hd-wallet";

/**
 * Which of a tenant's two keys to derive. `apps/web` today signs credentials
 * with `ISSUER_SECRET_KEY` and mandates/purchases with `AGENT_SECRET_KEY` —
 * one fixed pair, shared by every visitor. Multi-tenancy replaces those two
 * secrets with one master mnemonic and a role per derived key, not with a
 * secret per tenant to generate, store and rotate independently.
 */
export type TenantKeyRole = "agent" | "issuer";

export interface TenantKeypair {
  readonly publicKey: string;
  readonly secret: string;
}

/** BIP-32 hardened derivation only defines indices below 2^31. */
const MAX_HARDENED_INDEX = 2 ** 31 - 1;

/**
 * Maps (tenantIndex, role) to a single SEP-0005 account index — even for
 * `agent`, odd for `issuer` — so the two keys of the same tenant can never
 * collide with each other, and no two tenants can collide as long as
 * `tenantIndex` is assigned once per tenant and never reused.
 */
function accountIndexFor(tenantIndex: number, role: TenantKeyRole): number {
  if (!Number.isInteger(tenantIndex) || tenantIndex < 0) {
    throw new AgentPassError("InvalidTenantIndex", `tenantIndex must be a non-negative integer, got ${tenantIndex}`, {
      details: { tenantIndex },
    });
  }
  const accountIndex = tenantIndex * 2 + (role === "agent" ? 0 : 1);
  if (accountIndex > MAX_HARDENED_INDEX) {
    throw new AgentPassError("InvalidTenantIndex", `tenantIndex ${tenantIndex} exceeds the derivable range`, {
      details: { tenantIndex, accountIndex, max: MAX_HARDENED_INDEX },
    });
  }
  return accountIndex;
}

/**
 * Derives one Stellar keypair for `(tenantIndex, role)` from a single BIP-39
 * master mnemonic, via SEP-0005 (`m/44'/148'/<account>'`). Onboarding a
 * tenant costs a new index — assigned once, e.g. by a tenant table's
 * auto-increment id — not a new secret to generate and keep track of.
 *
 * `masterMnemonic` is the one secret this whole scheme protects: it belongs
 * in a secrets manager (Doppler/Infisical), never in `.env.local`'s
 * committed history. This function never logs or echoes it.
 */
export function deriveTenantKeypair(masterMnemonic: string, tenantIndex: number, role: TenantKeyRole): TenantKeypair {
  const accountIndex = accountIndexFor(tenantIndex, role);
  if (!StellarHDWallet.validateMnemonic(masterMnemonic)) {
    throw new AgentPassError("ConfigError", "the master mnemonic is not a valid BIP-39 phrase", {
      details: { reason: "failed-checksum-or-unknown-word" },
    });
  }
  const wallet = StellarHDWallet.fromMnemonic(masterMnemonic);
  return {
    publicKey: wallet.getPublicKey(accountIndex),
    secret: wallet.getSecret(accountIndex),
  };
}

/**
 * Generates a fresh 24-word master mnemonic. Run once, outside of any
 * request path; store the result in a secrets manager and pass it into
 * {@link deriveTenantKeypair} at startup — never regenerate it, or every
 * tenant's keys derived so far change with it.
 */
export function generateMasterMnemonic(): string {
  return StellarHDWallet.generateMnemonic();
}
