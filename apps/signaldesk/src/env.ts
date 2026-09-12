/**
 * Reading SignalDesk's own configuration.
 *
 * Its own copy, not the repo's `scripts/lib/env-file.ts`, for the same reason
 * it has its own keys: the merchant is not part of AgentPey and does not
 * import from it. The format it has to read is the same, though — this repo
 * writes `KEY="value"` — and a reader that ignored the quotes would hand a
 * 58-character "secret seed" to `Keypair.fromSecret`, which is exactly how
 * this was found.
 */
import { readFile } from "node:fs/promises";

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

function unquote(raw: string): string {
  const first = raw[0];
  const quoted = raw.length >= 2 && (first === '"' || first === "'") && raw.at(-1) === first;
  if (!quoted) return raw;
  const inner = raw.slice(1, -1);
  return first === '"' ? inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\") : inner;
}

export function parseEnv(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = LINE.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    values.set(match[1], unquote(match[2]));
  }
  return values;
}

/**
 * `.env.local` if it is there, overlaid by the real environment — so a
 * deployed process needs no file, and a local one needs no exported variables.
 */
export async function readEnv(path: string): Promise<Map<string, string>> {
  let values: Map<string, string>;
  try {
    values = parseEnv(await readFile(path, "utf8"));
  } catch {
    values = new Map();
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value !== "") values.set(key, value);
  }
  return values;
}
