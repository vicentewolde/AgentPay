import type { AgentPass } from "@agentpass/sdk";
import { hasErrorCode, didToStellarAddress } from "@agentpass/core";
import { Keypair, StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";

import { anchorMandate, revokeMandate, verifyMandateOnChain, type RegistryAccess } from "./anchor.js";
import { signMandate } from "./sign.js";
import { createFakeRegistryAccess, didOf, makeTestMandate } from "./testing.js";

const principal = Keypair.random();
const agent = Keypair.random();
const stranger = Keypair.random();
const FOREIGN_REGISTRY = StrKey.encodeContract(Buffer.alloc(32, 7));

function registryWithPrincipal(active = true) {
  const registry = createFakeRegistryAccess();
  registry.registerIssuer(principal.publicKey(), active);
  return registry;
}

describe("the port is narrow on purpose", () => {
  /**
   * Compile-time, not runtime: the real SDK satisfies the port as-is — every
   * method `RegistryAccess` names is already document-agnostic in
   * `@agentpass/sdk` — while the port itself exposes no way to issue a
   * credential, verify one, or run the admin operations. If any of the four
   * methods ever changed shape in the SDK, this stops building.
   */
  it("AgentPass from the SDK satisfies RegistryAccess", () => {
    const conforms = (agentPass: AgentPass): RegistryAccess => agentPass;

    expect(typeof conforms).toBe("function");
  });

  it("exposes exactly the four methods it needs, plus config", () => {
    const registry = createFakeRegistryAccess();

    expect(new Set(Object.keys(registry))).toEqual(
      new Set([
        "config",
        "anchor",
        "status",
        "issuerStatus",
        "revoke",
        "registerIssuer",
        "deactivateIssuer",
        "getCredential",
      ]),
    );
  });
});

describe("anchorMandate", () => {
  it("signs and anchors, returning the transaction hash alongside the signed mandate", async () => {
    const registry = registryWithPrincipal();
    const mandate = makeTestMandate(principal, agent);

    const anchored = await anchorMandate(registry, { mandate, principal });

    expect(anchored.jws.split(".")).toHaveLength(3);
    expect(anchored.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(anchored.transactionHash).not.toBe("");
    await expect(registry.status(anchored.hash)).resolves.toBe("Active");
  });

  it("refuses a mandate naming a registry this client does not trust", async () => {
    const registry = registryWithPrincipal();
    const mandate = makeTestMandate(principal, agent, { registry: FOREIGN_REGISTRY });

    await expect(anchorMandate(registry, { mandate, principal })).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "RegistryMismatch"),
    );
  });

  it("refuses an unregistered principal — the contract's own rule, not a new one", async () => {
    const registry = createFakeRegistryAccess();
    const mandate = makeTestMandate(principal, agent);

    await expect(anchorMandate(registry, { mandate, principal })).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "IssuerNotRegistered"),
    );
  });

  it("refuses a deactivated principal", async () => {
    const registry = registryWithPrincipal(false);
    const mandate = makeTestMandate(principal, agent);

    await expect(anchorMandate(registry, { mandate, principal })).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "IssuerInactive"),
    );
  });

  it("refuses to sign with a key that is not the mandate's own issuer", async () => {
    const registry = registryWithPrincipal();
    const mandate = makeTestMandate(principal, agent);

    await expect(anchorMandate(registry, { mandate, principal: stranger })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "SignerMismatch"),
    );
  });

  it("anchors the agent as the subject, the principal as the issuer — never swapped (M-3)", async () => {
    const registry = registryWithPrincipal();
    const mandate = makeTestMandate(principal, agent);

    const anchored = await anchorMandate(registry, { mandate, principal });

    expect(registry.getCredential(anchored.hash)).toEqual({
      issuer: principal.publicKey(),
      subject: didToStellarAddress(didOf(agent)),
    });
  });
});

