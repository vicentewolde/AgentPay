/**
 * The check `B-16` deferred: does adding this purchase to what has already
 * been spent today stay within `perDay`?
 *
 * Pure, same discipline as `checkScope` and `checkMandate`: exact integer
 * arithmetic, never `Number` (`B-14`), and no field here through which a
 * venue's prose could travel — `spentToday` and `amount` are both decimal
 * strings the ledger and the intent already produced, never a `Product`.
 *
 * Deliberately generic over which authority is being enforced: `scope.limits`
 * and a mandate's `grant.limits` are the same shape (`M-4`), and `perDay`
 * means the same arithmetic question against either one. The caller passes
 * `code` because *that* is the one thing that has to differ — `M-9`'s reason
 * applies here exactly as it did to `perTx`: a caller needs to know which
 * authority rejected the purchase, and a shared code would hide it.
 *
 * What this deliberately does **not** do: query the ledger, or decide whether
 * `spentOn` and `record` happen atomically. Those are `SpendLedger`'s job and
 * T19's, respectively (`M-10`) — this function only ever sees numbers it was
 * handed.
 */
import { AgentPassError } from "@agentpass/core";

import { fromScaledAmount, toScaledAmount } from "../scope/amount.js";

export type DailyLimitRejectionCode = "ScopeDailyLimitExceeded" | "MandateDailyLimitExceeded";

export interface DailyLimitAllowed {
  readonly allowed: true;
  /** `spentToday + amount`, exact, to seven decimals. */
  readonly total: string;
  readonly limit: string;
}

export interface DailyLimitDenied {
  readonly allowed: false;
  readonly code: DailyLimitRejectionCode;
  readonly reason: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type DailyLimitDecision = DailyLimitAllowed | DailyLimitDenied;

/**
 * Decides whether `spentToday + amount` stays within `perDay`.
 *
 * The boundary is inclusive, matching every other limit in the project
 * (`perTx` in `checkScope`/`checkMandate`, `validUntil`, the contract's
 * `expires_at`): a total that lands exactly on `perDay` is allowed.
 */
export function checkDailyLimit(
  perDay: string,
  spentToday: string,
  amount: string,
  code: DailyLimitRejectionCode,
): DailyLimitDecision {
  const limit = toScaledAmount(perDay);
  const already = toScaledAmount(spentToday);
  const total = already + toScaledAmount(amount);

  if (total > limit) {
    return {
      allowed: false,
      code,
      reason: "the total for today would exceed the per-day limit",
      details: {
        spentToday,
        amount,
        total: fromScaledAmount(total),
        limit: perDay,
      },
    };
  }

  return { allowed: true, total: fromScaledAmount(total), limit: perDay };
}

/** Turns a denial into the typed error the tool boundary raises. */
export function dailyLimitError(denied: DailyLimitDenied): AgentPassError {
  return new AgentPassError(denied.code, denied.reason, { details: denied.details });
}
