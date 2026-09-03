# @agentpay/agent

The minimal purchasing agent — **phase 2** of AgentPay. It consumes AgentPass
rather than extending it: identity, signing and revocation stay in
`@agentpass/core` and `@agentpass/sdk`.

What is built so far: **T9**, the catalogue boundary; **T10**, the tool surface;
**T11**, the startup credential check that decides what is in it; **T12**, the
scope check that decides what it may buy; **T13**, the signed purchase intent
it produces; and **T14**, the one-command demo — `pnpm demo` from the repo
root — that runs the whole thing against real Stellar testnet in about twelve
seconds.

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

## The four tools, and the boundary

| tool | arguments | state |
|---|---|---|
| `list_products` | none | works |
| `get_product` | `product_id` | works |
| `check_my_credential` | none | works |
| `create_purchase_intent` | `product_id`, `quantity` | present only when the credential verified and a signing key is configured; checks scope, re-checks the credential, then signs |

`TOOL_NAMES` is a literal union and `Tool.name` has that type, so a fifth tool
cannot be *named* without editing `tools/tool.ts` — "four tools, no more" is a
type error, not a review checklist item.

**The list is the authorisation boundary.** `invoke` resolves a name against
the tools the set actually holds, so a tool that was left out fails with
`UnknownTool` — absent, not forbidden. A denied permission is a message, and a
message is the kind of thing an injected instruction can try to argue with; a
missing tool has no such surface. T11 uses exactly this: when the credential no
longer verifies, `create_purchase_intent` is simply not in the array.

Every handler runs on parsed input. `invoke` validates `rawInput` through the
tool's own zod schema first and fails with `InvalidToolInput` otherwise, and
that same schema is what becomes the JSON Schema handed to a model — there is
no second copy of the contract to drift.

## Starting the agent

```ts
const agent = await createAgent({ credential: jws, catalog, verifier });
```

`createAgent` runs the three AgentPass checks — signature, validity window,
on-chain status and issuer — once, and the outcome decides the tool set. A
credential that was revoked, expired, never anchored, or whose issuer was
deactivated leaves the agent with three tools; `create_purchase_intent` is not
one of them, and calling it yields `UnknownTool`. The agent is not told it
lacks permission. There is nothing by that name to call.

A failed check does not stop the agent from starting. It reads the catalogue as
before and can say why it cannot buy — which is what a revocation demo needs,
and more useful than a process that dies.

**Not knowing counts as unusable.** An RPC failure leaves the on-chain status
unknown, so the tool is withheld all the same; `problem.code` still tells an
outage (`NetworkError`) apart from a revocation (`CredentialRevoked`).

`check_my_credential` reports everything when the credential is active. When it
is not, it reports the failure code, the message and the hash — and nothing
from inside the document. If the signature did not verify, every field in that
payload was chosen by whoever built it, and repeating it back would present a
forgery as fact. The hash survives because it is computed from the bytes
received rather than read out of them.

## The scope check, and why an injected instruction cannot move it

Before any intent, `checkScope` compares the signed scope against the purchase:
`intent:create` must be in `scope.actions`, the venue in `scope.venues`, the
asset in `scope.assets`, the limit must be denominated in the price's currency,
and `unitAmount x quantity` must not exceed `perTx`. Empty lists permit nothing
(B-1) and matching is byte-for-byte (B-3), so every ambiguity resolves to a
refusal. Failures are typed: `ScopeVenueNotAllowed`, `ScopeAssetNotAllowed`,
`ScopeAmountExceeded` and so on, each carrying what was asked for and what the
credential permits.

```ts
interface ScopeRequest {
  venue: string;
  asset: string;
  unitAmount: string;
  quantity: number;
}
```

**That signature is the defence.** `checkScope` is never handed a product, so a
product's name and description are not inputs to the decision — not filtered,
not weighed, not present. A sentence in a description has nothing to act on.
`src/injection.test.ts` proves it in both directions across nine attack styles:
adding an injection to an allowed product does not make it refused, and removing
one from a refused product does not make it allowed.

Amounts are compared as integers scaled to seven decimals, never as floats: in
floating point `0.1 * 3` is `0.30000000000000004`, so a purchase of exactly the
limit would be refused by a representation error. The limit boundary is
inclusive, matching how the phase-1 contract treats expiry.

