# Arquitectura — Fase 5 (MandateVault)

> Mapa técnico denso y autocontenido. Contexto: [CONTEXTO.md](CONTEXTO.md) ·
> Estado: [BITACORA.md](BITACORA.md) · Decisiones: [DECISIONES.md](DECISIONES.md)

---

## 1. El paquete: `@agentpay/vault`

Nuevo paquete del monorepo, `packages/vault/`. Una sola dependencia:
`@agentpass/core` (para `AgentPassError` y `decimalAmountSchema`). No depende
de `apps/agent` ni de `@agentpay/mandate` — ver `V-1`.

```
packages/vault/src/
  vault.ts   — MandateVault, createFileMandateVault, tipos
  index.ts   — superficie pública
```

## 2. `MandateVault`, el tipo

```ts
interface MandateVault {
  // El puerto SpendLedger (apps/agent/src/ledger/spend-ledger.ts),
  // satisfecho estructuralmente — nunca importado (V-1).
  spentOn(subject, currency, at: Date): Promise<string>;
  record(entry: { subject, intentId, currency, amount, at: Date }): Promise<void>;
  hasRecorded(intentId): Promise<boolean>;

  // Lo que SpendLedger nunca tuvo:
  recordRefusal(input: { subject, intentId, code, reason, details }, at?): Promise<void>;
  list(subject?): readonly VaultRecord[];
  head(): string | undefined;
  verify(): { ok: boolean; brokenAtSeq?: number };
}
```

Un `VaultRecord` es `{ seq, prevHash, hash, entry }`, donde `entry` es
`VaultGrantedEntry` (`kind: "granted"`, con `currency`/`amount`) o
`VaultRefusedEntry` (`kind: "refused"`, con `code`/`reason`/`details` — los
mismos tres campos que `AuthorisationRefused` ya trae en `apps/agent`).
`hash = sha256(JSON.stringify({ seq, prevHash, entry }))`. `prevHash` del
primer registro (`seq === 0`) es `""`.

## 3. `createFileMandateVault({ path })`

Backend: un archivo JSON Lines, un `VaultRecord` por línea, *append-only*.

- **Al construirse**, si `path` existe, lee el archivo entero y reconstruye
  en memoria: los totales por `subject`/`currency`/día (para `spentOn`), el
  set de `intentId`s ya vistos (para `hasRecorded`/dedupe), y el arreglo
  completo de registros (para `list`/`head`/`verify`). Si no existe, crea el
  directorio contenedor y arranca vacío.
- **Cada escritura** (`record`/`recordRefusal`) calcula el siguiente
  registro y lo agrega con `appendFileSync` — síncrono a propósito (`V-7`):
  Node corre JavaScript en un solo hilo, así que una escritura síncrona no
  puede intercalarse con la lectura-modificación-escritura de otra llamada,
  sin necesitar ningún lock nuevo. Mismo límite ya escrito para
  `LocalPolicyRail`/`SpendLedger`: durable dentro de este proceso y su
  archivo, no entre más de un proceso escribiendo la misma ruta a la vez.
- **`record()` deduplica por `intentId`** exactamente como el `SpendLedger`
  en memoria (`M-15`): una segunda llamada con el mismo `intentId` no agrega
  ninguna línea nueva ni toca los totales — necesario para que
  `checkDailyLimit`/`G-11` (una compra real llama `authorise()` dos veces)
  siga funcionando sin cambios. **`recordRefusal()` no deduplica** (`V-6`):
  cada intento rechazado es evidencia propia.
- **`verify()`** recorre los registros en orden, recalculando cada hash a
  partir de `seq`/`prevHash`/`entry` y comparándolo contra el `hash`/
  `prevHash` almacenados. La primera discrepancia es la primera línea editada
  después de escrita — todo lo que sigue en la cadena también dejaría de
  coincidir, por construcción.

## 4. `withVault`, el decorador (`apps/agent/src/policy/with-vault.ts`)

```ts
function withVault(policyRail: PolicyRail, vault: MandateVault): PolicyRail
```

