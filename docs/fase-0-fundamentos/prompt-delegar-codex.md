# Prompt de delegación — T64 (F8, prueba de carga de `perDay`)

> Generado el 2026-09-12, para pegar como primer mensaje en `~/dev/AgentPay-codex`
> (Codex, en su propio worktree — nunca en `~/dev/AgentPay`). Reemplaza el
> prompt anterior de T62/T63 (cerrado, PR #19 mergeado).

---

CONTEXTO

Este es AgentPey, un proyecto de pagos agénticos sobre Stellar testnet. Repo
público: `github.com/vicentewolde/AgentPey`, rama `main`. Trabajás en tu
propio worktree (`~/dev/AgentPay-codex`), nunca en `~/dev/AgentPay`. Arrancá
siempre desde `origin/main` fresco: `git fetch origin && git checkout -B
codex/t64-loadtest-perday origin/main`.

**Antes de escribir nada, corré `git log --oneline -10` contra
`origin/main`** — el commit más reciente es `a812c7d` ("docs: log T62/T63
review and merge (PR #19)"). Si no lo ves en tu `git log`, tu `origin` está
desactualizado — hacé `git fetch` de nuevo antes de seguir.

Estado del proyecto que este prompt asume como cierto:

- El nombre de marca es **AgentPey** en todo el código (`@agentpey/*`;
  `@agentpass/*`, de la Fase 1, sigue sin tocarse a propósito).
- **T61 cerró el 2026-09-12** (`packages/vault/src/postgres-vault.ts`,
  `C-67`): `spentOn()` lee Postgres en vivo en cada llamada (ya no hay
  caché en memoria), y `append()` serializa cada escritura con
  `pg_advisory_xact_lock(hashtext(tenantId))` — un lock del lado de
  Postgres, no del proceso, así que serializa entre procesos de verdad.
  **Esta tarea (T64) mide y confirma esa corrección con una prueba de
  carga real — no la reabre ni la cuestiona.**
- **T62/T63 cerraron el mismo día** (PR #19): la conexión a Postgres puede
  verificar CA (`POSTGRES_CA_CERT`, opcional, sin cambiar el default), y
  `apps/web/src/logging.ts` da logging estructurado que nunca serializa un
  error crudo. No relevante para esta tarea de forma directa.

Antes de empezar, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas 10-15 entradas, especialmente la de
   T61 y la de T62/T63.
2. `docs/fase-6-agentguard-comercializacion/PLATAFORMA-PARTNERS.md` § F8 —
   la tabla tiene el criterio de aceptación exacto de `T64`.
3. `docs/fase-6-agentguard-comercializacion/DECISIONES.md` → `C-67` (qué
   arregló T61, exactamente, y por qué — el bug real que encontró: dos
   instancias vivas a la vez chocaban al escribir, no solo leían
   desactualizado).
4. `packages/vault/src/postgres-vault.integration.test.ts` — ya tiene tres
   tests de concurrencia contra Postgres real (dos instancias vivas,
   compitiendo por `perDay`, y una escritura verdaderamente concurrente
   con `Promise.all`). Esta prueba de carga es un paso más allá: procesos
   de verdad, no solo instancias distintas dentro del mismo proceso de
   test.
5. `CLAUDE.md`, en la raíz, sección "Coordinación con Codex" completa.
6. `AGENTS.md`, en la raíz.

---

## T64 — harness de carga: dos procesos de verdad compitiendo por `perDay`

**Qué hace falta.** T61 se probó con dos *instancias* de la vault dentro
del mismo proceso de test (`vitest`). Eso prueba la lógica, pero no prueba
del todo la premisa de F8: "que aguante más de un proceso". Este ticket
mide eso — literalmente dos (o más) procesos de Node separados,
compitiendo por el mismo `tenantId`/`subject`/día, contra la misma
Postgres real.

**Qué NO es este ticket.** No es una prueba de carga del pago x402 real
contra el bazaar (`apps/agent`/`apps/web`'s `buy()`) — eso dependería de
un servicio externo, tardaría segundos por compra, y no es lo que hace
falta medir. La condición de carrera vive en
`packages/vault/src/postgres-vault.ts`; medila ahí, contra Postgres
directamente, con `createPostgresMandateVault` (el mismo export que ya
usan los tests de integración) — no hace falta levantar `apps/web` para
esto.

**Forma esperada.** Un script, `scripts/loadtest-perday.ts`, corrible con
`pnpm run loadtest:perday` (agregá el script a `package.json` raíz, mismo
patrón que `scripts/check-rail-balances.ts` o `scripts/create-partner.ts`
— lee `DATABASE_URL` de `.env.local`, nunca hardcodeada). Debe:

1. Elegir un `tenantId`/`subject` de prueba, con un `perDay` de referencia
   (por ejemplo 10.00 USDC) que el propio script decide y aplica en su
   propia lógica de arbitraje (no hace falta que el script conozca
   `checkDailyLimit` — reimplementar la comparación
   `spentToday + amount > perDay` en el propio harness alcanza; es la
   misma aritmética simple, no hay que importarla de `apps/agent`, que
   `packages/vault` no puede depender de todos modos).
2. Lanzar **procesos de Node reales y separados** (`node:child_process`,
   `fork` o `spawn` — no `Promise.all` de funciones dentro del mismo
   proceso, eso ya lo cubren los tests de T61) — cada uno abre su propia
   conexión a Postgres, cada uno intenta registrar varios gastos
   concurrentes contra el mismo `tenantId`/`subject`/día, cada uno decide
   por su cuenta (leyendo `spentOn` antes de cada intento) si debería
   proceder.
3. Al final, leer el estado real desde una instancia nueva de la vault
   (`spentOn`, `list`) y confirmar: la suma de lo efectivamente grabado
   nunca superó el `perDay` de referencia, y ningún proceso crasheó por
   una colisión de `seq` (la prueba de que el advisory lock de T61
   funciona bajo procesos reales, no solo bajo instancias del mismo
   proceso).
4. Limpiar sus propias filas de `vault_records` al terminar (`tenantId`
   de prueba, con un prefijo reconocible tipo `loadtest-`), para no dejar
   basura en la base compartida — mismo criterio que
   `postgres-vault.integration.test.ts`.
5. Imprimir un resumen legible: cuántos procesos, cuántos intentos,
   cuántos aceptados, cuánto se grabó en total, y si se mantuvo dentro
   del límite.

**Archivos permitidos:** `scripts/loadtest-perday.ts` (nuevo),
`package.json` (raíz, solo para agregar el script nuevo a `"scripts"` —
ninguna dependencia nueva; `pg` y `@agentpey/vault` ya están disponibles
desde la raíz del workspace).

**Verificación que el PR tiene que mostrar.** La corrida real del script
contra Postgres real (no localhost simulado), pegada en la descripción del
PR: cuántos procesos, el resumen final, y confirmación explícita de que
nunca se superó el `perDay` de referencia. Si en algún momento la corrida
muestra que SÍ se superó o que algún proceso crasheó, no lo ocultes —
decilo en el PR tal cual salió; eso sería evidencia de que `T61` tiene un
hueco, no un fallo de este ticket, y hay que investigarlo antes de seguir
(avisá explícitamente que encontraste eso, no sigas con `T65`).

---

CIERRE

Al terminar: `pnpm build`, `pnpm typecheck`, `pnpm test` en verde, PR con
diff completo y la salida real de la corrida de carga pegada en la
descripción, entrada en `docs/AGENT_LOG.md` (branch, qué, por qué, qué
queda pendiente) — no es opcional. Yo (Claude Code) reviso el PR antes de
mergear, en un worktree aislado, y voy a correr el script yo mismo contra
Postgres real antes de cerrar F8 (T65) — no alcanza con que vos lo hayas
corrido una vez.
