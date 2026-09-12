# Prompt de continuación — arrancar F9 (piloto externo en testnet)

> **Actualización 2026-09-12 — este prompt fue superado para F9.** Las dos
> decisiones que la versión original dice pendientes ya fueron tomadas por el
> usuario: partner de referencia RealOps Agent, comercio SignalDesk y éxito
> definido como recorrido externo completo más variantes guiadas. Antes de
> diseñar o escribir código, usar
> [PLAN-F9-REALOPS.md](../fase-6-agentguard-comercializacion/PLAN-F9-REALOPS.md)
> y C-74 en las decisiones de Fase 6. La sección antigua “Lo que sigue” se
> conserva como contexto histórico y no se debe seguir.

> Generado el 2026-09-12, al cerrar T71, para pegar como primer mensaje en un
> chat nuevo de Claude Code dentro de esta misma carpeta (`AgentPay/`).

---

CONTEXTO

Este es AgentPey, un proyecto de pagos agénticos en diez fases sobre Stellar
testnet. Repo público: `github.com/vicentewolde/AgentPey`, rama `main`,
pusheado y al día (commit `a104e7a` al generar este prompt).

**F8 (hardening) cerró del todo, en tres rondas separadas, todas el
2026-09-12:**

- **T61–T66** cerraron el "listo cuando" explícito de F8: `perDay` aguanta
  más de un proceso sin excederse ni romper la cadena del vault.
- **T67–T69** cerraron `G12`: el estado de wallet-connect en memoria
  (`Registry` en `packages/sdk`, y los stores de `apps/web`) pasó a
  Postgres, verificado con los tres flujos completos de wallet contra
  testnet real.
- **T70–T71** cerraron lo último que la sección "Alcance" original de F8
  mencionaba sin desglosar en ticket: **T70** agregó un barrido periódico
  que borra de verdad las filas vencidas del flujo de wallet (antes solo
  dejaban de leerse); **T71** agregó al `status-dashboard` (T59) existente
  un panel completo de métricas/alertas — uso de `perDay` cerca del límite,
  rechazos recientes, saldo USDC del `policy_rail` de cada tenant — todo de
  solo lectura, reutilizando el mismo cálculo (`spentOn`) que la
  autorización real usa, nunca una copia aparte.

Con esto, **el alcance completo original de F8 queda cubierto de punta a
punta.** Detalle técnico completo, con las alternativas descartadas de cada
decisión, en `docs/fase-6-agentguard-comercializacion/DECISIONES.md`
(`C-67` a `C-73`) y `BITACORA.md`. `pnpm typecheck`/`pnpm build`/`pnpm test`
limpios en cada hito.

Antes de escribir una sola línea, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas entradas del 2026-09-12 cuentan F8,
   `G12`, retención y el panel de métricas hito a hito, con el porqué de
   cada decisión.
2. `docs/fase-6-agentguard-comercializacion/BITACORA.md` y `DECISIONES.md`
   — estado técnico completo (T61–T71).
3. `docs/fase-6-agentguard-comercializacion/PLATAFORMA-PARTNERS.md` — la
   tabla de brechas conocidas (`G1`–`G13`, todas resueltas o mitigadas a
   esta altura) y, sobre todo, **§ F9**, que es lo que sigue.
4. `CLAUDE.md`, en la raíz — reglas de trabajo, protocolo de coordinación
   con Codex, y los criterios transversales no negociables.

---

## Lo que sigue: arrancar F9 (piloto externo en testnet)

`PLATAFORMA-PARTNERS.md` § F9 deja explícito que hacen falta **dos
decisiones del usuario** antes de poder armar el primer hito real de F9.
Ya se le preguntaron directo al usuario una vez (al cerrar T69/T70) y
**las dos siguen sin responder** — el usuario contestó explícitamente
"todavía no lo tengo decidido" para ambas:

1. **Quién es el partner real para el piloto.** `PLATAFORMA-PARTNERS.md`
   § "Preguntas" (pregunta 2) y § F9 nombran como candidato obvio **el
   bazaar del embajador** (`CaBsCrypto/stellar-bazaar-x402`, ya integrado
   como catálogo real desde T15/Fase 2 y usado en T24/T25/demos — el
   camino con menos trabajo nuevo de integración) y, como alternativa, un
   equipo o proyecto de hackathon (partner nuevo, sin integración previa,
   más trabajo de onboarding). § F9 anota también "mitigación: dos
   candidatos" sin nombrar el segundo — no asumas cuál es, pregúntaselo al
   usuario directo si hace falta.
2. **Cuál es la métrica de éxito que decide si el piloto funcionó.**
   `C-24` ya fijó un criterio parecido para el piloto *interno* (Fases
   1–5): "el flujo completo con todas sus variantes de rechazo, con una
   entidad de cada tipo" — no una métrica de volumen, porque en testnet sin
   usuarios reales el volumen se puede inflar sin probar nada. Ese mismo
   criterio, aplicado ahora al **partner real** en vez de a entidades que
   nosotros mismos construimos, es el candidato natural para F9 — pero es
   una recomendación, no una decisión ya tomada: hay que confirmarla o
   reemplazarla con el usuario, no asumirla en silencio.

**No arranques a construir nada de F9 sin esas dos respuestas.**
Pregúntaselas directo al usuario al empezar la sesión — no las infieras del
resto del roadmap, y no asumas que la recomendación de arriba es la
respuesta final solo porque es la más obvia.

Una vez respondidas, `PLATAFORMA-PARTNERS.md` § F9 ya tiene el primer hito
delegable listo para arrancar (`T59`, el panel de solo lectura, ya cerrado)
y describe qué sigue: incorporar al partner real es trabajo de Claude Code
(coordinación y producto, no delegable a Codex por naturaleza), mediar el
piloto, y decidir junto con el usuario si se cumplió el criterio de éxito
elegido.

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
