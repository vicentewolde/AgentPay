/**
 * A small, self-contained `.env.local` reader for the CLI.
 *
 * Deliberately not shared with `scripts/lib/env-file.ts`: that module lives
 * outside the pnpm workspace (see docs/DECISIONES.md I-2 — `contracts/` and the
 * repo-root `scripts/` are not published packages) and resolves only through
 * `tsconfig.scripts.json`'s `paths` hack. `@agentpass/cli` is a real workspace
 * package with its own module resolution; duplicating ~30 lines here is
 * cheaper than bending either module system to share it.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquote(raw: string): string {
  const value = raw.trim();
  const first = value[0];
  const quoted =
    value.length >= 2 && (first === '"' || first === "'") && value[value.length - 1] === first;
  if (!quoted) return value;

  const inner = value.slice(1, -1);
  return first === '"' ? inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\") : inner;
}

function parseEnv(contents: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const match = LINE.exec(line);
    const key = match?.[1];
    const rawValue = match?.[2];
    if (key === undefined || rawValue === undefined) continue;

    entries.set(key, unquote(rawValue));
  }
  return entries;
}

/**
 * `.env.local` layered under `process.env` — an explicit shell export always
 * wins over the file, matching common dotenv convention.
 */
export async function loadCliEnv(cwd: string): Promise<Record<string, string>> {
  let fileContents = "";
  try {
    fileContents = await readFile(resolve(cwd, ".env.local"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const merged: Record<string, string> = {};
  for (const [key, value] of parseEnv(fileContents)) merged[key] = value;
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}
