/**
 * Pure helpers shared by every `MandateVault` backend (file, Postgres, ...).
 * No I/O here on purpose — each backend owns its own persistence, this file
 * only owns the arithmetic and hashing rules that must stay identical no
 * matter where the records live.
 */
import { createHash } from "node:crypto";

import { AgentPassError, decimalAmountSchema } from "@agentpass/core";

import type { VaultEntry } from "../vault.js";

/** Stellar carries seven decimal places — same scale `apps/agent`'s amount arithmetic uses. */
const AMOUNT_DECIMALS = 7;
const SCALE = 10_000_000n;

export function invalidAmount(value: unknown): AgentPassError {
  return new AgentPassError("InvalidAmount", `"${String(value)}" is not a usable amount`, {
    details: { value: String(value) },
  });
}

/** @throws AgentPassError `InvalidAmount` for anything the credential schema would not accept. */
export function scaleAmount(value: string): bigint {
  const parsed = decimalAmountSchema.safeParse(value);
  if (!parsed.success) throw invalidAmount(value);
  const [whole, fraction = ""] = parsed.data.split(".") as [string, string?];
  const padded = `${fraction}0000000`.slice(0, AMOUNT_DECIMALS);
  return BigInt(whole) * SCALE + BigInt(padded);
}

export function unscaleAmount(scaled: bigint): string {
  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE).toString().padStart(AMOUNT_DECIMALS, "0");
  return `${whole}.${fraction}`;
}

/** `YYYY-MM-DD`, in UTC — the same day boundary `SpendLedger` uses. */
export function utcDayKey(at: Date): string {
  const iso = at.toISOString();
  return iso.slice(0, iso.indexOf("T"));
}

export function computeHash(seq: number, prevHash: string, entry: VaultEntry): string {
  return createHash("sha256").update(JSON.stringify({ seq, prevHash, entry }), "utf8").digest("hex");
}
