import { AgentPassError, hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import { createAgent } from "./agent.js";
import { createMockCatalog } from "./catalog/mock.js";
import { createStubVerifier, makeTestCredential } from "./testing/credentials.js";
import { createStubMandateVerifier, makeTestMandate } from "./testing/mandates.js";
import type { ActiveCredentialReport, UnusableCredentialReport } from "./tools/agent-tools.js";
import type { SimulatedStatus } from "./testing/credentials.js";

async function startAgent(
  options: {
    status?: SimulatedStatus;
    failWith?: unknown;
    validFrom?: string;
    validUntil?: string;
    now?: Date;
    jws?: string;
    withMandate?: boolean;
  } = {},
) {
  const credential = await makeTestCredential({
    validFrom: options.validFrom,
    validUntil: options.validUntil,
  });
  const withMandate = options.withMandate ?? true;
  const mandate = withMandate
    ? await makeTestMandate({ principal: credential.issuerKeypair, agent: credential.subjectKeypair })
    : undefined;

  const agent = await createAgent({
    credential: options.jws ?? credential.jws,
    mandate: mandate?.jws,
    catalog: createMockCatalog(),
    verifier: createStubVerifier({ status: options.status, failWith: options.failWith }),
    mandateVerifier: mandate === undefined ? undefined : createStubMandateVerifier(),
    signer: credential.subjectKeypair,
    now: options.now,
  });

  return { agent, credential, mandate };
}

function names(agent: { tools: { list(): readonly { name: string }[] } }): string[] {
  return agent.tools.list().map((tool) => tool.name);
}

describe("a credential that verifies", () => {
  it("gives the agent all four tools", async () => {
    const { agent } = await startAgent();

    expect(agent.credential.usable).toBe(true);
    expect(names(agent)).toEqual([
      "list_products",
      "get_product",
      "check_my_credential",
      "create_purchase_intent",
    ]);
  });
});

describe("a credential that does not verify", () => {
  /**
   * The phase's whole claim, as a test. Revocation happens outside the agent
   * and outside the prompt; what the agent notices is that a capability is
   * gone. There is no "you are not allowed" message for an injected
   * instruction to argue with.
   */
  it.each([
    ["revoked", { status: "Revoked" as const }, "CredentialRevoked"],
    ["never anchored", { status: "Unknown" as const }, "CredentialUnknown"],
    ["issuer deactivated", { status: "IssuerInactive" as const }, "IssuerInactive"],
    [
      "expired",
      { validUntil: "2026-02-01T00:00:00.000Z", now: new Date("2026-06-01T00:00:00.000Z") },
      "CredentialExpired",
    ],
    [
      "not yet valid",
      { validFrom: "2027-06-01T00:00:00.000Z", now: new Date("2026-06-01T00:00:00.000Z") },
      "CredentialNotYetValid",
    ],
  ])("%s: create_purchase_intent is absent, not refused", async (_label, options, code) => {
    const { agent } = await startAgent(options);

    expect(agent.credential.usable).toBe(false);
    expect(names(agent)).toEqual(["list_products", "get_product", "check_my_credential"]);
    expect(agent.tools.has("create_purchase_intent")).toBe(false);

    await expect(
      agent.tools.invoke("create_purchase_intent", { product_id: "mate-calabaza", quantity: 1 }),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "UnknownTool"));

    if (agent.credential.usable) expect.unreachable("expected an unusable credential");
    expect(agent.credential.problem.code).toBe(code);
  });

  it("still reads the catalogue: identity is gone, not the whole agent", async () => {
    const { agent } = await startAgent({ status: "Revoked" });

    await expect(agent.tools.invoke("list_products", {})).resolves.toMatchObject({
      product_count: 12,
    });
    await expect(
      agent.tools.invoke("get_product", { product_id: "mate-calabaza" }),
    ).resolves.toBeDefined();
  });

  it("says why, through check_my_credential", async () => {
    const { agent, credential } = await startAgent({ status: "Revoked" });
    const report = (await agent.tools.invoke(
      "check_my_credential",
      {},
    )) as UnusableCredentialReport;

    expect(report.status).toBe("unusable");
    expect(report.can_create_purchase_intent).toBe(false);
    expect(report.problem.code).toBe("CredentialRevoked");
    expect(report.credential_hash).toBe(credential.hash);
  });

  /**
   * If the signature did not verify, everything inside the payload is
   * attacker-chosen. Repeating its scope back would be presenting a forgery as
   * fact. The hash survives because it is computed from the bytes received.
   */
  it("reports nothing from inside a document whose signature failed", async () => {
    const forged = await makeTestCredential();
    const other = await makeTestCredential();
    const [header, payload] = forged.jws.split(".");
    const [, , foreignSignature] = other.jws.split(".");
    const tampered = `${header}.${payload}.${foreignSignature}`;

    const agent = await createAgent({
      credential: tampered,
      catalog: createMockCatalog(),
      verifier: createStubVerifier(),
      signer: forged.subjectKeypair,
    });

    expect(agent.credential.usable).toBe(false);
    const report = (await agent.tools.invoke(
      "check_my_credential",
      {},
    )) as UnusableCredentialReport;

    expect(report.problem.code).toBe("InvalidSignature");
    expect(JSON.stringify(report)).not.toContain("compras-demo");
    expect(JSON.stringify(report)).not.toContain("50.00");
    expect(JSON.stringify(report)).not.toContain("agentpay-pilot");
  });
});

