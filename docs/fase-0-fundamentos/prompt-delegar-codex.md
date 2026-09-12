# Prompt de delegación — T62 y T63 (F8, hardening)

> Generado el 2026-09-12, para pegar como primer mensaje en `~/dev/AgentPay-codex`
> (Codex, en su propio worktree — nunca en `~/dev/AgentPay`). Reemplaza el
> prompt anterior de T59 (cerrado, PR #18 mergeado).

---

CONTEXTO

Este es AgentPey (nombre de marca definitivo desde `P-11`, ya ejecutado —
ver más abajo), un proyecto de pagos agénticos sobre Stellar testnet. Repo
público: `github.com/vicentewolde/AgentPey` (renombrado, la URL vieja
`github.com/vicentewolde/AgentPay` redirige sola), rama `main`. Trabajás en
tu propio worktree (`~/dev/AgentPay-codex`), nunca en `~/dev/AgentPay`.
Arrancá siempre desde `origin/main` fresco: `git fetch origin && git
checkout -B codex/t62-t63-hardening origin/main`.

**Antes de escribir nada, corré `git log --oneline -10` contra
`origin/main`** — el commit más reciente es `19dd596` ("fix(vault): perDay
survives two processes for real (T61, C-67)"). Si no lo ves en tu `git
log`, tu `origin` está desactualizado — hacé `git fetch` de nuevo antes de
seguir.

Estado del proyecto que este prompt asume como cierto:

- **El rename a AgentPey ya se ejecutó** (`docs/DECISIONES.md` → `P-11`,
  `docs/fase-6-agentguard-comercializacion/DECISIONES.md` → `C-64`/`C-65`):
  el scope de npm es `@agentpey/*` (`@agentpass/*`, de la Fase 1, sigue sin
  tocarse — es un nombre de módulo, no la marca), el repo de GitHub ya es
  `AgentPey`. Usá `@agentpey/*` en cualquier import nuevo, nunca
  `@agentpay/*`.
- **T61 cerró el 2026-09-12** y tocó de lleno
  `packages/vault/src/postgres-vault.ts` — el archivo que este mismo
  prompt te pide tocar (`T62`). Leé el archivo tal como está en
  `origin/main` antes de editarlo: `append()` ahora abre una transacción y
  toma un `pg_advisory_xact_lock` por `tenantId`; no reviertas ni
  reinterpretes esa lógica, tu cambio es únicamente la opción `ssl` del
  `new Pool({ ... })`.
- El rail compartido de la demo se migró a un contrato nuevo el mismo día
  (`C-66`) — no relevante para esta tarea, pero si tu `git log` no lo
  tiene, tu `origin` está viejo.

Antes de empezar, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas 10-15 entradas, especialmente las de
   la migración del rail compartido y T61.
2. `docs/fase-6-agentguard-comercializacion/PLATAFORMA-PARTNERS.md` § F8 —
   la tabla tiene el criterio de aceptación exacto de `T62` y `T63`.
3. `docs/fase-6-agentguard-comercializacion/DECISIONES.md` → `C-32` (por
   qué nunca se serializa un error crudo de `pg` — tiene la contraseña de
   la base adentro) y `C-67` (qué cambió en `postgres-vault.ts` con T61).
4. `CLAUDE.md`, en la raíz, sección "Coordinación con Codex" completa.
5. `AGENTS.md`, en la raíz.

Son dos tickets independientes entre sí (tocan archivos distintos, ninguno
depende del otro) — podés hacerlos en el orden que prefieras, pero en un
solo PR o en dos, como te resulte más cómodo de revisar. Si hacés dos PRs,
decilo explícitamente al cerrar.

---

## T62 — verificación real de CA en las conexiones a Postgres

**Qué hace falta.** Hoy, tanto `packages/vault/src/postgres-vault.ts` como
`packages/directory/src/directory.ts` conectan a Postgres con
`ssl: { rejectUnauthorized: false }` — cifra la conexión, pero no valida
que el certificado del servidor sea el que dice ser. Es el trade-off que
casi toda guía de "conectar a Supabase desde Render/Vercel/Heroku" hace,
porque el bundle de CAs por defecto de Node no trae la cadena de Supabase.
El ticket es cerrar ese hueco sin romper el trade-off original: la opción
tiene que poder verificar de verdad la CA cuando se le da una, y fallar
**cerrado** (tirar un error claro, no conectar en silencio sin verificar)
si se pide verificación y la CA no es válida — nunca degradar a "sin
verificar" calladamente.

**Forma esperada.** Algo en la línea de: la opción `ssl` acepta, además de
lo que ya acepta hoy, una forma que incluya el certificado de la CA (por
ejemplo `ssl: { ca: <contenido del cert>, rejectUnauthorized: true }`,
leído de una variable de entorno nueva — vos elegís el nombre, documentalo
en `.env.example` con un comentario que explique de dónde se saca ese
certificado (el de Supabase, u otro proveedor de Postgres). Si esa
variable no está seteada, el comportamiento por default debe seguir siendo
el actual (`rejectUnauthorized: false`) — este ticket agrega una opción
más segura, no cambia el default de un piloto que ya funciona así hace
meses sin que nadie lo haya pedido cambiar.

**Qué significa "fallar cerrado" acá, en concreto:** si el código nuevo
recibe una CA y esa CA no verifica contra el certificado real del
servidor, la conexión tiene que fallar con un error claro (mismo patrón
`AgentPassError`/`ConfigError` que ya usa este archivo) — nunca capturar
ese fallo y reintentar sin verificación, ni silenciarlo.

**Archivos permitidos:** `packages/vault/src/postgres-vault.ts` (**solo**
la opción `ssl` del `new Pool(...)` — no toques nada de lo que T61 agregó:
`append()`, el advisory lock, `spentOn()`), `packages/directory/src/directory.ts`
(**solo** la opción `ssl` del cliente de Postgres que ya usa — línea 427 y
el tipo de la línea 98 al momento de escribir esto), `.env.example` (para
documentar la variable nueva).

**Verificación que el PR tiene que mostrar.** Un test que confirma que,
sin la variable de CA seteada, el comportamiento es exactamente el de
hoy (no hay regresión). Si podés armar un test que efectivamente ejercite
una verificación de CA real o simulada fallando cerrado, mejor — si no es
practicable en CI sin un certificado real a mano, documentá en el PR por
qué no y qué se probó a mano en su lugar.

---

## T63 — logging estructurado, sin filtrar nunca un error crudo

**Qué hace falta.** `apps/web/src/server.ts` hoy no loguea nada del lado
del servidor — un error se convierte en la respuesta JSON que ve el
cliente (`errorBody(error)`, ya existente) y ahí termina; quien opera el
piloto no tiene forma de ver en los logs de Render qué está fallando sin
que alguien se lo reporte primero. El ticket agrega logging estructurado
mínimo — sin librería nueva, `console.log`/`console.error` con una forma
consistente (por ejemplo JSON de una línea: `{ level, msg, ...campos }`)
alcanza.

**La regla que no se negocia (`C-32`).** Un error de `pg` (el driver de
Postgres) lleva la contraseña de la conexión adentro de sí mismo
(`connectionParameters`) — cualquier log que serialice el objeto de error
completo la publica en texto plano en los logs de Render. **Ningún log
nuevo puede serializar un error crudo** (`JSON.stringify(error)`,
`console.error(error)` a secas, o pasarlo tal cual a cualquier función que
lo serialice) — siempre `error.message`, nunca el objeto. El código que ya
existe en este mismo repo (`postgres-vault.ts`, T33) ya sigue esta regla —
usalo como referencia exacta de qué extraer de un error atrapado.

**Forma esperada.** Un módulo nuevo, `apps/web/src/logging.ts`, con una
función mínima (algo como `log(level, msg, fields?)`) que arme la línea
estructurada y la escriba a stdout/stderr según corresponda. Cablealo en
los `catch (error)` de `apps/web/src/server.ts` que hoy no loguean nada —
no hace falta tocar los 20 y pico que hay, priorizá los que ya devuelven
un error 500/`ConfigError`/`NetworkError` (fallas de infraestructura, no
rechazos esperables como `ScopeAmountExceeded`, que no son un problema
operativo).

**Archivos permitidos:** `apps/web/src/logging.ts` (nuevo),
`apps/web/src/server.ts` (solo agregar llamadas a `log(...)` en los
`catch` existentes — no cambies la lógica de negocio ni las respuestas
que ya arma cada handler).

**Verificación que el PR tiene que mostrar.** Un test de `logging.ts`
que confirma que, dado un error con un campo sensible tipo
`connectionParameters.password`, la línea logueada nunca contiene ese
valor — solo `error.message`. Y una corrida real (`pnpm run web` local,
forzar algún error conocido) mostrando que el log nuevo aparece en la
consola del servidor con esa forma.

---

CIERRE

Al terminar cada ticket (o los dos juntos, si van en un solo PR): `pnpm
build`, `pnpm typecheck`, `pnpm test` en verde, PR con diff completo,
entrada en `docs/AGENT_LOG.md` (branch, qué, por qué, qué queda
pendiente) — no es opcional. Yo (Claude Code) reviso el PR antes de
mergear, en un worktree aislado — no se mergea a ciegas, con atención
particular a la superficie de seguridad de transporte que toca `T62`
(`postgres-vault.ts`/`directory.ts`) y a que ningún log de `T63` filtre
algo que `C-32` ya identificó como sensible.
