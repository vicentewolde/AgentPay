# AgentPass credential schema

Placeholder. The typed zod schema and its prose documentation land in **T4**,
alongside `packages/core`'s VC-JWT implementation.

Shape already fixed by the architecture decisions:

- W3C VC 2.0 data model (`issuer`, `credentialSubject`, `validFrom`,
  `validUntil`, `credentialStatus`), serialised as a **compact JWS signed with
  EdDSA** — the VC-JWT profile. No JSON-LD processing, no canonicalisation, no
  Data Integrity proofs.
- `credentialStatus.type` is `AgentPassRegistry2026`; its `id` is the hex
  SHA-256 of the compact JWS, which is the key anchored on-chain.
- `credentialSubject.scope.limits` is **declarative in this phase**: signed and
  transported, enforced by nothing yet.
