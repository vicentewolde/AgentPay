/**
 * The catalogue boundary: everything the agent can learn about what is for sale
 * crosses this interface, and every implementation — the mock in `mock.ts`, the
 * real Soroban bazaar in T15 — answers with exactly this shape.
 *
 * A product's `name` and `description` are **third-party text**. They are
 * validated for shape and never for meaning: nothing downstream may read them
 * as instructions. That is not a stylistic preference — T12 authorises
 * purchases by comparing structured fields (venue, asset, amount) against a
 * signed credential, so a sentence buried in a description has nothing to act
 * on. `parseProduct` is where that boundary is enforced, and it is the only way
 * a row becomes a {@link Product}.
 */
import { AgentPassError, decimalAmountSchema } from "@agentpass/core";
import { z } from "zod";

import { assetIdSchema, type AssetId, type VenueId } from "./ids.js";

/**
 * Opaque to us — the venue names its own products. Deliberately narrow: if the
 * real bazaar uses a shape this rejects, T15 widens it on purpose and loudly,
 * rather than a surprising id slipping through into a signed intent.
 */
export const productIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:@/-]+$/, "expected an id of letters, digits and . _ : @ / -");

/** One line of third-party text. No control characters, newlines included. */
const productNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001F\u007F]+$/, "a product name may not contain control characters");

/** Free-form third-party text. Tabs and newlines allowed, other controls not. */
const productDescriptionSchema = z
  .string()
  .max(2000)
  .regex(
    /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/,
    "a product description may not contain control characters",
  );

export const priceSchema = z.strictObject({
  /** A string end to end, so no float ever rounds a price into or out of a limit. */
  amount: decimalAmountSchema,
  asset: assetIdSchema,
});

export const productSchema = z.strictObject({
  id: productIdSchema,
  /** Third-party text. Displayed, never interpreted. */
  name: productNameSchema,
  /** Third-party text. Displayed, never interpreted. */
  description: productDescriptionSchema,
  price: priceSchema,
  available: z.boolean(),
});

export type Product = z.infer<typeof productSchema>;
export type Price = z.infer<typeof priceSchema>;

/**
 * The only way an untrusted row becomes a {@link Product}.
 *
 * Every adapter funnels its raw answers through here, so a catalogue that
 * replies with a malformed row fails as a typed error at the boundary instead
 * of leaking an unvalidated object into the agent.
 *
 * @throws AgentPassError `InvalidProduct`
 */
export function parseProduct(value: unknown): Product {
  const result = productSchema.safeParse(value);
  if (!result.success) {
    throw new AgentPassError(
      "InvalidProduct",
      "a catalogue entry does not match the product schema",
      {
        cause: result.error,
        details: {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
    );
  }
  return result.data;
}

/**
 * What the agent's `list_products` and `get_product` tools (T10) run on, and
 * the exact surface `BazaarSorobanAdapter` implements in T15. Swapping one for
 * the other must not require touching anything built in T9–T14.
 */
export interface CatalogAdapter {
  /**
   * Which venue this catalogue *is*. T12 checks it against `scope.venues`
   * before any intent is issued, so it lives on the adapter rather than being
   * passed in by a caller that could get it wrong.
   */
  readonly venueId: VenueId;

  /** Every product on offer. Pagination, if the venue needs it, stays inside. */
  listProducts(): Promise<readonly Product[]>;

  /**
   * One product by id.
   *
   * @throws AgentPassError `ProductNotFound` when the venue has no such id.
   */
  getProduct(id: string): Promise<Product>;
}

/** Raised by every adapter for an id the venue does not have. */
export function productNotFound(id: string, venueId: VenueId): AgentPassError {
  return new AgentPassError("ProductNotFound", `the catalogue has no product with id "${id}"`, {
    details: { productId: id, venueId },
  });
}

export type { AssetId, VenueId };
