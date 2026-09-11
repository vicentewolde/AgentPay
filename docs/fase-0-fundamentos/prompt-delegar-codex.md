# Prompt de delegación — T59 (F9, panel de estado de solo lectura)

> Generado el 2026-09-11, para pegar como primer mensaje en `~/dev/AgentPay-codex`
> (Codex, en su propio worktree — nunca en `~/dev/AgentPay`). Reemplaza el
> prompt anterior de T54 (cerrado, PR #17 mergeado).

---

CONTEXTO

Este es AgentPay, un proyecto de pagos agénticos sobre Stellar testnet. Repo
público: `github.com/vicentewolde/AgentPay`, rama `main`. Trabajás en tu
propio worktree (`~/dev/AgentPay-codex`), nunca en `~/dev/AgentPay`. Arrancá
siempre desde `origin/main` fresco: `git fetch origin && git checkout -B
codex/t59-status-dashboard origin/main`.

**Antes de escribir nada, corré `git log --oneline -10` contra
`origin/main`** — el commit más reciente es `0930e9a` ("docs: log the
F8/F9 renumbering and T59 Codex delegation"). Si no lo ves en tu `git
log`, tu `origin` está desactualizado — hacé `git fetch` de nuevo antes de
seguir.

Estado del proyecto que este prompt asume como cierto:

- El nombre de marca definitivo es **AgentPey** (`docs/DECISIONES.md` →
  `P-11`). El rename real (paquetes, repo, texto del código) **todavía no se
  ejecutó** — seguí usando "AgentPay"/`@agentpay/*`/`@agentpass/*` tal cual
  aparecen en el código hoy.
- **T57 y T58 cerraron el 2026-09-11**: `contracts/policy-rail` ganó
  `withdraw`/`set_owner` (T57), y cada tenant con wallet real conectada ya
  despliega y usa su propio `policy_rail` desde su primer pago (T58,
  `apps/web/src/tenant-rail.ts`). No relevante para esta tarea de forma
  directa, pero si tu `git log` no los tiene, tu `origin` está viejo.
- **La numeración de F8 y F9 en `PLATAFORMA-PARTNERS.md` se corrigió el
  mismo día** (`T61`–`T65` para F8, que ni empezó; `T59` para esta tarea,
  antes numerada `T61` en el borrador original de esas tablas). Usá
  siempre `T59` — es el número real, ya no hay renumeración pendiente
  sobre este ticket.

Antes de empezar, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas 10-15 entradas, especialmente las de
   T57, T58 y la de renumeración de F8/F9.
2. `docs/fase-6-agentguard-comercializacion/PLATAFORMA-PARTNERS.md` § F9 —
   la tabla tiene el criterio de aceptación exacto.
3. `CLAUDE.md`, en la raíz, sección "Coordinación con Codex" completa.
4. `AGENTS.md`, en la raíz.

---

## T59 — panel de estado interno, de solo lectura

**Qué hace falta.** Mientras el piloto corre, alguien tiene que poder ver
qué está pasando sin entrar a Postgres a mano: pagos recientes, rechazos,
y si la cadena de hashes del vault sigue íntegra. Un panel interno —no
para partners, para nosotros— que solo lee, nunca escribe ni dispara nada.

**Por qué es seguro delegarlo.** Es estrictamente de lectura: ningún
endpoint puede iniciar un pago, una revocación, ni ninguna escritura. No
toca custodia, llaves, ni fondos — la razón por la que el resto de F6 (el
rail por tenant) se queda en Claude Code no aplica acá.

**De dónde lee — no reinventar nada de esto:**

- `@agentpay/vault`'s `MandateVault` (`packages/vault/src/vault.ts`):
  - `list(subject?)` — el historial completo, o el de un tenant. Cada
    `VaultRecord` tiene `kind: "granted" | "refused" | "anchored"` — de
    ahí salen "pagos recientes" (`granted`/`anchored`) y "rechazos"
    (`refused`), sin que este panel tenga que decidir qué es cada cosa.
  - `verify()` — recalcula la cadena de hashes y confirma que nada se editó
    después de escrito. Esto es "salud de la cadena del vault".
  - Se construye con `createPostgresMandateVault({ connectionString,
    tenantId })` (`packages/vault/src/postgres-vault.ts`) — necesitás un
    `tenantId` por instancia; para un panel que ve *todos* los tenants,
    puede hacer falta iterar sobre los tenants de `@agentpay/directory` o
    pedir uno a la vez por query param. Vos decidís la forma exacta de
    "listar todos", pero no inventes un segundo camino de lectura del
    vault que no pase por estas dos funciones.
- `@agentpay/directory`'s `Directory` (`packages/directory/src/directory.ts`):
  solo los métodos de lectura (`findTenant`, `listTenants`, `listMandates`,
  `listActiveMandates`, `findAgent`, `listAgents`, etc.) — **nunca**
  `createTenant`, `createAgent`, `recordMandate`, `revokeMandate`,
  `bindPrincipal`, ni ningún otro método que escriba.
- `DATABASE_URL` de `.env.local`, igual que el resto del repo — no inventes
  una conexión nueva ni un usuario de Postgres distinto.

**Forma esperada.** Un servidor HTTP mínimo (`node:http` directo, sin
frameworks nuevos — mismo criterio que `apps/web`), con algo como:

1. `GET /api/status/mandates?tenantId=...` — mandatos recientes de ese
   tenant (o los últimos N si no se pasa `tenantId`), vía `listMandates`/
   `listActiveMandates`.
2. `GET /api/status/vault/:tenantId` — `list()` y `verify()` de ese
   tenant, en un JSON legible (fecha, `kind`, monto, y si la cadena
   verifica).
3. Una página HTML mínima, sin JS pesado, que muestre esto en una tabla —
   no hace falta que sea linda, tiene que ser legible por un humano en
   medio de un incidente.

**Archivos permitidos:** `apps/status-dashboard/**` (nuevo, paquete propio
del workspace — el glob `apps/*` de `pnpm-workspace.yaml` ya lo toma sin
que edites ese archivo).
**Prohibido, sin excepción:** cualquier ruta que escriba, cualquier
llamada a un método de `Directory` o `MandateVault` que no sea de lectura,
tocar `apps/web/**`, `apps/agent/**`, `packages/directory/src/**`,
`packages/vault/src/**` o `contracts/**`.

**Verificación que el PR tiene que mostrar.** Un test que enumera cada
ruta HTTP del panel y confirma que ninguna acepta `POST`/`PUT`/`DELETE`
(o que si acepta un método de escritura, responde `405` sin ejecutar
nada) — esa es la prueba de "estrictamente de lectura" que este ticket
pide. Además, corrida real contra una base con datos de prueba (podés
sembrarlos vos con `createDirectory`/`createPostgresMandateVault`
directamente en tu test, no hace falta pegarle a `apps/web`): el panel
muestra un mandato sembrado y un `verify()` en verde.

---

CIERRE

Al terminar: `pnpm build`, `pnpm typecheck`, `pnpm test` en verde, PR con
diff completo, entrada en `docs/AGENT_LOG.md` (branch, qué, por qué, qué
queda pendiente) — no es opcional. Yo (Claude Code) reviso el PR antes de
mergear, en un worktree aislado — no se mergea a ciegas, con atención
particular a que ningún endpoint nuevo pueda mutar nada.
