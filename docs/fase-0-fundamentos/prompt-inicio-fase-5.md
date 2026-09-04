# Prompt de arranque — Fase 5 (MandateVault + cierre de piloto)

> Generado el 2026-09-04 al cerrar la Fase 4, para pegar como primer mensaje
> en un chat nuevo de Claude Code dentro de esta misma carpeta (`AgentPay/`).

---

CONTEXTO

Este es AgentPay, un proyecto de pagos agénticos en siete fases sobre Stellar
testnet. Repo público: `github.com/vicentewolde/AgentPay`, rama `main`,
pusheado y al día.

**Fases 1 a 4 cerradas.**

- **Fase 1 (AgentPass, T1–T8)** — identidad verificable del agente. Contrato
  desplegado: `CARC2SIQ3GTL34LVHSTGFRKDNNBYUXCSMGAUGKWGMT6Z2SDY6FXPP2DT`.
- **Fase 2 (agente mínimo de compra, T9–T15)** — un agente lee un catálogo
  real (el bazaar de un Embajador de Stellar) y produce una intención de
  compra firmada, trazable a su credencial.
- **Fase 3 (PolicyRail + Mandato, T16–T23)** — el límite de gasto se hace
  cumplir en infraestructura (`PolicyRail`), no en el prompt; el
  consentimiento del principal es un documento firmado (el Mandato),
  revocable desde afuera del agente.
- **Fase 4 (MandateGate, T24–T26)** — toda esa cadena se ejerce contra un
  pago **real**: un `PurchaseIntent` firmado se convierte en plata movida de
  verdad en Stellar testnet, contra el bazaar real. Desplegado y público en
  [agentpay-web.onrender.com](https://agentpay-web.onrender.com/). T26
  (el hito más reciente, 2026-09-04) agregó `execute_payment` — una quinta
  tool del agente que firma y paga en una sola llamada, invocable por una
  instrucción en español, con las mismas protecciones de siempre — y cerró
  dos huecos que habían quedado documentados y sin resolver: `payTo`
  (a quién se le puede pagar, ahora parte del Mandato) y un bug real donde
  una compra contaba el doble contra el límite diario.

604 tests rápidos, 0 fallando (`pnpm test`). `pnpm typecheck` limpio.

Vas a evaluar y, si corresponde, arrancar la Fase 5: **MandateVault + cierre
del piloto.**

Antes de escribir una sola línea, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas entradas dicen exactamente qué se hizo
   para cerrar la Fase 4 y por qué, incluida una nota de higiene sobre no
   imprimir secretos en el chat innecesariamente — vale la pena leerla.
2. `ROADMAP.md` §4.5 — la especificación de esta fase tal como está hoy: qué
   prueba, y **por qué todavía no tiene desglose de tareas** (depende de qué
   evidencia produjeron realmente las Fases 3 y 4 — ya la tenés, hay que
   mirarla).
3. `docs/fase-4-mandategate/BITACORA.md` y `DECISIONES.md` — estado técnico
   completo de lo que esta fase hereda: los eventos on-chain de
   PolicyRail/Mandato/MandateGate son la materia prima de MandateVault.
4. `CLAUDE.md`, en la raíz — reglas de trabajo. La nota de alcance del punto
   5 sigue sin actualizar para la Fase 5: dice qué entró en alcance hasta la
   Fase 4, no menciona MandateVault todavía. Actualizala a mano antes de
   tocar código, como se hizo en cada fase anterior.
5. `docs/DECISIONES.md` — decisiones de proyecto (prefijo `P-`).

---

LO PRIMERO QUE TENÉS QUE HACER: ESTA FASE ES DISTINTA A LAS ANTERIORES

Las Fases 2, 3 y 4 eran, de punta a punta, trabajo de ingeniería sobre este
repo. La Fase 5 no lo es del todo — `ROADMAP.md §4.5` la define con una
definición de "listo" que mezcla dos tipos de trabajo muy distintos:

- **Ingeniería real, que sí depende de este repo:** MandateVault —
  convertir los eventos on-chain que PolicyRail/Mandato/MandateGate ya
  producen en evidencia consultable y verificable, no solo texto en una
  terminal o en `evidencia/*.md`.
- **Ejecución de negocio y de piloto, que no depende de código:** que al
  menos una cohorte real de alumnos y de la comunidad aliada corran el flujo
  (no solo el equipo del proyecto), una demo grabable, el formulario de
  interés de Build Award enviado.

**No asumas que "empezar la Fase 5" significa escribir código.** Antes de
diseñar nada, preguntale al usuario en qué punto está lo segundo (el piloto
con alumnos, el contacto con la comunidad aliada, el formulario de Build
Award) — condiciona qué construir primero, o si construir algo de
MandateVault tiene sentido todavía sin esa evidencia real para consultar.

**Alternativa, si el usuario prefiere no encarar la Fase 5 todavía:** hay
trabajo más chico y ya identificado que no depende de nada de esto —
`apps/web`'s `buy()` sigue llamando `executeBazaarPayment` directamente en
vez de a través de `execute_payment` (la tool nueva de T26); migrarlo fue
explícitamente dejado fuera de T26 por no ser parte del pedido, no porque
haga falta más diseño. Es una opción concreta si lo que se busca es una
tarea acotada mientras se decide qué hacer con la Fase 5.
