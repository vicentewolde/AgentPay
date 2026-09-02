# Esquema de la credencial AgentPass

Implementado en [`packages/core/src/credential.ts`](../../packages/core/src/credential.ts),
firmado y verificado en [`vc-jwt.ts`](../../packages/core/src/vc-jwt.ts).

Perfil **VC-JWT**: data model W3C VC 2.0 serializado como **JWS compacto firmado
con EdDSA**. Sin JSON-LD processing, sin canonicalización, sin Data Integrity
proofs.

---

## La credencial

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "type": ["VerifiableCredential", "AgentPassCredential"],
  "issuer": "did:stellar:testnet:GCTTRJIY...",
  "validFrom": "2026-09-01T00:00:00Z",
  "validUntil": "2026-12-01T00:00:00Z",
  "credentialSubject": {
    "id": "did:stellar:testnet:GAK6E5E7...",
    "agent": {
      "name": "compras-demo",
      "model": "claude-sonnet-4-6",
      "operator": "agentpass-pilot"
    },
    "principal": "did:stellar:testnet:GCTTRJIY...",
    "scope": {
      "actions": ["catalog:read", "intent:create"],
      "venues": ["bazaar-aliado:CD..."],
      "assets": ["USDC:GB..."],
      "limits": { "perTx": "50.00", "perDay": "200.00", "currency": "USDC" }
    }
  },
  "credentialStatus": {
    "type": "AgentPassRegistry2026",
    "registry": "CBKRUILA..."
  }
}
```

### Validación

| campo | regla |
|---|---|
| `@context` | exactamente `["https://www.w3.org/ns/credentials/v2"]` |
| `type` | exactamente `["VerifiableCredential", "AgentPassCredential"]` |
| `issuer`, `credentialSubject.id`, `credentialSubject.principal` | `did:stellar` válido |
| `validFrom`, `validUntil` | ISO 8601 **con zona horaria** — `2026-09-01T00:00:00` sin `Z` se rechaza |
| `scope.actions` | al menos un elemento |
| `limits.perTx`, `limits.perDay` | decimal no negativo, máximo 7 decimales, **como string** |
| `credentialStatus.registry` | contract id de Soroban (`C...`) |

Todos los objetos son **estrictos**: un campo desconocido hace fallar la
validación. Es la decisión correcta para un piloto con una sola implementación —
caza typos de inmediato. Si en el futuro entran verificadores de terceros que
deban tolerar campos nuevos, hay que relajarlo deliberadamente.

Los montos viajan como **string**, nunca como número: ningún float redondea un
límite en el camino.

---

## Por qué `credentialStatus` no lleva el hash

El brief especificaba un tercer campo:

```json
"credentialStatus": { "type": "...", "registry": "...", "id": "<sha256 del JWS compacto>" }
```

**Ese campo no se puede implementar**, y además no debería existir. Dos razones:

**1. Es circular.** El valor anclado on-chain es `sha256(JWS compacto)`. El JWS
compacto se produce firmando el payload. Si el payload contiene el hash del JWS,
entonces firmar cambia el JWS, lo que cambia su hash, lo que cambia el payload,
lo que cambia la firma. No converge. No hay orden de operaciones que lo resuelva.

**2. Aunque se pudiera, no habría que confiar en él.** Un hash autodeclarado lo
elige quien construye la credencial. Un atacante con una credencial revocada
apuntaría ese campo al hash de una credencial ajena que siga activa, y el
verificador consultaría el registro por el hash equivocado y obtendría `Active`.

Un verificador **siempre** debe hashear el JWS que efectivamente recibió:

```ts
const { hash } = await verifyCredential(jws);   // sha256(jws), hex
// El sdk (T7) consulta status(hash) contra el registro.
```

`credentialStatus` conserva `type` y `registry` porque sí aportan: dicen **en
qué contrato** hay que consultar el estado. Eso el verificador no puede
deducirlo, y va firmado.

---

## El JWS

Header protegido:

```json
{ "alg": "EdDSA", "typ": "vc+jwt", "kid": "did:stellar:testnet:GCTTRJIY..." }
```

`kid` es el DID del emisor **a secas, sin fragmento**: un `did:stellar` tiene
exactamente una llave, así que el DID ya la identifica sin ambigüedad.

**El `kid` no se usa para elegir la llave de verificación.** El header lo
controla quien construye el JWS; confiar en él permitiría que una credencial
falsificada nombrara la llave que la valida. La llave sale siempre del `issuer`
del payload; el `kid` solo se contrasta, y si discrepan se rechaza.

El payload es la credencial **tal cual**, sin envoltorio `vc` ni claims
registrados (`iss`, `exp`, `nbf`). La vigencia se lee de `validFrom` /
`validUntil`, que es donde el data model de VC 2.0 la pone.

### `stellarKeypairToJWK`

Una llave secreta de Stellar es una **semilla Ed25519 de 32 bytes**, no una
llave privada expandida. El JWK lleva:

| campo | contenido |
|---|---|
| `kty` | `"OKP"` |
| `crv` | `"Ed25519"` |
| `d` | la **semilla** de 32 bytes, base64url |
| `x` | la **llave pública** de 32 bytes, base64url |

Confundir `d` con `x`, o usar base64 en vez de base64url, produce llaves que
firman sin quejarse y no verifican contra nada. Los tests están anclados al
vector RFC 8032 §7.1 TEST 1 y contrastados contra `@noble/curves`.

---

## Verificación

`verifyCredential` cubre **dos** de los tres chequeos. El tercero necesita la
red y vive en `@agentpass/sdk` (T7).

| # | chequeo | dónde | error si falla |
|---|---|---|---|
| 1 | la firma verifica contra la llave derivada del DID del emisor | `core`, offline | `InvalidSignature` |
| 2 | `now` dentro de `validFrom` / `validUntil` | `core`, offline | `CredentialExpired` · `CredentialNotYetValid` |
| 3 | `status(sha256(jws)) == Active` y el emisor activo | `sdk`, on-chain | *(T7)* |

**La firma se chequea antes que el reloj.** Si no, una credencial falsificada y
además vencida se reportaría como "vencida" y ocultaría la falsificación.

Otros errores: `InvalidJws` (JWS malformado, `alg` o `typ` equivocados, `kid` que
discrepa del `issuer`) e `InvalidCredential` (el payload no cumple el esquema).

---

## `scope.limits` es declarativo

Se firma y se transporta. **Nada lo hace cumplir todavía.** El enforcement es un
hito posterior; no lo agregues aquí.
