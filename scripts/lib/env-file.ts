import { readFile, writeFile } from "node:fs/promises";

import { AgentPassError } from "@agentpass/core";

/**
 * A deliberately small `.env` reader/writer. The format is ours — one
 * `KEY="value"` per line, `#` comments, no interpolation — so a dependency
 * would buy nothing and would disagree with us at the edges.
 */
export type EnvEntries = ReadonlyMap<string, string>;

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquote(raw: string): string {
  const value = raw.trim();
  const first = value[0];
  const quoted =
    value.length >= 2 && (first === '"' || first === "'") && value[value.length - 1] === first;

  if (!quoted) return value;

  const inner = value.slice(1, -1);
  // Mirror of formatEnvLine, so parse(format(x)) === x for every x.
  return first === '"' ? inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\") : inner;
}

export function parseEnv(contents: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const match = LINE.exec(line);
    if (match === null) continue;

    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;

    entries.set(key, unquote(rawValue));
  }

  return entries;
}

/** Returns an empty map when the file does not exist; anything else throws. */
export async function readEnvFile(path: string): Promise<Map<string, string>> {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw new AgentPassError("ConfigError", `could not read ${path}`, {
      cause: error,
      details: { path },
    });
  }
}

export async function writeEnvFile(path: string, contents: string): Promise<void> {
  try {
    await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    throw new AgentPassError("ConfigError", `could not write ${path}`, {
      cause: error,
      details: { path },
    });
  }
}

/** Every value is quoted: the network passphrase contains spaces and a `;`. */
export function formatEnvLine(key: string, value: string): string {
  return `${key}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Sets one key in an `.env` file's text, leaving every other line — comments,
 * blanks, ordering — exactly as it was. Appends the key if it is absent.
 *
 * Used by deploy:registry, which owns a single key and must not disturb the
 * keypairs bootstrap wrote.
 */
export function upsertEnvValue(contents: string, key: string, value: string): string {
  const line = formatEnvLine(key, value);
  const lines = contents.split("\n");
  const index = lines.findIndex((existing) => LINE.exec(existing)?.[1] === key);

  if (index === -1) {
    const separator = contents === "" || contents.endsWith("\n") ? "" : "\n";
    return `${contents}${separator}${line}\n`;
  }

  lines[index] = line;
  return lines.join("\n");
}
