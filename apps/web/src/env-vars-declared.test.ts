import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const SERVER_PATH = new URL("./server.ts", import.meta.url);
const RENDER_PATH = new URL("../../../render.yaml", import.meta.url);
const REQUIRED_ENV_CALL =
  /\b(?:requireEnv|requireSecretKey)\(\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\s*,\s*"([A-Z][A-Z0-9_]*)"\s*\)/g;

function requiredServerEnvKeys(serverSource: string): ReadonlySet<string> {
  return new Set(
    [...serverSource.matchAll(REQUIRED_ENV_CALL)].flatMap((match) => (match[1] === undefined ? [] : [match[1]])),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function declaredRenderEnvKeys(renderYaml: string): ReadonlySet<string> {
  const blueprint: unknown = parse(renderYaml);
  if (!isRecord(blueprint) || !Array.isArray(blueprint.services)) return new Set();

  return new Set(
    blueprint.services.flatMap((service) => {
      if (!isRecord(service) || !Array.isArray(service.envVars)) return [];
      return service.envVars.flatMap((envVar) => {
        if (!isRecord(envVar) || typeof envVar.key !== "string") return [];
        return [envVar.key];
      });
    }),
  );
}

describe("Render environment variables", () => {
  it("declares every variable server.ts requires", async () => {
    const [serverSource, renderYaml] = await Promise.all([readFile(SERVER_PATH, "utf8"), readFile(RENDER_PATH, "utf8")]);
    const required = requiredServerEnvKeys(serverSource);
    const declared = declaredRenderEnvKeys(renderYaml);
    const missing = [...required].filter((key) => !declared.has(key));

    expect(required.size, "expected to find requireEnv or requireSecretKey calls in server.ts").toBeGreaterThan(0);
    expect(missing, `render.yaml is missing required environment variables: ${missing.join(", ")}`).toEqual([]);
  });
});
