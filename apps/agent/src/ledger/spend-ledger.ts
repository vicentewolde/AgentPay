/**
 * The state `B-16` said this project would eventually need: memory of past
 * spending, so a daily total can mean something.
 *
 * `checkScope` (T12) and `checkMandate` (T17) are both pure — no clock, no
 * network, no memory between calls — because that is what makes `perTx`
 * checkable without state. `perDay` cannot be: "has this already spent 200
 * today" is a question about the past, and a pure function has no past to ask
 * about. This is that memory, kept behind a narrow port so the in-memory
 * implementation below can later be swapped for something durable without
 * changing anything that calls it.
 *
 * `subject` is deliberately opaque here: whether a daily budget is tracked per
 * credential, per mandate, or per agent is a composition decision for T19
 * (PolicyRail decides which authority it is enforcing for), not something
 * this port bakes in. It is just the key whoever calls `record`/`spentOn`
 * agrees to use consistently.
 *
 * The day boundary is UTC, always — the same timezone discipline the rest of
 * the project already uses for every `validFrom`/`validUntil`/`issuedAt`
 * (`z.iso.datetime()` accepts only `Z`-suffixed UTC timestamps). A boundary
 * that moved with a server's local timezone would make "today" ambiguous
 * depending on where the process runs.
 */
import { fromScaledAmount, toScaledAmount } from "../scope/amount.js";

export interface SpendLedgerEntry {
  /** Whose daily budget this counts against — opaque to the ledger. */
  readonly subject: string;
  /**
   * De-duplication key. Recording the same `intentId` twice — a retried
   * purchase, a re-delivered message — counts once, not twice.
   */
  readonly intentId: string;
  readonly currency: string;
  /** This entry's amount, as a decimal string. */
  readonly amount: string;
  /** Which UTC day this counts toward. */
  readonly at: Date;
}

export interface SpendLedger {
  /** Total already recorded for `subject`+`currency`, on the UTC day of `at`. */
  spentOn(subject: string, currency: string, at: Date): Promise<string>;
  /**
   * Records `entry`. If `entry.intentId` was already recorded — under any
   * subject or currency — this is a no-op: the first recording stands.
   */
  record(entry: SpendLedgerEntry): Promise<void>;
}

/** `YYYY-MM-DD`, in UTC. The bucket a spend counts toward. */
export function utcDayKey(at: Date): string {
  const iso = at.toISOString();
  return iso.slice(0, iso.indexOf("T"));
}

/**
 * An in-memory {@link SpendLedger}. Loses everything on restart — fine for a
 * pilot and for tests, not for anything that needs to survive one.
 */
export function createInMemorySpendLedger(): SpendLedger {
  // subject -> currency -> day -> scaled total
  const totals = new Map<string, Map<string, Map<string, bigint>>>();
  const seenIntents = new Set<string>();

  return {
    async spentOn(subject: string, currency: string, at: Date): Promise<string> {
      const total = totals.get(subject)?.get(currency)?.get(utcDayKey(at)) ?? 0n;
      return fromScaledAmount(total);
    },

    async record(entry: SpendLedgerEntry): Promise<void> {
      if (seenIntents.has(entry.intentId)) return;

      // Throws InvalidAmount for anything malformed — the same validation
      // every other amount in the project goes through, never a bespoke copy.
      const amount = toScaledAmount(entry.amount);

      const bySubject = totals.get(entry.subject) ?? new Map<string, Map<string, bigint>>();
      totals.set(entry.subject, bySubject);

      const byCurrency = bySubject.get(entry.currency) ?? new Map<string, bigint>();
      bySubject.set(entry.currency, byCurrency);

      const day = utcDayKey(entry.at);
      const current = byCurrency.get(day) ?? 0n;
      byCurrency.set(day, current + amount);

      // Marked only after every step above succeeded: a rejected entry (a bad
      // amount) must remain retryable under the same intentId, not silently
      // and permanently ignored.
      seenIntents.add(entry.intentId);
    },
  };
}
