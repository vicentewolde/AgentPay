# `@agentpay/directory`

The durable record of who exists on the platform: partners, their tenants,
the wallets that consent inside those tenants, the agents that act, and the
signed documents that authorise them.

Phase 6, T38. It is the piece the pilot never had — everything `apps/web`
knows about a visitor today lives in a `Map` in memory and is gone on the next
restart, which is why starting a session twice issues two credentials and two
Mandates instead of finding the ones already anchored on chain.

## What it is not

- **It does not derive keys.** It allocates the index and asks the caller to
  derive from it, so the master seed never enters this package's scope. The
  derivation itself is `@agentpay/tenancy`.
- **It does not verify anything.** Storing a signed document and judging one
  are different jobs. `checkMandate`, `checkScope` and the credential
  verifier are untouched by this package and unaware of it.
- **It does not read the environment.** The connection string is a parameter.

## Install and run its tests

```bash
pnpm install
```

The fast suite needs no database and no network:

```bash
pnpm --filter @agentpay/directory run test
```

The live suite needs `DATABASE_URL` in `.env.local` (any Postgres; Supabase in
the pilot). It creates its own partners and deletes every row it wrote:

```bash
pnpm --filter @agentpay/directory run test:integration
```

## Shape of the data

| Table | Holds | Key rule it enforces |
|---|---|---|
| `directory_partners` | CloudOps and friends | Archived, never deleted |
| `directory_api_keys` | One partner's credentials | Only the `sha256` of the secret is stored |
| `directory_tenants` | One partner's relationship with one of its users | `unique (partner_id, external_ref)` |
| `directory_principals` | A wallet, globally | One address is one principal, across every partner |
| `directory_principal_bindings` | That wallet's consent inside one tenant | `unique (tenant_id, principal_id)` |
| `directory_agents` | The technical identity that acts | `key_index` unique, from a sequence, never reused |
| `directory_credentials` | The AgentPass credential, by its anchored hash | `credential_hash` unique |
| `directory_mandates` | The Mandate, verbatim, by its anchored hash | `document` is `json`, never `jsonb` |

Tables are created on first use, the same way `@agentpay/vault` creates its
own — this pilot has no migration runner.

## Three decisions worth knowing before changing anything here

**A tenant id is `<partner id>:<ULID>`.** The partner is inside the id, not
only in a column, because this value is what scopes a tenant's rows in the
vault. Two partners cannot collide whatever their users do with their wallets.
It replaces the `sha256(wallet address)` of T34, under which one wallet used
with two partners landed in one shared vault.

**`key_index` comes from a Postgres sequence.** A sequence hands out a value
without waiting for the transaction that asked for it, so two concurrent
creations can never get the same one. Sequences leave gaps when a transaction
rolls back; a gap is harmless, and a collision would mean two agents deriving
the same Stellar keypair from the master seed.

**The index is per agent, not per tenant.** A tenant may hold several agents
and each needs its own key. This refines what T32 assumed when it wrote
`deriveTenantKeypair(mnemonic, tenantIndex, role)`: what that parameter
indexes is one derived identity, and a tenant owns one or more of them.

**`document` is `json`, not `jsonb`.** `jsonb` normalises key order on write,
and a mandate's hash is computed over its serialised text. Same trap the vault
hit in T33.
