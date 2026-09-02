/**
 * The scope check: may this agent buy this, here, with this, for this much?
 *
 * **This function is never given a product.** It takes a venue, an asset, a
 * unit amount and a quantity — four structured facts — and nothing else. That
 * is the phase's defence against prompt injection, and it is a structural one:
 * a sentence in a product description cannot change a decision made by code
 * that was never handed the description. Not "the agent is instructed to ignore
 * it"; not "the text is filtered first". The text is not an input.
 *
 * Every rejection is fail-closed, following B-1: an empty `venues` or `assets`
 * list permits nothing, an unparseable value matches nothing, and a limit that
 * cannot be compared to the price is not a limit that was satisfied.
 *
 * What this does **not** do: `scope.limits.perDay`. Enforcing a daily total
 * needs memory of past spending, which is enforcement rather than a scope
 * check, and belongs to PolicyRail in phase 3. `perTx` is stateless and is the
 * whole of what T12 promises.
 */
import type { Scope } from "@agentpass/core";
import { AgentPassError } from "@agentpass/core";

import { parseAssetId } from "../catalog/ids.js";
import { fromScaledAmount, multiplyAmount, toScaledAmount } from "./amount.js";

/** The action a purchase intent requires to be present in `scope.actions`. */
export const INTENT_CREATE_ACTION = "intent:create";

export type ScopeRejectionCode =
  | "ScopeActionNotAllowed"
  | "ScopeVenueNotAllowed"
  | "ScopeAssetNotAllowed"
  | "ScopeCurrencyMismatch"
  | "ScopeAmountExceeded";

/**
 * Everything the check is allowed to know. Deliberately four scalars: there is
 * no field here that a venue's prose could travel in.
 */
export interface ScopeRequest {
  /** The venue the purchase would happen at, canonical form (B-3). */
  readonly venue: string;
  /** The asset the price is denominated in, canonical form (B-3). */
  readonly asset: string;
  /** The price of one unit, as a decimal string. */
  readonly unitAmount: string;
  readonly quantity: number;
}

export interface ScopeAllowed {
  readonly allowed: true;
  readonly venue: string;
  readonly asset: string;
  readonly unitAmount: string;
  readonly quantity: number;
  /** `unitAmount x quantity`, exact, to seven decimal places. */
  readonly total: string;
  /** The `perTx` limit it was compared against. */
  readonly limit: string;
}

export interface ScopeDenied {
  readonly allowed: false;
  readonly code: ScopeRejectionCode;
  readonly reason: string;
  /** Structured context — what was asked for, and what the credential permits. */
  readonly details: Readonly<Record<string, unknown>>;
}

export type ScopeDecision = ScopeAllowed | ScopeDenied;

function deny(
  code: ScopeRejectionCode,
  reason: string,
  details: Readonly<Record<string, unknown>>,
): ScopeDenied {
  return { allowed: false, code, reason, details };
}

/**
 * Decides whether a signed scope authorises one purchase.
 *
 * Pure: no network, no clock, no I/O. Returns a decision rather than throwing,
 * so both outcomes are equally inspectable; the tool boundary is what turns a
 * denial into a typed error.
 *
 * The checks run broadest first — may it buy at all, may it buy here, may it
 * spend this, is the limit even comparable, is the total within it — so the
 * reason reported is the most fundamental one that failed.
 */
export function checkScope(scope: Scope, request: ScopeRequest): ScopeDecision {
  const { venue, asset, unitAmount, quantity } = request;

  // 1. May this agent create purchase intents at all?
  if (!scope.actions.includes(INTENT_CREATE_ACTION)) {
    return deny(
      "ScopeActionNotAllowed",
      `this credential does not permit "${INTENT_CREATE_ACTION}"`,
      { required: INTENT_CREATE_ACTION, permitted: scope.actions },
    );
  }

  // 2. May it buy at this venue? Byte-for-byte (B-3); empty permits none (B-1).
  if (!scope.venues.includes(venue)) {
    return deny("ScopeVenueNotAllowed", "this credential does not permit this venue", {
      venue,
      permitted: scope.venues,
      // Said out loud because an empty list is the one case where the reason is
      // "nothing is permitted" rather than "this one is not".
      permitsNothing: scope.venues.length === 0,
    });
  }

  // 3. May it spend this asset?
  if (!scope.assets.includes(asset)) {
    return deny("ScopeAssetNotAllowed", "this credential does not permit this asset", {
      asset,
      permitted: scope.assets,
      permitsNothing: scope.assets.length === 0,
    });
  }

  // 4. Is the limit even denominated in what the price is denominated in?
  //    A limit of "50.00 USDC" says nothing about a price in EURC, and an
  //    incomparable limit is not a limit that was satisfied.
  const priceCode = parseAssetId(asset).code;
  if (priceCode !== scope.limits.currency) {
    return deny(
      "ScopeCurrencyMismatch",
      "the spending limit is denominated in a different asset than the price",
      { priceAsset: asset, priceCurrency: priceCode, limitCurrency: scope.limits.currency },
    );
  }

  // 5. Is the total within perTx? Exact integer arithmetic; the boundary is
  //    inclusive, matching how phase 1 treats the expiry boundary on chain.
  const total = multiplyAmount(unitAmount, quantity);
  const limit = toScaledAmount(scope.limits.perTx);

  if (total > limit) {
    return deny("ScopeAmountExceeded", "the total exceeds this credential's per-transaction limit", {
      unitAmount,
      quantity,
      total: fromScaledAmount(total),
      limit: scope.limits.perTx,
      currency: scope.limits.currency,
    });
  }

  return {
    allowed: true,
    venue,
    asset,
    unitAmount,
    quantity,
    total: fromScaledAmount(total),
    limit: scope.limits.perTx,
  };
}

/** Turns a denial into the typed error the tool boundary raises. */
export function scopeError(denied: ScopeDenied): AgentPassError {
  return new AgentPassError(denied.code, denied.reason, { details: denied.details });
}
