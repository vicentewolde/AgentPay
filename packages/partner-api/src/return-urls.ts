/**
 * Where a principal may be sent back to after signing, and why that cannot be
 * a free parameter.
 *
 * **The threat.** A consent session ends with the person being redirected
 * somewhere. If the partner could name any destination, the consent URL
 * becomes an open redirect on AgentPey's own domain — the most credible
 * possible place to host one, because it is exactly where the person was told
 * to go and sign. `PILOTO-F9.md` § 8 row 8 lists it as the last piece of
 * security F9 had not built.
 *
 * **The rule: the return URL's origin must be one the partner registered in
 * advance.** Not a pattern, not a prefix, not a suffix — an origin, compared
 * exactly. That is the same rule `resolveCandidateVenue` applies to a venue
 * (`C-85`), and for the same reason: a prefix comparison on strings is how
 * `https://realops.example.attacker.test` gets accepted as
 * `https://realops.example`.
 *
 * **Validated when the session is created, not when the redirect happens.**
 * Two reasons, and the second matters more. The integrator finds out at the
 * moment they are integrating, with a typed error, instead of a person
 * discovering it mid-signature. And a stored session can then be trusted by
 * whatever renders the redirect, because nothing unvalidated was ever written.
 */
import { AgentPassError } from "@agentpass/core";
import { z } from "zod";

/** A registered origin: scheme + host + port, nothing else. */
export const returnOriginSchema = z
  .string()
  .min(1)
  .max(200)
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "expected an absolute URL" });
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      ctx.addIssue({ code: "custom", message: "expected an http(s) origin" });
      return;
    }
    if (url.origin !== value.replace(/\/+$/, "")) {
      ctx.addIssue({ code: "custom", message: "expected a bare origin, with no path, query or fragment" });
    }
  });

/** A partner's registered return origins. Empty means the partner may not use `return_url` at all. */
export const returnOriginsSchema = z.array(returnOriginSchema).max(10);

/**
 * The origin of a candidate URL, or `undefined` when it is not a URL this
 * would ever redirect to.
 *
 * Refuses anything that is not absolute http(s), and anything carrying
 * credentials — `https://realops.example@attacker.test` has origin
 * `https://attacker.test` and is exactly the shape an allowlist is meant to
 * catch, but only if the credentials are refused rather than parsed away.
 */
function originOf(candidate: string): string | undefined {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return url.origin;
}

/** A return URL longer than this is not a return URL. */
const MAX_RETURN_URL_LENGTH = 2048;

/**
 * Checks a proposed return URL against a partner's registered origins.
 *
 * Fail-closed in both directions a caller could get wrong: a partner with no
 * registered origins cannot use `return_url` at all (an empty list allows
 * nothing, the same reading `B-1` fixed for every other list in this system),
 * and a URL whose origin is not on the list is refused rather than trimmed,
 * normalised or coerced into one that is.
 *
 * @throws AgentPassError `ReturnUrlNotAllowed`
 */
export function requireAllowedReturnUrl(returnUrl: string, allowedOrigins: readonly string[]): string {
  if (returnUrl.length > MAX_RETURN_URL_LENGTH) {
    throw new AgentPassError("ReturnUrlNotAllowed", "the return URL is too long", {
      details: { reason: "too-long", length: returnUrl.length },
    });
  }

  const origin = originOf(returnUrl);
  if (origin === undefined) {
    throw new AgentPassError(
      "ReturnUrlNotAllowed",
      "a return URL must be an absolute http(s) URL with no embedded credentials",
      { details: { reason: "malformed" } },
    );
  }

  if (allowedOrigins.length === 0) {
    throw new AgentPassError(
      "ReturnUrlNotAllowed",
      "this partner has no registered return origins, so it may not supply a return_url",
      { details: { reason: "no-origins-registered" } },
    );
  }

  // Exact origin equality. Deliberately not `startsWith`, not a regex, not a
  // suffix check — each of those is a known way to accept a lookalike host.
  if (!allowedOrigins.includes(origin)) {
    throw new AgentPassError("ReturnUrlNotAllowed", "that return URL's origin is not registered for this partner", {
      // The rejected origin is echoed because the integrator needs it to fix
      // the mistake, and it is their own value, not a secret.
      details: { reason: "origin-not-registered", origin, allowed: [...allowedOrigins] },
    });
  }

  return returnUrl;
}
