/**
 * `create_purchase_intent` end to end: from a tool call to a signed document,
 * and the re-verification that stands between them.
 */
import { hasErrorCode } from "@agentpass/core";
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";

import { createAgent, type Agent } from "../agent.js";
import { createMockCatalog, MOCK_VENUE_ID, USDC_TESTNET } from "../catalog/mock.js";
import type { CredentialVerifier } from "../credential/verifier.js";
import { createStubVerifier, makeTestCredential } from "../testing/credentials.js";
import type { CreatePurchaseIntentResult } from "../tools/agent-tools.js";
import { verifyIntent } from "./sign.js";

async function startAgent(
  overrides: { verifier?: CredentialVerifier; signer?: Keypair; intentTtlSeconds?: number } = {},
) {
  const credential = await makeTestCredential();
  const agent = await createAgent({
    credential: credential.jws,
    catalog: createMockCatalog(),
    verifier: overrides.verifier ?? createStubVerifier(),
    signer: "signer" in overrides ? overrides.signer : credential.subjectKeypair,
    intentTtlSeconds: overrides.intentTtlSeconds,
  });
  return { agent, credential };
}

async function buy(agent: Agent, product_id: string, quantity: number) {
  return (await agent.tools.invoke("create_purchase_intent", {
    product_id,
    quantity,
  })) as CreatePurchaseIntentResult;
}

describe("a signed intent", () => {
  it("verifies against the agent's own key, and says what was ordered", async () => {
    const { agent, credential } = await startAgent();
    const result = await buy(agent, "mate-calabaza", 2);
    const verified = await verifyIntent(result.jws);

    expect(verified.intent.purchase).toEqual({
      productId: "mate-calabaza",
      quantity: 2,
      unitAmount: "18.50",
      totalAmount: "37.0000000",
      asset: USDC_TESTNET,
    });
    expect(verified.intent.venue).toBe(MOCK_VENUE_ID);
    expect(verified.intent.agent).toBe(credential.credential.credentialSubject.id);
    expect(verified.intent.principal).toBe(credential.credential.credentialSubject.principal);
  });

  /**
   * The link that makes an intent revocable after the fact rather than a bearer
   * token: it names the credential's hash, which is what the registry answers
   * about. A holder of this document can ask whether the authority behind it
   * still stands.
   */
  it("is traceable to the credential that authorised it", async () => {
    const { agent, credential } = await startAgent();
    const result = await buy(agent, "mate-calabaza", 1);
    const verified = await verifyIntent(result.jws);

    expect(verified.intent.credential.hash).toBe(credential.hash);
    expect(verified.intent.credential.registry).toBe(
      credential.credential.credentialStatus.registry,
    );
    expect(result.credential_hash).toBe(credential.hash);
  });

  it("carries the limit it was checked against, so a mismatch is detectable", async () => {
    const { agent } = await startAgent();
    const verified = await verifyIntent((await buy(agent, "mate-calabaza", 1)).jws);

    expect(verified.intent.authorisation).toEqual({ perTx: "50.00", currency: "USDC" });
  });

  it("expires, and by default in fifteen minutes", async () => {
    const { agent } = await startAgent();
    const verified = await verifyIntent((await buy(agent, "mate-calabaza", 1)).jws);

    const window =
      new Date(verified.intent.expiresAt).getTime() - new Date(verified.intent.issuedAt).getTime();
    expect(window).toBe(900_000);
  });

  it("honours a shorter lifetime when the operator asks for one", async () => {
    const { agent } = await startAgent({ intentTtlSeconds: 60 });
    const verified = await verifyIntent((await buy(agent, "mate-calabaza", 1)).jws);

    expect(
      new Date(verified.intent.expiresAt).getTime() - new Date(verified.intent.issuedAt).getTime(),
    ).toBe(60_000);
  });

  it("gives every intent its own id, so two identical orders stay distinct", async () => {
    const { agent } = await startAgent();
    const first = await buy(agent, "mate-calabaza", 1);
    const second = await buy(agent, "mate-calabaza", 1);

    expect(first.intent_id).not.toBe(second.intent_id);
    expect(first.intent_hash).not.toBe(second.intent_hash);
  });

  it("computes the total in exact decimals, not floats", async () => {
    const { agent } = await startAgent();
    const verified = await verifyIntent((await buy(agent, "cafe-grano-250g", 3)).jws);

    // 9.90 x 3. In floating point this is 29.700000000000003.
    expect(verified.intent.purchase.totalAmount).toBe("29.7000000");
    expect(9.9 * 3).not.toBe(29.7);
  });
});

