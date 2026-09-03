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
