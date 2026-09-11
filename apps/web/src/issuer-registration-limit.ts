/**
 * A cap on how many wallets `ensureWalletIsRegisteredIssuer` can register as
 * issuers, server-wide, per rolling window — `G10`.
 *
 * `registerIssuer` is a real Soroban write, paid for by `ADMIN_SECRET_KEY`,
 * and `ensureWalletIsRegisteredIssuer` calls it for **any** address a
 * visitor's browser claims to control (`/api/wallet/verify` only checks a
 * SEP-0053 signature — proving control of a keypair anyone can generate for
 * free, as many times as they like). Nothing before this module bounded how
 * many of those writes the admin key would pay for in a given stretch of
 * time — `C-63`.
 *
 * **What this is not.** It does not distinguish a legitimate pilot user
 * from an attacker — a sliding-window counter cannot know intent, only
 * count. It is a blast-radius bound, not a replacement for the manual
 * approval `C-15` already considered and deferred: past the cap, admin
 * stops paying for *new* registrations until the window rolls forward, and
 * everything else (wallets already registered, everything not touching the
 * registry) keeps working. A real attacker willing to wait out the window
 * is still bounded to the same rate, forever — it caps throughput, not just
 * one burst.
 */
import { AgentPassError } from "@agentpass/core";

export interface IssuerRegistrationLimiter {
  /**
   * @throws AgentPassError `IssuerRegistrationRateLimited` if the window's
   * cap is already spent. Call only immediately before actually registering
   * — a check that does not reserve a slot would let two concurrent
   * requests both pass and both spend, one slot over the cap.
   */
  consume(): void;
}

export interface IssuerRegistrationLimiterOptions {
  /** How many registrations the admin key will pay for per window. */
  readonly maxPerWindow: number;
  readonly windowMs: number;
  /** Injectable for tests — never for production callers. */
  readonly clock?: () => number;
}

/**
 * 20 per rolling hour is generous for this pilot's real traffic (a handful
 * of demo visitors at a time, each registering once, ever) and small enough
 * that a script hammering `/api/wallet/verify` with fresh keypairs cannot
 * run the admin key through an unbounded number of paid transactions before
 * someone notices — the two numbers this pilot actually has to balance,
 * absent real fraud signals to score requests against.
 */
export const DEFAULT_ISSUER_REGISTRATION_LIMIT = {
  maxPerWindow: 20,
  windowMs: 60 * 60_000,
} as const;

export function createIssuerRegistrationLimiter(
  options: IssuerRegistrationLimiterOptions = DEFAULT_ISSUER_REGISTRATION_LIMIT,
): IssuerRegistrationLimiter {
  const clock = options.clock ?? Date.now;
  // Timestamps of every registration still inside the window, oldest first —
  // a plain array is fine at this cap (tens per hour, not thousands).
  let timestamps: number[] = [];

  return {
    consume() {
      const now = clock();
      const windowStart = now - options.windowMs;
      timestamps = timestamps.filter((at) => at > windowStart);

      if (timestamps.length >= options.maxPerWindow) {
        throw new AgentPassError(
          "IssuerRegistrationRateLimited",
          "the admin key has reached its cap on new issuer registrations for this window",
          {
            details: {
              maxPerWindow: options.maxPerWindow,
              windowMs: options.windowMs,
              retryAfterMs: (timestamps[0] ?? now) + options.windowMs - now,
            },
          },
        );
      }

      timestamps.push(now);
    },
  };
}