describe("the credential is re-checked at the instant of signing", () => {
  /**
   * Resolves what T11 left open. The startup check decides which capabilities
   * exist; this one decides whether the authority is still live at the moment
   * the signature goes on. Without it, a long-running agent would keep signing
   * against a credential revoked hours earlier — and the phase's whole claim is
   * that authorisation can be cut from outside, which is not true if the cut
   * only takes effect at the next restart.
   */
  it("refuses to sign once the registry reports the credential revoked", async () => {
    let status: "Active" | "Revoked" = "Active";
    const verifier: CredentialVerifier = {
      verify: (jws, options) => createStubVerifier({ status }).verify(jws, options),
    };

    const { agent } = await startAgent({ verifier });

    // Startup saw it active, so the tool exists.
    expect(agent.tools.has("create_purchase_intent")).toBe(true);
    await expect(buy(agent, "mate-calabaza", 1)).resolves.toBeDefined();

    // Revoked from outside the agent, mid-run.
    status = "Revoked";

    await expect(buy(agent, "mate-calabaza", 1)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "CredentialRevoked"),
    );
  });

  it("refuses when the registry cannot be reached: not knowing is not permission", async () => {
    let fail = false;
    const verifier: CredentialVerifier = {
      verify: (jws, options) =>
        createStubVerifier(fail ? { failWith: new Error("rpc down") } : {}).verify(jws, options),
    };

    const { agent } = await startAgent({ verifier });
    fail = true;

    await expect(buy(agent, "mate-calabaza", 1)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "NetworkError"),
    );
  });

  it("checks the scope first, so a refused purchase costs no network call", async () => {
    let calls = 0;
    const verifier: CredentialVerifier = {
      verify: (jws, options) => {
        calls += 1;
        return createStubVerifier().verify(jws, options);
      },
    };

    const { agent } = await startAgent({ verifier });
    const afterStartup = calls;

    // Over the limit: rejected by the scope check, before any re-verification.
    await expect(buy(agent, "chaleco-alpaca", 1)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "ScopeAmountExceeded"),
    );
    expect(calls).toBe(afterStartup);

    // Within the limit: one re-verification, then a signature.
    await buy(agent, "mate-calabaza", 1);
    expect(calls).toBe(afterStartup + 1);
  });
});

describe("the signing key", () => {
  it("is refused at startup when it is not the credential's subject", async () => {
    const credential = await makeTestCredential();

    await expect(
      createAgent({
        credential: credential.jws,
        catalog: createMockCatalog(),
        verifier: createStubVerifier(),
        signer: Keypair.random(),
      }),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "SignerMismatch"));
  });

  /**
   * A capability that cannot be exercised should not be advertised. Without a
   * key the agent can read the catalogue and report its credential, and simply
   * has no tool for buying.
   */
  it("withholds the tool entirely when there is no key to sign with", async () => {
    const { agent } = await startAgent({ signer: undefined });

    expect(agent.credential.usable).toBe(true);
    expect(agent.tools.list().map((tool) => tool.name)).toEqual([
      "list_products",
      "get_product",
      "check_my_credential",
    ]);
    await expect(
      agent.tools.invoke("create_purchase_intent", { product_id: "mate-calabaza", quantity: 1 }),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "UnknownTool"));
  });
});