describe("the mandate, T21", () => {
  it("no mandate configured: the agent starts, reads the catalogue, but has no purchase tool", async () => {
    const { agent } = await startAgent({ withMandate: false });

    expect(agent.credential.usable).toBe(true);
    expect(agent.mandate).toBeUndefined();
    expect(names(agent)).toEqual(["list_products", "get_product", "check_my_credential"]);
    await expect(agent.tools.invoke("list_products", {})).resolves.toBeDefined();
  });

  /**
   * The mandate's own equivalent of "a credential that does not verify":
   * revocation, an unknown anchor, and a deactivated principal all withhold
   * the tool the same way an unusable credential already does, even though
   * the credential itself is perfectly fine.
   */
  it.each([
    ["revoked", { status: "Revoked" as const }, "MandateRevoked"],
    ["never anchored", { status: "Unknown" as const }, "MandateUnknown"],
    ["principal deactivated", { status: "IssuerInactive" as const }, "IssuerInactive"],
  ])("mandate %s: create_purchase_intent is absent, credential unaffected", async (_label, mandateOptions, code) => {
    const credential = await makeTestCredential();
    const mandate = await makeTestMandate({
      principal: credential.issuerKeypair,
      agent: credential.subjectKeypair,
    });
    const agent = await createAgent({
      credential: credential.jws,
      mandate: mandate.jws,
      catalog: createMockCatalog(),
      verifier: createStubVerifier(),
      mandateVerifier: createStubMandateVerifier(mandateOptions),
      signer: credential.subjectKeypair,
    });

    expect(agent.credential.usable).toBe(true);
    expect(names(agent)).toEqual(["list_products", "get_product", "check_my_credential"]);

    if (agent.mandate?.usable !== false) expect.unreachable("expected an unusable mandate");
    expect(agent.mandate.problem.code).toBe(code);
  });

  /**
   * `M-4`'s identity check, applied at startup rather than against an intent:
   * a mandate signed for a different agent is a misconfiguration, loud and
   * immediate, the same direction as the existing signer/subject check.
   */
  it("refuses at startup when the mandate empowers a different agent than the credential names", async () => {
    const credential = await makeTestCredential();
    const mandate = await makeTestMandate({
      principal: credential.issuerKeypair,
      // A stranger, not this credential's own subject.
    });

    await expect(
      createAgent({
        credential: credential.jws,
        mandate: mandate.jws,
        catalog: createMockCatalog(),
        verifier: createStubVerifier(),
        mandateVerifier: createStubMandateVerifier(),
        signer: credential.subjectKeypair,
      }),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "MandateAgentMismatch"));
  });

  it("refuses to start with a mandate but no mandateVerifier to check it, as ConfigError", async () => {
    const credential = await makeTestCredential();
    const mandate = await makeTestMandate({
      principal: credential.issuerKeypair,
      agent: credential.subjectKeypair,
    });

    await expect(
      createAgent({
        credential: credential.jws,
        mandate: mandate.jws,
        catalog: createMockCatalog(),
        verifier: createStubVerifier(),
        signer: credential.subjectKeypair,
      }),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "ConfigError"));
  });
});

describe("not knowing counts as unusable", () => {
  /**
   * Fail-closed, the same direction as B-1. An agent that cannot confirm its
   * authorisation must not act on it — but the reason survives in the code, so
   * an outage is still distinguishable from a revocation.
   */
  it("an outage during the registry lookup withholds the tool", async () => {
    const { agent } = await startAgent({
      failWith: new AgentPassError("NetworkError", "rpc timed out"),
    });

    expect(agent.credential.usable).toBe(false);
    expect(agent.tools.has("create_purchase_intent")).toBe(false);
    if (agent.credential.usable) expect.unreachable("expected an unusable credential");
    expect(agent.credential.problem.code).toBe("NetworkError");
  });

  it("wraps a failure that is not an AgentPassError instead of letting it escape", async () => {
    const { agent } = await startAgent({ failWith: new TypeError("undefined is not a function") });

    expect(agent.credential.usable).toBe(false);
    if (agent.credential.usable) expect.unreachable("expected an unusable credential");
    expect(agent.credential.problem).toBeInstanceOf(AgentPassError);
    expect(agent.credential.problem.code).toBe("NetworkError");
    expect(agent.credential.problem.cause).toBeInstanceOf(TypeError);
  });

  it("a malformed credential withholds the tool rather than crashing startup", async () => {
    const { agent } = await startAgent({ jws: "not.a.jws" });

    expect(agent.credential.usable).toBe(false);
    expect(agent.tools.has("create_purchase_intent")).toBe(false);
  });
});

describe("configuration", () => {
  it.each([
    ["no credential", { credential: "" }],
    ["a credential that is not a string", { credential: 42 }],
    ["no verifier", { verifier: undefined }],
    ["no catalogue", { catalog: undefined }],
  ])("refuses to start with %s, as ConfigError", async (_label, override) => {
    const credential = await makeTestCredential();
    const base = {
      credential: credential.jws,
      catalog: createMockCatalog(),
      verifier: createStubVerifier(),
    };

    await expect(
      createAgent({ ...base, ...override } as Parameters<typeof createAgent>[0]),
    ).rejects.toSatisfy((error: unknown) => hasErrorCode(error, "ConfigError"));
  });
});

describe("the credential state is a snapshot", () => {
  it("records when it was checked, so nobody reads it as live", async () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const { agent } = await startAgent({ now });

    expect(agent.credential.checkedAt).toEqual(now);
    const report = (await agent.tools.invoke("check_my_credential", {})) as ActiveCredentialReport;
    expect(report.checked_at).toBe("2026-06-01T12:00:00.000Z");
  });
});
