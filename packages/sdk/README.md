# @agentpass/sdk

`issue()` / `verify()` / `revoke()` — `core`'s offline crypto plus the registry
lookup that makes authorisation revocable from outside the agent.

```bash
pnpm --filter @agentpass/sdk test
```

```bash
pnpm run test:integration
```

The second runs the full cycle against **live Stellar testnet** with nothing
mocked. It needs `.env.local`, so run `pnpm run bootstrap` and
`pnpm run deploy:registry` first; it registers the issuer itself if the registry
has not seen it.

## Use

```ts
const agentpass = await createAgentPass(configFromEnv());

const { jws, hash } = await agentpass.issue({ credential, issuer: issuerKeypair });
const verified = await agentpass.verify(jws);          // all three checks
await agentpass.revoke({ credentialHash: hash, issuer: issuerKeypair });
await agentpass.verify(jws);                            // throws CredentialRevoked
```

## The three checks, in order

| # | check | where | fails with |
|---|---|---|---|
| 1 | the signature verifies against the key derived from the issuer's DID | offline | `InvalidSignature` |
| 2 | `now` is inside `validFrom` / `validUntil` | offline | `CredentialExpired` · `CredentialNotYetValid` |
| 3a | `status(sha256(jws))` is `Active` | registry | `CredentialRevoked` · `CredentialUnknown` |
| 3b | the issuer is registered and active | registry | `IssuerNotRegistered` · `IssuerInactive` |

Checks 1 and 2 run before any network call, so a forged or expired credential
is rejected without touching the chain.

## The verifier chooses the registry

A credential names the registry holding its status, but **the verifier decides
which registry it trusts**. A credential naming a different one is rejected with
`RegistryMismatch` rather than followed — otherwise an issuer could stand up a
registry they control and answer for their own credentials.

## Two things to know before editing `registry.ts`

- **`Client.from` builds its methods from the interface spec it fetches off the
  chain**, so TypeScript cannot know them. That untyped boundary is confined to
  `registry.ts`, and every value crossing it is parsed with zod first. Assuming
  a shape here has already cost us twice: `get_admin` returns a Rust `Result`
  wrapped in an `Ok` that needs unwrapping, and `status` returns a tagged object
  `{ tag: "Active" }`, not the bare string the CLI prints.
- **A write's source account must be the signer.** Reads simulate from a null
  account, but `anchor`, `revoke` and the admin calls pass the signer's public
  key per call, or the SDK rejects the transaction as built from a default
  account.

## Admin operations

`registerIssuer` and `deactivateIssuer` sit outside the issue/verify/revoke
surface. They live here because this is the only module that talks to the
contract, and without a supported way to register an issuer nobody could run the
cycle from a fresh clone.
