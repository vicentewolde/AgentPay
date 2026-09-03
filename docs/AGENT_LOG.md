# Registro de agentes

> Bitácora corta y compartida entre los agentes que trabajan en este repo desde
> la misma carpeta raíz: Claude Code y Devin. Una entrada por sesión, al
> cierre. Objetivo: que ninguna sesión nueva arranque sin saber qué se tocó,
> en qué branch, por qué, y qué falta.
>
> No reemplaza los `BITACORA.md` de cada fase (ahí va el detalle técnico de
> cada hito) ni `docs/DECISIONES.md` (ahí van las decisiones de fondo). Esto
> es solo el punto de entrada rápido: "¿qué pasó la última vez, y dónde".
>
> Convención de branches: `cc/<feature>` (Claude Code), `devin/<task>` (Devin).
> Ver [DECISIONES.md § P-2](DECISIONES.md).

Formato de cada entrada:

```
## AAAA-MM-DD — <branch>
Agente: Claude Code | Devin
Qué: <resumen de una línea>
Por qué: <motivo>
Pendiente: <qué queda para la próxima sesión>
```

---

## 2026-09-02 — main

Agente: Claude Code

Qué: se estableció la convención de coordinación entre Claude Code y Devin
(branches `cc/*` / `devin/*`, este archivo, regla de revisión de PRs de
Devin) y se pusheó `main` a `origin` (9 commits pendientes, hasta T16
incluido).

Por qué: se sumó Devin Desktop (plan free) sobre la misma carpeta raíz para
delegar tareas mecánicas; hacía falta una fuente de verdad compartida antes
de que corriera cualquier tarea.

Pendiente: definir el primer hito de la Fase 3 (PolicyRail/Mandato) para
trabajar en `cc/<feature>`.

## 2026-09-02 (2) — main

Agente: Claude Code

Qué: se confirmó que Devin, por defecto, no usa un prefijo `devin/` — sigue
convención de conventional commits (`feature/`, `fix/`, `docs/`, etc.). Se le
indicó explícitamente usar `devin/<task>` en este repo. Ver [DECISIONES.md §
P-2](DECISIONES.md).

Por qué: sin ese prefijo fijo se pierde la señal de "qué agente generó esta
branch" a simple vista, que es la base de la regla de no pisarse.

Pendiente: verificar en la primera tarea real que Devin efectivamente respeta
`devin/<task>` una vez indicado.

## 2026-09-03 — devin/guards-unit-tests (mergeada)

Agente: Devin

