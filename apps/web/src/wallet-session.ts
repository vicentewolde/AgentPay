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
import { createHash } from "node:crypto";

const SESSION_COOKIE = "agentpay_sid";

/**
 * Session ids are only ever minted by this server (`randomUUID()`, or
 * {@link walletTenantId}) — validated on the way back in so a forged cookie
 * cannot be used as another visitor's `tenantId` when reading or writing
 * their rows in `vault_records`.
 */
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { SESSION_COOKIE };

export function isValidSessionId(value: string | undefined): value is string {
  return value !== undefined && SESSION_ID_RE.test(value);
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
  return `VynGent quiere confirmar que controlás esta wallet.\nNonce: ${nonce}`;
}

/**
 * A stable, cookie-safe id derived from a wallet address, so the same wallet
 * reconnecting always lands on the same MandateVault `tenant_id` (T33)
 * instead of a fresh random one per visit. Not a real UUID v5 (no
 * namespace/version bits) — just `sha256(address)` reshaped to satisfy
 * `SESSION_ID_RE`, since nothing downstream needs RFC 4122 compliance, only
 * a stable, collision-resistant string shaped like the ones `randomUUID()`
 * already produces.
 */
export function walletTenantId(address: string): string {
  const hex = createHash("sha256").update(address, "utf8").digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
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
