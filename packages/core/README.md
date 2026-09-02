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

## Credentials

A W3C VC 2.0 credential, validated with zod and signed as a compact JWS
(EdDSA). Full schema and rationale: [docs/credential-schema.md](../../docs/credential-schema.md).

```ts
const { jws, hash } = await signCredential(credential, issuerKeypair);
const verified = await verifyCredential(jws);   // signature + validity window
```

`verifyCredential` covers checks 1 and 2 of the three. Check 3 —
`status(hash) == Active` and the issuer still active — needs the registry and
lives in `@agentpass/sdk`.

Two invariants worth knowing before changing anything here:

- **The verification key comes from the payload's `issuer`, never from `kid`.**
  `kid` is attacker-controlled; trusting it would let a forged credential
  nominate the key that verifies it. `kid` is only cross-checked for agreement.
- **The signature is verified before the clock.** Otherwise a forged *and*
  expired credential reports as merely expired, hiding the forgery.

### `stellarKeypairToJWK`

A Stellar secret is a 32-byte Ed25519 **seed**. The JWK carries that seed in `d`
and the public key in `x`, both base64url. Swapping them, or emitting plain
base64, yields keys that sign happily and verify against nothing. The tests are
anchored to RFC 8032 §7.1 TEST 1 and cross-checked against `@noble/curves`.

The base64url-alphabet assertion in `jwk.test.ts` is load-bearing: Node and
`jose` both decode base64 leniently, so it is the only test that catches a
base64/base64url mix-up. Don't delete it.
