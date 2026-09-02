# @agentpay/agent

The minimal purchasing agent — **phase 2** of AgentPay. It consumes AgentPass
rather than extending it: identity, signing and revocation stay in
`@agentpass/core` and `@agentpass/sdk`.

What is built so far: **T9**, the catalogue boundary.

## The catalogue

Everything the agent can learn about what is for sale crosses one interface:

```ts
interface CatalogAdapter {
  readonly venueId: VenueId;
  listProducts(): Promise<readonly Product[]>;
  getProduct(id: string): Promise<Product>;   // throws ProductNotFound
}
```

`createMockCatalog()` implements it over twelve in-memory products and touches
no network. `BazaarSorobanAdapter` (T15) will implement the same interface
against the ambassador's real bazaar; swapping one for the other must not
require touching anything built in T10–T14.

## Identifiers

Two strings decide, in T12, whether a purchase is authorised — they are matched
against the `scope` of a signed credential, **byte for byte**. No trimming, no
case folding, no normalisation, for the same reason `did.ts` applies that rule
to DIDs: a string differing by one byte names a different thing.

| | shape | example |
|---|---|---|
| `VenueId` | `<slug>:<contract id>` | `mock-bazaar:CCL57L4Z…TM7F` |
| `AssetId` | `<CODE>:<issuer>` | `USDC:GBBD47IF…FLA5` |

A slug is lowercase letters, digits and single hyphens, at most 40 characters.
An asset code is 1–12 alphanumerics, case-sensitive as Stellar treats it; its
issuer may be a classic account (`G…`) or a token contract (`C…`).

## Third-party text is data

A product's `name` and `description` come from the venue. `parseProduct` — the
only way a row becomes a `Product` — validates their **shape** and never their
meaning: length caps and no control characters, nothing rewritten.

Two of the twelve mock products carry a prompt injection in their description,
and they live in the default catalogue rather than in a test fixture. Phase 2's
central risk is a refusal that depends on the agent *choosing* to disobey text
embedded in data instead of coming out of a structural check, so the adversarial
rows sit on the path the demo actually walks.

## Commands

```bash
pnpm --filter @agentpay/agent run test
```

```bash
pnpm typecheck
```

Neither touches the network.

## Errors

Every failure is an `AgentPassError` with a `code`, from the same union in
`packages/core/src/errors.ts` — no parallel hierarchy. This package added
`InvalidVenueId`, `InvalidAssetId`, `InvalidProduct` and `ProductNotFound`.

## Documentation

Spanish, under [`docs/fase-2-agente-compra/`](../../docs/fase-2-agente-compra/):
[BITACORA.md](../../docs/fase-2-agente-compra/BITACORA.md) for what was built,
[DECISIONES.md](../../docs/fase-2-agente-compra/DECISIONES.md) for why.
