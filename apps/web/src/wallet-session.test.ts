import { randomUUID } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE,
  challengeMessage,
  createExpiringStore,
  isValidSessionId,
  parseCookies,
  walletTenantId,
} from "./wallet-session.js";

describe("parseCookies", () => {
  it("returns nothing for a request with no cookie header", () => {
    expect(parseCookies(undefined).size).toBe(0);
  });

  it("reads one cookie among several", () => {
    const cookies = parseCookies(`other=1; ${SESSION_COOKIE}=abc; last=2`);
    expect(cookies.get(SESSION_COOKIE)).toBe("abc");
  });

  it("decodes percent-encoded values", () => {
    expect(parseCookies("k=a%20b").get("k")).toBe("a b");
  });

  it("skips malformed pairs instead of throwing", () => {
    const cookies = parseCookies("novalue; =noname; good=yes");
    expect(cookies.get("good")).toBe("yes");
    expect(cookies.has("")).toBe(false);
  });
});

describe("isValidSessionId", () => {
  // This is what stops a forged cookie from being used as somebody else's
  // `tenant_id` when reading or writing their rows in `vault_records`.
  it("accepts an id this server would have minted", () => {
    expect(isValidSessionId(randomUUID())).toBe(true);
    expect(isValidSessionId(walletTenantId(Keypair.random().publicKey()))).toBe(true);
  });

  it("rejects anything that is not shaped like one", () => {
    for (const forged of [
      undefined,
      "",
      "../../etc/passwd",
      "'; drop table vault_records; --",
      "not-a-uuid",
      `${randomUUID()}extra`,
      `${randomUUID()} `,
    ]) {
      expect(isValidSessionId(forged)).toBe(false);
    }
  });
});

describe("walletTenantId", () => {
  // Why a wallet's history survives across visits (T33/T34): the same wallet
  // always lands on the same vault tenant, without a lookup table.
  it("is stable for the same address", () => {
    const address = Keypair.random().publicKey();
    expect(walletTenantId(address)).toBe(walletTenantId(address));
  });

  it("differs for different addresses", () => {
    expect(walletTenantId(Keypair.random().publicKey())).not.toBe(walletTenantId(Keypair.random().publicKey()));
  });

  it("produces something the cookie validator accepts", () => {
    expect(isValidSessionId(walletTenantId(Keypair.random().publicKey()))).toBe(true);
  });
});

describe("challengeMessage", () => {
  it("carries the nonce, so a signature proves which challenge was answered", () => {
    const nonce = randomUUID();
    expect(challengeMessage(nonce)).toContain(nonce);
  });

  it("is the brand the user reads inside their wallet", () => {
    expect(challengeMessage("n")).toContain("VynGent");
  });
});

describe("createExpiringStore", () => {
  function fixedClock(start = 0) {
    let now = start;
    return { now: () => now, advance: (ms: number) => (now += ms) };
  }

  it("reads back what was stored", () => {
    const store = createExpiringStore<string>(1000);
    store.set("k", "v");
    expect(store.peek("k")).toBe("v");
  });

  it("returns undefined for a key never stored", () => {
    expect(createExpiringStore<string>(1000).peek("missing")).toBeUndefined();
  });

  it("peek leaves the entry in place — the wallet flow reads it twice", () => {
    const store = createExpiringStore<string>(1000);
    store.set("k", "v");
    expect(store.peek("k")).toBe("v");
    expect(store.peek("k")).toBe("v");
  });

  // A challenge nonce is spent by being presented at all, so a wrong
  // signature cannot be retried against the same one.
  it("take consumes the entry, so it cannot be replayed", () => {
    const store = createExpiringStore<true>(1000);
    store.set("nonce", true);
    expect(store.take("nonce")).toBe(true);
    expect(store.take("nonce")).toBeUndefined();
    expect(store.peek("nonce")).toBeUndefined();
  });

  it("forgets an entry once its TTL passes", () => {
    const clock = fixedClock();
    const store = createExpiringStore<string>(1000, clock.now);
    store.set("k", "v");
    clock.advance(999);
    expect(store.peek("k")).toBe("v");
    clock.advance(2);
    expect(store.peek("k")).toBeUndefined();
  });

  it("expires on take as well as on peek", () => {
    const clock = fixedClock();
    const store = createExpiringStore<string>(1000, clock.now);
    store.set("k", "v");
    clock.advance(1001);
    expect(store.take("k")).toBeUndefined();
  });

  it("restarts the window when a key is written again", () => {
    const clock = fixedClock();
    const store = createExpiringStore<string>(1000, clock.now);
    store.set("k", "first");
    clock.advance(900);
    store.set("k", "second");
    clock.advance(900);
    expect(store.peek("k")).toBe("second");
  });

  it("delete removes an entry that has not expired", () => {
    const store = createExpiringStore<string>(1000);
    store.set("k", "v");
    store.delete("k");
    expect(store.peek("k")).toBeUndefined();
  });

  it("keeps entries apart from one another", () => {
    const clock = fixedClock();
    const store = createExpiringStore<string>(1000, clock.now);
    store.set("early", "a");
    clock.advance(600);
    store.set("late", "b");
    clock.advance(600);
    expect(store.peek("early")).toBeUndefined();
    expect(store.peek("late")).toBe("b");
  });

  // An abandoned wallet flow must not pin its entry in memory forever.
  it("drops expired entries from its own size, without anyone reading them", () => {
    const clock = fixedClock();
    const store = createExpiringStore<string>(1000, clock.now);
    store.set("a", "1");
    store.set("b", "2");
    expect(store.size).toBe(2);
    clock.advance(1001);
    expect(store.size).toBe(0);
  });
});
