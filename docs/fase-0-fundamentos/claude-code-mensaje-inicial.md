# Mensaje inicial para Claude Code

Pega el bloque completo de abajo como primer mensaje en un repo vacío. Es autocontenido — no necesita más contexto.

---

## CONTEXTO DEL PROYECTO

Estás construyendo **AgentPass**: emisión y verificación de credenciales de identidad para agentes de IA, sobre Stellar Testnet. Es la primera pieza de una pila de "agentic payments" (después vendrán PolicyRail, Mandato, MandateGate, MandateVault — **no los construyas ni los anticipes ahora**).

La tesis del producto: un agente de IA debe poder probar criptográficamente quién lo opera y qué está autorizado a hacer, y esa autorización debe poder cortarse desde fuera del agente — imposible de saltar por prompt injection.

**Restricciones no negociables:**

- Todo en Stellar **Testnet**. Nada de mainnet, nada de rieles fiat, ningún PSP. Es intencional.
- Piloto de 10 semanas. Prioriza velocidad de iteración sobre arquitectura perfecta.
- Nada de dependencias pesadas de JSON-LD ni de suites criptográficas exóticas.

---

## DECISIONES DE ARQUITECTURA (ya tomadas — impleméntalas, no las re-litigues)

**1. Formato de credencial: perfil VC-JWT.** Data model de W3C VC 2.0 (`issuer`, `credentialSubject`, `validFrom`, `validUntil`, `credentialStatus`) serializado como JWS compacto firmado con EdDSA. Sin JSON-LD contexts, sin canonicalización, sin Data Integrity proofs, sin BBS+.

**2. Método DID: derivable, sin red.** `did:stellar:testnet:<G-address>`. El documento DID se deriva determinísticamente de la dirección Stellar — la llave pública de la cuenta *es* el `Ed25519VerificationKey2020`. Verificar una firma no debe requerir ninguna llamada de red.

**3. La credencial nunca va on-chain.** On-chain van solo: el `SHA-256` del JWS compacto, su estado (activa/revocada/expirada) y el registro de emisores autorizados.

**4. Contrato Soroban `agent_registry`** con esta superficie exacta:

```rust
// instance:   Admin -> Address
// persistent: Issuer(Address)  -> IssuerRecord { active: bool, meta_hash: BytesN<32> }
// persistent: Cred(BytesN<32>) -> CredRecord {
//                issuer: Address, subject: Address,
//                issued_at: u64, expires_at: u64, revoked: bool }

register_issuer(issuer: Address, meta_hash: BytesN<32>)   // admin.require_auth()
deactivate_issuer(issuer: Address)                        // admin.require_auth()
anchor(issuer: Address, cred_hash: BytesN<32>, subject: Address, expires_at: u64)  // issuer.require_auth()
revoke(issuer: Address, cred_hash: BytesN<32>)            // issuer.require_auth()
status(cred_hash: BytesN<32>) -> CredStatus               // Unknown | Active | Revoked | Expired
```

Emite eventos `("agentpass","anchored", issuer, subject)` y `("agentpass","revoked", issuer)`. Extiende el TTL de las entradas persistentes en cada `anchor` — si no lo haces, el estado se archiva y la demo se cae en unas semanas.

**5. Verificar una credencial son exactamente 3 chequeos:** (a) el JWS verifica contra la llave pública derivada del DID del emisor; (b) `now` está dentro de `validFrom`/`validUntil`; (c) `status(sha256(jws)) == Active` y el emisor está activo.

**6. Versiones — resuélvelas, no las asumas.** La major de `soroban-sdk` sigue la versión de protocolo de la red. Usa `cargo add soroban-sdk` para resolver la actual y confirma el protocolo vivo de testnet con `getVersionInfo` por RPC antes de fijarla. Añade el target `wasm32v1-none`. En TypeScript usa `@stellar/stellar-sdk` contra `https://soroban-testnet.stellar.org`.

---

## ESTRUCTURA DEL REPO

```
agentpass/
├── contracts/                  # workspace Cargo (stellar contract init)
│   └── agent-registry/
├── packages/
│   ├── core/                   # tipos, DID derivable, VC-JWT sign/verify
│   ├── sdk/                    # issue() verify() revoke() — core + RPC
│   └── cli/                    # agentpass issue|verify|revoke|status
├── apps/agent/                 # agente mínimo de compra (fase siguiente)
├── deployments/testnet.json
├── docs/credential-schema.md
└── .env.example
```

pnpm workspaces, TypeScript strict, vitest, zod para todos los schemas.

---