`scope.limits.perDay` is deliberately **not** enforced — a daily total needs
memory of past spending, which is PolicyRail's job in phase 3. A test pins that
boundary so half of it cannot arrive unnoticed.

## The signed purchase intent

A successful `create_purchase_intent` returns a compact JWS signed with the
**agent's own** key — a credential is signed by its issuer, an intent by the
agent its credential names as the subject. It moves no money and completes no
purchase; it is a statement that verifies offline, against the key the agent's
DID already contains.

```json
{
  "type": ["AgentPayIntent", "PurchaseIntent"],
  "intentId": "<uuid>",
  "issuedAt": "...", "expiresAt": "...",
  "agent": "did:stellar:testnet:G...",
  "principal": "did:stellar:testnet:G...",
  "credential": { "hash": "<sha256 of the credential's JWS>", "registry": "C..." },
  "venue": "mock-bazaar:C...",
  "purchase": { "productId", "quantity", "unitAmount", "totalAmount", "asset" },
  "authorisation": { "perTx": "50.00", "currency": "USDC" }
}
```

`credential.hash` is what makes this revocable rather than a bearer token:
whoever holds the intent can ask the registry whether that credential is still
active. A month-old intent is still an authentic signature — and the registry
will say the authority behind it is gone.

The shape is meant to survive into phase 3. Checking an intent against a Mandato
needs who, for whom, where, what, how much, in what asset, under what limit and
until when; all eight are here, and nothing is specific to the mock catalogue.

It deliberately carries **no** product name or description: that is the venue's
text (B-5, B-19), a signed document should not put the agent's signature on a
third party's prose, and the description can change in the catalogue afterwards.
The schema is strict, so smuggling one in fails the signature.

`verifyIntent(jws)` checks the signature and the window, offline. It does *not*
ask the registry about the credential — which registry to trust is the caller's
decision, the same rule phase 1 settled with `RegistryMismatch`.

## Two layers of authorisation

| layer | decides | when |
|---|---|---|
| the tool list | which capabilities exist | at startup |
| re-verification | whether the authority is still live | at the instant of signing |

Startup verification decides whether `create_purchase_intent` exists at all
(T11). Immediately before signing, the credential is checked against the
registry again (T13) — because the phase's claim is that authorisation can be
cut from outside, and that is not true for a long-running agent if the cut only
takes effect at the next restart. The scope check runs first, so a purchase the
scope refuses costs no network call.

## Least privilege, by type

The agent takes a `CredentialVerifier` — one method — not the SDK:

```ts
interface CredentialVerifier {
  verify(jws: string, options?: { now?: Date }): Promise<VerifiedOwnCredential>;
}
```

So it cannot issue a credential, cannot revoke one, and cannot register an
issuer: those functions are not reachable, rather than merely not called.
`AgentPass` satisfies the port structurally, checked at compile time.

## Reading a Spanish instruction

`interpretPurchase(instruction, products)` turns a sentence like *"Comprame un
mate de calabaza curado"* into a `productId` and a `quantity` by comparing
words against each product's name — deterministically, not via an LLM call
(B-21). It returns nothing else: no venue, no asset, no amount override. A
misread instruction can pick the wrong product; it cannot grant authority the
scope check would otherwise refuse, and a test proves that with an instruction
carrying a prompt injection.

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
`InvalidVenueId`, `InvalidAssetId`, `InvalidProduct`, `ProductNotFound`,
`UnknownTool`, `InvalidToolInput`, `InvalidAmount`, `ScopeActionNotAllowed`,
`ScopeVenueNotAllowed`, `ScopeAssetNotAllowed`, `ScopeCurrencyMismatch` and
`ScopeAmountExceeded`, `InvalidIntent`, `IntentExpired`, `IntentNotYetValid`,
`SignerMismatch` and `InstructionNotUnderstood`.

## Documentation

Spanish, under [`docs/fase-2-agente-compra/`](../../docs/fase-2-agente-compra/):
[BITACORA.md](../../docs/fase-2-agente-compra/BITACORA.md) for what was built,
[DECISIONES.md](../../docs/fase-2-agente-compra/DECISIONES.md) for why.
