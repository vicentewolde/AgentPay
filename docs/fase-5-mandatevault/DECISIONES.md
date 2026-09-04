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

### V-3 · El memo de la transacción de pago está bloqueado por `@x402/stellar`; se ancla vía transacción companion en su lugar · `Vigente` — construida en T28
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

**Resuelto en T28, las dos preguntas que quedaron abiertas:**

- **Quién firma:** la clave del principal/issuer (`ISSUER_SECRET_KEY`), no la
  del agente. Es la única clave registrada como issuer activo en el piloto
  (`M-17`) — el agente nunca lo fue, y registrarlo solo para esto habría sido
  una decisión de confianza aparte (¿debería un agente poder atestiguar su
  propio historial, sin el principal de por medio?), no resuelta de paso.
  Mismo firmante que ya ancla credencial y mandato — el mismo emisor que ya
  se confía para "esto es quién sos y qué podés hacer" es el que ahora
  también dice "esto es lo que hiciste".
- **Qué se ancla, y con qué cadencia:** no `vault.head()` sin más — el hash
  de un registro puntual de la Fase 3 no menciona la transacción de pago que
  vino después, así que anclarlo solo no cierra el vínculo que esta fase
  necesita. Se ancla `paymentLinkHash(record, paymentTx) = sha256(record.hash
  + ":" + paymentTx)`, calculado recién cuando el pago real asienta — un
  valor que solo existe si **ambas** cosas pasaron: la decisión y el pago. Se
  ancla después de **cada** pago real, no en lote — el volumen del piloto en
  testnet es bajo y anclar de a uno es la garantía más fuerte posible (nunca
  hay una ventana donde un pago quedó sin su propio anclaje esperando el
  siguiente lote).

Ver `V-8` (`expiresAt`, y qué significa que un anclaje "expire" cuando lo que
ancla es un hecho pasado, no una autoridad vigente) y `V-9` (por qué esto no
bloquea el pago si falla).

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

### V-8 · `expiresAt` del anclaje reusa `validUntil` del Mandato, aunque "expirado" no invalida el hecho histórico · `Vigente`
**Fecha:** 2026-09-04 (T28)

`agent_registry.anchor()` exige un `expires_at`, y `status()` reporta
`Expired` una vez pasado — diseñado para una credencial o un mandato, cuya
autoridad *debería* dejar de valer con el tiempo. Un anclaje de pago no es
eso: es la prueba de que algo ya pasó, no un permiso vigente. Aun así, T28
reusa `current.mandate.mandate.validUntil` como `expiresAt`, en vez de
inventar un horizonte propio.

**Motivo.** No hay un valor "correcto" obvio para algo que conceptualmente
no debería expirar nunca — cualquier horizonte fijo (un año, diez años) es
igual de arbitrario. Reusar `validUntil` es lo único que no agrega un
parámetro nuevo sin significado: es el mismo horizonte bajo el cual el
Mandato que autorizó la compra ya deja de ser consultable como "vigente" de
todos modos. Que `status()` diga `Expired` después de esa fecha no borra
nada — el evento `Anchored` que la transacción emitió al confirmarse queda
en la historia del ledger de Stellar para siempre, recuperable vía Horizon
aunque el storage vivo del contrato lo archive (`M-22` ya midió que el TTL
del storage, no el evento, es lo que tiene horizonte).

**Alternativa descartada:** un horizonte fijo, muy largo (p. ej. 100 años),
para que `status()` prácticamente nunca reporte `Expired`. Se descartó por
ser un número inventado sin ningún significado —ni siquiera aproximado— en
el dominio del proyecto, mientras que `validUntil` del Mandato ya es un
valor que otra parte del sistema calcula con una razón real.

### V-9 · Un anclaje que falla no revierte ni oculta el pago que ya asentó · `Vigente`
**Fecha:** 2026-09-04 (T28)

`anchorSettledPayment` (`apps/web/src/server.ts`) corre **después** de que
`executeBazaarPayment` ya confirmó `settled: true`. Si el anclaje falla —red,
el issuer sin registrar, cualquier cosa— el error se atrapa y se reporta como
un paso más (`vault_anchor: "no se pudo anclar: ..."`) en vez de propagarse.

**Motivo.** El dinero real ya se movió en el momento en que este código
corre; no hay ninguna acción que "deshaga" eso, y fallar la respuesta HTTP
completa por un problema puramente de evidencia le mentiría al llamador
sobre si el pago (la parte que sí importa financieramente) funcionó. Mismo
principio que ya rige el resto del proyecto: el pago es fail-closed *antes*
de firmar (T24, "nunca firma antes de autorizar"); una vez asentado, la
evidencia alrededor de él es best-effort, no otra puerta que pueda cerrarse
sobre plata que ya es del vendedor.

**Alternativa descartada:** ninguna — no hay una versión razonable de
"revertir un pago real en Stellar porque un paso de auditoría posterior
falló". La alternativa habría sido no capturar el error y dejar que
rompiera la respuesta entera, perdiendo el resto de los datos del recibo
(`tx`, `settled`) que sí son reales y sí importan.

