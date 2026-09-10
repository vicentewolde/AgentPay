/**
 * The directory's tables, created on first use — same self-initialising
 * approach `createPostgresMandateVault` already uses (T33), and for the same
 * reason: this pilot has no migration runner, and adding one to hold four
 * `create table if not exists` statements would be more machinery than the
 * problem has.
 *
 * Two things here are deliberate and would be wrong if copied blindly into a
 * project that did not share this one's constraints:
 *
 * - **`key_index` comes from a Postgres sequence, not from `max(key_index)+1`.**
 *   A sequence hands out a value without waiting for the transaction that
 *   asked for it, so two concurrent tenant creations can never receive the
 *   same index — which is the failure that matters, because two agents on one
 *   index means two tenants deriving the same Stellar keypair from the master
 *   seed. Sequences leave gaps when a transaction rolls back; a gap is
 *   harmless (the requirement is "never reused", not "no holes"), and a
 *   collision is not.
 * - **`document` is `json`, not `jsonb`.** Exactly the trap `C-5` documents
 *   for the vault: `jsonb` normalises key order on write, and a mandate's
 *   hash is computed over its serialised text, so a `jsonb` round trip would
 *   silently produce a document whose hash no longer matches what was signed
 *   and anchored.
 */

/** Bumped when the layout changes incompatibly. Mirrors the contracts' own convention. */
export const DIRECTORY_SCHEMA_VERSION = 1;

export const DIRECTORY_SCHEMA_SQL: readonly string[] = [
  `create sequence if not exists directory_key_index_seq as bigint start with 0 minvalue 0`,

  `create table if not exists directory_partners (
     id         text        primary key,
     name       text        not null,
     status     text        not null,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   )`,

  `create table if not exists directory_api_keys (
     id         text        primary key,
     partner_id text        not null references directory_partners(id),
     name       text        not null,
     key_hash   text        not null unique,
     scopes     text[]      not null,
     created_at timestamptz not null default now(),
     revoked_at timestamptz
   )`,

  `create index if not exists directory_api_keys_partner_idx on directory_api_keys (partner_id)`,

  // The unique constraint is the whole point of the table: one partner cannot
  // have two tenants for the same user, and two partners naming the same user
  // do not collide, because the partner is part of the key.
  `create table if not exists directory_tenants (
     id           text        primary key,
     partner_id   text        not null references directory_partners(id),
     external_ref text        not null,
     label        text,
     status       text        not null,
     created_at   timestamptz not null default now(),
     updated_at   timestamptz not null default now(),
     unique (partner_id, external_ref)
   )`,

  `create table if not exists directory_principals (
     id         text        primary key,
     address    text        not null unique,
     did        text        not null unique,
     created_at timestamptz not null default now()
   )`,

  // One binding per (tenant, principal): re-proving control of the same
  // wallet in the same tenant updates the proof, it does not add a row.
  `create table if not exists directory_principal_bindings (
     id              text        primary key,
     tenant_id       text        not null references directory_tenants(id),
     principal_id    text        not null references directory_principals(id),
     proof_nonce     text        not null,
     proof_signature text        not null,
     bound_at        timestamptz not null default now(),
     revoked_at      timestamptz,
     unique (tenant_id, principal_id)
   )`,

  `create table if not exists directory_agents (
     id            text        primary key,
     tenant_id     text        not null references directory_tenants(id),
     key_index     bigint      not null unique,
     address       text        not null unique,
     did           text        not null unique,
     label         text,
     status        text        not null,
     onchain_state text        not null,
     created_at    timestamptz not null default now(),
     updated_at    timestamptz not null default now()
   )`,

  `create index if not exists directory_agents_tenant_idx on directory_agents (tenant_id)`,

  `create table if not exists directory_credentials (
     id              text        primary key,
     agent_id        text        not null references directory_agents(id),
     credential_hash text        not null unique,
     issuer_did      text        not null,
     principal_did   text        not null,
     jws             text        not null,
     valid_from      timestamptz not null,
     valid_until     timestamptz not null,
     anchor_tx       text        not null,
     revoked_at      timestamptz,
     created_at      timestamptz not null default now()
   )`,

  `create index if not exists directory_credentials_agent_idx on directory_credentials (agent_id)`,

  `create table if not exists directory_mandates (
     id             text        primary key,
     tenant_id      text        not null references directory_tenants(id),
     agent_id       text        not null references directory_agents(id),
     principal_id   text        not null references directory_principals(id),
     mandate_hash   text        not null unique,
     signature_kind text        not null,
     document       json        not null,
     signature      text,
     jws            text,
     valid_from     timestamptz not null,
     valid_until    timestamptz not null,
     anchor_tx      text        not null,
     supersedes_id  text        references directory_mandates(id),
     revoked_at     timestamptz,
     revoke_tx      text,
     created_at     timestamptz not null default now()
   )`,

  `create index if not exists directory_mandates_tenant_idx on directory_mandates (tenant_id)`,
];