Envuelve cualquier `PolicyRail`: llama `authorise()`, y si el resultado es un
rechazo, llama `vault.recordRefusal(...)` con el `subject`/`intentId` del
intent y el `code`/`reason`/`details` del rechazo — después devuelve la
decisión sin tocarla. **No hace falta para las autorizaciones concedidas**:
`LocalPolicyRail.authorise()` (Fase 3, sin cambios) ya llama
`ledger.record(...)` al conceder, y si `ledger` es un `MandateVault`, esa
llamada ya persiste el registro. `withVault` es, literalmente, el único
código nuevo que un rechazo necesitaba — `policy-rail.ts` (T19, cerrado) no
se tocó.

## 5. El seam nuevo en `apps/agent`: `policyRail?` inyectable

`AgentToolsDeps`/`AgentConfig` ganan un campo opcional `policyRail?:
PolicyRail`. Si está presente, `purchaseIntentDepsOf` lo usa tal cual en vez
de construir su propio `createLocalPolicyRail({ ledger, now })` — el mismo
patrón que `ledger?` ya tenía desde T19 ("override... para más adelante
enchufar algo durable", literal en su propio docstring). Sin ese campo, el
comportamiento no cambia en nada respecto de antes de T27.

## 6. Cómo se cablea en `apps/web`

```ts
const vault = createFileMandateVault({ path: env.get("MANDATE_VAULT_PATH") ?? DEFAULT_VAULT_PATH });
const policyRail = withVault(createLocalPolicyRail({ ledger: vault }), vault);

const agent = await createAgent({ ..., ledger: vault, policyRail });
```

`DEFAULT_VAULT_PATH` es `data/mandate-vault.jsonl` en la raíz del repo,
overridable por `MANDATE_VAULT_PATH` (mismo patrón que `BAZAAR_BASE_URL`).
`data/` está en `.gitignore` — es estado de ejecución, no código fuente.

Una sola instancia de `PolicyRail` ahora sirve tanto a `createAgent()` como
al `buy()` que la llama directo (T24/G-5) — antes eran dos objetos distintos
compartiendo el mismo `ledger`. `G-5` había descartado explícitamente
compartir la instancia por alcance ("cambia la superficie pública de
`Agent`"); con el seam de `policyRail?` ya construido por otra razón, ese
costo desapareció y se adoptó la alternativa que `G-5` había dejado anotada
(`V-5`).

**Nota de despliegue, dicha en voz alta:** "durable" acá significa que
sobrevive un reinicio del proceso dentro de la misma instancia — no
necesariamente un redeploy de Render, que puede o no preservar el disco
local según el plan contratado. Confirmarlo con un disco persistente real es
trabajo de infraestructura, no de este hito.

## 7. `apps/agent/src/vault/anchor-payment.ts` — el anclaje on-chain (T28)

Cierra lo que §6 dejaba pendiente: un vínculo criptográfico entre un pago
real asentado y la decisión que lo autorizó, verificable sin confiar en
quien opera el vault.

```ts
function paymentLinkHash(record: VaultRecord, paymentTx: string): string
// sha256(`${record.hash}:${paymentTx}`) — solo existe si la decisión Y el pago pasaron

function anchorPaymentDecision(registry: RegistryAnchor, params: {
  record: VaultRecord; paymentTx: string; subject: string; expiresAt: Date; issuer: Keypair;
}): Promise<{ linkHash: string; transactionHash: string }>

function verifyPaymentAnchor(registry: RegistryAnchorStatus, record: VaultRecord, paymentTx: string):
  Promise<{ linkHash: string; status: CredStatus }>
```

`RegistryAnchor`/`RegistryAnchorStatus` son la misma forma estructural que
`RegistryAccess` (T20, `@agentpay/mandate`) — `AgentPass` de `@agentpass/sdk`
las satisface directamente, sin adaptador.

**Cableado en `apps/web`:** `anchorSettledPayment()` (`server.ts`) corre
después de que `executeBazaarPayment` confirma `settled: true`. Busca en el
vault el registro `granted` de ese `intentId` (`vault.list(agentDid)` —
`intent.agent` es un DID, no la dirección cruda que `subject` necesita para
el anclaje; `stellarAddressToDid` hace la conversión), calcula
`paymentLinkHash` y llama `anchorPaymentDecision` firmando con
`ISSUER_SECRET_KEY` — la misma llave que ya ancla credencial y mandato
(`V-3`). El resultado se agrega como dos pasos más (`vault_anchor_hash`,
`vault_anchor_tx`) a lo que `buy()` ya devolvía. Un fallo del anclaje no
revierte ni oculta el pago (`V-9`): se reporta como un paso propio
(`vault_anchor: "no se pudo anclar: ..."`), nunca lanzando.

**Verificado en testnet real, de punta a punta:** un pago real se ancló
(`transactionHash` confirmado en Horizon), y consultar
`agentpass.status(linkHash)` de forma completamente independiente —sin tocar
el archivo del vault— devolvió `"Active"`. Detalle en
`evidencia/T28.md`.

## 8. La superficie de consulta (T29)

`GET /api/session/vault` (`apps/web/src/server.ts`) y la sección 5
("Bitácora (MandateVault)") de `public/index.html` — lo que hace que T27/T28
sean *consultables* por una persona, no solo por un script.

**Backend.** `vaultReport(current: DemoSession)` toma
`current.vault.list(agentDid)` y `current.vault.verify()`, y para cada
registro `anchored` hace una llamada en vivo a
`current.agentpass.status(entry.linkHash)` — nunca reusa un valor guardado
(`V-10`). Devuelve `{ chain: VaultVerification, records: WireVaultRecord[] }`.

**Vault, extendido.** `MandateVault` gana una tercera clase de entrada,
`VaultAnchoredEntry` (`kind: "anchored"`, con `paymentTx`/`linkHash`/
`anchorTx`) y el método `recordAnchor()` — misma cadena de hashes que ya
guarda `granted`/`refused`, sin abrir un archivo ni una estructura aparte.
`apps/web`'s `anchorSettledPayment` (T28) lo llama justo después de que
`anchorPaymentDecision` confirma la transacción.

**Frontend.** Sin build step, mismo patrón que el resto de `apps/web`
(T25): un botón ("Ver bitácora") que pide `/api/session/vault` y renderiza
cada registro — `#seq tipo: intentId — detalle`, con `— on-chain: <estado>`
para los anclados — más un indicador de si la cadena entera verificó
íntegra. Se vuelve a pedir automáticamente después de cada compra, así que
el resultado de una compra real aparece sin un segundo clic.

**Verificado clickeando el flujo completo en un navegador real** (Claude
Browser, contra el servidor local): sesión → compra real → la sección 5
mostró `"Cadena íntegra ✓ (2 registros)"`, el registro `granted` (monto y
moneda) y el `anchored` con `on-chain: Active` — leído en vivo, no
cacheado. Detalle en `evidencia/T29.md`.

## 9. `AgentPass.getRecord()` — la identidad, en la misma bitácora (T30)

Cierra el último candidato técnico pendiente: la credencial y el Mandato de
la sesión activa, con lo que `agent_registry` dice de ellos **ahora mismo**.

**`packages/sdk`, extendido (mismo precedente que `anchor()` en T20).**
`Registry.getCredential(hash)` (`registry.ts`) llama al `get_credential` que
el contrato siempre tuvo — usado internamente por `status()`, nunca expuesto
— y lo parsea con `credRecordSchema`, verificado contra el contrato real
antes de escribirse:

```
{ issuer: "G...", subject: "G...", issued_at: 1788536887n,
  expires_at: 1788623260n, revoked: false }
```

`AgentPass.getRecord(hash): Promise<CredRecord | undefined>` lo expone en
la superficie pública, con `issuedAt`/`expiresAt` ya como `Date`.

**Cableado en `vaultReport()`** (`apps/web/src/server.ts`): junto a los
registros del vault, pide `getRecord(credentialHash)` y
`getRecord(mandate.hash)` — dos llamadas en vivo más, mismo patrón que ya
usa para el estado de cada anclaje (`onChainStatus`, T29). El resultado
(`identity: WireIdentityRecord[]`) se agrega a la respuesta de
`GET /api/session/vault`, y el frontend lo renderiza como
`<kind> (en cadena): activa|revocada` arriba de la lista de decisiones.

**Verificado en testnet real, de dos formas.** La integración del SDK
(`agentpass.integration.test.ts`) cubre `getRecord()` en el ciclo completo:
recién emitida, después de revocar, y para un hash nunca anclado. Y en el
navegador: revocar el Mandato cambió "mandato (en cadena)" de `activa` a
`revocada` sin recargar la página, mientras la credencial —nunca
revocada— se mantuvo `activa`. Detalle en `evidencia/T30.md`.

## 10. `policy_rail` como pagador (T31)

Hasta T30, toda compra real salía de la cuenta clásica del agente. T31 agrega
un segundo camino, sin quitar el primero.

```
executeBazaarPayment(deps, input)
  ├── fetch(resourceUrl) → 402  ····································· igual
  ├── reconcileTerms + PolicyRail.authorise()  ······················ igual
  └── firma y envía:
        deps.payer === undefined                   deps.payer = { contractId, ownerSecret }
        └── ExactStellarScheme                     └── PolicyRailStellarScheme
              (cuenta clásica G…)                        (smart account C…)
```

Las dos ramas comparten todo lo anterior a la firma: el mismo reto real, el
mismo `reconcileTerms` (`M-14`), el mismo `authorise()` de la Fase 3, el mismo
registro en el vault y el mismo anclaje de T28. Lo único que cambia es quién
firma la autorización de la transferencia — y, por lo tanto, quién más puede
decir que no.

### Por qué hay un esquema propio y no un signer distinto

`ClientStellarSigner` acepta cualquier `address`, incluida una `C…`, pero el
paso de firma que `ExactStellarScheme` usa no: `AssembledTransaction.signAuthEntries`
reduce la firma a bytes crudos y `authorizeEntry` deriva entonces la llave
pública de la dirección de la propia entrada, que para un contrato no es una
llave Ed25519. `PolicyRailStellarScheme` reemplaza exactamente ese paso, vía el
parámetro `authorizeEntry` que el SDK expone, y produce
`Vec<{public_key, signature}>` — la forma que `__check_auth` decodifica
(`V-12`).

### Los dos gates, y qué comprueba cada uno

| | `LocalPolicyRail` (off-chain, Fase 3) | `policy_rail.__check_auth` (on-chain, T22) |
|---|---|---|
| Cuándo | Antes de firmar nada | Dentro de la transacción que mueve la plata |
| Qué compara | Scope + Mandato firmado: venue, activo, `payTo`, vigencia, `perTx`, `perDay` | `perTx`, `perDay`, y que lo autorizado sea un `transfer` de su propio activo desde sí mismo |
| Qué sabe | Todo lo que el principal firmó | Solo lo que se le fijó al desplegar |
| Ventana consultar↔registrar | Existe (`M-15`) | No existe: comprobar y registrar son la misma escritura |

No se reemplazan (`V-15`): el contrato no conoce el Mandato, y `LocalPolicyRail`
no puede impedir que el dinero se mueva si alguien lo saltea.

### El script de despliegue

`pnpm run deploy:policy-rail` (`scripts/deploy-policy-rail.ts`) es
re-ejecutable como `deploy:registry`: construye, despliega, **lee el contrato de
vuelta** para confirmar `owner`/`asset`/límites, escribe
`deployments/testnet.json` y `POLICY_RAIL_CONTRACT_ID` en `.env.local`, y deja
el rail fondeado con USDC propio. Un wasm distinto del registrado detiene el
script y pide `--redeploy` — un redeploy es un contract id nuevo, y el viejo se
queda con su saldo.
