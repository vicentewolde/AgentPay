# Decisiones — Fase 5 (MandateVault)

> Una entrada por decisión, con su motivo y la alternativa que se descartó.
> **No se borran entradas**: si una decisión se revierte, se marca como
> `Superada` y se agrega la nueva. Prefijo `V-` (de "Vault").

---

### V-1 · `@agentpay/vault` no depende de `apps/agent` — satisface `SpendLedger` estructuralmente · `Vigente`
**Fecha:** 2026-09-04 (T27)

`MandateVault` implementa las mismas tres firmas que `SpendLedger`
(`spentOn`, `record`, `hasRecorded`), pero el paquete nunca importa ese tipo
de `apps/agent`.

**Motivo.** Ningún paquete de este repo depende de una app (`apps/agent`,
`apps/web`) — la dirección siempre es al revés. Importar `SpendLedger` desde
`@agentpay/vault` habría invertido esa capa por conveniencia de un solo tipo.
El patrón ya existe en el proyecto: `RegistryAccess` en `@agentpay/mandate`
(T20) nombra estructuralmente los cuatro métodos que necesita de `AgentPass`
sin importar su tipo real, "la misma forma que `CredentialVerifier` en
`apps/agent` narrows `AgentPass`". Este paquete hace lo mismo en la dirección
opuesta: en vez de una app angostando el tipo de un paquete, un paquete
ofrece una forma que una app ya espera. TypeScript's structural typing hace
el resto en el sitio de uso, sin adaptador.

**Alternativa descartada:** exportar `SpendLedger` desde un paquete
compartido (p. ej. `@agentpass/core`) para que ambos lo importen. Se
descartó por alcance — mover ese tipo fuera de `apps/agent` es un cambio a
código de Fase 3 sin necesidad real: la duplicación estructural (mismas tres
firmas, en dos sitios) cuesta menos que reorganizar dónde vive un tipo ya
usado en producción.

### V-2 · La aritmética decimal de 7 posiciones se duplica en `vault.ts`, no se promueve a `@agentpass/core` · `Vigente`
**Fecha:** 2026-09-04 (T27)

`scaleAmount`/`unscaleAmount` en `packages/vault/src/vault.ts` reimplementan
~15 líneas que ya existen en `apps/agent/src/scope/amount.ts`
(`toScaledAmount`/`fromScaledAmount`) — mismo escalado a 7 decimales, mismo
uso de `decimalAmountSchema` de `@agentpass/core` para validar.

**Motivo.** `@agentpay/vault` no puede importar de `apps/agent` (`V-1`), y
`apps/agent/src/scope/amount.ts` es código de Fase 2 ya probado en
producción con muchos call sites (`scope.ts`, `intent.ts`,
`check-daily-limit.ts`, `terms.ts`). Promoverlo a `@agentpass/core` sería la
solución "correcta" a mediano plazo, pero es un refactor de superficie mucho
mayor que lo que este hito necesitaba — 15 líneas de aritmética pura,
determinística, con su propio test de duplicación.

**Alternativa descartada:** mover `toScaledAmount`/`fromScaledAmount` a
`@agentpass/core` ahora. Se descartó por alcance: toca Fase 1 (dónde vive la
función) y Fase 2 (todos sus call sites) por una necesidad de un paquete
nuevo de Fase 5. Queda anotado como limpieza posible si un tercer
consumidor apareciera.

### V-3 · El memo de la transacción de pago está bloqueado por `@x402/stellar`; se ancla vía transacción companion en su lugar · `Pendiente` (T28)
**Fecha:** 2026-09-04

El plan original de T27 —bitácora durable **y** memo en la transacción de
pago que referencia el `intentId`— se recortó a solo la bitácora durable
después de leer el código real de `@x402/stellar@2.24.0`.

**Hallazgo.** `ExactStellarScheme.createPaymentPayload` (el método que
`executeBazaarPayment` llama) construye la transacción de pago **enteramente
dentro del paquete**, vía `contract.AssembledTransaction.build({ contractId,
method: "transfer", args, networkPassphrase, rpcUrl, ... })` de
`@stellar/stellar-sdk`. No expone ningún parámetro de memo — el llamador no
tiene forma de agregarle uno sin parchear la dependencia.

**Motivo de la alternativa elegida (transacción companion, no construida
todavía).** En vez de meter la referencia *dentro* de la transacción de pago
(bloqueado), publicar una transacción separada, que sí construimos y
firmamos nosotros, que ancla `vault.head()` (o el hash de un registro
puntual) contra `agent_registry` — reusando `anchor()`, el mismo mecanismo
que T20 ya construyó para credenciales y mandatos. Sin contrato nuevo, mismo
patrón de "documento off-chain, hash anclado on-chain" que el resto del
proyecto ya usa.

**Alternativa descartada:** parchear `@x402/stellar` para exponer un memo.
Se descartó de inmediato — este proyecto nunca ha modificado una dependencia
de terceros (T19/T22/T24 la leyeron, nunca la tocaron), y hacerlo ahora
crearía una divergencia que cualquier actualización del paquete rompería en
silencio.

