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

### V-12 · `policy_rail` paga con su propio camino de firma, no con el de `@x402/stellar` · `Vigente`
**Fecha:** 2026-09-04 (T31)

`ExactStellarScheme` (el cliente x402 que T24 usa) no puede firmar por una
cuenta de contrato, aunque `M-12` haya concluido —correctamente— que nada en la
cadena de pago *prohíbe* un comprador `C…`. Se agregó
`PolicyRailStellarScheme` (`apps/agent/src/payment/policy-rail-payer.ts`): arma
la misma `AssembledTransaction` contra el mismo `transfer` SEP-41, y solo el
paso de firma es propio.

**Hallazgo, siguiendo la cadena de llamadas del SDK instalado y no sus tipos.**
`ExactStellarScheme.createPaymentPayload` firma vía
`AssembledTransaction.signAuthEntries({ address, signAuthEntry, expiration })`.
El callback interno de ese método reduce **siempre** la respuesta de un signer
SEP-43 a bytes crudos de firma (`base64ToUint8Array(signedAuthEntry)`). Con
bytes crudos, `authorizeEntry` toma su rama "firma pelada", donde la llave
pública se **deriva de la dirección de la propia entrada**:
`Keypair.fromPublicKey(Address.fromScAddress(addrAuth.address).toString())`.
Para una cuenta de contrato esa dirección es un strkey `C…`, que no es una
llave Ed25519: revienta antes de verificar nada. En la práctica el camino
estándar del cliente es solo para cuentas clásicas, más allá de lo que sus
tipos permitan.

**Motivo de la solución elegida.** La salida es API pública, no un parche:
`signAuthEntries` acepta un `authorizeEntry` propio, y `authorizeEntry` acepta
un callback que devuelve `{ signature, publicKey }` explícito. Por esa rama el
SDK construye `scvVec([{ public_key: bytes32, signature: bytes64 }])` — campo
por campo el `Vec<Signature>` que `__check_auth` de `policy_rail` espera, que es
exactamente la forma que su docstring dice haber elegido para que esto fuera
posible (`M-21`).

**Alternativa descartada:** parchear `@x402/stellar` o `@stellar/stellar-sdk`
para que el camino estándar acepte cuentas de contrato. Mismo motivo que `V-3`
ya dio para el memo: este proyecto nunca modificó una dependencia de terceros;
una divergencia así la rompe en silencio cualquier actualización.

### V-13 · `policy_rail` deja de emitir su evento de auditoría — el facilitator no acepta pagadores que emitan otra cosa que `transfer` · `Vigente`
**Fecha:** 2026-09-04 (T31)

`contracts/policy-rail/src/lib.rs` ya no publica `SpendAuthorised`
(`("policy_rail", "authorised", day)` con `amount`/`spent_today`), el evento que
T22 había decidido conservar tras medir que costaba solo ~1 100 stroops.

**Motivo, encontrado pagando de verdad y no leyendo código.** El facilitator de
OpenZeppelin simula el pago y corre `validateSimulationEvents`, que exige que
**todo** evento de contrato de esa simulación sea un `transfer`: recorre la
lista y rechaza el primero cuyo primer tópico no sea el símbolo `transfer`. El
evento de auditoría del rail cae ahí y el pago se rechaza entero
(`invalid_exact_stellar_payload_event_not_transfer`), sin llegar nunca a la red.
Mientras el contrato lo emitiera, `policy_rail` no podía pagar una factura x402
— la razón entera de existir de este hito. Quitado el `publish`, el mismo pago
asienta a la primera.

**Qué se pierde y qué no.** Se pierde el rastro histórico en el ledger: ya no
queda una línea por autorización con el total del día en ese momento. No se
pierde el control —el rechazo por `perTx`/`perDay` sigue ocurriendo dentro de la
misma transacción que mueve la plata— ni el dato: `spent_on(day)` responde lo
mismo cuando se le pregunte, y el `transfer` del propio token sigue emitiendo su
evento. La auditoría del proyecto tampoco depende de esto: MandateVault
(T27–T30) ya encadena cada decisión por hash y ancla el vínculo pago↔decisión
on-chain.

