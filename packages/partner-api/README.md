# `@agentpey/partner-api`

The frozen contract for `/v1` — F5's T45. Zod schemas for what a partner
sends and receives, the API-key authentication contract, the permission list,
and the exact idempotency semantics. No HTTP server lives here, and no route
is wired: this package exists so the shape of `/v1` is decided and testable
*before* anything calls it, per `PLATAFORMA-PARTNERS.md` § 6.1 — Codex's
tickets (T46-T48, T50) and Claude Code's own middleware ticket (T49) all
build against what this package freezes, not against a moving target.

## What it is not

- **Not a server.** `authorizeRequest` and `resolveIdempotency` are pure,
  framework-agnostic functions that take an injected lookup and return a
  decision or throw a typed `AgentPassError`. Whatever wires `/v1` to Node's
  `http` (T49, `apps/web` or a successor) calls these once per route; the
  decision itself is not re-implemented there.
- **Not a store.** `IdempotencyRecord` is a shape, not a table.
  `consent_sessions` has no persistence anywhere yet — `@agentpey/directory`
  does not know about it. Whichever ticket builds `POST /v1/consent_sessions`
  decides where that state lives.
- **Not `Scope`.** `@agentpass/core` already exports `Scope` for a
  credential/mandate's spending scope (`actions`/`venues`/`assets`/`limits`).
  This package's API-key permissions are `ApiScope` — a deliberately
  different name for a deliberately different thing.

## The contract, in one page

**Auth.** `Authorization: Bearer <secret>`, secret shaped
`ap_test_<24 random bytes, base64url>` — the same string
`@agentpey/directory`'s `issueApiKey` already mints. `authorizeRequest`
authenticates and checks scope in one call; unknown and revoked keys answer
with the same `InvalidApiKey`, on purpose — telling the two apart would
confirm a guessed secret once existed.

**Scopes (`ApiScope`).** `tenants:read`, `tenants:write`, `agents:read`,
`consent_sessions:read`, `consent_sessions:write`, `mandates:read`. Narrower
than `PLATAFORMA-PARTNERS.md` §2.7's proposed list on purpose — only what a
route in F5's table (T45-T50) actually needs. Extend it, additively, the day
a ticket implements the route it would guard.

**Webhooks.** The seven event names from §2.7 (`mandate.activated`,
`mandate.revoked`, `mandate.expiring`, `payment.authorized`,
`payment.refused`, `payment.settled`, `agent.retired`), an envelope
(`id`/`type`/`created_at`/`data`), and a signing scheme —
`AgentPay-Signature: t=<unix ms>,v1=<hmac>`, five-minute replay window.
`data` stays `z.record(unknown)` on purpose: `payment.*` describes a
resource F7 has not designed yet, and typing four of seven events while
leaving three loose is a worse contract than freezing the envelope alone
(`C-48`). `signWebhookPayload`/`verifyWebhookSignature` are pure — no
delivery, no retry, no decision about *when* an event fires.

**Idempotency.** Header `Idempotency-Key`, required on `POST /v1/tenants` and
`POST /v1/consent_sessions`. `resolveIdempotency` looks up
`(partner_id, key)`; a fresh key proceeds, a repeat with the same body
replays the stored response, a repeat with a different body is a caller bug
(`IdempotencyKeyConflict`), and a record past its 24h TTL is treated as if it
never existed.

**Resources.** `tenants` (create + read), `agents` (read-only), `mandates`
(read-only), `consent_sessions` (create + read, schema only — no store).
Every wire shape is snake_case; every internal shape it maps from
(`@agentpey/directory`'s `Tenant`, `AgentInstance`, `MandateRecord`) is
camelCase. The mapping functions (`toTenantResource`, `toAgentResource`,
`toMandateResource`) exist precisely so a partner never sees a field that is
only meaningful internally — `keyIndex`, the raw `document`/`jws` of a
mandate, `updatedAt`.

**Errors.** `{ ok: false, code, message, details }` — the same shape
`apps/web/src/server.ts`'s `errorBody()` already returns on every route.
`errorEnvelopeSchema` freezes it so T46 can generate `/v1`'s OpenAPI error
response from this schema instead of a second, hand-written copy.

## What T45 deliberately left open

- **No route implementation.** `POST`/`GET` handlers, and where
  `consent_sessions` actually persists, are T49's job (or a successor
  ticket) — not named as a separate ticket in F5's table, which is itself a
  gap worth the user's attention before T49 opens.
- **No parsed `grant` on a mandate resource.** `@agentpey/directory` stores a
  mandate's `document` unvalidated; shaping a public `grant` field from it is
  a decision for whoever builds the read route, informed by what a real
  integration asks for — not guessed at here.
- **G10** (automatic issuer registration by wallet, `PLATAFORMA-PARTNERS.md`
  §5) is unaffected by this package; resolving it is part of F5's alcance but
  not of T45.

## Run its tests

```bash
pnpm --filter @agentpey/partner-api run test
```

No database, no network — every test here is pure.
