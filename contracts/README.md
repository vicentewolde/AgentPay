# contracts

Cargo workspace for `agent_registry`. Independent of the pnpm workspace: no
`package.json` lives here, and the only artefact TypeScript consumes is
`deployments/testnet.json`, written by `pnpm run deploy:registry` (T6).

Run the tests:

```bash
cd contracts && cargo test
```

Build the wasm:

```bash
cd contracts && stellar contract build
```
