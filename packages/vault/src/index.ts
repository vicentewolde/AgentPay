/**
 * `@agentpay/vault` — durable, tamper-evident evidence of every PolicyRail
 * decision. Phase 5, T27.
 */
export {
  createFileMandateVault,
  type MandateVault,
  type RecordAnchorInput,
  type RecordRefusalInput,
  type VaultAnchoredEntry,
  type VaultEntry,
  type VaultGrantedEntry,
  type VaultRecord,
  type VaultRefusedEntry,
  type VaultVerification,
} from "./vault.js";
export { createPostgresMandateVault, type PostgresMandateVaultOptions } from "./postgres-vault.js";