**Cómo se decidió.** No se cambió en silencio una decisión de una fase cerrada:
se verificó primero que quitarlo desbloqueaba el pago (contrato desplegado sin
el evento, pago real asentado), se le mostró al usuario la evidencia y el costo
—incluida la explicación de qué es un evento y qué implica perderlo— y se
esperó su confirmación explícita. Mismo patrón que `M-1` en la Fase 3 y que
`V-3` en esta.

**Alternativa descartada:** conservar el evento y dar el hito por imposible con
este facilitator. Se descartó porque el contrato seguiría siendo lo que ya era
—una pieza probada que nunca paga— y porque el evento es reversible: si el
proyecto alguna vez asienta sin facilitator, o con uno menos estricto, vuelve a
agregarse sin tocar nada más.

### V-14 · El pago se construye con credenciales de autorización v1 (`useUpgradedAuth: false`) · `Vigente`
**Fecha:** 2026-09-04 (T31)

`PolicyRailStellarScheme` pide explícitamente credenciales de autorización
heredadas (v1) al simular, en vez del `sorobanCredentialsAddressV2` (CAP-71) que
`@stellar/stellar-sdk@17` produce por defecto.

**Motivo.** El facilitator viaja con `@stellar/stellar-sdk@16.3.0`, que no sabe
decodificar credenciales v2: la transacción ni siquiera se parsea del otro lado
(`invalid_exact_stellar_payload_malformed`), y `validateAuthEntries` exige
`sorobanCredentialsAddress` de todos modos. `@x402/stellar` no tropieza con esto
porque usa su propio SDK 16; solo aparece cuando la transacción la arma este
repo con su SDK 17. Encontrado pagando de verdad y leyendo el rechazo, no en los
tipos.

**Nota de caducidad, dicha en voz alta:** el propio SDK marca `useUpgradedAuth`
como transicional y avisa que dejará de tener efecto cuando la red devuelva
credenciales v2 por defecto. Cuando eso pase, este pago dejará de funcionar
hasta que el facilitator actualice su SDK — es una dependencia de terceros con
fecha de vencimiento, no una decisión que dependa de nosotros.

**Alternativa descartada:** construir la transacción con el `@stellar/stellar-sdk@16`
que `@x402/stellar` trae adentro, para no tener el desfasaje. Se descartó por
frágil: implicaría importar el SDK anidado de otra dependencia por su ruta
interna, algo que cualquier reinstalación puede mover de lugar.

### V-15 · El rail es una segunda puerta sobre los mismos números, no un reemplazo de `LocalPolicyRail` · `Vigente`
**Fecha:** 2026-09-04 (T31)

Con `payer` presente, una compra pasa igual por `checkScope` + `checkMandate` +
`checkDailyLimit` + `reconcileTerms` off-chain (`PolicyRail.authorise()`, Fase
3) **y además** por el `__check_auth` del contrato. Los límites se comprueban
dos veces, en dos lugares, con dos implementaciones distintas.

**Motivo.** No son redundantes: comprueban cosas distintas contra el mismo
número. Off-chain se compara la compra contra el Mandato firmado por el
principal —venue, activo, `payTo`, vigencia, todo lo que el contrato no sabe— y
se rechaza antes de firmar nada. On-chain se comprueba lo único que el contrato
sí puede garantizar por su cuenta: que del contrato no salga más de `perTx` en
una transferencia ni más de `perDay` en el día, sin ventana entre consultar y
registrar (`M-15`). Un operador que ignorara el rail off-chain igual choca con
la red; un atacante que sortee la red igual no tiene un Mandato válido.

`owner` es la llave del propio agente: el agente sigue autorizando sus compras
igual que cuando paga con su cuenta clásica. Lo que cambia es de dónde sale la
plata y quién más puede decir que no.

**Alternativa descartada:** mover los límites al contrato y sacarlos de
`LocalPolicyRail` cuando se paga por el rail. Se descartó porque el contrato no
conoce el Mandato —ni principal, ni venue, ni `payTo`, ni vigencia firmada
(`M-21` lo dice explícito)— así que "moverlos" habría sido perder los siete
chequeos que el contrato no hace, a cambio de no repetir dos.
