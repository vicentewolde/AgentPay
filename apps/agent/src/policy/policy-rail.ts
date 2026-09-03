/**
 * PolicyRail: the single point where a purchase is authorised, or is not.
 *
 * Everything before this milestone answered one question each and stayed pure:
 * `checkScope` (T12) for what the issuer signed, `checkMandate` (T17) for what
 * the principal consented to, `reconcileTerms` for whether the venue is asking
 * for the purchase that was actually signed, `checkDailyLimit` (T18) for
 * whether today's running total still has room. None of them can enforce
 * anything on its own — a check nobody is obliged to call is a suggestion.
 * This is the thing that is obliged to call all of them, in one place, and
 * that a caller cannot partially satisfy.
 *
 * **This is not a fallback.** The real bazaar's own state machine names a
 * `buyer policy authorization` step between the 402 challenge and settlement,
 * owned by the buyer and described as "independent allowlist, budget and card
 * reconciliation" — `M-11`. That is this function, and it needs no cooperation
 * from the venue to exist. The on-chain smart account (T22) is a second
 * implementation of the same port, not a replacement for this one.
 *
 * The port is `authorise(request)`, so the on-chain rail can sit behind it
 * later without any caller learning it changed. `LocalPolicyRail` is the
 * off-chain implementation, and it holds no state of its own except the
 * ledger (`M-13`).
 */
import type { Scope } from "@agentpass/core";
import { AgentPassError } from "@agentpass/core";
import type { AgentPayMandate } from "@agentpay/mandate";

import type { PurchaseIntent } from "../intent/intent.js";
import { checkDailyLimit, type DailyLimitRejectionCode } from "../ledger/check-daily-limit.js";
import type { SpendLedger } from "../ledger/spend-ledger.js";
import { checkMandate, type MandateRejectionCode } from "../mandate/check-mandate.js";
import { checkScope, type ScopeRejectionCode } from "../scope/scope.js";
import { reconcileTerms, type PaymentTerms, type TermsRejectionCode } from "./terms.js";

export type AuthorisationRejectionCode =
  | TermsRejectionCode
  | ScopeRejectionCode
  | MandateRejectionCode
  | DailyLimitRejectionCode;

/**
 * Everything the rail needs to decide, passed in rather than held (`M-13`).
 *
 * `scope` and `mandate` arrive **already verified** — a `Scope` lifted out of
 * a credential that verified, and a mandate whose signature and window were
 * checked by `@agentpay/mandate`. PolicyRail decides; it does not verify
 * signatures, exactly as `checkScope` knows nothing about cryptography.
 */
export interface AuthorisationRequest {
  readonly intent: PurchaseIntent;
  /** From the verified credential: what its issuer signed. */
  readonly scope: Scope;
  /** The verified mandate: what the principal consented to. */
  readonly mandate: AgentPayMandate;
  /**
   * What the venue is asking to be paid, when there is a challenge to
   * reconcile against. Absent on the mock-catalogue path, where no venue has
   * asked for anything yet — and the granted decision says so in `reconciled`
   * rather than implying a check that did not happen (`M-14`).
   */
  readonly terms?: PaymentTerms;
}

export interface AuthorisationGranted {
  readonly authorised: true;
  /** The intent this authorisation is for, and the key its spend was recorded under. */
  readonly intentId: string;
  /** `unitAmount x quantity`, exact, to seven decimals. */
  readonly total: string;
  readonly currency: string;
  /** Today's total for this agent **including** this purchase. */
  readonly spentToday: string;
  /** Whether payment terms were reconciled, or there were none to reconcile. */
  readonly reconciled: boolean;
}

