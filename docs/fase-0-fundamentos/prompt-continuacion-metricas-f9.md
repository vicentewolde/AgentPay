# Prompt de continuación — cerrar métricas/alertas/retención, arrancar F9

> Generado el 2026-09-12, al cerrar T69, para pegar como primer mensaje en un
> chat nuevo de Claude Code dentro de esta misma carpeta (`AgentPay/`).

---

CONTEXTO

Este es AgentPey, un proyecto de pagos agénticos en diez fases sobre Stellar
testnet. Repo público: `github.com/vicentewolde/AgentPey`, rama `main`,
pusheado y al día (commit `bfb52f1` al generar este prompt).

**F8 (hardening) cerró del todo, en dos rondas separadas, ambas el
2026-09-12:**

- **T61–T66** cerraron el "listo cuando" explícito de F8: `perDay` aguanta
  más de un proceso sin excederse ni romper la cadena del vault. T64 (Codex)
  encontró con un harness de carga real que T61 solo había cerrado la
  carrera de *escritura*; T66 cerró la carrera de *decisión* que quedaba
  (`ledger.atomically()`, `packages/vault`/`apps/agent`).
- **T67–T69** cerraron `G12` (mencionado en el alcance de F8, nunca
  desglosado en un ticket propio): el estado de wallet-connect en memoria.
  T67 encontró y resolvió el bloqueante real — no estaba en `apps/web`,
  sino en `packages/sdk` (Fase 1): `Registry` guardaba la transacción
  Soroban armada en memoria entre `prepareAnchor`/`prepareRevoke` y
  `submitSigned`. T68 conectó esa capacidad a Postgres para el anclaje de
  wallet. T69 migró los últimos cuatro stores en memoria (desafíos,
  sesiones pendientes, direcciones de wallet). Verificado con los tres
  flujos completos (clásico, wallet-connect, consent-session hospedado) de
  punta a punta contra el servidor real y testnet real.

Detalle técnico completo, con las alternativas descartadas de cada
decisión, en `docs/fase-6-agentguard-comercializacion/DECISIONES.md`
(`C-67` a `C-71`) y `BITACORA.md`. `pnpm typecheck`/`pnpm build`/`pnpm test`
limpios en cada hito.

Antes de escribir una sola línea, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas entradas del 2026-09-12 cuentan F8 y
   `G12` hito a hito, con el porqué de cada decisión.
2. `docs/fase-6-agentguard-comercializacion/BITACORA.md` y `DECISIONES.md`
   — estado técnico completo de F8/`G12` (T61–T69).
3. `docs/fase-6-agentguard-comercializacion/PLATAFORMA-PARTNERS.md` — la
   tabla de brechas conocidas (`G1`–`G13`) y el desglose fase por fase.
4. `CLAUDE.md`, en la raíz — reglas de trabajo, protocolo de coordinación
   con Codex, y los criterios transversales no negociables.

---

## Lo que sigue, en dos partes — en este orden

### 1. Cerrar lo que quedó explícitamente anotado y sin ticket: métricas, alertas, política de retención

La sección "Alcance" original de F8 (`PLATAFORMA-PARTNERS.md` § F8) los
mencionaba junto a `G4`/`G11`/`G12`, pero nunca se desglosaron en un ticket
real — la delegación efectiva solo cubrió `G4` y `G11`. A diferencia de
`G4`/`G12`, esto **no tiene un problema concreto ya identificado esperando
arreglo** — es una decisión de producto sin tomar todavía: qué medir,
sobre qué umbral avisar, y cuánto tiempo retener qué.

**No asumas un diseño — primero armá una lista corta de candidatos y
preguntale al usuario**, mismo criterio que ya se usó para elegir entre
T27/T28/T29/T30 en la Fase 5. Como punto de partida, mirá qué ya existe:

- `packages/vault` (`vault_records`, `sdk_pending_writes` desde T67/T68) y
  `wallet-session-store.ts` (T69) — ¿cuánto tiempo debería vivir una fila
  de `wallet_challenges`/`pending_wallet_sessions` más allá de su TTL de
  lectura? Hoy nada las borra activamente, solo dejan de ser legibles.
- `apps/status-dashboard` (T59) — panel de solo lectura ya existente;
  ¿es el lugar natural para mostrar métricas, o hace falta algo aparte?
- `apps/web/src/logging.ts` (T63) — logging estructurado ya existe para
  errores de infraestructura; ¿alertas es "avisar sobre esos logs" o algo
  con su propio umbral de negocio (`perDay` cerca del límite, un rail
  quedándose sin fondos — `scripts/check-rail-balances.ts`, T60, ya
  existe pero no alerta, solo informa)?
- `G10`/`C-63` (tope de registro de emisores) es la única otra pieza del
  proyecto con algo parecido a un "umbral de alerta" — mirá cómo se
  decidió ese número antes de proponer uno nuevo de la nada.

Presentale al usuario la lista corta con tu recomendación — una pregunta
clara, no una lista larga sin opinión — antes de tocar código. Puede que
la respuesta sea "esto no vale la pena todavía, saltalo" — es una opción
válida, no asumas que hay que construir algo.

### 2. Arrancar F9 (piloto externo en testnet)

`PLATAFORMA-PARTNERS.md` § F9 deja explícito que hacen falta dos
decisiones del usuario antes de poder armar el primer hito — no están
respondidas todavía en ningún documento:

- **Quién es el partner real** para el piloto.
- **Cuál es la métrica de éxito** que decide si el piloto funcionó.

No arranques a construir nada de F9 sin esas dos respuestas — preguntaselas
directo, no las asumas ni las infieras del resto del roadmap.

---

## Reglas de trabajo (sin cambios, recordatorio)

- Rama `cc/<feature>` por hito, nunca directo a `main`.
- `pnpm typecheck`/`pnpm build`/`pnpm test` limpios antes de cerrar
  cualquier hito — y la corrida de integración (`test:integration`) de
  cualquier paquete que la tenga y que el hito haya tocado.
- Documentación actualizada al cerrar cada hito: `BITACORA.md` (progreso +
  bloque en lenguaje llano), `DECISIONES.md` (con motivo y alternativa
  descartada), `docs/AGENT_LOG.md` (branch, qué, por qué, qué queda
  pendiente) — no es opcional.
- Mergear a `main` y pushear solo con confirmación explícita del usuario
  para cada hito — nunca asumida de una aprobación anterior.
- Custodia, gestión de claves, firma de wallet, revocación, y cualquier
  decisión de producto difícil de revertir se quedan en Claude Code, no se
  delegan a Codex sin visto bueno explícito — ver `CLAUDE.md` §
  "Coordinación con Codex".
