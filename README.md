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

## Project documentation

Written in Spanish, because that is the language its readers use. Code,
comments and commit messages are in English.

| | |
|---|---|
| [docs/CONTEXTO.md](docs/CONTEXTO.md) | What AgentPass is, the thesis, what it is **not** |
| [docs/BITACORA.md](docs/BITACORA.md) | Running log: current state, what each milestone delivered |
| [docs/DECISIONES.md](docs/DECISIONES.md) | Every significant decision, with its rationale and the rejected alternative |
| [docs/evidencia/](docs/evidencia/) | Raw command output for each milestone |

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

```bash
pnpm run deploy:registry
```

`bootstrap` generates the admin / issuer / agent keypairs, funds them through
Friendbot, writes `.env.local` (mode 600, gitignored, secrets never printed) and
reports the network's live protocol version. It is idempotent: re-running reuses
every existing keypair, skips accounts that are already funded, and preserves
keys it does not own — including the contract id `deploy:registry` writes.

`deploy:registry` builds, uploads and deploys `agent_registry`, then reads the
contract back through the SDK to confirm what landed on chain is what was meant,
and records it in `deployments/testnet.json` and `.env.local`. Re-running is a
no-op when the deployed contract matches the built wasm. Any drift stops the
script and asks for `--redeploy`, because a redeploy means a **new contract id**
and every credential anchored against the old one would be orphaned.

The live testnet deployment is
`CARC2SIQ3GTL34LVHSTGFRKDNNBYUXCSMGAUGKWGMT6Z2SDY6FXPP2DT`.

`deploy:registry` also registers the pilot's issuer in that contract if it
is not already active, which is what lets the walkthrough below run with no
manual setup beyond the three commands above.

## Build the CLI

```bash
pnpm build
```

## Full walkthrough: issue → verify → revoke → verify fails

Everything above — `pnpm install`, `bootstrap`, `deploy:registry`, `build` —
must have already run. Every command below is run from the repo root.

Pull the demo agent's address out of `.env.local` (written by `bootstrap`):

```bash
AGENT_PUBLIC_KEY=$(grep '^AGENT_PUBLIC_KEY=' .env.local | cut -d'"' -f2)
```

Issue it a credential. [examples/scope.json](examples/scope.json) is a ready-made
scope file — what the agent may do, and its spending limits:

```bash
node packages/cli/dist/bin.js issue --subject "$AGENT_PUBLIC_KEY" --scope examples/scope.json --out credential.jws
```

This prints a summary including the credential's hash, and anchors that hash in
the registry. Verify the credential — this runs all three checks: signature,
validity window, and the registry:

```bash
node packages/cli/dist/bin.js verify credential.jws
```

`status` should be `Active`. Pull the hash out of that same output, so nothing
needs to be copied by hand:

```bash
HASH=$(node packages/cli/dist/bin.js verify credential.jws | grep '^hash' | awk '{print $2}')
```

Confirm it directly against the registry:

```bash
node packages/cli/dist/bin.js status "$HASH"
```

Now revoke it — this is the principal cutting the agent's authorisation from
**outside** the agent:

```bash
node packages/cli/dist/bin.js revoke "$HASH"
```

```bash
node packages/cli/dist/bin.js status "$HASH"
```

That should now print `Revoked`. Verify the exact same file again — the same
JWS, the same valid signature, nothing about the credential itself changed:

```bash
node packages/cli/dist/bin.js verify credential.jws
```

This must fail with `CredentialRevoked: the registry reports this credential as
revoked`, exit code 1. That failure is the whole point of the project: an
agent's authorisation was cut without touching the agent, the credential, or
its signature — only the registry.

## Test

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm run test:integration
```

```bash
cd contracts && cargo test
```

`pnpm test` is the fast suite and needs no keys. `test:integration` runs the
full cycle against live testnet with nothing mocked — issue, verify, revoke,
then confirm the same JWS no longer verifies — so it needs `.env.local` and a
deployed registry.

## Status

T1 through T8 are complete. The pilot's full loop — install, bootstrap, deploy,
build, then issue / verify / revoke / status from the CLI — runs end to end
against live Stellar testnet, following nothing but this README.

Out of scope for this phase, deliberately: enforcing `scope.limits` (signed and
transported, not yet enforced by anything), PolicyRail, Mandato, MandateGate,
MandateVault, any web UI, mainnet, and fiat rails. See
[docs/CONTEXTO.md](docs/CONTEXTO.md).