export interface AuthorisationRefused {
  readonly authorised: false;
  readonly code: AuthorisationRejectionCode;
  readonly reason: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type AuthorisationDecision = AuthorisationGranted | AuthorisationRefused;

/**
 * The port. One method, because there is one question.
 *
 * `authorised` rather than the `allowed` the pure checks use, and deliberately:
 * a granted authorisation has **recorded a spend** (`M-15`). Calling it is not
 * free of consequences the way calling `checkScope` is, and the two words
 * being different is the cheapest possible reminder of that.
 */
export interface PolicyRail {
  authorise(request: AuthorisationRequest): Promise<AuthorisationDecision>;
}

export interface LocalPolicyRailDeps {
  readonly ledger: SpendLedger;
  /**
   * The clock the day boundary is read from. Never `intent.issuedAt`: that
   * field is signed by the agent, over its own document, so an agent that
   * wanted to reset its daily budget would only have to date the intent
   * yesterday (`M-16`).
   */
  readonly now?: () => Date;
}

function refuse(
  code: AuthorisationRejectionCode,
  reason: string,
  details: Readonly<Record<string, unknown>>,
): AuthorisationRefused {
  return { authorised: false, code, reason, details };
}

/**
 * The off-chain PolicyRail.
 *
 * Authorisations are serialised per subject: the read of today's total, the
 * decision, and the recording of the spend happen inside one critical section,
 * closing the TOCTOU that `M-10` deferred to this milestone (`M-15`). The
 * serialisation is a promise chain, so it holds within this process and
 * nowhere else — with a durable ledger behind more than one instance, this has
 * to become a database transaction or a distributed lock, and the chain below
 * helps not at all. That limit is real and is written down rather than
 * discovered.
 */
export function createLocalPolicyRail(deps: LocalPolicyRailDeps): PolicyRail {
  const { ledger } = deps;
  const clock = deps.now ?? (() => new Date());

  /** subject -> the tail of that subject's queue of authorisations. */
  const queues = new Map<string, Promise<unknown>>();

  function serialise<T>(subject: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(subject) ?? Promise.resolve();
    // `catch` before chaining: one authorisation that throws must not poison
    // every later authorisation for the same subject.
    const next = previous.then(work, work);
    queues.set(
      subject,
      next.catch(() => undefined),
    );
    return next;
  }

  return {
    async authorise(request: AuthorisationRequest): Promise<AuthorisationDecision> {
      const { intent, scope, mandate, terms } = request;

      // 1. Which purchase is this? Before whether it is permitted (M-14).
      if (terms !== undefined) {
        const reconciled = reconcileTerms(intent, terms);
        if (!reconciled.allowed) {
          return refuse(reconciled.code, reconciled.reason, reconciled.details);
        }
      }

      // 2. What the issuer signed. Never handed the product (T12): the four
      //    facts come off the intent, which has no field for a venue's prose.
      const scoped = checkScope(scope, {
        venue: intent.venue,
        asset: intent.purchase.asset,
        unitAmount: intent.purchase.unitAmount,
        quantity: intent.purchase.quantity,
      });
      if (!scoped.allowed) return refuse(scoped.code, scoped.reason, scoped.details);

      // 3. What the principal consented to. Both authorities must allow, and
      //    neither can widen what the other permits (M-4).
      const mandated = checkMandate(mandate, intent);
      if (!mandated.allowed) return refuse(mandated.code, mandated.reason, mandated.details);

      // Both checks above proved the limit currency equals the price's, so
      // the two are the same string and either one names today's budget.
      const currency = scope.limits.currency;
      // `scoped.total` and `mandated.total` are the same arithmetic on the same
      // inputs; using one is not a shortcut past the other.
      const total = scoped.total;
      const subject = intent.agent;

      // 4. The stateful half, in one critical section (M-15).
      return serialise(subject, async () => {
        const at = clock();
        const spentToday = await ledger.spentOn(subject, currency, at);

        // Both limits, against the same running total, each with its own code
        // so a caller can tell which authority refused (M-9, M-16).
        const underScope = checkDailyLimit(
          scope.limits.perDay,
          spentToday,
          total,
          "ScopeDailyLimitExceeded",
        );
        if (!underScope.allowed) {
          return refuse(underScope.code, underScope.reason, underScope.details);
        }

        const underMandate = checkDailyLimit(
          mandate.credentialSubject.grant.limits.perDay,
          spentToday,
          total,
          "MandateDailyLimitExceeded",
        );
        if (!underMandate.allowed) {
          return refuse(underMandate.code, underMandate.reason, underMandate.details);
        }

        // Recorded on authorising, not on paying: over-counting a purchase
        // that falls through is fail-closed, under-counting is not (M-15).
        // The ledger de-duplicates by intentId, so authorising the same intent
        // twice counts once.
        await ledger.record({ subject, intentId: intent.intentId, currency, amount: total, at });

        return {
          authorised: true,
          intentId: intent.intentId,
          total,
          currency,
          spentToday: underScope.total,
          reconciled: terms !== undefined,
        };
      });
    },
  };
}

/** Turns a refusal into the typed error the tool boundary raises. */
export function policyRailError(refused: AuthorisationRefused): AgentPassError {
  return new AgentPassError(refused.code, refused.reason, { details: refused.details });
}