describe("verifyMandateOnChain", () => {
  it("runs all four checks and returns Active with the principal's address", async () => {
    const registry = registryWithPrincipal();
    const anchored = await anchorMandate(registry, { mandate: makeTestMandate(principal, agent), principal });

    const verified = await verifyMandateOnChain(registry, anchored.jws);

    expect(verified.status).toBe("Active");
    expect(verified.hash).toBe(anchored.hash);
    expect(verified.principalAddress).toBe(principal.publicKey());
    expect(verified.agent).toBe(didOf(agent));
  });

  it("refuses a mandate naming a registry this client does not trust, before any network call", async () => {
    const registry = registryWithPrincipal();
    const signed = await signMandate(
      makeTestMandate(principal, agent, { registry: FOREIGN_REGISTRY }),
      principal,
    );

    await expect(verifyMandateOnChain(registry, signed.jws)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "RegistryMismatch"),
    );
  });

  it("refuses a validly signed mandate that was never anchored", async () => {
    const registry = registryWithPrincipal();
    const signed = await signMandate(makeTestMandate(principal, agent), principal);

    await expect(verifyMandateOnChain(registry, signed.jws)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "MandateUnknown"),
    );
  });

  it("refuses a revoked mandate — not the credential code, its own", async () => {
    const registry = registryWithPrincipal();
    const anchored = await anchorMandate(registry, { mandate: makeTestMandate(principal, agent), principal });
    await revokeMandate(registry, { mandateHash: anchored.hash, principal });

    const rejection = verifyMandateOnChain(registry, anchored.jws);

    await expect(rejection).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "MandateRevoked"));
    await expect(rejection).rejects.not.toSatisfy((error: unknown) => hasErrorCode(error, "CredentialRevoked"));
  });

  it("refuses when the principal was deactivated after anchoring", async () => {
    const registry = registryWithPrincipal();
    const anchored = await anchorMandate(registry, { mandate: makeTestMandate(principal, agent), principal });

    registry.deactivateIssuer(principal.publicKey());

    await expect(verifyMandateOnChain(registry, anchored.jws)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "IssuerInactive"),
    );
  });

  it("reports the registry's Expired disagreeing with the signed window as MandateExpired", async () => {
    // Two independent clocks, deliberately out of step: the registry's own
    // (`expires_at` is stored as seconds, per the contract) and the one
    // `verifyMandate`'s offline check is handed. The scenario this proves is
    // exactly the one `AgentPass.verify()` already names for credentials: the
    // registry disagrees with the document's own signed window.
    let registryNow = new Date("2026-09-01T00:00:00.000Z");
    const registry = createFakeRegistryAccess({ now: () => registryNow });
    registry.registerIssuer(principal.publicKey());

    const mandate = makeTestMandate(principal, agent, {
      validFrom: "2026-09-01T00:00:00.000Z",
      validUntil: "2026-09-01T00:00:10.000Z",
    });
    const anchored = await anchorMandate(registry, { mandate, principal });

    // Past the contract's expires_at...
    registryNow = new Date("2026-09-01T00:00:20.000Z");
    // ...but still inside the signed window as verifyMandate's own offline
    // check sees it, so that check passes and the disagreement is the
    // registry's alone to report.
    const stillInWindow = new Date("2026-09-01T00:00:05.000Z");

    await expect(
      verifyMandateOnChain(registry, anchored.jws, { now: stillInWindow }),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "MandateExpired"));
  });

  it("still reports the offline MandateExpired when both the window and the anchor have lapsed", async () => {
    const registry = registryWithPrincipal();
    const mandate = makeTestMandate(principal, agent, {
      validFrom: "2020-01-01T00:00:00.000Z",
      validUntil: "2020-02-01T00:00:00.000Z",
    });
    const anchored = await anchorMandate(registry, { mandate, principal });

    await expect(verifyMandateOnChain(registry, anchored.jws)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "MandateExpired"),
    );
  });
});

describe("revokeMandate", () => {
  it("is what makes a verified mandate stop verifying, from outside the agent", async () => {
    const registry = registryWithPrincipal();
    const anchored = await anchorMandate(registry, { mandate: makeTestMandate(principal, agent), principal });

    await expect(verifyMandateOnChain(registry, anchored.jws)).resolves.toMatchObject({ status: "Active" });

    await revokeMandate(registry, { mandateHash: anchored.hash, principal });

    await expect(registry.status(anchored.hash)).resolves.toBe("Revoked");
    await expect(verifyMandateOnChain(registry, anchored.jws)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "MandateRevoked"),
    );
  });

  it("is idempotent, matching the contract's own rule", async () => {
    const registry = registryWithPrincipal();
    const anchored = await anchorMandate(registry, { mandate: makeTestMandate(principal, agent), principal });

    await revokeMandate(registry, { mandateHash: anchored.hash, principal });
    await revokeMandate(registry, { mandateHash: anchored.hash, principal });

    await expect(registry.status(anchored.hash)).resolves.toBe("Revoked");
  });
});
