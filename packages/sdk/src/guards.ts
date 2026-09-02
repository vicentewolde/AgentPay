import type { AgentPassCredential } from "@agentpass/core";
import { AgentPassError } from "@agentpass/core";

import type { AgentPassConfig } from "./config.js";

/**
 * A credential names the registry that holds its status, but the **verifier**
 * decides which registry it trusts. A credential pointing somewhere else is
 * rejected rather than followed — otherwise an issuer could nominate a registry
 * they control and answer for their own credentials.
 */
export function assertTrustedRegistry(
  credential: AgentPassCredential,
  config: AgentPassConfig,
): void {
  if (credential.credentialStatus.registry !== config.contractId) {
    throw new AgentPassError(
      "RegistryMismatch",
      "the credential names a registry this client does not trust",
      {
        details: {
          credentialRegistry: credential.credentialStatus.registry,
          trustedRegistry: config.contractId,
        },
      },
    );
  }
}

/** The registry keys credentials by raw 32 bytes; callers hand us hex. */
export function credentialHashToBytes(value: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new AgentPassError(
      "ConfigError",
      "a credential hash must be 64 lowercase hex characters",
      { details: { value } },
    );
  }
  return Buffer.from(value, "hex");
}
