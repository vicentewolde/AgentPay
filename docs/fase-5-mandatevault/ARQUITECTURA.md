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

## 7. Lo que sigue (T28, no construido)

Anclar `vault.head()` contra `agent_registry` después de un pago real —
mismo mecanismo de `anchor()` que T20 ya construyó para credenciales y
mandatos, sin contrato nuevo. Ver `V-3` para el porqué (el memo dentro de la
transacción de pago está bloqueado por `@x402/stellar`) y qué decisiones
concretas faltan (quién firma la transacción companion, qué campos exactos
entran al hash).
