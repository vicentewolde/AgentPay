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
