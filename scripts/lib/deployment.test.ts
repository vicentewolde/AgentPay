import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";

import type { Deployment } from "./deployment.js";
import { EMPTY_DEPLOYMENT, readDeployment, writeDeployment } from "./deployment.js";

const VALID: Deployment = {
  ...EMPTY_DEPLOYMENT,
  protocolVersion: 28,
  agentRegistry: {
    contractId: "CARC2SIQ3GTL34LVHSTGFRKDNNBYUXCSMGAUGKWGMT6Z2SDY6FXPP2DT",
    wasmHash: "b2ff9231f27555c1cfd94e6d480529a5cf316736c969410aad3c57a8953cf151",
    admin: "GARBTKFQEX325HDOWL3KQT7PDCENLOYMXF7D6B6SB54LDKCHCRYFUY2K",
    schemaVersion: 1,
    deployedAt: "2026-09-02T03:15:48.276Z",
    protocolVersion: 28,
  },
};

async function tempFile(contents?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentpass-deployment-"));
  const path = join(dir, "testnet.json");
  if (contents !== undefined) await writeFile(path, contents, "utf8");
  return path;
}

describe("readDeployment", () => {
  it("treats a missing file as an empty deployment, not a failure", async () => {
    await expect(readDeployment(await tempFile())).resolves.toEqual(EMPTY_DEPLOYMENT);
  });

  it("round-trips a written record", async () => {
    const path = await tempFile();
    await writeDeployment(path, VALID);

    await expect(readDeployment(path)).resolves.toEqual(VALID);
  });

  it("rejects invalid JSON with ConfigError", async () => {
    const path = await tempFile("{ not json");

    await expect(readDeployment(path)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "ConfigError"),
    );
  });

  it("rejects a record whose contract id is not a contract id", async () => {
    const path = await tempFile(
      JSON.stringify({
        ...VALID,
        agentRegistry: { ...VALID.agentRegistry, contractId: VALID.agentRegistry?.admin },
      }),
    );

    await expect(readDeployment(path)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "ConfigError"),
    );
  });

  it("rejects a wasm hash that is not 64 hex characters", async () => {
    const path = await tempFile(
      JSON.stringify({ ...VALID, agentRegistry: { ...VALID.agentRegistry, wasmHash: "abc" } }),
    );

    await expect(readDeployment(path)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "ConfigError"),
    );
  });

  it("rejects unknown fields, so a typo cannot silently survive a round trip", async () => {
    const path = await tempFile(JSON.stringify({ ...VALID, contractID: "typo" }));

    await expect(readDeployment(path)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "ConfigError"),
    );
  });
});

describe("writeDeployment", () => {
  it("refuses to write a malformed record rather than corrupting the shared artefact", async () => {
    const path = await tempFile();
    const broken = { ...VALID, agentRegistry: { ...VALID.agentRegistry, schemaVersion: -1 } };

    await expect(writeDeployment(path, broken as Deployment)).rejects.toSatisfy((error: unknown) =>
      hasErrorCode(error, "ConfigError"),
    );
  });
});
