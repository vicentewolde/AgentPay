/**
 * The bookkeeping behind wallet connect (T34) and the wallet-signed Mandate
 * (T35): cookies, the one-time challenge nonces, and the short-lived state a
 * session parks between the three requests a wallet signature needs.
 *
 * Extracted from `server.ts` in T36. None of it touches the network, so the
 * parts that actually carry security weight — a forged cookie must not pass
 * as another visitor's `tenant_id`, a nonce must not survive being used, a
 * half-finished wallet session must not outlive its window — can be tested
 * directly instead of only through a live browser.
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

export interface ExpiringStore<T> {
  set(key: string, value: T): void;
  /** Reads without consuming. `undefined` once expired, same as absent. */
  peek(key: string): T | undefined;
  /** Reads and consumes, so the entry cannot be replayed. */
  take(key: string): T | undefined;
  delete(key: string): void;
  /** Live entries only — expired ones are dropped as they are found. */
  readonly size: number;
}

/**
 * A map whose entries stop existing after `ttlMs`.
 *
 * One store replaces what used to be two parallel maps for the pending wallet
 * sessions (the value in one, its expiry in the other), which had to be kept
 * in step by hand at every call site. Expiry is checked on read rather than
 * on a timer: there is no background work to leak if the process is busy, and
 * a stale entry is unreachable from the moment it expires whether or not
 * anything has swept it yet.
 *
 * `clock` is injectable so the TTL can be tested without waiting for it.
 */
export function createExpiringStore<T>(ttlMs: number, clock: () => number = Date.now): ExpiringStore<T> {
  const entries = new Map<string, { readonly value: T; readonly expiresAt: number }>();

  function live(key: string): { readonly value: T; readonly expiresAt: number } | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (clock() > entry.expiresAt) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    set(key, value) {
      entries.set(key, { value, expiresAt: clock() + ttlMs });
    },
    peek(key) {
      return live(key)?.value;
    },
    take(key) {
      const entry = live(key);
      entries.delete(key);
      return entry?.value;
    },
    delete(key) {
      entries.delete(key);
    },
    get size() {
      for (const key of [...entries.keys()]) live(key);
      return entries.size;
    },
  };
}
