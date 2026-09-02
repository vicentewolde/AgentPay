# @agentpass/core

Network-free primitives. Everything here imports from
`@stellar/stellar-sdk/base` — the subpath without the Horizon and RPC clients —
so the package physically cannot perform I/O.

```bash
pnpm --filter @agentpass/core test
```

## `did:stellar`

A DID method with no resolution step. A Stellar account address *is* an Ed25519
public key in StrKey form, so the verification key is recovered by decoding the
identifier itself:

```
did:stellar:testnet:GARBTKFQEX325HDOWL3KQT7PDCENLOYMXF7D6B6SB54LDKCHCRYFUY2K
└─┬─┘ └──┬──┘ └──┬──┘ └────────────────────────┬────────────────────────────┘
scheme  method  network            Ed25519 public key, StrKey-encoded
```

| Function | |
|---|---|
| `stellarAddressToDid(address, network)` | `G...` → `StellarDid` |
| `parseStellarDid(did)` | → `{ did, network, address }`, every segment validated |
| `didToPublicKey(did)` | → raw 32-byte `Uint8Array`, the material a JWS verifies against |
| `didToStellarAddress(did)` | → `G...` |
| `stellarDidSchema` / `stellarAddressSchema` | zod validators for the edge |

`StellarDid` is a branded string: only the functions above and the zod schema
can produce one, so an unvalidated string cannot reach a function expecting a
DID.

Nothing is lenient — no trimming, no case folding — because a DID differing by
one byte identifies a different subject. Malformed input raises `InvalidDid`
(bad scheme, method, shape or network) or `InvalidStellarAddress` (the address
segment is a secret seed, a contract id, a muxed address, truncated, or has a
broken checksum). Neither function can return `undefined`.

## Typed errors

Every failure is an `AgentPassError` carrying a `code` from a literal union.
Callers branch on `code`, never on message text:

```ts
if (hasErrorCode(error, "InvalidStellarAddress")) { /* narrowed */ }
```
