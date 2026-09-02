# contracts

Cargo workspace for `agent_registry`. Independent of the pnpm workspace: no
`package.json` lives here, and the only artefact TypeScript consumes is
`deployments/testnet.json`, written by `pnpm run deploy:registry` (T6).

```bash
cd contracts && cargo test
```

```bash
cd contracts && stellar contract build
```

## What the contract stores

Credentials never go on-chain. Only the SHA-256 of the compact JWS, its status,
and the issuer set. That is what makes authorisation revocable from outside the
agent: the principal calls `revoke`, and every later verification fails. The
agent cannot prevent it, cannot detect it from its own state, and no prompt
undoes it.

| storage | key | value |
|---|---|---|
| instance | `Admin` | `Address` |
| persistent | `Issuer(Address)` | `IssuerRecord { active, meta_hash }` |
| persistent | `Cred(BytesN<32>)` | `CredRecord { issuer, subject, issued_at, expires_at, revoked }` |

## Surface

| function | auth | |
|---|---|---|
| `__constructor(admin)` | — | runs atomically with deployment, so there is no window without an admin |
| `register_issuer(issuer, meta_hash)` | admin | also re-activates a deactivated issuer |
| `deactivate_issuer(issuer)` | admin | stops new anchors; does **not** retroactively revoke |
| `anchor(issuer, cred_hash, subject, expires_at)` | issuer | issuer must be registered and active |
| `revoke(issuer, cred_hash)` | issuer | only the issuer that anchored it |
| `status(cred_hash)` | — | `Unknown` · `Active` · `Revoked` · `Expired` |
| `get_admin()` · `get_issuer(a)` · `get_credential(h)` | — | reads |

Events carry the topics `("agentpass","anchored", issuer, subject)` and
`("agentpass","revoked", issuer)`, declared with `#[contractevent]` so they
appear in the contract's interface spec and downstream tooling can discover them.

## Decisions worth knowing before editing

- **Re-anchoring an existing hash is refused.** Otherwise an issuer could reset
  a revoked credential to active by anchoring it again.
- **A deactivated issuer may still revoke.** Revocation is a safety operation;
  removing it would be the wrong failure direction.
- **Revocation outranks expiry** — a credential that is both reads `Revoked`.
- **The expiry boundary is inclusive**: at exactly `expires_at` the credential
  is still `Active`, matching the off-chain `validUntil` check in `core`.
- **`expires_at` is not validated against the clock.** Anchoring an
  already-expired credential is legal and simply reads `Expired`.
- **Persistent entries are extended on every write** (threshold 30 days, extend
  to 90). Without this the state is archived and the deployment silently stops
  answering within weeks.

`status` deliberately has no "issuer inactive" variant. The third verification
check is `status == Active` **and** the issuer active, so the SDK reads
`get_issuer` alongside it.