### V-10 · El anclaje se guarda como una tercera clase de entrada en el vault, y su estado se lee en vivo, no cacheado · `Vigente`
**Fecha:** 2026-09-04 (T29)

Hasta T28, el resultado de `anchorPaymentDecision` (`linkHash`,
`transactionHash`) solo existía en la respuesta HTTP de `buy()` — se perdía
apenas el navegador cerraba esa respuesta. T29 le agrega a `MandateVault`
una tercera clase de entrada, `VaultAnchoredEntry` (`kind: "anchored"`), y
`recordAnchor()` la escribe en la misma cadena que ya guarda concesiones y
rechazos — el acto de anclar queda, en sí mismo, parte de la evidencia
encadenada por hash, no solo su resultado on-chain.

**Motivo.** Sin esto, `GET /api/session/vault` (la superficie de consulta
nueva) no tendría nada que mostrar para un pago ya anclado en una visita
anterior — la única fuente sería releer la respuesta de `buy()`, que nadie
guarda. Guardarlo en el vault es coherente con lo que T27 ya estableció:
todo lo que le pasa a una decisión es evidencia, y una decisión que además
se ancló es información nueva sobre esa decisión, no un evento aparte.

**El estado que la página muestra (`onChainStatus`) se pide a `agent_registry`
en cada carga**, vía `agentpass.status(linkHash)` — nunca se guarda como
parte de la entrada del vault. Es la diferencia entre "esto es lo que
pasó" (el vault, inmutable una vez escrito) y "esto es lo que el registro
dice ahora mismo" (una pregunta en vivo, que en principio podría cambiar si
alguien revocara el anclaje — algo que este proyecto nunca hace, pero que
la página no debería fingir que es imposible por diseño).

**Alternativa descartada:** guardar `onChainStatus` como parte de
`VaultAnchoredEntry`, calculado una sola vez al anclar. Se descartó porque
mezclaría un hecho inmutable (se ancló, con este hash, en esta transacción)
con una lectura que solo tiene sentido en el momento en que se pide —
guardar un estado que después no se vuelve a comprobar habría sido fingir
una garantía de "sigue vigente" que el vault, por sí solo, no puede dar.

### V-11 · `AgentPass.getRecord()`, un método nuevo en un paquete de la Fase 1 — extendido, no reescrito · `Vigente`
**Fecha:** 2026-09-04 (T30)

`get_credential` ya existía en el contrato `agent_registry` desde la Fase 1
—`status()` siempre lo usó internamente para colapsar el registro completo
en `Unknown`/`Active`/`Revoked`/`Expired`— pero ninguna capa pública de
`@agentpass/sdk` lo exponía. Se agregó `Registry.getCredential(hash)`
(`packages/sdk/src/registry.ts`) y `AgentPass.getRecord(hash)` (`index.ts`):
el mismo registro, sin colapsar — `issuer`, `subject`, `issuedAt`,
`expiresAt`, `revoked`.

**Motivo.** La bitácora de T29 podía mostrar la decisión y el pago, pero no
la identidad que los hizo posibles — la credencial y el Mandato quedaban
fuera, aunque el contrato siempre tuvo esa información. Antes de escribir el
schema de parseo se verificó la forma real contra el contrato desplegado
(mismo hábito que T19/T22/T24/T28): `get_credential` devuelve
`{ issuer, subject, issued_at, expires_at, revoked }`, `issued_at`/
`expires_at` como enteros de 64 bits (segundos, no milisegundos) — confirmado
con una llamada real antes de escribir `credRecordSchema`, no asumido de la
firma Rust.

**Por qué tocar `packages/sdk` (Fase 1, cerrada) es aceptable acá.** Mismo
precedente que `M-3`/T20 ya sentó: `AgentPass.anchor()` se agregó a la
superficie pública durante la Fase 3 porque el contrato ya lo hacía
internamente y una fase posterior necesitaba la llamada cruda. `getRecord()`
es exactamente ese patrón otra vez — aditivo, sin tocar ningún método
existente, exponiendo una llamada que el contrato ya respondía.

**Verificado en testnet real, dos veces.** La integración del SDK
(`agentpass.integration.test.ts`) ahora cubre `getRecord()` dentro del ciclo
completo: recién emitida (`revoked: false`, `expiresAt` coincide con
`validUntil` truncado al segundo), después de revocar (`revoked: true`), y
`undefined` para un hash nunca anclado. Y clickeando la bitácora en un
navegador real: revocar el Mandato cambió "mandato (en cadena)" de `activa`
a `revocada` sin recargar la página, mientras la credencial —nunca
revocada— se mantuvo `activa`.

**Alternativa descartada:** construir esto sobre eventos de Soroban
(`getEvents` del RPC, filtrando por el topic `["agentpass", "anchored"]`)
en vez de `get_credential`. Se descartó porque el evento `Anchored` no
lleva `cred_hash` como topic —solo `issuer`/`subject` lo son, `cred_hash`
va en el payload— así que responder "¿qué pasó con *este* hash puntual?"
necesitaría traer *todos* los eventos de ese `subject` y filtrarlos del
lado del cliente. `get_credential` responde la misma pregunta en una sola
llamada, con el mismo costo que `status()` ya paga.
