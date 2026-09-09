# Prompt de continuación — explorar nuevas mejoras y funcionalidades para AgentPay

> Generado el 2026-09-09, para pegar como primer mensaje en un chat nuevo de
> Claude Code dentro de esta misma carpeta (`AgentPay/`). Es un chat de
> código.

---

CONTEXTO

Este es AgentPay, un proyecto de pagos agénticos en siete fases sobre Stellar
testnet. Repo público: `github.com/vicentewolde/AgentPay`, rama `main`,
pusheado y al día (commit `3ac4ffc` al generar este prompt, working tree
limpio).

**Fases 1 a 4 cerradas. Fase 5 (MandateVault) sin candidatos técnicos
pendientes — T27 a T31 cerrados el 2026-09-04**, el último de ellos
(`policy_rail`, el smart account de Soroban de la Fase 3, pagando facturas
x402 reales con sus límites aplicados por la propia red) el hito más
"Stellar-nativo" del proyecto.

**Desde entonces (2026-09-05 en adelante) hubo trabajo real que no es un
hito numerado de ninguna fase** — mismo criterio que la Fase 5 estableció
para la landing: cambios de producto/UX que no ameritan un `T<n>`, pero sí
quedaron documentados sin numerar en `docs/fase-5-mandatevault/BITACORA.md`.
En orden:

- **`P-3` (2026-09-05):** cambio de plan de negocio — la Instaward del
  Stellar Community Fund se gestiona vía un referente de Stellar en Chile
  (Tellus), a cambio de un mensaje de WhatsApp con un link al MVP y un link a
  la landing. La cohorte de alumnos, la demo grabable y el formulario de
  Build Award quedaron sin prioridad (no descartados). El único criterio de
  "listo" pasó a ser que el MVP y la landing funcionen bien.
- **Ronda de usabilidad del MVP (2026-09-06):** sesión aislada por visitante
  (antes era una sola sesión global en memoria), aviso de cold-start de
  Render, copy en lenguaje llano por paso.
- **Landing v2 (2026-09-07):** feed de "actividad reciente" con una sesión
  real congelada (no simulada), estadísticas de prueba movidas arriba del
  pliegue, línea de tiempo de "eras de pago". Varias rondas de ajuste de
  copy con el usuario antes de publicar.
- **Rediseño completo del MVP (2026-09-07):** `apps/web/public/index.html`
  pasó de un panel oscuro monoespaciado a compartir la tipografía editorial y
  paleta clara de `/landing`, ahora bilingüe EN/ES (mismo `localStorage` que
  la landing). Se simplificó a un solo botón de compra (solo `policy_rail`
  como pagador, se sacó la opción de cuenta clásica).
- **Bug de producción encontrado y arreglado (2026-09-07):** `render.yaml`
  nunca declaraba `POLICY_RAIL_CONTRACT_ID` — el único botón de compra que
  quedó tras el rediseño dependía de esa variable. Arreglado y verificado en
  vivo contra `https://agentpay-web.onrender.com/`.
- **Cambio de coordinación (`P-4`, `P-5`, 2026-09-07/08):** Devin
  discontinuado por calidad insuficiente; Codex (OpenAI, incluido en ChatGPT
  Plus) es el segundo agente ahora, trabajando en su propio worktree de git
  (`~/dev/AgentPay-codex`), no en esta carpeta — para que un `checkout` suyo
  nunca vuelva a pisar el trabajo de Claude Code (ya pasó dos veces, con
  Devin y con Codex, antes de resolverlo así). Su primer PR de prueba
  (`#2`, tests de `packages/sdk/src/config.ts`) está revisado pero **todavía
  sin decisión del usuario sobre mergearlo** — puede seguir así al arrancar
  este chat.

**No verificado en esta última sesión: si el mensaje de WhatsApp a Tellus ya
se envió.** `docs/AGENT_LOG.md` no registra ese envío explícitamente —
confirmalo con el usuario si es relevante para lo que te pida, en vez de
asumir cualquiera de las dos cosas.

