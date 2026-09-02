# @agentpass/cli

The `agentpass` binary. After `pnpm build`, run it as:

```bash
node packages/cli/dist/bin.js <command>
```

from the repo root. It reads `.env.local` itself — no need to `export` anything
first, though an exported shell variable always wins over the file.

## Commands

```
agentpass issue --subject <G...> --scope <file.json> [--out <file>] [--valid-days <n>]
agentpass verify <jws|file>
agentpass revoke <hash>
agentpass status <hash>
```

| | |
|---|---|
| `issue` | Signs a credential for `--subject` (the agent's Stellar address) using `ISSUER_SECRET_KEY`, anchors its hash in the registry, and prints the compact JWS. `--scope` points at a JSON file matching `credentialRequestSchema` — see [examples/scope.json](../../examples/scope.json) and [docs/credential-schema.md](../../docs/fase-1-agentpass/credential-schema.md). `--valid-days` defaults to 90. With `--out <file>`, the JWS is written there instead of stdout, and the summary (hash, subject, `transactionHash`) prints to stdout too; without it, the JWS goes to stdout alone — so `agentpass issue ... > credential.jws` captures exactly the credential — and the summary goes to stderr. |
| `verify` | Runs the three checks — signature, validity window, registry — against a JWS given directly or read from a file. Prints `status`, `hash`, `issuer`, `subject`, `agent`, `validUntil` on success. |
| `revoke` | Revokes `<hash>` using `ISSUER_SECRET_KEY`. Only the issuer that anchored a credential may revoke it — the contract enforces this, not the CLI. |
| `status` | Prints the bare registry status word: `Active`, `Revoked`, `Expired`, or `Unknown`. |

Every failure prints `<Code>: <message>` to stderr, plus a JSON `details` block
when there is one, and exits 1. Codes are the same `AgentPassError` codes used
throughout the repo — see [packages/core/src/errors.ts](../core/src/errors.ts).

## Test

```bash
pnpm --filter @agentpass/cli test
```

Offline only: every test exercises argument validation and stops at the point
where a live registry would be needed next, so none of it requires network
access or `.env.local`. The full cycle is exercised by
[@agentpass/sdk's integration test](../sdk/src/agentpass.integration.test.ts)
and by hand in the root README's walkthrough.
