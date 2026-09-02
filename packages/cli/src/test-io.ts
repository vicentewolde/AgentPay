import type { CliIO } from "./io.js";

/** A `CliIO` that records what was written, for tests. Not exported to consumers. */
export interface FakeIO extends CliIO {
  readonly out: string[];
  readonly err: string[];
}

export function fakeIO(): FakeIO {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
}
