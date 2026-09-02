/**
 * Exact decimal arithmetic for amounts, in scaled integers.
 *
 * Amounts travel as strings from end to end precisely so that no float ever
 * rounds a limit — the rule the credential schema states and this is the first
 * code that has to honour it while actually computing something. A price of
 * `"0.10"` bought three times is `"0.30"` here, not `0.30000000000000004`, and a
 * total that lands exactly on `perTx` is under it rather than a coin flip.
 *
 * The scale is Stellar's seven decimal places, which is also the most the
 * credential schema allows, so every representable amount converts exactly.
 */
import { AgentPassError, decimalAmountSchema } from "@agentpass/core";

/** Stellar carries seven decimal places. */
export const AMOUNT_DECIMALS = 7;

const SCALE = 10_000_000n;

function invalidAmount(value: unknown, reason: string): AgentPassError {
  return new AgentPassError("InvalidAmount", `"${String(value)}" is not a usable amount`, {
    details: { value: String(value), reason },
  });
}

/**
 * Parses a decimal amount string into scaled integer units.
 *
 * @throws AgentPassError `InvalidAmount` for anything the credential schema
 * would not have accepted — negative, float, over seven decimals, padded.
 */
export function toScaledAmount(value: string): bigint {
  const parsed = decimalAmountSchema.safeParse(value);
  if (!parsed.success) throw invalidAmount(value, "not a non-negative decimal with <= 7 places");

  const [whole, fraction = ""] = parsed.data.split(".") as [string, string?];
  const padded = `${fraction}0000000`.slice(0, AMOUNT_DECIMALS);

  return BigInt(whole) * SCALE + BigInt(padded);
}

/** Renders scaled units back to a decimal string, always with seven places. */
export function fromScaledAmount(scaled: bigint): string {
  if (scaled < 0n) throw invalidAmount(scaled, "negative");

  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE).toString().padStart(AMOUNT_DECIMALS, "0");

  return `${whole}.${fraction}`;
}

/**
 * `unitAmount x quantity`, exactly.
 *
 * `quantity` must be a non-negative safe integer; it is converted to BigInt
 * before multiplying, so a large order cannot silently lose precision the way
 * `Number` multiplication would.
 */
export function multiplyAmount(unitAmount: string, quantity: number): bigint {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw invalidAmount(quantity, "quantity must be a non-negative safe integer");
  }

  return toScaledAmount(unitAmount) * BigInt(quantity);
}
