# `@agentpay/mandate`

The principal's signed consent. Phase 3, milestone T16.

A credential (`@agentpass/core`) says *who this agent is and what its issuer
believes it may do*. A purchase intent (`@agentpay/agent`) says *what this agent
wants to do right now*. A **Mandate** is the third statement, and the one that
was missing: **"I authorise this agent to spend up to this much, at these
venues, in these assets, until this date"** — signed by the principal, and by
nobody else.

An agent cannot write itself one. Signing with any key other than the mandate's
own `issuer` fails with `SignerMismatch` before a document is produced.

## Install

Part of the AgentPay workspace; nothing to install separately.

```bash
pnpm install
```

## Use

```ts
import { Keypair } from "@stellar/stellar-sdk/base";
import { stellarAddressToDid } from "@agentpass/core";
import { createMandate, signMandate, verifyMandate } from "@agentpay/mandate";

const mandate = createMandate({
  principal: stellarAddressToDid(principalKeypair.publicKey(), "testnet"),
  agent: stellarAddressToDid(agentKeypair.publicKey(), "testnet"),
  grant: {
    actions: ["catalog:read", "intent:create"],
    venues: ["mock-bazaar:CCL5…"],
    assets: ["USDC:GBBD…"],
    limits: { perTx: "50.0000000", perDay: "200.0000000", currency: "USDC" },
  },
  registry: "CARC2SIQ3GTL34LVHSTGFRKDNNBYUXCSMGAUGKWGMT6Z2SDY6FXPP2DT",
  validUntil: "2026-12-01T00:00:00.000Z", // required — no default, on purpose
});

const signed = await signMandate(mandate, principalKeypair);
const verified = await verifyMandate(signed.jws);
```

`signed.hash` is `sha256(jws)` — the key the registry answers about, and what
gets anchored so the principal can withdraw consent later.

## What verification does, and does not

`verifyMandate` is **offline, always**. In order: JWS header (`alg`, `typ`) →
peek the `issuer` → cross-check `kid` → **verify the signature** → full schema →
cross-check the signer → validity window. Both window edges are inclusive.

The window is checked last on purpose: a forged *and* expired mandate must
report the forgery, not the expiry.

It does **not** consult the registry — which registry to trust is the caller's
decision — and it does **not** compare the mandate against any intent. That is
`checkMandate` (T17), kept separate so it can stay a pure function.

## Errors

Typed `AgentPassError` with a `code`, never a bare `Error`:

| code | when |
|---|---|
| `InvalidMandate` | malformed JWS, wrong `typ`, off-schema payload, bad request |
| `SignerMismatch` | the signing key is not the mandate's `issuer` |
| `InvalidSignature` | the signature does not verify against the issuer |
| `MandateNotYetValid` | `now` is before `validFrom` |
| `MandateExpired` | `now` is past `validUntil` |

## Test

```bash
pnpm --filter @agentpay/mandate test
```

## Design notes

The decisions behind this package, each with its reason and the alternative that
was rejected, are in [`docs/fase-3-policyrail-mandato/DECISIONES.md`](../../docs/fase-3-policyrail-mandato/DECISIONES.md)
(`M-2` through `M-7`). The technical map is
[`ARQUITECTURA.md`](../../docs/fase-3-policyrail-mandato/ARQUITECTURA.md).
