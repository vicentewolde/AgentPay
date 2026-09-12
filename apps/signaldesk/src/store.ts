/**
 * SignalDesk's own storage: what it delivered, and who holds credits.
 *
 * **Its own tables, not AgentPey's.** The merchant records its sales; the
 * payment platform records its authorisations. They are different facts kept
 * by different parties, and the pilot is only worth anything if that stays
 * true. The tables live behind a `signaldesk_` prefix and this service never
 * reads a row of the directory or the vault.
 *
 * (Honest operational note: in this pilot both services point at the same
 * Postgres instance, because Render gives one. Separate databases is a
 * deployment change, not a code change — nothing here reaches outside the
 * `signaldesk_` prefix.)
 *
 * **A credit balance has no transfer.** There is `grantCredits` and there is
 * reading a balance. There is no operation that moves credits between
 * accounts, and that absence is the design: a transferable credit would be an
 * issuance, which is on the far side of the line this project keeps closed.
 */
import { AgentPassError } from "@agentpass/core";

import type { SignedReceipt } from "./receipts.js";

export interface DeliveryRecord {
  readonly deliveryId: string;
  readonly productId: string;
  readonly buyer: string;
  readonly artifact: string;
  readonly artifactHash: string;
  readonly signedReceipt: SignedReceipt;
  readonly deliveredAt: Date;
}

/** Everything the merchant persists. Narrow on purpose — no reads of anyone else's data. */
export interface SignalDeskStore {
  /**
   * Records one delivery. The payment transaction is the key of record: a
   * settled Stellar transaction can only be delivered against once, so a
   * retried request with the same transaction gets the same delivery back
   * rather than a second artefact.
   */
  recordDelivery(paymentTx: string, record: DeliveryRecord): Promise<DeliveryRecord>;
  findDelivery(deliveryId: string): Promise<DeliveryRecord | undefined>;
  findDeliveryByPayment(paymentTx: string): Promise<DeliveryRecord | undefined>;
  /** Adds to an account's balance and returns the new total. */
  grantCredits(account: string, amount: number): Promise<number>;
  readCredits(account: string): Promise<number>;
}

/** For tests, and for a local run with no database. Loses everything on restart, by design. */
export function createMemoryStore(): SignalDeskStore {
  const byDeliveryId = new Map<string, DeliveryRecord>();
  const byPaymentTx = new Map<string, DeliveryRecord>();
  const credits = new Map<string, number>();

  return {
    async recordDelivery(paymentTx, record) {
      const existing = byPaymentTx.get(paymentTx);
      if (existing !== undefined) return existing;
      byPaymentTx.set(paymentTx, record);
      byDeliveryId.set(record.deliveryId, record);
      return record;
    },
    async findDelivery(deliveryId) {
      return byDeliveryId.get(deliveryId);
    },
    async findDeliveryByPayment(paymentTx) {
      return byPaymentTx.get(paymentTx);
    },
    async grantCredits(account, amount) {
      const total = (credits.get(account) ?? 0) + amount;
      credits.set(account, total);
      return total;
    },
    async readCredits(account) {
      return credits.get(account) ?? 0;
    },
  };
}

export const SIGNALDESK_SCHEMA_SQL: readonly string[] = [
  `create table if not exists signaldesk_deliveries (
     delivery_id   text        primary key,
     payment_tx    text        not null unique,
     product_id    text        not null,
     buyer         text        not null,
     artifact      text        not null,
     artifact_hash text        not null,
     receipt       json        not null,
     delivered_at  timestamptz not null
   )`,

  `create index if not exists signaldesk_deliveries_buyer_idx on signaldesk_deliveries (buyer)`,

  // No `from` column and no transfer statement anywhere: a balance is granted
  // and read, never moved.
  `create table if not exists signaldesk_credits (
     account    text        primary key,
     balance    bigint      not null,
     updated_at timestamptz not null default now()
   )`,
];

/** The minimal `pg` surface this store needs, so nothing here imports a driver type. */
export interface SqlClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

interface DeliveryRow {
  readonly delivery_id: string;
  readonly product_id: string;
  readonly buyer: string;
  readonly artifact: string;
  readonly artifact_hash: string;
  readonly receipt: SignedReceipt;
  readonly delivered_at: Date;
}

function toRecord(row: DeliveryRow): DeliveryRecord {
  return {
    deliveryId: row.delivery_id,
    productId: row.product_id,
    buyer: row.buyer,
    artifact: row.artifact,
    artifactHash: row.artifact_hash,
    signedReceipt: row.receipt,
    deliveredAt: row.delivered_at,
  };
}

/**
 * The durable store.
 *
 * `recordDelivery` inserts with `on conflict (payment_tx) do nothing` and then
 * reads the row back, so two concurrent requests carrying the same settled
 * transaction end with one delivery and both callers holding it. Deciding by
 * reading first and inserting second would leave exactly the window `C-82`
 * closed on the funding path, for exactly the same reason.
 */
export function createPostgresStore(client: SqlClient): SignalDeskStore {
  return {
    async recordDelivery(paymentTx, record) {
      await client.query(
        `insert into signaldesk_deliveries
           (delivery_id, payment_tx, product_id, buyer, artifact, artifact_hash, receipt, delivered_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (payment_tx) do nothing`,
        [
          record.deliveryId,
          paymentTx,
          record.productId,
          record.buyer,
          record.artifact,
          record.artifactHash,
          JSON.stringify(record.signedReceipt),
          record.deliveredAt.toISOString(),
        ],
      );

      const stored = await this.findDeliveryByPayment(paymentTx);
      if (stored === undefined) {
        throw new AgentPassError("CommandFailed", "the delivery was neither inserted nor found", {
          details: { paymentTx },
        });
      }
      return stored;
    },

    async findDelivery(deliveryId) {
      const { rows } = await client.query(
        `select delivery_id, product_id, buyer, artifact, artifact_hash, receipt, delivered_at
           from signaldesk_deliveries where delivery_id = $1`,
        [deliveryId],
      );
      const row = rows[0] as DeliveryRow | undefined;
      return row === undefined ? undefined : toRecord(row);
    },

    async findDeliveryByPayment(paymentTx) {
      const { rows } = await client.query(
        `select delivery_id, product_id, buyer, artifact, artifact_hash, receipt, delivered_at
           from signaldesk_deliveries where payment_tx = $1`,
        [paymentTx],
      );
      const row = rows[0] as DeliveryRow | undefined;
      return row === undefined ? undefined : toRecord(row);
    },

    async grantCredits(account, amount) {
      const { rows } = await client.query(
        `insert into signaldesk_credits (account, balance) values ($1, $2)
         on conflict (account) do update
           set balance = signaldesk_credits.balance + excluded.balance, updated_at = now()
         returning balance`,
        [account, amount],
      );
      return Number((rows[0] as { readonly balance: string | number }).balance);
    },

    async readCredits(account) {
      const { rows } = await client.query(`select balance from signaldesk_credits where account = $1`, [account]);
      const row = rows[0] as { readonly balance: string | number } | undefined;
      return row === undefined ? 0 : Number(row.balance);
    },
  };
}
