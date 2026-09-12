/**
 * The bookkeeping behind wallet connect (T34) and the wallet-signed Mandate
 * (T35): cookie parsing, session-id validation, and the challenge message a
 * wallet signs. None of it touches the network, so the parts that actually
 * carry security weight — a forged cookie must not pass as another
 * visitor's `tenant_id` — can be tested directly instead of only through a
 * live browser.
 *
 * Extracted from `server.ts` in T36. The state this module used to hold
 * in-process (the one-time challenge nonces, the short-lived wallet-flow
 * sessions) moved to Postgres in T69 (`G12`) — see `wallet-session-store.ts`.
 * `WALLET_CHALLENGE_TTL_MS`/`PENDING_WALLET_SESSION_TTL_MS` stay here: they
 * describe the flow's timing, not where its state lives.
 */
import { ID_PREFIXES, ULID_LENGTH } from "@agentpey/directory";

const SESSION_COOKIE = "agentpay_sid";

/**
 * Session ids are only ever minted by this server — `randomUUID()` for the
 * classic (platform-signed) path, or a real `@agentpey/directory` tenant id
 * (`ptn_<ULID>:<ULID>`) for the wallet path since T39 — validated on the way
 * back in so a forged cookie cannot be used as another visitor's identity
 * when reading, writing or rehydrating their rows.
 *
 * Two shapes, not one, because the two paths mint genuinely different
 * things: the classic path has no durable identity to key by (`session-rehydration.ts`'s
 * docstring), so a fresh random id per visit is still correct there; the
 * wallet path's id *is* the tenant's own real identifier in the directory,
 * not a derived stand-in the way `walletTenantId`'s `sha256(address)` used
 * to be (superseded — `C-25`/`D4`: that scheme let one wallet's tenant id
 * collide across two different partners, which is exactly what a tenant id
 * must never do).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_ID_RE = new RegExp(
  `^${ID_PREFIXES.partner}_[0-9A-Z]{${ULID_LENGTH}}:[0-9A-Z]{${ULID_LENGTH}}$`,
);

export { SESSION_COOKIE };

export function isValidSessionId(value: string | undefined): value is string {
  return value !== undefined && (UUID_RE.test(value) || TENANT_ID_RE.test(value));
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === "") continue;
    cookies.set(key, decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return cookies;
}

/** The message a wallet is asked to sign to prove it controls its address. */
export function challengeMessage(nonce: string): string {
  return `AgentPey quiere confirmar que controlás esta wallet.\nNonce: ${nonce}`;
}

export const WALLET_CHALLENGE_TTL_MS = 5 * 60_000;
export const PENDING_WALLET_SESSION_TTL_MS = 10 * 60_000;
