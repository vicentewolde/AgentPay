# Prompt de delegación — T50, guía de integración de partner

> Generado el 2026-09-11, para pegar como primer mensaje en `~/dev/AgentPay-codex`
> (Codex, en su propio worktree — nunca en `~/dev/AgentPay`). Reemplaza el
> prompt anterior (genérico, sin tarea asignada); este ya trae una tarea
> concreta y lista para arrancar.

---

CONTEXTO

Este es AgentPay, un proyecto de pagos agénticos sobre Stellar testnet. Repo
público: `github.com/vicentewolde/AgentPay`, rama `main`. Trabajás en tu
propio worktree (`~/dev/AgentPay-codex`), nunca en `~/dev/AgentPay` — carpetas
de disco distintas, mismo historial de git. Arrancá siempre desde
`origin/main` fresco (`git fetch origin && git checkout -b codex/t50-partner-guide origin/main`).

**Antes de escribir nada, corré `git log --oneline -15` contra `origin/main`**
— hubo mucho movimiento reciente (Fase 6, T45 a T52) y este prompt puede
quedar desactualizado apenas se genere otra sesión.

Estado del proyecto que este prompt asume como cierto:

- `/v1` (la API para partners) ya responde de verdad contra Postgres real:
  crear un tenant (`POST /v1/tenants`), listar sus agentes
  (`GET /v1/agents`), abrir un consentimiento (`POST /v1/consent_sessions`)
  y consultar mandatos (`GET /v1/mandates`) — todo con API key, idempotencia,
  y aislamiento entre partners verificados con `curl` real (T45, T49, T51).
- La página que un principal usa para revisar y firmar un consentimiento
  (`/consent/{id}`) ya existe y está en producción de código (T52).
- El nombre de marca definitivo es **AgentPey** (`docs/DECISIONES.md` → `P-11`,
  reemplaza a VynGent/`P-9` y a TirevPay/`P-8`). El **rename real todavía no
  se ejecutó** — el código, los paquetes (`@agentpass/*`/`@agentpay/*`), el
  repo de GitHub y el nombre del servicio en Render siguen diciendo
  "AgentPay". Escribí la guía usando "AgentPay" tal como aparece en el
  código hoy — no adelantes el rename, es una sesión propia y deliberada que
  todavía no ocurrió.

Antes de delegar nada, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas 10-15 entradas.
2. `docs/DECISIONES.md` → `P-4`, `P-5`, `P-10`, `P-11`.
3. `docs/fase-6-agentguard-comercializacion/PLATAFORMA-PARTNERS.md` § F5 —
   la fila de **T50** tiene el criterio de aceptación exacto.
4. `CLAUDE.md`, en la raíz, sección "Coordinación con Codex" completa.
5. `AGENTS.md`, en la raíz.

---

LA TAREA: T50 — guía de integración de un partner

**Qué hace falta.** `/v1` ya responde de verdad. Falta la guía que un
partner externo (ficticio para este hito: "CloudOps") pueda seguir sin
hablar con nosotros y sin tocar el repo, con comandos `curl` **exactos**
—no descripciones del comando— que:

1. Emitan una API key (referenciando `pnpm run partner:create`, el script
   operador que ya existe — no inventes una ruta HTTP nueva para esto, no
   existe a propósito, ver `scripts/create-partner.ts`).
2. Creen un tenant (`POST /v1/tenants`).
3. Abran un `consent_session` con un `grant` de ejemplo, incluyendo
   `payTo` (`POST /v1/consent_sessions`) — mostrá también el
   `consent_url` que devuelve, y qué hace un principal ahí (abre
   `/consent/{id}`, revisa el grant, conecta Freighter, firma).
4. Consulten el estado del consentimiento y, una vez firmado, el mandato
   resultante (`GET /v1/consent_sessions/{id}`, `GET /v1/mandates/{id}`).
5. Manejen los errores documentados (`InvalidApiKey`, `ScopeNotGranted`,
   `IdempotencyKeyConflict`, `ConsentSessionExpired`, etc. — la lista
   completa está en `packages/partner-api/src/**` y en
   `docs/api/openapi.yaml`, generado en T46).

**Archivos permitidos:**
`docs/fase-6-agentguard-comercializacion/evidencia/**`,
`examples/**` (nuevo).

**Prohibido, sin excepción:** ningún archivo bajo `apps/`, `packages/`, ni
`contracts/`. Esta tarea es documentación y ejemplos — si algo que querés
mostrar no funciona tal cual está documentado, es una brecha para reportar
en el PR, no algo para arreglar tocando código.

**Verificación que el PR tiene que mostrar.** Corré la guía de punta a
punta, literalmente copiando y pegando tus propios comandos contra un
servidor local (`pnpm run web`) con un `.env.local` real — la misma
disciplina que T39/T51/T52 ya usaron. Si necesitás simular la firma de
wallet sin Freighter, mismo patrón: un script descartable (nunca
commiteado) que firma con `@stellar/stellar-sdk` + `signStellarMessage`
de `@agentpass/core`, no lo inventes desde cero. Al terminar, borrá
cualquier partner/tenant/consent_session de prueba que hayas creado en
Postgres — no dejes residuos en la base compartida.

**Qué no es esta tarea.** No es un panel de partner, no es publicar nada a
npm, no es cobrar nada — todo eso sigue fuera de alcance (`PLATAFORMA-PARTNERS.md`
§ F5, "Fuera de alcance").

Al terminar: abrí el PR con el diff completo, agregá tu entrada de rigor a
`docs/AGENT_LOG.md` (branch, qué, por qué, qué queda pendiente), y esperá
revisión — no se mergea nada a ciegas.

---

Nada más queda preseleccionado a propósito. Si además de T50 hay lugar para
delegar algo más en paralelo, decidilo en este mismo chat después de leer
el estado real del repo — no lo asumas de este prompt.
