/**
 * The one field a partner fills in freely, and therefore the one field that
 * will contain an email address unless something refuses it.
 *
 * `external_ref` is how CloudOps says "this tenant is my user `usr_123`".
 * AgentPey never interprets it, never resolves it, and never needs to: it is
 * an opaque key, scoped to one partner. The requirement it exists to satisfy
 * is that a partner can integrate **without sending personal data**
 * (`PLATAFORMA-PARTNERS.md` §2.4).
 *
 * **What this check is, stated honestly.** It catches the honest mistake —
 * the integrator who wires up `user.email` because it was the handy unique
 * string — and it does not stop a partner who is determined to send personal
 * data anyway, because no syntactic check can. That is the right trade: the
 * mistake is common and the malice is not, and refusing the common mistake
 * at the boundary is worth far more than a check that pretends to be a
 * guarantee. The contract with the partner is what carries the rest.
 */
import { AgentPassError } from "@agentpass/core";

/** Long enough for a UUID, a hash, or a prefixed internal id; not for prose. */
const MAX_LENGTH = 128;
const MIN_LENGTH = 1;

/**
 * Printable ASCII without whitespace, quotes or angle brackets. An opaque key
 * has no reason to contain any of those, and refusing them keeps this value
 * boring wherever it is later interpolated.
 */
const ALLOWED = /^[A-Za-z0-9._:@+/=-]+$/;

/** Anything with an `@` between two non-empty runs and a dot in the tail. */
const LOOKS_LIKE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A Chilean RUT, in the shapes people actually type: `12345678-9`,
 * `12.345.678-K`, `9876543-2`. Named explicitly because it is the national id
 * of the market this pilot is built for, and because it is short, numeric and
 * exactly the kind of value that looks like a harmless key.
 */
const LOOKS_LIKE_RUT = /^\d{1,3}(?:\.?\d{3}){1,2}-[\dkK]$/;

/**
 * An E.164-ish phone number: an optional `+`, then 8 to 15 digits with
 * optional separators. Deliberately not stricter — a bare 8-to-15-digit run
 * is also a perfectly ordinary opaque id, so this only fires when the shape
 * is unambiguous (a leading `+`, or internal separators).
 */
const LOOKS_LIKE_PHONE = /^\+\d[\d.-]{6,17}$|^\d{1,4}[.-]\d{2,4}[.-]\d{2,6}$/;

function reject(reason: string, externalRef: string, hint: string): never {
  // The value itself is deliberately **not** echoed into `details`: if it is
  // an email, repeating it in an error that will be logged is the very leak
  // this function exists to prevent. Its length and shape are enough to
  // debug with.
  throw new AgentPassError("InvalidExternalRef", reason, {
    details: { length: externalRef.length, hint },
  });
}

/**
 * Validates a partner-supplied external reference, returning it unchanged.
 *
 * Returns the value rather than a boolean so the check cannot be performed
 * and then accidentally not used — the only way to get a validated ref is to
 * hold the return value.
 *
 * @throws AgentPassError `InvalidExternalRef`
 */
export function assertOpaqueExternalRef(externalRef: string): string {
  if (externalRef.length < MIN_LENGTH || externalRef.length > MAX_LENGTH) {
    reject(
      `an external reference must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters`,
      externalRef,
      "use a stable opaque key, e.g. your own user id or a hash of it",
    );
  }
  if (!ALLOWED.test(externalRef)) {
    reject(
      "an external reference may only contain letters, digits and . _ : @ + / = -",
      externalRef,
      "use a stable opaque key, e.g. your own user id or a hash of it",
    );
  }
  if (LOOKS_LIKE_EMAIL.test(externalRef)) {
    reject(
      "an external reference must not be an email address",
      externalRef,
      "send your own user id, or a hash of the email — AgentPey never needs to resolve it",
    );
  }
  if (LOOKS_LIKE_RUT.test(externalRef)) {
    reject(
      "an external reference must not be a national identity number",
      externalRef,
      "send your own user id, or a hash of it — AgentPey never needs to resolve it",
    );
  }
  if (LOOKS_LIKE_PHONE.test(externalRef)) {
    reject(
      "an external reference must not be a phone number",
      externalRef,
      "send your own user id, or a hash of it — AgentPey never needs to resolve it",
    );
  }
  return externalRef;
}
