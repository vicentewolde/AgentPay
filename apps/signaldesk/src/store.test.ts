import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { signReceipt } from "./receipts.js";
import { createMemoryStore, createPostgresStore, type DeliveryRecord, type SqlClient } from "./store.js";

const MERCHANT = Keypair.random();

function record(deliveryId: string, paymentTx: string): DeliveryRecord {
  return {
    deliveryId,
    productId: "signaldesk:market-brief-xlm-usdc",
    buyer: MERCHANT.publicKey(),
    artifact: `<!doctype html><p>${deliveryId}</p>`,
    artifactHash: "a".repeat(64),
    signedReceipt: signReceipt(
      {
        delivery_id: deliveryId,
        product_id: "signaldesk:market-brief-xlm-usdc",
        buyer: MERCHANT.publicKey(),
        amount: "2500000",
        asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
        pay_to: MERCHANT.publicKey(),
        payment_tx: paymentTx,
        artifact_hash: "a".repeat(64),
        delivered_at: "2026-09-12T12:00:00.000Z",
      },
      MERCHANT.secret(),
    ),
    deliveredAt: new Date("2026-09-12T12:00:00.000Z"),
  };
}

describe("the delivery ledger", () => {
  /** Acceptance case 8, from the merchant's side: one settled payment, one delivery. */
  it("delivers once per settled payment, however many times it is asked", async () => {
    const store = createMemoryStore();
    const first = await store.recordDelivery("tx-1", record("delivery-1", "tx-1"));
    const second = await store.recordDelivery("tx-1", record("delivery-2", "tx-1"));

    expect(second.deliveryId).toBe(first.deliveryId);
    expect(await store.findDelivery("delivery-2")).toBeUndefined();
  });

  it("keeps different payments apart", async () => {
    const store = createMemoryStore();
    await store.recordDelivery("tx-1", record("delivery-1", "tx-1"));
    await store.recordDelivery("tx-2", record("delivery-2", "tx-2"));

    expect((await store.findDeliveryByPayment("tx-2"))?.deliveryId).toBe("delivery-2");
  });
});

describe("credits", () => {
  it("accumulates a balance per account", async () => {
    const store = createMemoryStore();
    const account = Keypair.random().publicKey();

    expect(await store.grantCredits(account, 1000)).toBe(1000);
    expect(await store.grantCredits(account, 1000)).toBe(2000);
    expect(await store.readCredits(account)).toBe(2000);
  });

  it("reads zero for an account that never bought anything", async () => {
    expect(await createMemoryStore().readCredits(Keypair.random().publicKey())).toBe(0);
  });

  it("has no operation that moves a balance between accounts", () => {
    // The interface is the enforcement: a transfer would have to be added here
    // before it could exist anywhere, and this is the test that would have to
    // be deleted to do it quietly.
    expect(Object.keys(createMemoryStore()).sort()).toEqual([
      "findDelivery",
      "findDeliveryByPayment",
      "grantCredits",
      "readCredits",
      "recordDelivery",
    ]);
  });
});

describe("the Postgres store", () => {
  /**
   * The insert must not read first and write second: that window is exactly
   * what `C-82` closed on the funding path, and a second artefact for one
   * payment is the same class of bug.
   */
  it("inserts with on-conflict-do-nothing, then reads the row back", async () => {
    const statements: string[] = [];
    const client: SqlClient = {
      async query(text) {
        statements.push(text.replaceAll(/\s+/g, " ").trim());
        if (text.includes("select delivery_id")) {
          return {
            rows: [
              {
                delivery_id: "delivery-1",
                product_id: "signaldesk:market-brief-xlm-usdc",
                buyer: MERCHANT.publicKey(),
                artifact: "<p>x</p>",
                artifact_hash: "a".repeat(64),
                receipt: record("delivery-1", "tx-1").signedReceipt,
                delivered_at: new Date("2026-09-12T12:00:00.000Z"),
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const stored = await createPostgresStore(client).recordDelivery("tx-1", record("delivery-1", "tx-1"));

    expect(statements[0]).toContain("on conflict (payment_tx) do nothing");
    expect(statements[1]).toContain("where payment_tx = $1");
    expect(stored.deliveryId).toBe("delivery-1");
  });

  it("fails typed when the row is neither inserted nor found", async () => {
    const client: SqlClient = { async query() { return { rows: [] }; } };

    await expect(
      createPostgresStore(client).recordDelivery("tx-1", record("delivery-1", "tx-1")),
    ).rejects.toMatchObject({ code: "CommandFailed" });
  });

  it("grants credits with an atomic upsert, never a read-then-write", async () => {
    const statements: string[] = [];
    const client: SqlClient = {
      async query(text) {
        statements.push(text.replaceAll(/\s+/g, " ").trim());
        return { rows: [{ balance: "2000" }] };
      },
    };

    expect(await createPostgresStore(client).grantCredits(MERCHANT.publicKey(), 1000)).toBe(2000);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("on conflict (account) do update");
  });
});