**Qué falta decidir, explícitamente, antes de construir T28:** quién firma
la transacción companion (¿la propia clave del agente, o la del principal/
issuer, como ya hace el anclaje de credencial y mandato?), y con qué
cadencia se ancla (¿cada pago real, o el head cada tanto?). Ninguna de las
dos tiene una respuesta obvia todavía — anotado a propósito, no resuelto de
paso dentro de este hito.

### V-4 · `policyRail?` inyectable en `AgentConfig`/`AgentToolsDeps`, en vez de tocar `policy-rail.ts` · `Vigente`
**Fecha:** 2026-09-04 (T27)

Capturar un rechazo en el vault necesitaba que algo observara lo que
`PolicyRail.authorise()` devuelve — pero `createAgentTools` construía su
propio `LocalPolicyRail` internamente, sin ninguna forma de interceptarlo.

**Motivo.** Se agregó un campo opcional `policyRail?: PolicyRail` a
`AgentToolsDeps`/`AgentConfig`, con el mismo patrón que `ledger?` ya usaba
desde T19 (su propio docstring decía "override... later to plug in something
durable" — literalmente esto). Con ese seam, `withVault(createLocalPolicyRail(...),
vault)` se construye **afuera** de `apps/agent`'s wiring interno y se
inyecta, sin que `policy-rail.ts` (Fase 3, cerrada) cambie una sola línea.

**Alternativa descartada:** hacer que `createAgentTools` detecte si `ledger`
también implementa `recordRefusal` (duck-typing de una capacidad) y decida
envolver por su cuenta. Se descartó por implícito — un `SpendLedger` que
"a veces" hace algo más según qué shape tenga en tiempo de ejecución es más
difícil de razonar que un parámetro explícito que el llamador decide pasar o
no.

### V-5 · `apps/web` pasa a compartir una sola instancia de `PolicyRail`, no dos · `Vigente`
**Fecha:** 2026-09-04 (T27)

`server.ts` construía dos objetos `PolicyRail` (uno para `createAgent()`,
otro para el `buy()` del servidor) compartiendo el mismo `ledger` — la
decisión de `G-5` (T24), que dejó anotado como alternativa descartada
"exponer el `PolicyRail` interno... por alcance". Con el seam de `V-4` ya
construido, ese costo desapareció: `server.ts` ahora construye un solo
`policyRail` y lo pasa a ambos lados.

**Motivo.** Es estrictamente más simple sin perder nada: `G-5` ya garantizaba
que el resultado práctico (mismo ledger, dedupe funcionando) era idéntico
con dos objetos; con uno solo, es la misma garantía sin depender de que dos
instancias independientes se sigan comportando igual en el futuro.

**Alternativa descartada:** ninguna — es la adopción directa de la
alternativa que `G-5` ya había dejado escrita, ahora sin el costo que la
hizo descartarse en su momento.

### V-6 · Un rechazo no se deduplica por `intentId`; una concesión sí · `Vigente`
**Fecha:** 2026-09-04 (T27)

`record()` (concesión) ignora una segunda llamada con el mismo `intentId`
—mismo comportamiento que `SpendLedger` desde `M-15`—; `recordRefusal()`
agrega una línea nueva cada vez, sin importar si el mismo `intentId` ya fue
rechazado antes.

**Motivo.** La deduplicación de `record()` existe para que el gasto no se
cuente dos veces (`M-15`/`G-11`) — un problema de aritmética. Un rechazo no
suma nada a ningún total; dos rechazos del mismo intent son dos eventos
reales (dos intentos), y ambos son evidencia legítima para el objetivo de
esta fase ("cada decisión... consultable").

**Alternativa descartada:** deduplicar refusals también, por simetría con
`record()`. Se descartó porque la simetría no aplica — no hay ninguna
cantidad que un refusal duplicado esté en riesgo de contar dos veces.

### V-7 · Escrituras síncronas (`appendFileSync`), sin lock nuevo · `Vigente`
**Fecha:** 2026-09-04 (T27)

`createFileMandateVault` usa `appendFileSync`/`readFileSync`, no las
variantes de promesa.

**Motivo.** Node ejecuta JavaScript en un solo hilo; una llamada síncrona no
puede intercalarse con el resto del trabajo de otra llamada de la forma en
que un `await` sí podría (el runtime cede el control entre `await`s, nunca
en medio de una función síncrona). Con esto, dos llamadas a `record()`/
`recordRefusal()` en el mismo proceso nunca pueden pisarse una escritura a
mitad de la otra, sin necesitar ningún mecanismo de lock nuevo. Mismo límite
que `LocalPolicyRail`/`SpendLedger` ya tienen por escrito: durable dentro de
este proceso, no entre más de uno escribiendo el mismo archivo a la vez.

**Alternativa descartada:** `appendFile`/`readFile` asíncronos, con una cola
de escritura propia (similar a `LocalPolicyRail.serialise()`, T19). Se
descartó por innecesario — esa cola existe en `LocalPolicyRail` porque el
trabajo entre la lectura y la escritura del ledger *sí* tiene puntos de
`await` (el chequeo de límite diario llama a `ledger.spentOn` de forma
asíncrona). Acá no los hay: todo el ciclo lectura-en-memoria → escritura es
síncrono de punta a punta.
