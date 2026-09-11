# Prompt de delegación — T54 (F7, comercio de referencia x402)

> Generado el 2026-09-11, para pegar como primer mensaje en `~/dev/AgentPay-codex`
> (Codex, en su propio worktree — nunca en `~/dev/AgentPay`). Reemplaza el
> prompt anterior de T54–T56 (T55 y T56 ya cerraron, PR #16 mergeado).

---

CONTEXTO

Este es AgentPay, un proyecto de pagos agénticos sobre Stellar testnet. Repo
público: `github.com/vicentewolde/AgentPay`, rama `main`. Trabajás en tu
propio worktree (`~/dev/AgentPay-codex`), nunca en `~/dev/AgentPay`. Arrancá
siempre desde `origin/main` fresco: `git fetch origin && git checkout -B
codex/t54-reference-merchant origin/main`.

**Antes de escribir nada, corré `git log --oneline -10` contra
`origin/main`** — el commit más reciente es `faad595` ("merge: venue
registration script and generic adapter tests (codex/delegated-task, PR
#16)"). Si no lo ves en tu `git log`, tu `origin` está desactualizado — hacé
`git fetch` de nuevo antes de seguir.

Estado del proyecto que este prompt asume como cierto:

- El nombre de marca definitivo es **AgentPey** (`docs/DECISIONES.md` →
  `P-11`). El rename real (paquetes, repo, texto del código) **todavía no se
  ejecutó** — seguí usando "AgentPay"/`@agentpay/*`/`@agentpass/*` tal cual
  aparecen en el código hoy.
- **T53 cerró el 2026-09-11**: el registro de venues/assets
  (`apps/agent/src/catalog/registry.ts` + `venues.json`) y el adaptador x402
  genérico (`apps/agent/src/catalog/x402-catalog.ts`) ya existen en `main`.
  Reemplazan el `mapAsset` hardcodeado que `bazaar.ts` tenía — leé ese código
  antes de tocar nada, esta tarea se apoya en él.
- **T55 y T56 cerraron el mismo día** (PR #16, mergeado): ya existen
  `scripts/register-venue.ts` (alta de un venue sin tocar código) y
  `apps/agent/src/catalog/x402-catalog.test.ts` (tests del adaptador genérico
  contra un segundo venue sintético). No los toques — esta tarea es
  independiente de ambos.
- **T57 cerró el mismo día, en Claude Code, no en vos**: `contracts/policy-rail`
  ganó `withdraw` y `set_owner`, gateados por una wallet `principal` separada
  de la llave `owner` que sigue firmando los pagos. Resuelve `G9`. No es
  relevante para esta tarea — no toca nada de `contracts/`, y `contracts/**`
  sigue fuera de lo delegable — pero si tu `git log` no lo tiene, tu `origin`
  está viejo.

Antes de empezar, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas 10-15 entradas, especialmente las de
   T53, T55/T56 y T57.
2. `docs/fase-6-agentguard-comercializacion/DECISIONES.md` → `C-60` (por qué
   el registro se diseñó así).
3. `docs/fase-6-agentguard-comercializacion/PLATAFORMA-PARTNERS.md` § F7 —
   la tabla tiene el criterio de aceptación exacto. Usá siempre `T54` — es el
   número real, ya no hay renumeración pendiente.
4. Los archivos que T53 dejó:
   - `apps/agent/src/catalog/registry.ts` — el esquema (`registryVenueSchema`,
     `registryAssetSchema`), `loadVenueRegistry`, `mapAssetCodeForVenue`,
     `mapAssetIssuerForVenue`, `baseUrlForVenue`.
   - `apps/agent/src/catalog/venues.json` — la fila real de datos.
   - `apps/agent/src/catalog/x402-catalog.ts` — el adaptador HTTP genérico
     (`createX402Catalog`, `getX402ServiceRoute`).
   - `apps/agent/src/catalog/bazaar.ts` — cómo el bazaar del embajador quedó
     como una fila de configuración más un archivo de compatibilidad fino.
   - `apps/agent/src/payment/x402.ts` — el lado cliente del protocolo, la
     forma exacta que tu servidor tiene que satisfacer del otro lado.
5. `CLAUDE.md`, en la raíz, sección "Coordinación con Codex" completa.
6. `AGENTS.md`, en la raíz.

---

## T54 — comercio de referencia x402

**Qué hace falta.** Un segundo comercio, aparte del bazaar del embajador,
que hable el mismo protocolo x402 — para poder probar el adaptador genérico
contra algo que no sea el único comercio real que existe hoy. Tiene que
responder un `402` de verdad y liquidar contra Stellar testnet real, no
simularlo.

**Forma esperada.** Un servidor HTTP mínimo (usá `node:http` directo, sin
frameworks nuevos — mismo criterio que `apps/web` ya sigue) con al menos:

1. `GET /api/discovery/search?query=*` — responde la forma exacta que
   `x402-catalog.ts` ya espera (`discoverySearchResponseSchema` en ese
   archivo): `{ ok: true, results: [{ resource: ServiceCard }] }`, con al
   menos un producto pagable.
2. Una ruta pagada que responda `402` con un `PaymentRequirements` real
   (`scheme: "exact"`, `network` = la red de Stellar testnet de `@x402/stellar`,
   un `asset` que sea un contrato SAC real de testnet, un `payTo` tuyo) y que,
   al recibir el pago firmado, lo verifique contra Horizon/Soroban real antes
   de entregar el recurso. Mirá `apps/agent/src/payment/x402.ts` para la
   forma exacta que el lado cliente ya espera — tu servidor es el otro
   extremo de ese mismo protocolo.

**Archivos permitidos:** `examples/reference-merchant/**` (nuevo).
**Prohibido, sin excepción:** `apps/agent/src/**`, `contracts/**`. Si algo que
necesitás no está expuesto ahí (por ejemplo, para firmar o verificar en
testnet), resolvelo con tus propias dependencias dentro de
`examples/reference-merchant/`, no tocando el paquete del agente ni ningún
contrato.

**Verificación que el PR tiene que mostrar.** Un producto de este comercio
de referencia comprado de punta a punta: `createX402Catalog` (o
directamente `curl`) contra tu servidor real corriendo local, el `402`
real, el pago firmado y liquidado en testnet, el recurso entregado. Incluí
en el PR el hash de la transacción de testnet que asentó. Si tu servidor
necesita una cuenta Stellar fondeada, usá el Friendbot como cualquier otro
script descartable de este repo — no pidas fondos reales.

---

CIERRE

Al terminar: `pnpm build`, `pnpm typecheck`, `pnpm test` en verde, PR con
diff completo, entrada en `docs/AGENT_LOG.md` (branch, qué, por qué, qué
queda pendiente) — no es opcional. Yo (Claude Code) reviso el PR antes de
mergear, en un worktree aislado — no se mergea a ciegas.