## SCHEMA DE LA CREDENCIAL

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "type": ["VerifiableCredential", "AgentPassCredential"],
  "issuer": "did:stellar:testnet:GPRINCIPAL...",
  "validFrom": "2026-09-08T00:00:00Z",
  "validUntil": "2026-12-08T00:00:00Z",
  "credentialSubject": {
    "id": "did:stellar:testnet:GAGENT...",
    "agent": { "name": "compras-demo", "model": "claude-sonnet-4-6", "operator": "..." },
    "principal": "did:stellar:testnet:GPRINCIPAL...",
    "scope": {
      "actions": ["catalog:read", "intent:create"],
      "venues": ["bazaar-aliado:CD..."],
      "assets": ["USDC:GB..."],
      "limits": { "perTx": "50.00", "perDay": "200.00", "currency": "USDC" }
    }
  },
  "credentialStatus": {
    "type": "AgentPassRegistry2026",
    "registry": "<contract id>",
    "id": "<sha256 del JWS compacto, hex>"
  }
}
```

`scope.limits` es **declarativo** en esta fase: se firma y se transporta, pero nada lo hace cumplir todavía. El enforcement llega después. **No construyas enforcement de límites ahora** — solo asegúrate de que el campo viaje firmado.

---

## TAREA INMEDIATA

Implementa en este orden. Después de cada tarea, para y muéstrame el resultado antes de seguir.

**T1 — Scaffold.** Monorepo según la estructura de arriba. `pnpm install && pnpm build && pnpm test` en verde con un test trivial por paquete; `cargo test` en verde en `contracts/`.

**T2 — Bootstrap de red.** Script `pnpm run bootstrap`: genera keypairs de admin, issuer y agent, los fondea con Friendbot en testnet, escribe `.env.local`, reporta la versión de protocolo viva. Debe ser idempotente.

**T3 — `packages/core`, DID derivable.** `stellarAddressToDid(address, network)` y `didToPublicKey(did)`, sin red.
*Aceptación:* test de propiedad sobre 100 keypairs aleatorios — el round-trip devuelve la llave pública cruda original. DIDs malformados lanzan un error tipado, nunca `undefined`.

**T4 — `packages/core`, VC-JWT.** `stellarKeypairToJWK()`, `signCredential()`, `verifyCredential()` (firma + vigencia solamente; el estado on-chain se chequea en `sdk`). Schema tipado con zod, documentado en `docs/credential-schema.md`.
*Aceptación:* credencial firmada verifica; un byte alterado en el payload falla; una expirada falla con un error **distinguible** de "firma inválida".
*Advertencia:* el secreto de Stellar es una semilla Ed25519 de 32 bytes y el JWK necesita `d` (semilla) y `x` (pública) en base64url. Es el punto más probable de falla silenciosa del proyecto. **Escribe el test de round-trip antes que la implementación** y verifica cruzado contra `@noble/curves` con un vector conocido.

**T5 — Contrato `agent_registry`.** La superficie de la decisión 4, con tests unitarios.
*Aceptación:* `cargo test` cubre — anclar y leer `Active`; revocar y leer `Revoked`; anclar sin auth del emisor falla; anclar desde emisor desactivado falla; `expires_at` en el pasado devuelve `Expired`; hash desconocido devuelve `Unknown`.

**T6 — Deploy.** `pnpm run deploy:registry`: compila, sube, despliega, inicializa admin, persiste el contract ID en `.env.local` y en `deployments/testnet.json` junto con la versión de protocolo. Re-ejecutable sin romper nada.

**T7 — `packages/sdk`.** `issue()` (firma + `anchor`), `verify()` (los 3 chequeos), `revoke()`.
*Aceptación:* test de integración contra testnet **real, sin mocks del contrato**: emitir → verificar OK → revocar → verificar falla con `CredentialRevoked`.

**T8 — CLI.** `agentpass issue --subject <G...> --scope <file.json>`, `verify <jws|archivo>`, `revoke <hash>`, `status <hash>`. README con el camino completo desde clonar hasta el ciclo cerrado.
*Aceptación:* alguien que nunca vio el repo puede clonarlo y ejecutar el ciclo completo siguiendo solo el README, sin preguntarme nada.

---

## CRITERIOS TRANSVERSALES

- Errores tipados y distinguibles, nunca `throw new Error("...")` genérico.
- Todo schema pasa por zod en el borde; nada de `any`.
- Sin credenciales hardcodeadas; todo por `.env.local`, con `.env.example` versionado.
- Cada `README` documenta el comando exacto, no una descripción del comando.
- Si una decisión de arriba te parece equivocada al implementarla, **dímelo y espera** — no la cambies unilateralmente.

## FUERA DE ALCANCE (no lo construyas)

PolicyRail, enforcement de límites de gasto, el esquema de Mandato, MandateGate, MandateVault, cualquier UI web, cualquier cosa en mainnet, cualquier integración con rieles fiat, y el agente de compra (viene en el siguiente mensaje).

---

Empieza por T1. Antes de escribir código, dime en 5 líneas cómo vas a estructurar el `package.json` raíz y la relación entre el workspace de pnpm y el workspace de Cargo.
