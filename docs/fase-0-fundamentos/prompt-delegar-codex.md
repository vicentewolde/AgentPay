# Prompt de delegación — T54, T55, T56 (F7, comercio x402 genérico)

> Generado el 2026-09-11, para pegar como primer mensaje en `~/dev/AgentPay-codex`
> (Codex, en su propio worktree — nunca en `~/dev/AgentPay`). Reemplaza el
> prompt anterior de T50 (ya cerrado, PR #15 mergeado).

---

CONTEXTO

Este es AgentPay, un proyecto de pagos agénticos sobre Stellar testnet. Repo
público: `github.com/vicentewolde/AgentPay`, rama `main`. Trabajás en tu
propio worktree (`~/dev/AgentPay-codex`), nunca en `~/dev/AgentPay`. Arrancá
siempre desde `origin/main` fresco: `git fetch origin && git checkout -B
codex/<task> origin/main`.

**Antes de escribir nada, corré `git log --oneline -10` contra
`origin/main`** — el commit más reciente relevante es `a1cbb14` ("feat(agent):
venue/asset registry replaces hardcoded mapAsset (T53)"). Si no lo ves en tu
`git log`, tu `origin` está desactualizado — hacé `git fetch` de nuevo antes
de seguir.

Estado del proyecto que este prompt asume como cierto:

- El nombre de marca definitivo es **AgentPey** (`docs/DECISIONES.md` →
  `P-11`). El rename real (paquetes, repo, texto del código) **todavía no se
  ejecutó** — seguí usando "AgentPay"/`@agentpay/*`/`@agentpass/*` tal cual
  aparecen en el código hoy.
- **T53 acaba de cerrar** (2026-09-11): el registro de venues/assets
  (`apps/agent/src/catalog/registry.ts` + `venues.json`) y el adaptador x402
  genérico (`apps/agent/src/catalog/x402-catalog.ts`) ya existen en `main`.
  Reemplazan el `mapAsset` hardcodeado que `bazaar.ts` tenía — leé ese código
  antes de tocar nada, las tres tareas de abajo se apoyan en él.

Antes de delegar nada, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas 10-15 entradas, especialmente la de T53.
2. `docs/fase-6-agentguard-comercializacion/DECISIONES.md` → `C-60` (por qué
   el registro se diseñó así, y por qué `resolveJsonModule` en vez de leer el
   JSON a mano con `node:fs`).
3. `docs/fase-6-agentguard-comercializacion/PLATAFORMA-PARTNERS.md` § F7 —
   la tabla tiene el criterio de aceptación exacto de cada ticket. **Nota:**
   esa tabla usaba `T51`–`T54` en su borrador original; están renumerados a
   `T53`–`T56` porque esos números ya los usó F5 de verdad. Usá siempre
   `T54`, `T55`, `T56` — no los números viejos.
4. Los archivos que T53 dejó:
   - `apps/agent/src/catalog/registry.ts` — el esquema (`registryVenueSchema`,
     `registryAssetSchema`), `loadVenueRegistry`, `mapAssetCodeForVenue`,
     `mapAssetIssuerForVenue`, `baseUrlForVenue`.
   - `apps/agent/src/catalog/venues.json` — la fila real de datos.
   - `apps/agent/src/catalog/x402-catalog.ts` — el adaptador HTTP genérico
     (`createX402Catalog`, `getX402ServiceRoute`).
   - `apps/agent/src/catalog/bazaar.ts` — cómo el bazaar del embajador quedó
     como una fila de configuración más un archivo de compatibilidad fino.
5. `CLAUDE.md`, en la raíz, sección "Coordinación con Codex" completa.
6. `AGENTS.md`, en la raíz.

Son **tres tareas independientes**, sin colisión de archivos entre ellas
(podés correrlas en tres worktrees/ramas a la vez si querés, o una por una).
Las tres dependen solo de T53, ya en `main`.

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
**Prohibido, sin excepción:** `apps/agent/src/**`. Si algo que necesitás no
está expuesto ahí (por ejemplo, para firmar o verificar en testnet), resolvelo
con tus propias dependencias dentro de `examples/reference-merchant/`, no
tocando el paquete del agente.

**Verificación que el PR tiene que mostrar.** Un producto de este comercio
de referencia comprado de punta a punta: `createX402Catalog` (o
directamente `curl`) contra tu servidor real corriendo local, el `402`
real, el pago firmado y liquidado en testnet, el recurso entregado. Incluí
en el PR el hash de la transacción de testnet que asentó. Si tu servidor
necesita una cuenta Stellar fondeada, usá el Friendbot como cualquier otro
script descartable de este repo — no pidas fondos reales.

---

## T55 — script de alta de comercio

**Qué hace falta.** Un script que agregue una fila nueva a
`apps/agent/src/catalog/venues.json`, validándola contra el esquema exacto
que `registry.ts` ya define — sin interpretar nada, sin adivinar valores por
omisión que el esquema no pida.

**Forma esperada.** `scripts/register-venue.ts` (mismo patrón que
`scripts/create-partner.ts`: un script standalone, ejecutado a mano, no una
ruta HTTP). Argumentos de línea de comando para cada campo de
`registryVenueSchema` (`slug`, `contractId` — o generalo con `sha256` igual
que `BAZAAR_VENUE_CONTRACT_ID`/`MOCK_VENUE_CONTRACT_ID` si no se pasa uno,
misma técnica que ya usa este repo —, `baseUrl` opcional, y al menos un
`asset` con `code`+`issuer`, repetible para más de uno). El script:

1. Lee `venues.json`.
2. Agrega la fila nueva.
3. **Valida el archivo resultante completo con `loadVenueRegistry` (importado
   de `registry.ts`) antes de escribirlo** — si la tabla completa no pasa
   (por ejemplo, un venue o asset duplicado), el script falla y no toca el
   archivo. Esto es la garantía real de "sin tocar código": nadie puede
   corromper la tabla por este camino.
4. Escribe `venues.json` de vuelta, formateado igual que el original.

**Archivos permitidos:** `scripts/register-venue.ts` (nuevo).
**Prohibido:** cualquier archivo bajo `apps/agent/src/`, incluido
`venues.json` mismo — el script lo *escribe* en tiempo de ejecución, pero no
formes parte de tu PR con un `venues.json` ya modificado a mano; el PR
prueba que el script funciona, no que vos edites el archivo directamente.

**Verificación que el PR tiene que mostrar.** Correr el script de verdad
contra una copia de `venues.json`, agregando una fila de prueba, y mostrar
que el archivo resultante carga sin error con `loadVenueRegistry`. Probar
también el camino de rechazo: correr el script con un `slug` que ya existe
en la tabla y confirmar que falla sin escribir nada (compará el archivo
antes/después, byte a byte).

---

## T56 — tests del adaptador genérico sobre un segundo venue

**Qué hace falta.** `bazaar.test.ts` prueba `createX402Catalog` únicamente a
través del bazaar del embajador (un solo venue). Faltan tests que prueben el
adaptador genérico como lo que es — genérico — construyendo un segundo venue
sintético con `loadVenueRegistry` (no hace falta que sea el comercio de
referencia de T54; un registro fabricado en el propio test alcanza, mismo
estilo que `registry.test.ts` ya usa).

**Forma esperada.** `apps/agent/src/catalog/x402-catalog.test.ts` (nuevo),
mismo estilo que `bazaar.test.ts` (`fetchReturning`/`fetchThrowing` como
`fetchImpl` fabricado, sin red real). Casos mínimos:

1. Camino feliz: `createX402Catalog` con un venue fabricado en el registro
   lista y obtiene productos correctamente mapeados.
2. Rechazo por asset no reconocido: un `ServiceCard` que cotiza en un código
   que el venue del registro no nombra — `InvalidProduct`.
3. Rechazo por venue sin `baseUrl` en el registro — `InvalidProduct`.
4. `getX402ServiceRoute`: camino feliz y el rechazo por falta de
   `routeTemplate` (`InvalidProduct`).
5. Los casos de red que `bazaar.test.ts` ya cubre (`NetworkError` por fallo
   de conexión, status no-2xx, cuerpo no-JSON, forma inesperada) — confirmá
   que el adaptador genérico los produce igual, no asumas que porque
   `bazaar.test.ts` los cubre ya están cubiertos acá (son módulos separados).

**Archivos permitidos:** `apps/agent/src/catalog/x402-catalog.test.ts`
(nuevo).
**Prohibido:** tocar `x402-catalog.ts`, `registry.ts`, `bazaar.ts` ni
`bazaar.test.ts` — si algo ahí parece necesitar un cambio para que tu test
funcione, es una señal para reportar en el PR, no para arreglar vos.

**Verificación que el PR tiene que mostrar.** `pnpm test` completo en verde,
con el conteo de tests nuevo explícito en el PR.

---

CIERRE

Cada una de las tres, al terminar: `pnpm build`, `pnpm typecheck`, `pnpm
test` en verde, PR con diff completo, entrada en `docs/AGENT_LOG.md` (branch,
qué, por qué, qué queda pendiente) — no es opcional. Yo (Claude Code) reviso
cada PR antes de mergear, en un worktree aislado — no se mergea a ciegas
ninguna de las tres, aunque estén marcadas de riesgo bajo.