Antes de escribir o proponer nada, leé en este orden:

1. `docs/AGENT_LOG.md` — completo si es posible; como mínimo, todo desde la
   entrada `## 2026-09-05 (2) — main` (el cambio de plan `P-3`) en adelante.
   Ahí está el detalle de cada punto de la lista de arriba, con su porqué.
2. `docs/DECISIONES.md` — completo, especialmente `P-3`, `P-4` y `P-5` (las
   tres más recientes, todas vigentes).
3. `docs/fase-5-mandatevault/BITACORA.md` y `DECISIONES.md` — estado técnico
   completo de la fase (T27–T31) más las entradas sin numerar posteriores
   (`V-16`, `V-17` y lo que siga).
4. `ROADMAP.md` — mapa de las siete fases. **Su línea de estado (línea 13)
   está desactualizada** — dice "Fase 5, en curso (T27–T30)" cuando T31 ya
   cerró y hubo varias rondas de trabajo después; no la tomes como fuente de
   verdad sola, cruzala con `docs/AGENT_LOG.md`.
5. `CLAUDE.md`, en la raíz — reglas de trabajo, protocolo de coordinación con
   Codex (reemplazó a Devin — la sección todavía puede decir "Codex" o estar
   en transición, verificalo), y los criterios transversales no negociables.
6. El estado real del producto, no solo lo que la documentación describe: si
   podés, corré `pnpm run web` y abrí `/` y `/landing` en el navegador, o
   revisá directo `https://agentpay-web.onrender.com/` y su `/landing` —
   ambos quedaron rediseñados y verificados en producción el 2026-09-07.
7. `apps/web/src/server.ts` y `apps/web/public/index.html` — el MVP tal cual
   está hoy, después del rediseño y de la ronda de usabilidad: sesión por
   cookie, bilingüe, un solo botón de compra vía `policy_rail`.

---

QUÉ HACER

El pedido del usuario es explorar mejoras o funcionalidades nuevas para
AgentPay — deliberadamente abierto, y a propósito **sin ninguna lista de
candidatos precargada en este prompt**: la idea es que la evaluación salga
de leer el estado real del proyecto con esta sesión, no de repetir una lista
que alguien más ya armó. Investigá con la misma disciplina que el resto del
proyecto ya usó en cada fase (verificar contra código y tráfico real antes de
diseñar sobre un supuesto), armá tu propia lista corta con una recomendación,
y presentásela al usuario — una pregunta clara, no una lista larga sin
opinión — antes de tocar código. El usuario puede confirmar uno, pedir varios,
o redirigirte a algo fuera de la lista.

Tené en cuenta el alcance que `CLAUDE.md` §"Reglas de trabajo" punto 5 marca
como **fuera de límite todavía**: la ejecución de negocio del piloto (cohorte
de alumnos, comunidad aliada, demo grabable, formulario de Build Award —
sigue sin prioridad por `P-3`), y cualquier cosa en mainnet o con rieles
fiat. Si algo que encontrás parece pedir eso, anotalo y dejalo sin construir,
en vez de forzarlo.

Al construir, seguí el mismo ritmo ya establecido: una rama `cc/<feature>`
por hito, tests + `pnpm typecheck` + `pnpm build` limpios antes de cerrar,
verificación real en el navegador (Claude Browser, no solo tests) cuando el
cambio sea observable, documentación actualizada si el cambio lo amerita
(`BITACORA.md`/`DECISIONES.md` de la fase que corresponda, o sin numerar si
es más una mejora de producto que un hito técnico — mismo criterio que ya se
usó varias veces desde `P-3`), entrada en `docs/AGENT_LOG.md`, y confirmación
explícita del usuario antes de mergear a `main` y pushear — nunca asumida de
una aprobación anterior.