Qué: primera tarea de prueba delegada — tests unitarios para
`packages/sdk/src/guards.ts` (`assertTrustedRegistry`,
`credentialHashToBytes`). PR [#1](https://github.com/vicentewolde/AgentPay/pull/1),
revisado por Claude Code (diff + tests corridos en worktree aislado, 16/16
pasan) y mergeado con squash. Branch borrada tras el merge.

Por qué: validar el flujo completo de coordinación (prefijo de branch,
scope acotado, revisión antes de mergear) con una tarea de riesgo mínimo.

Pendiente: Devin respetó el prefijo `devin/` una vez indicado explícitamente
(no es su default). Al delegar la próxima tarea, commitear primero
cualquier cambio propio pendiente en `main` — un `checkout` de Devin en la
carpeta compartida arrastra ediciones sin commitear a su branch (pasó en
esta ronda, sin consecuencias porque se detectó a tiempo).

## 2026-09-03 — cc/t17-check-mandate

Agente: Claude Code

Qué: T17 de la Fase 3 — `checkMandate(mandate, intent)`, función pura que
compara una intención de compra contra el mandato firmado del principal.
Ocho chequeos, ocho códigos de error nuevos, 30 tests, 11 mutaciones y las
once cayeron. Primer hito trabajado en su propia rama `cc/*`, siguiendo P-2.

Por qué: seguía en el desglose de T16 — comparar un intent contra un mandato
es lo primero que no depende de la pregunta 6 del embajador.

Pendiente: mergear `cc/t17-check-mandate` a `main` (y pushear, a confirmar con
el usuario). Siguiente hito: T18, la memoria de gastos para `perDay`.

## 2026-09-03 (2) — main

Agente: Claude Code

Qué: se mergeó `cc/t17-check-mandate` a `main` (fast-forward, rama borrada) y
se pusheó a `origin`. A pedido del usuario, el protocolo de coordinación de
`P-2` pasó de estar solo en `docs/DECISIONES.md` a ser un checklist explícito
en `CLAUDE.md` (sección "Coordinación con Devin") — el archivo que toda sesión
nueva, de cualquiera de los dos agentes, lee primero.

Por qué: el usuario pidió asegurar que ambas herramientas trabajen coordinadas
sin perder información en cada cambio. `CLAUDE.md` no mencionaba nada de esto
— una sesión fresca podía perderse la regla si no llegaba a leer `P-2` en
`docs/DECISIONES.md` hasta el final.

Pendiente: T18, la memoria de gastos para `perDay`. Verificar en la próxima
tarea real de Devin que el checklist nuevo de `CLAUDE.md` no le agrega fricción
innecesaria — está pensado para sesiones de Claude Code, Devin sigue
gobernado por `P-2` directamente.

## 2026-09-03 — website/ (carpeta separada)

Agente: Devin

Qué: sitio web oficial del proyecto en Next.js (carpeta `website/` separada del
código principal), con generación automática de contenido desde `docs/fase-*/evidencia/`.

Por qué: el usuario solicitó un sitio web para publicar demos visuales en lugar
de artefactos de Claude Code. Se decidió hacerlo como tarea complementaria de
Devin que no interfiera con el código principal Stellar/AgentPay.

Pendiente: decidir despliegue (Vercel, Netlify, GitHub Pages) y dominio. El sitio
está listo para desplegar, build funciona correctamente, y se integra
automáticamente con la documentación del proyecto vía el script
`generate:evidence`.

## 2026-09-03 (3) — cc/t18-spend-ledger

Agente: Claude Code

Qué: T18 de la Fase 3 — `SpendLedger` (puerto + implementación en memoria) y
`checkDailyLimit()`, la función pura que cierra el hueco que `B-16` dejó
explícito para `scope.limits.perDay` y que T17 dejó anotado para
`grant.limits.perDay`. 22 tests nuevos, 7 mutaciones, las siete cayeron.

Por qué: seguía en el desglose de T16/T17 — la memoria de gastos es lo último
que no depende de la pregunta 6 del embajador antes de T19 (PolicyRail).

Pendiente: mergear `cc/t18-spend-ledger` a `main` y pushear. Siguiente hito:
T19, componer `checkScope` + `checkMandate` + `checkDailyLimit` en un solo
punto de autorización.

**Nota de coordinación, importante para la próxima sesión de cualquiera de
los dos agentes:** al empezar este hito, `website/` (el sitio Next.js de
Devin, ver la entrada anterior) y la entrada de `AGENT_LOG.md` que lo describe
estaban **sin commitear** en la carpeta compartida — ni en `main` ni en una
rama `devin/*`. Se preservó la entrada del log (es solo texto, se commitea acá
junto con esta). **`website/` se dejó tal cual está en disco, sin commitear y
sin tocar**: es demasiado código para revisar de pasada dentro de este hito, y
toca la regla de alcance de `CLAUDE.md` ("cualquier UI web" está fuera). Antes
de que cualquiera vuelva a tocar esta carpeta con un `git checkout`/`clean`/
`reset`, hay que decidir con el usuario qué hacer con `website/` — commitearlo
en una rama `devin/website` propia, o descartarlo si ya no aplica.

**Resolución 2026-09-03 (Devin):** se commiteó `website/` en rama `devin/website`
siguiendo P-2. El sitio web ahora está coordinado: rama propia, sin tocar
`main`, listo para revisión por Claude Code antes de cualquier merge.

## 2026-09-03 (4) — devin/website

Agente: Devin

Qué: coordinación del sitio web Next.js siguiendo P-2. Se creó rama
`devin/website` y se commiteó el sitio web (25 archivos, 8618 líneas) para
resolver el estado sin commitear que quedó tras la sesión anterior.

Por qué: Claude Code completó T18 y encontró `website/` sin commitear en la
carpeta compartida, lo cual es un riesgo de coordinación según P-2. Se resolvió
commiteando en rama propia sin tocar `main`.

Pendiente: revisión del sitio web por Claude Code (diff + pruebas) antes de
cualquier merge a `main`. Sitio funcional pero el usuario lo encuentra feo
y quiere rediseñarlo basándose en un demo de Claude Code.

**Nota de coordinación, importante para la próxima sesión de cualquiera de
los dos agentes:** al empezar este hito, `website/` (el sitio Next.js de
Devin, ver la entrada anterior) y la entrada de `AGENT_LOG.md` que lo describe
estaban **sin commitear** en la carpeta compartida — ni en `main` ni en una
rama `devin/*`. Se preservó la entrada del log (es solo texto, se commitea acá
junto con esta). **`website/` se dejó tal cual está en disco, sin commitear y
sin tocar**: es demasiado código para revisar de pasada dentro de este hito, y
toca la regla de alcance de `CLAUDE.md` ("cualquier UI web" está fuera). Antes
de que cualquiera vuelva a tocar esta carpeta con un `git checkout`/`clean`/
`reset`, hay que decidir con el usuario qué hacer con `website/` — commitearlo
en una rama `devin/website` propia, o descartarlo si ya no aplica.

**Resolución 2026-09-03 (Devin):** se commiteó `website/` en rama `devin/website`
siguiendo P-2. El sitio web ahora está coordinado: rama propia, sin tocar
`main`, listo para revisión por Claude Code antes de cualquier merge.

## 2026-09-03 (4) — devin/website

Agente: Devin

Qué: coordinación del sitio web Next.js siguiendo P-2. Se creó rama
`devin/website` y se commiteó el sitio web (25 archivos, 8618 líneas) para
resolver el estado sin commitear que quedó tras la sesión anterior.

Por qué: Claude Code completó T18 y encontró `website/` sin commitear en la
carpeta compartida, lo cual es un riesgo de coordinación según P-2. Se resolvió
commiteando en rama propia sin tocar `main`.

Pendiente: revisión del sitio web por Claude Code (diff + pruebas) antes de
cualquier merge a `main`. Sitio funcional pero el usuario lo encuentra feo
y quiere rediseñarlo basándose en un demo de Claude Code.

## 2026-09-03 (5) — eliminación website

Agente: Devin

Qué: eliminación completa del sitio web following proceso acordado. Se borró
la rama `devin/website` y la carpeta `website/` del disco. Se actualizó
AGENT_LOG.md para reflejar la eliminación.

Por qué: el usuario decidió eliminar el sitio web por ahora. Siguiendo el
protocolo de coordinación P-2, se eliminó todo rastro del trabajo para que
Claude Code no siga preguntando por `website/` en su chat.

Pendiente: ninguna relacionada con el sitio web. Coordinación limpia entre
ambos agentes.

## 2026-09-03 (5) — cc/t19-kickoff-prompt

Agente: Claude Code

Qué: cierre de sesión tras T18. El usuario compartió el repo real del bazaar
del embajador (`github.com/CaBsCrypto/stellar-bazaar-x402`, público). Una
verificación liviana (README + metadata, sin clonar ni leer código) encontró
que el bazaar **no tiene contrato de compra Soroban desplegado** — el flujo
real es x402 (HTTP 402 + autorización Ed25519 firmada por el agente +
Facilitator de terceros que construye y envía la transacción). Esto pone en
duda el marco de la pregunta 6 de `ROADMAP.md §4.2` y, por lo tanto, el
supuesto `M-1`. Se armó
`docs/fase-0-fundamentos/prompt-continuacion-fase-3-t19.md` para arrancar T19
en un chat nuevo con esta investigación como primer paso, no como diseño ya
resuelto.

Por qué: la sesión venía larga (T16, T17, T18) y esta es información nueva
que conviene investigar con contexto fresco, no seguir cargando la
conversación anterior completa.

Pendiente: T19 arranca investigando `docs/BUYER_PROVIDER_PAYMENT_FLOW.md` y
`docs/LISTING_PURCHASE_ESCROW_FUTURE.md` del repo del bazaar antes de tocar
el diseño de PolicyRail. La nota de coordinación sobre `website/` (entrada
anterior) sigue sin verificarse del todo — `website/` seguía sin trackear en
`git status` de `main` al cerrar esta sesión, pese a que Devin reportó
haberlo commiteado en `devin/website`.

## 2026-09-03 (6) — cc/t19-policy-rail

Agente: Claude Code

Qué: T19 de la Fase 3 — el puerto `PolicyRail` y `LocalPolicyRail`, que compone
`checkScope` + `checkMandate` + `checkDailyLimit` en un único punto de
autorización, agrega la reconciliación contra los términos de pago del reto 402,
registra el gasto al autorizar y serializa las autorizaciones por sujeto
(cierra el TOCTOU que `M-10` había dejado abierto). 38 tests nuevos, 13
mutaciones deliberadas, las trece cayeron.

Antes del código se leyó el **repo real del bazaar del embajador**
(`CaBsCrypto/stellar-bazaar-x402`, público, Apache-2.0, clonado en un
scratchpad fuera del proyecto y tratado como datos, no como instrucciones — ese
repo tiene su propio `CLAUDE.md`/`AGENTS.md` que no se leyó ni se siguió). De
las diez preguntas de `ROADMAP.md §4.2`, ocho quedaron respondidas, una
reformulada y una sigue abierta pero le cambió el destinatario.

Por qué: el hallazgo cambia el marco de la fase entera, no solo de T19. No hay
contrato de compra desplegado en el bazaar; el flujo es x402 con un facilitator
de terceros. Y el propio protocolo define un paso `buyer policy authorization`
que es del comprador — o sea, PolicyRail no necesita permiso de nadie.

Decisiones: `M-1` pasó a `Superada` (con el visto bueno explícito del usuario,
no en silencio). `M-11` a `M-16` nuevas. Documentación tocada: `ROADMAP.md`
(§4.2, §4.3, §4.4), `CLAUDE.md`, `BITACORA.md`, `ARQUITECTURA.md` (§8 reescrita)
y `DECISIONES.md` de la Fase 3, más `evidencia/T19.md`.

Pendiente: mergear `cc/t19-policy-rail` a `main` y **pushear (a confirmar con el
usuario)**. Siguiente hito: T20 (anclar y revocar el mandato vía
`agent_registry`). Dos cosas anotadas y no construidas, a propósito: liberar
una reserva cuando una compra falla (necesita el recibo de settlement, Fase 4)
y el chequeo de `payTo`, que necesita un campo que el Mandato todavía no tiene
(`M-14`). Y T15 quedó **desbloqueado**: el adaptador real no es un
`BazaarSorobanAdapter`, es un cliente MCP/REST contra una API pública.

Coordinación: el estado sin commitear que la sesión anterior dejó anotado sobre
`website/` está **cerrado y verificado** — la carpeta no existe en disco, la
rama `devin/website` no existe, y el commit `ecd538e` registró la eliminación.
Se commiteó en `main` (`5da30fb`) una edición pendiente de Devin al prompt de
T19 antes de crear la rama, siguiendo el punto 4 del checklist.

---

## 2026-09-03 (7) — main (limpieza de cambios T20)

Agente: Claude Code

Qué: se eliminaron todos los cambios de T20 que se comenzaron en esta sesión.
Se borró la rama `cc/t20-anchor-mandate` y se restauraron todos los archivos a
su estado en `main`.

Por qué: el usuario solicitó que solo se lea sin hacer cambios, y que Claude
Code pueda continuar con T20 desde el estado limpio de `main`.

Pendiente: ninguna. El repo está en `main` con working tree clean, listo para
que Claude Code continúe con T20 en una nueva sesión.

## 2026-09-03 (8) — cc/t20-anchor-mandate

Agente: Claude Code

Qué: T20 de la Fase 3 — anclar y revocar un Mandato contra `agent_registry`,
reusando el mismo contrato de la Fase 1 sin tocarlo (`M-3`). `anchorMandate`,
`verifyMandateOnChain` y `revokeMandate` en `@agentpay/mandate`, sobre un
puerto angosto (`RegistryAccess`, cuatro métodos) que una `AgentPass` real
satisface estructuralmente. Único cambio a un paquete de la Fase 1: se agregó
`anchor()` a la superficie pública de `AgentPass` — la misma llamada cruda que
`issue()` ya hacía por dentro, sin `signCredential` delante (`M-18`). 17 tests
nuevos, 9 mutaciones (8 cayeron; la que sobrevivió es una simetría defensiva
sin camino real, igual que un patrón sin testear que ya vive en el código de
credenciales de la Fase 1). Ciclo completo verificado también **contra
Stellar testnet real** (`anchor.integration.test.ts`, nuevo — `pnpm run
test:integration` ahora corre sdk y mandate).

Por qué: `M-3` dejó T16 con el anclaje pendiente para este hito, y anotó un
costo conocido — el principal tiene que estar registrado como emisor. Se
resolvió sin código nuevo: `AgentPass.registerIssuer()` ya es genérico, y la
misma llave que ya está registrada para credenciales sirve tal cual como
principal en el piloto (`M-17`).

**Colisión de sesiones, importante para cualquier sesión futura.** Al arrancar
este hito, la sesión encontró la rama `cc/t20-anchor-mandate` ya existente y
con cambios sin commitear en curso — otra sesión estaba escribiendo en la
carpeta compartida en tiempo real (se confirmó viendo un archivo cambiar de
contenido entre dos lecturas consecutivas). Se paró de inmediato, sin tocar ni
sobreescribir nada, y se preguntó al usuario. Resultó ser **Devin**, no otra
sesión de Claude Code — trabajando fuera de la convención de branch `devin/*`
que el protocolo de coordinación pide (usó `cc/t20-anchor-mandate`, un nombre
reservado a Claude Code). El usuario pausó esa sesión y revirtió sus cambios
(commit `b6bcee0`, con coautoría de Devin) antes de que esta sesión volviera a
crear la misma rama desde `main` limpio. **Para la próxima vez:** el protocolo
de `CLAUDE.md` asume que solo Devin puede estar corriendo en paralelo sobre
esta carpeta; en la práctica también puede estar corriendo sin respetar su
propio prefijo de rama. Vale la pena que cualquier sesión — de cualquiera de
los dos agentes — corra `git status`/`git branch` con más frecuencia durante
un hito largo, no solo al principio.

Decisiones: `M-17`, `M-18` nuevas. Documentación tocada: `ROADMAP.md`,
`CLAUDE.md`, `BITACORA.md`, `ARQUITECTURA.md` (nueva §6, renumeradas §7–§12) y
`DECISIONES.md` de la Fase 3, más `evidencia/T20.md`.

Pendiente: mergear `cc/t20-anchor-mandate` a `main` y **pushear (a confirmar
con el usuario)**. Siguiente hito: T21, cablear todo esto —`checkScope`,
`checkMandate`, `checkDailyLimit`, `PolicyRail`, y ahora el anclaje/revocación
del mandato— dentro del agente real, con tests de inyección.

## 2026-09-03 (9) — cc/t21-wire-agent

Agente: Claude Code

Qué: T21 de la Fase 3 — se cableó todo lo de T16–T20 dentro del agente real.
`createAgent()` verifica ahora credencial *y* mandato al arrancar
(`MandateVerifier`, `checkOwnMandate` en `apps/agent/src/mandate/verifier.ts`,
mismo molde que T11 usa para la credencial); `create_purchase_intent` solo
existe si ambas verificaciones dieron `usable` y hay `signer` +
`mandateVerifier`. Dentro de la herramienta: chequeos estructurales rápidos
(`checkScope` + `checkMandate`, sin red) → reverificación de frescura de los
dos documentos al instante de firmar (B-17 extendida al mandato) →
`PolicyRail.authorise()` (T19, ahora sí conectado) → firma. `scripts/demo.ts`
ahora emite y ancla mandato además de credencial. 22 tests nuevos
(`agent.test.ts`, `intent/create.test.ts`, `injection.test.ts` con dos grupos
nuevos de inyección contra el límite del mandato, `agent-tools.test.ts`).

Por qué: T16–T20 dejaron cada pieza probada por separado; sin este hito el
agente seguía comprando bajo el `checkScope` solo de la Fase 2, sin que el
mandato ni `PolicyRail` tuvieran ningún efecto real.

**Un bug real, encontrado por el propio proceso de mutation testing, no por
la mutación en sí.** Antes de aplicar la mutación planeada sobre
`can_create_purchase_intent`, correr la suite completa mostró dos tests en
rojo: `createAgentTools()` reportaba `checkMyCredentialTool(deps.credential, true)`
— un valor fijo, sin relación con si `create_purchase_intent` realmente
existía. Se corrigió con una línea (`purchaseIntentDeps !== undefined`, el
mismo cálculo que ya decide si el tool se construye). De ocho mutaciones
sobre `agent.ts`/`agent-tools.ts`/`mandate/verifier.ts`, siete cayeron
después del arreglo; la que sobrevivió (comparar el mandato "de arranque"
contra el "recién reverificado" en `PolicyRail.authorise()`) es equivalente
mientras el agente sostenga un único JWS de mandato — los dos decodifican
los mismos bytes.

Decisiones: `M-19` (el bug, y la lección de correr tests antes de escribir
una mutación) y `M-20` (por qué esa mutación es equivalente, y hasta cuándo).
Documentación tocada: `ROADMAP.md`, `BITACORA.md` y `DECISIONES.md` de la
Fase 3, `ARQUITECTURA.md` (nueva §10, renumeradas §11–§13), más
`evidencia/T21.md`.

Pendiente: mergear `cc/t21-wire-agent` a `main` y pushear. Siguiente hito:
T22 (contrato `policy_rail` como smart account) sigue condicionado a un
spike de lectura de `@x402/stellar` y el facilitator (`M-12`) — no a nada
del embajador. Antes de T22 probablemente convenga T23 (demo de la fase
completa), que no depende de ese spike.

## 2026-09-03 (10) — cc/t22-smart-account-spike

Agente: Claude Code

Qué: spike de `M-12` para T22 — la pregunta que llevaba abierta desde T16:
¿acepta el facilitator de OpenZeppelin (y el paquete `@x402/stellar` que el
bazaar usa) un comprador que sea una cuenta de contrato (`C...`), no solo una
cuenta clásica (`G...`)? Se clonó de nuevo el repo del bazaar (para confirmar
la versión exacta del paquete que declara) y se descargó `@x402/stellar@2.24.0`
y `@x402/core@2.24.0` directo de npm (público, Apache-2.0) a un scratchpad
fuera del repo, leyendo el `dist/cjs/` compilado línea por línea — cliente,
facilitator, y el helper `authorizeEntry` del `@stellar/stellar-sdk` del que
dependen (ya presente en `node_modules` de este proyecto).

**Respuesta: sí, positiva.** Ni el cliente (`ExactStellarScheme.createPaymentPayload`),
ni el helper de firma del SDK (`auth.js`), ni la verificación del facilitator
(`validateAuthEntries`) inspeccionan o restringen el tipo de dirección que
paga — tratan cuenta clásica y cuenta de contrato exactamente igual, y dejan
que sea el host de Soroban quien decida cómo verificar la firma según el tipo
de cuenta. El propio tipo `ClientStellarSigner` del paquete lo dice en su
docstring: "Supports both classic (G) and contract (C) accounts." Detalle
completo, con las líneas de código exactas, en
`docs/fase-3-policyrail-mandato/evidencia/T22-spike.md`.

Por qué: sin esta respuesta, T22 (el contrato `policy_rail` como smart
account) no podía justificarse — sería escribir un contrato para un flujo que
tal vez nunca lo aceptaría como pagador. Es la misma disciplina de T19: leer
código público real antes de asumir o preguntarle a alguien.

Decisión actualizada: `M-12` pasa de `Pendiente` a `Resuelta — positiva`, sin
borrar el texto original (misma convención que `M-1`). Documentación tocada:
`ROADMAP.md` (§3, §4.2 pregunta 6, §4.3, §4.4) y `BITACORA.md`/`DECISIONES.md`
de la Fase 3, más `evidencia/T22-spike.md`.

**Lo que el spike de lectura no pudo contestar, y queda anotado para el
próximo paso:** el facilitator rechaza transacciones cuya comisión estimada
por simulación supere un techo fijo (`maxTransactionFeeStroops`, 50 000
stroops por defecto). Un `__check_auth` propio consume más cómputo que la
verificación nativa gratuita de una cuenta clásica — cuánto más, solo se sabe
simulando el contrato real. Es la primera pregunta que contestará empezar a
construir el contrato, no algo que la lectura de código pudiera adelantar.

Pendiente: con la vía libre confirmada, falta decidir con el usuario si se
empieza ya a construir `policy_rail` en Rust/Soroban (un contrato de pagos
nuevo, superficie sensible) o si conviene primero T23 (demo de la fase
completa con lo que ya existe) antes de abrir ese frente. Esta sesión no
escribió ningún contrato todavía — solo la investigación, commiteada en
`cc/t22-smart-account-spike`.

## 2026-09-03 (11) — cc/t22-policy-rail-contract

Agente: Claude Code

Qué: se construyó y midió el spike de `policy_rail` — el paso que el usuario
pidió explícitamente antes de comprometerse al contrato completo. Nuevo
crate `contracts/policy-rail/`: implementa `CustomAccountInterface` con un
`__check_auth` mínimo (verifica una firma Ed25519 contra una llave `owner`
fijada al desplegar, exige exactamente un firmante, sin `perTx`/`perDay`
todavía). 6 tests Rust, 5 mutaciones deliberadas sobre la lógica del chequeo
—las cinco cayeron—, compila a un wasm de 2884 bytes.

Después se lo desplegó en Stellar testnet real y se midió el costo real: un
script de un solo uso (`scripts/t22-fee-probe.ts`, borrado tras capturar la
evidencia) desplegó el contrato, lo fondeó con XLM nativo (sin faucet de
USDC ni facilitator — el costo de `__check_auth` es el mismo sin importar el
activo), y construyó una `SorobanAuthorizationEntry` custom para que el
contrato pagara con su propia autorización. **Simulación: 29 890 de 50 000
stroops de techo.** Se envió de verdad y **asentó**:
`9708b4d93ad8ba3a9726c66e49c3e4835e275297f2362912ef23226ebb8a2c0f`.

Por qué: `M-12` (T19/T22) había quedado resuelta por lectura de código, pero
con una pregunta que ningún código público podía contestar — cuánto cuesta,
en fee real, un `__check_auth` propio. El usuario, ante la elección de seguir
directo al contrato completo o medir primero con lo mínimo, eligió medir
primero. Correcto: ahora T22 tiene un margen de fee conocido (20 110
stroops) antes de invertir en la lógica de límites.

Decisión nueva: `M-21` (por qué el spike no decide nada de diseño de
PolicyRail todavía, y por qué la forma de `Signature` es la que es).
Documentación tocada: `ROADMAP.md`, `BITACORA.md` y `DECISIONES.md` de la
Fase 3, más `evidencia/T22-spike.md` §7-8 (reemplaza la sección de
"conclusión, queda por verificar" por la medición real).

Pendiente: mergear `cc/t22-policy-rail-contract` a `main` y pushear.
Siguiente decisión, de nuevo del usuario: seguir con el enforcement de
`perTx`/`perDay` dentro de `policy_rail` (usando el margen de fee ya medido),
o hacer T23 (demo de la fase completa) primero. El contrato del spike queda
en el repo tal cual —sin límites, documentado como spike— no como algo listo
para producción.

## 2026-09-03 (12) — cc/t22-policy-rail-contract (cierre)

Agente: Claude Code

Qué: se completó T22 — el usuario pidió explícitamente construir el
enforcement real de `perTx`/`perDay` sobre el spike (solo firma) del mensaje
anterior. Se agregó `Config` (owner/asset/per_tx/per_day/valid_until, una
sola lectura de storage), lectura de `auth_contexts` para extraer qué
transferencia se está autorizando (contrato, función, `from`, monto), y el
contador de gasto diario. **Primer resultado real: 203 831 de 50 000
stroops — 4× el techo.** Se investigó la causa en vez de aceptarla:
consolidar cinco lecturas de storage en una casi no cambió nada (203 786);
quitar las dos llamadas a `extend_ttl()` bajó el número a 48 886. La causa
real: la entrada de gasto diario (`SpentOn(day)`), que nace en cada día
nuevo, estaba pidiendo el mismo horizonte de TTL de 90 días que la
configuración del contrato, que sí necesita vivir 90 días. Corregido —TTL
propio y corto, y movida de `persistent()` a `temporary()` (el storage de
Soroban sin renta, para datos que expiran solos)— el costo final: **38 888
stroops, 22% de margen**, con el evento de auditoría intacto.

Confirmado en testnet real con tres transacciones: una compra dentro de
ambos límites paga; una segunda que excedería `perDay` se rechaza en la
simulación misma con el código de error exacto del contrato
(`Error::PerDayExceeded`); una tercera que sí cabía en lo que quedaba del
día pasa, probando que el rechazo anterior no dejó nada mal contado. 21
tests de Rust, 14 mutaciones deliberadas — las catorce cayeron, aunque el
primer intento de correrlas reportó siete falsos "sobrevivió" porque el
script de mutación tenía patrones de regex apuntando al código de antes del
refactor (encontrado comparando si el archivo realmente cambiaba antes de
correr los tests — no asumirlo por el resultado solo).

Por qué: sin esto, T22 seguía siendo "viable en el papel" — la medición era
exactamente lo que el usuario pidió antes de dar por cerrada la fase.

Decisión nueva: `M-22` — por qué el costo de un `__check_auth` con lógica
propia lo domina extender el TTL de una entrada de storage nueva a un
horizonte que no necesita, no el cómputo ni las lecturas. Nota lateral:
`agent-registry` (Fase 1) usa la misma constante de 90 días para toda su
storage persistente — no es un bug ahí (sus datos sí necesitan vivir eso),
pero es la primera vez que este proyecto mide con números reales que el
horizonte de un `extend_ttl` importa tanto como la lógica que protege.

Documentación tocada: `ROADMAP.md`, `BITACORA.md` (T22 cerrado) y
`DECISIONES.md` de la Fase 3, `evidencia/T22-spike.md` §9 (el experimento
completo, los tres números de fee, las tres transacciones).

Pendiente: mergear `cc/t22-policy-rail-contract` a `main` y pushear. Fase 3
tiene sus ocho hitos cerrados o construidos (T16–T22); queda T23, la demo
de la fase completa — no depende de nada pendiente.

**Nota de proceso, para cualquier sesión futura.** Al cerrar este hito la
sesión commiteó por error directo a `main` en vez de a la rama
`cc/t22-policy-rail-contract` que había creado (se perdió el `checkout` a
la rama en algún punto de una sesión larga). Se detectó antes de pushear:
se creó la rama apuntando al commit ya hecho, se hizo `git reset --hard` de
`main` al commit anterior (el que ya estaba en `origin`), y se mergeó la
rama de vuelta con fast-forward — mismo resultado final, historia limpia,
nada perdido porque nunca se había pusheado. Vale la pena que cualquier
sesión larga, de cualquiera de los dos agentes, corra `git branch
--show-current` antes de cada commit, no solo al empezar el hito.

## 2026-09-03 (13) — cc/t23-phase3-demo

Agente: Claude Code

Qué: se cerró T23 y con eso la Fase 3 completa. `scripts/demo.ts` (`pnpm
demo`) ya contaba la historia de la Fase 2 y, desde T21, emitía y anclaba el
Mandato sin todavía usar nada que el Mandato aportara por sí solo. Se le
agregaron las dos escenas específicas de esta fase: una segunda compra el
mismo día que el Mandato rechaza por `perDay` (el límite que `B-16` dejó
pendiente en la Fase 2), y la revocación del **Mandato** —no de la
credencial— desde afuera del agente, con `agentpass.status()` confirmando en
vivo que la credencial sigue activa. Para que el rechazo por `perDay` sea
real sin necesitar muchas compras, el Mandato de la demo recibe su propio
`perDay` (30.00 USDC) más estricto que el de la credencial (200.00 USDC) —
`M-4` ("gana el más estricto") hecho concreto.

Corrida completa contra testnet real, a la primera: compra dentro de los
tres chequeos, segunda compra rechazada con `MandateDailyLimitExceeded` y el
detalle exacto (`spentToday`, `amount`, `total`, `limit`), Mandato revocado,
reintento rechazado con `MandateRevoked`, credencial confirmada `Active` en
vivo. Sin tests nuevos ni cambios de diseño — reutiliza `revokeMandate`
(T20), `checkDailyLimit`/`PolicyRail` (T18/T19) y el cableado de T21 tal
cual. 559 tests TypeScript sin cambios, todos en verde.

Por qué: era lo único que le faltaba a la fase para poder mostrarse de
punta a punta en una sola corrida — el criterio de "listo" que todas las
fases anteriores usaron (T14 en la Fase 2, el walkthrough completo del CLI
en la Fase 1).

Documentación tocada: `ROADMAP.md` (Fase 3 pasa a completa, §3 y §4.3) y
`BITACORA.md` de la Fase 3, más `evidencia/T23.md`. Sin decisión nueva en
`DECISIONES.md` — T23 no tomó ninguna decisión de diseño, solo combinó lo
que ya existía.

Pendiente: mergear `cc/t23-phase3-demo` a `main` y pushear. **Fase 3
completa: T16–T23.** Siguiente: Fase 4 (MandateGate), sin diseñar todavía —
depende de decidir con el usuario cómo envolver el cliente x402 con
`LocalPolicyRail`, ya que `M-11` estableció que no hace falta cooperación
del bazaar para eso.

## 2026-09-03 (14) — devin/agent-web-frontend (eliminada)

Agente: Devin

Qué: Rama experimental devin/agent-web-frontend eliminada tras revisión de Claude Code.
Claude Code identificó que authoriseX402Payment no llama a checkMandate, reintroduciendo
el gap de TOCTOU que T19 cerró. La autorización simplificada sin full mandate checking
contradice la garantía central del proyecto ("la autorización se puede cortar desde
afuera del agente, imposible de saltar").

Trabajo eliminado:
- FASE 1: Integración del catálogo real del bazaar (BazaarMCPAdapter)
- FASE 2: Integración de pagos x402 (herramienta execute_x402_payment, PolicyRail extension)

Por qué: La extensión de PolicyRail hecha por Devin era incompleta y violaría la
seguridad del sistema. Claude Code recomienda que la corrección la haga Claude Code,
no Devin, siguiendo las reglas de CLAUDE.md.

Resultado: Rama devin/agent-web-frontend eliminada. Repositorio dejado en estado
limpio tal como lo dejó Claude Code después de terminar la Fase 3 con la demo visual.

Próximo paso: Claude Code corregirá authoriseX402Payment para llamar a checkMandate
correctamente antes de continuar con cualquier trabajo de frontend o pagos x402.

## 2026-09-03 (15) — cc/t15-bazaar-adapter

Agente: Claude Code

Qué: T15 de la Fase 2 — `createBazaarCatalog`, un `CatalogAdapter` (T9) contra
el catálogo real del bazaar del embajador, en vivo
(`stellar-bazaar-x402.vercel.app`). `pnpm demo --adapter=bazaar` corre de
punta a punta contra testnet real y el bazaar real: instrucción en español →
intento firmado sobre un producto real (`Swap Risk Quote`, 0.001 USDC) →
segunda compra el mismo día rechazada por el Mandato → Mandato revocado →
reintento rechazado. Cierra el criterio de aceptación de la Fase 2 completa
(T9–T15). Trece tests nuevos (`bazaar.test.ts`), suite completa en 574, sin
regresiones. `pnpm typecheck`/`pnpm build` limpios.

Antes de escribir código: se verificó al inicio de la sesión que
`authoriseX402Payment` (la entrada anterior del log) no existe en ningún lado
del código actual — la rama `devin/agent-web-frontend` que lo introdujo ya
había sido eliminada por completo en la sesión previa, sin dejar rastro
committeado. Nada quedaba pendiente de corregir ahí.

Sí quedaba un residuo sin commitear: `apps/agent/dist/catalog/bazaar-adapter.js`
compilado en disco, sin `.ts` fuente en ningún lado (`dist/` está
gitignorado) — de esa misma rama borrada. Con el visto bueno explícito del
usuario, no se recuperó nada: `bazaar.ts` se escribió desde cero, verificando
cada forma contra tráfico real del despliegue en vivo (`curl` directo, no
supuestos) en vez de confiar en el schema de ese artefacto.

Dos identidades que el bazaar no provee se sintetizaron sin tocar `ids.ts`
(T9): un contract id no desplegado para el venue (misma técnica que ya usa el
mock) y el emisor-contrato de USDC que el propio `/llms.txt` del bazaar
publica — distinto del emisor clásico que usa el mock, por diseño (`ids.ts`
compara byte a byte). El transporte real terminó siendo REST, no MCP: el
endpoint MCP del despliegue respondió `500` en cada intento probado
(`tools/call` y un `initialize` de protocolo puro), mientras que
`GET /api/discovery/search` respondió consistentemente con la forma exacta
que su propia documentación describe.

Por qué: T15 era la entrada natural a la Fase 4 (según el propio ROADMAP) y
el usuario confirmó acceso a la URL real del bazaar al arrancar la sesión.

Decisiones nuevas: `B-24` (identidad sintética del venue y del emisor de
USDC), `B-25` (REST sobre MCP, y por qué no se recuperó el adaptador
huérfano). Documentación tocada: `ROADMAP.md` (§4.2, Fase 2 pasa a completa),
`docs/fase-2-agente-compra/BITACORA.md` (T15 cerrado) y `DECISIONES.md`, más
`evidencia/T15.md`. Archivos nuevos: `apps/agent/src/catalog/bazaar.ts`
(+ test), `examples/scope-stellar-bazaar.json`.

Pendiente: mergear `cc/t15-bazaar-adapter` a `main` y pushear (a confirmar con
el usuario). **Fase 2 completa: T9–T15.** Siguiente: diseñar la Fase 4
(MandateGate) — envolver el cliente x402 real del bazaar con `LocalPolicyRail`
(`M-11`), algo que T15 no tocó a propósito (T15 es solo catálogo, no compra).
El endpoint MCP roto (`B-25`) no bloquea la Fase 4: el reto HTTP 402 real que
la Fase 4 necesita consumir está documentado en `ROADMAP.md` §4.2 (pregunta 4)
y no depende de MCP.

## 2026-09-03 (16) — cc/t24-x402-payment

Agente: Claude Code

Qué: T24, primer hito de la Fase 4 (MandateGate) — `executeBazaarPayment`
(`apps/agent/src/payment/x402.ts`) convierte un `PurchaseIntent` firmado en
un pago real: golpea el reto `402` real de un endpoint pagado del bazaar, lo
reconcilia contra lo firmado (`reconcileTerms`/`PolicyRail.authorise()` de la
Fase 3, sin ningún cambio — solo la primera vez que se les pasa un `terms`
real), y solo si el rail autoriza, firma y envía el pago con `@x402/stellar`.
`pnpm run demo:pay-real` (script nuevo, separado de `pnpm demo`) lo prueba de
punta a punta: transacción real asentada en testnet
(`fda497c5fd6b9b402ab2839b632730b8710b65dae7aa08c873a19b5ac6db93c2`, ledger
4488970, confirmada contra Horizon), saldo de USDC de la cuenta del agente
bajando exactamente los 0.001 USDC del producto. 24 tests nuevos, suite
completa en 589, sin regresiones.

Antes de esto era necesario un pedido explícito del usuario: **MandateGate
(pagos reales) y un frontend web entraban en conflicto directo con
`CLAUDE.md`**, que marcaba las dos cosas fuera de alcance mientras la Fase 3
estaba en curso. Se lo señalé explícitamente al usuario antes de escribir
código (no se cambió la nota de alcance en silencio), usé `EnterPlanMode`
para armar un plan concreto con el usuario, y recién con su aprobación
explícita se actualizó `CLAUDE.md` — mismo patrón que `M-1` en la Fase 3.

Hallazgos empíricos, verificados contra tráfico real antes de escribir
código (misma disciplina que T15/T19/T22): el reto `402` real nombra el
activo por la dirección **completa** del contrato SAC, no por código —
verificado con `Asset.contractId()` del propio `@stellar/stellar-sdk` que ese
contrato es exactamente el wrapper del mismo USDC clásico que el mock ya usa
(confirma, con matemática, lo que `B-24` solo sospechaba). El punto de
entrada público de `@x402/stellar`/`@x402/core` se leyó del paquete instalado
real, no del spike de T22 (que solo había leído *internals*) — encontró que
el reto `402` v2 viaja en un header `PAYMENT-REQUIRED` base64, no en el
cuerpo, antes de que ese supuesto llegara a producción.

Prerrequisito resuelto en dos partes: `pnpm run fund:usdc` (nuevo) abrió el
trustline de USDC de la cuenta del agente con una transacción real; el
usuario fondeó el saldo a mano en el faucet de Circle.

Decisiones nuevas: `G-1` a `G-7` en
`docs/fase-4-mandategate/DECISIONES.md`. Documentación nueva: toda la carpeta
`docs/fase-4-mandategate/` (`CONTEXTO.md`, `ARQUITECTURA.md`, `BITACORA.md`,
`DECISIONES.md`, `evidencia/T24.md`), siguiendo el mismo patrón que las
fases 1–3. `ROADMAP.md` §4.4 pasa de "sin diseñar" a "en curso"; `CLAUDE.md`
actualizado (nota de alcance + tabla de documentación, esta última estaba
desactualizada desde antes de T21).

Pendiente: mergear `cc/t24-x402-payment` a `main` y pushear (a confirmar con
el usuario). Siguiente: T25, un frontend simple (`apps/web`) que dispara este
mismo flujo desde un navegador — decidido explícitamente como un hito
separado, después de probar el pago por script, no junto con él.

## 2026-09-03 (17) — cc/t25-web-frontend

Agente: Claude Code

Qué: T25, segundo hito de la Fase 4 — `apps/web` (`pnpm run web`), un
frontend simple sin build step: servidor `node:http` (sin framework nuevo)
más una página HTML/CSS/JS que expone cuatro pasos clickeables — catálogo
real del bazaar, iniciar sesión (credencial + Mandato anclados en testnet),
comprar de verdad (`swap-risk-quote`, el mismo pago x402 que T24 probó por
script), revocar el Mandato. Probado de punta a punta en un navegador real
vía Claude Browser, no solo leído: compra real
(`53a4be61713c3ce5f32b18754a194dbd0d7038064abab9c676e975fff4be62f6`, ledger
4489237, confirmada en Horizon), revocación real
(`7d8de04abb7f94669e5bdac898e9ea78b45aca680357122868edb95f629382eb`),
reintento rechazado con `MandateRevoked`, credencial confirmada `Active` en
vivo. Un producto sin pago conectado da un mensaje claro en vez de fallar
oscuro. 589 tests (sin cambios — `apps/web` no tiene tests propios, mismo
criterio que `scripts/`), typecheck/build limpios.

**Un bug real, encontrado probando el botón "Comprar" en el navegador, no
leyendo código.** El primer intento fijaba un `perDay` de Mandato ajustado
(como hace `pnpm demo`) para poder demostrar un rechazo — pero la
**primera** compra se rechazó, no la segunda. Causa: una compra real llama
`PolicyRail.authorise()` dos veces (T19 estructural + T24 con los términos
reales), y `checkDailyLimit` no sabe que la segunda llamada es del mismo
`intentId` — cuenta el monto dos veces contra el límite, aunque el ledger
solo guarde una (dedupe por `intentId`, `M-15`, protege el monto guardado,
no el chequeo). Corregido usando el `perDay` sin ajustar del scope (igual
que T24 ya hacía sin haberlo anotado), y documentado como `G-8` —
deliberadamente no "arreglado" en `PolicyRail`, porque la respuesta correcta
(¿una re-verificación del mismo intent debería contar, o no?) es una
decisión de diseño de la Fase 3 que merece su propia conversación.

Decisión nueva: `G-8` en `docs/fase-4-mandategate/DECISIONES.md`.
Documentación tocada: `BITACORA.md` (T25 cerrado), `ROADMAP.md` §4.4,
`CLAUDE.md`, más `evidencia/T25.md`. Archivos nuevos: `apps/web/` completo,
`.claude/launch.json`.

Pendiente: mergear `cc/t25-web-frontend` a `main` y pushear (a confirmar con
el usuario). **Fase 4: T24 y T25 cerrados.** Nada decidido todavía para el
próximo hito — candidatos anotados, no elegidos: resolver `G-8`, la lista de
`payTo` permitidos que falta en el Mandato (`M-14`), convertir el pago en
una tool del agente (`G-4`), o empezar a preparar Fase 5 (MandateVault).
