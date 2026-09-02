# AgentPass

Identity credentials for AI agents, issued and verified against **Stellar
testnet**. An agent proves cryptographically who operates it and what it is
authorised to do; that authorisation can be cut from outside the agent, so no
prompt injection can talk its way past it.

Testnet only. No mainnet, no fiat rails, no PSP — deliberately.

## How it fits together

| Piece | What it does |
|---|---|
| `packages/core` | Typed errors, `did:stellar` derivation, VC-JWT sign/verify. **No I/O.** |
| `packages/sdk` | `issue()` / `verify()` / `revoke()` — core plus Soroban RPC. |
| `packages/cli` | The `agentpass` binary. |
| `contracts/agent-registry` | Soroban contract holding credential hashes, their status, and the issuer set. |
| `deployments/testnet.json` | The only artefact shared between the TypeScript and Rust sides. |

A credential is **never** stored on-chain. On-chain there is only the SHA-256 of
the compact JWS, its status, and the issuer registry.

Verifying a credential is exactly three checks:

1. the JWS verifies against the public key derived from the issuer's DID;
2. `now` falls within `validFrom` / `validUntil`;
3. `status(sha256(jws)) == Active` and the issuer is active.

Checks 1 and 2 need no network at all — `did:stellar:testnet:<G-address>`
resolves deterministically, because the Stellar account's public key *is* the
`Ed25519VerificationKey2020`.

## Requirements

- Node ≥ 22 and pnpm 11 (`brew install pnpm`)
- Rust stable with the `wasm32v1-none` target (`brew install rustup && rustup default stable`)
- `stellar` CLI 28 (`brew install stellar-cli`)

Homebrew installs rustup keg-only, so add it to your shell:

```bash
echo 'export PATH="/opt/homebrew/opt/rustup/bin:$PATH"' >> ~/.zshrc
```

## Getting a working testnet environment

```bash
pnpm install
```

```bash
pnpm run bootstrap
```

`bootstrap` generates the admin / issuer / agent keypairs, funds them through
Friendbot, writes `.env.local` (mode 600, gitignored, secrets never printed) and
reports the network's live protocol version. It is idempotent: re-running reuses
every existing keypair, skips accounts that are already funded, and preserves
keys it does not own — including the contract id `deploy:registry` writes.

## Build and test

```bash
pnpm build
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
cd contracts && cargo test
```

## Status

T1 (scaffold) and T2 (network bootstrap) are complete. `did:stellar` (T3),
VC-JWT (T4), the registry contract (T5), deploy (T6), the SDK (T7) and the CLI
(T8) follow in order. Command surfaces that are declared but unwired raise
`AgentPassError` with code `NotImplemented` rather than returning `undefined`.
