# Evidencia — rename a AgentPey (ejecuta `P-11`, sin numerar)

Rama: `cc/t61-rename-agentpey`. Commit: `daee607`.

## Alcance acordado con el usuario antes de tocar código

Tres preguntas resueltas explícitamente antes de escribir nada (ver la
sesión completa para el detalle de cada una):

1. `AgentPass` (Fase 1, `@agentpass/*`) **no se renombra** — se queda como
   nombre de módulo, distinto de la marca general.
2. El servicio de Render **se renombra ahora**, aceptando que el link ya
   compartido con Tellus (`agentpay-web.onrender.com`) deja de servir.
3. Los literales de protocolo horneados en documentos ya firmados
   (`AGENTPAY_MANDATE_TYPE`, `AGENTPAY_INTENT_TYPE`/`FAMILY`, el header de
   webhook `agentpay-signature`) **no se tocan** — quedan como
   identificadores internos, no como texto de marca.

## Paso 1 — scope de npm (`@agentpay/*` → `@agentpey/*`)

Confirmado antes de tocar nada: ningún paquete se publicó nunca
(`"private": true` en los catorce `package.json` del workspace, sin
script de `publish` en ningún lado) — cero riesgo de romper un consumidor
externo de npm.

```
$ grep -rl '"private": true' packages/*/package.json apps/*/package.json examples/*/package.json | wc -l
14
$ grep -rn "npm publish\|pnpm publish" --include="*.yml" --include="*.yaml" --include="package.json" .
(sin resultados)
```

`sed`/`perl` sobre los 12 `package.json` con `@agentpay/` (nombre +
dependencias), el `package.json` raíz (`"name": "agentpay"` →
`"agentpey"`), y `tsconfig.scripts.json` (los `paths` hardcodeados que
`tsc -b` no resuelve solo desde `package.json`). `pnpm install` regeneró
`pnpm-lock.yaml` sin ninguna referencia a `@agentpay` sobrante.

```
$ pnpm typecheck && pnpm build
$ tsc -b && tsc -p tsconfig.scripts.json
$ tsc -b
(ambos limpios, sin salida)

$ pnpm test
...
Test Files  4 passed (4)   # scripts/lib
Tests  36 passed (36)
(y el resto de los catorce paquetes/apps en verde — ver corrida completa
en la sesión; sin regresiones)
```

## Paso 2 — contenido y docs vivos

Se separaron los archivos "AgentPay" en dos grupos antes de tocar nada:

- **Histórico, sin tocar:** `docs/AGENT_LOG.md`, `docs/DECISIONES.md`
  (raíz — la narrativa de `P-8`/`P-9`/`P-11` describe qué nombre regía en
  cada fecha), todo `docs/fase-*/evidencia/*.md`, y los prompts de
  arranque en `docs/fase-0-fundamentos/prompt-*.md`.
- **Vivo, actualizado:** `README.md`, `ROADMAP.md`, `CLAUDE.md`,
  `AGENTS.md`, los `BITACORA.md`/`ARQUITECTURA.md`/`CONTEXTO.md`/
  `DECISIONES.md` vigentes de cada fase, la landing/index/consent de
  `apps/web/public`, los READMEs de cada paquete/app, comentarios de
  código, y los tres textos de consola (`demo.ts`,
  `demo-real-payment.ts`, `apps/web/src/server.ts`) que un primer barrido
  con `\bAgentPay\b` no detectó — el `\n` de escape que los precede
  (`` `\nAgentPay web...` ``) hace que no haya límite de palabra ahí; un
  segundo barrido sin `\b` los encontró.

Dos strings humanos, no literales de protocolo, también se actualizaron:

- `apps/web/src/wallet-session.ts` — `challengeMessage` decía
  **"VynGent"** (quedó un hito atrás sin actualizar cuando se mergeó el
  kit visual de AgentPey en `P-11`). Efímero (nonce de 5 min, nunca se
  reverifica), sin riesgo.
- `packages/mandate/src/wallet-sign.ts` — la primera línea de
  `mandateChallengeMessage` ("AgentPay Mandate" → "AgentPey Mandate").
  Confirmado antes de tocarlo: se recalcula desde cero en cada
  verificación y solo se verifica una vez, en el momento del
  consentimiento — no queda ninguna firma ya anclada que dependa de este
  texto exacto.

Verificado en el navegador contra el servidor real (`pnpm run web`):
título de la landing pasa a "AgentPey — payment infrastructure for AI
agents on Stellar", el header visible dice "AgentPey", el link de GitHub
apunta a `github.com/vicentewolde/AgentPey`.

## Paso 3 — repo de GitHub

```
$ gh repo rename AgentPey --repo vicentewolde/AgentPay --yes
(sin salida — éxito)
$ gh repo view vicentewolde/AgentPay --json name,url
{"name":"AgentPey","url":"https://github.com/vicentewolde/AgentPey"}
```

Confirmado: la URL vieja (`vicentewolde/AgentPay`) redirige sola a la
nueva — el link de GitHub no se rompe. `git remote set-url origin` +
`git fetch` confirmaron que el remote local sigue funcionando.

## Paso 4 — Render, pendiente

`render.yaml` actualizado (`name: agentpay-web` → `agentpey-web`), pero
el servicio real en Render **no se renombró** — no hay `RENDER_API_KEY`
ni CLI de Render en este entorno, y aunque lo hubiera, cambiar el nombre
de un servicio ya desplegado es una acción visible hacia afuera (rompe el
link que ya tiene Tellus) que le toca ejecutar al usuario desde el
dashboard, no a un script. Instrucciones para el usuario en el cierre del
hito, en la conversación.

## Corrección de numeración

El plan mencionado a mitad de sesión decía "T61" de forma tentativa. Se
descubrió que `T61` ya está reservado (F8, "enforcement de `perDay`",
`PLATAFORMA-PARTNERS.md` §F) — este trabajo queda **sin numerar**, mismo
criterio que la mitigación de `G10` y el fix de deploy de Render/Corepack:
real, pero fuera de la secuencia de hitos planificados.
