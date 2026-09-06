# Prompt de continuación — mejorar el MVP (`apps/web`) para el envío a Tellus

> Generado el 2026-09-05, para pegar como primer mensaje en un chat nuevo de
> Claude Code dentro de esta misma carpeta (`AgentPay/`). Es un chat de
> código.

---

CONTEXTO

Este es AgentPay, un proyecto de pagos agénticos en siete fases sobre Stellar
testnet. Repo público: `github.com/vicentewolde/AgentPay`, rama `main`,
pusheado y al día.

**Fases 1 a 4 cerradas. Fase 5 (MandateVault) sin candidatos técnicos
pendientes — T27 a T31 cerrados el 2026-09-04**, el último de ellos
(`policy_rail`, el smart account de Soroban de la Fase 3, pagando facturas
x402 reales con sus límites aplicados por la propia red) el hito más
"Stellar-nativo" del proyecto.

**Cambio de plan de negocio, 2026-09-05 (`docs/DECISIONES.md` → `P-3`).** El
encargado de Tellus —un referente de Stellar en Chile— se ofreció a
gestionar una Instaward de USD 5.000 del Stellar Community Fund
directamente, a cambio de un mensaje de WhatsApp explicando el proyecto, un
link al MVP y un link a la landing. Como consecuencia:

- La cohorte de alumnos, la demo grabable, y el formulario de interés de
  Build Award quedan **sin prioridad, pendientes para después** — no se
  descartaron, solo salieron del camino crítico.
- **Lo único que importa ahora es que el MVP y la landing funcionen bien.**
  Son las dos piezas que se van a compartir.

**La landing (`apps/web/public/landing.html`, en `/landing`) ya está lista**
— tercera iteración, nivel de pulido visual "YC" (tipografía editorial,
un acento, la evidencia real como héroe), verificada en navegador, mobile y
desktop, con cambio de idioma EN/ES. **No hace falta tocarla** salvo que el
trabajo de este chat encuentre una razón concreta para hacerlo (por ejemplo,
un link roto hacia el MVP).

**El MVP es `apps/web` (`https://agentpay-web.onrender.com/`, o `pnpm run
web` en local) — la demo interactiva real.** Es lo que el encargado de
Tellus va a *usar*, no solo mirar: va a clickear los pasos, no leer prosa.
Esta es la pieza que este chat tiene que dejar funcionando bien.

Antes de escribir una sola línea, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas entradas cuentan T31 (`policy_rail`
   como pagador real) y el cambio de plan `P-3`, con el porqué de cada uno.
2. `docs/fase-5-mandatevault/BITACORA.md` y `DECISIONES.md` — estado técnico
   completo de lo que ya existe (T27–T31).
3. `docs/DECISIONES.md` → `P-3` — el cambio de prioridad completo, con la
   alternativa descartada.
4. `CLAUDE.md`, en la raíz — reglas de trabajo, protocolo de coordinación con
   Devin, criterios transversales no negociables.
5. `apps/web/src/server.ts` y `apps/web/public/index.html` — el MVP tal
   cual está hoy: cinco pasos clickeables (catálogo real del bazaar, sesión,
   comprar con pago real —clásico o vía `policy_rail`—, revocar el Mandato,
   bitácora de MandateVault).

---

LO PRIMERO QUE TENÉS QUE HACER: EVALUAR, NO ASUMIR

"Mejorar funcionalidades del MVP" es deliberadamente abierto. Antes de tocar
código, armá una lista corta de candidatos y presentásela al usuario con tu
recomendación — mismo patrón que ya se usó para elegir T27–T31 y para el
candidato técnico de `policy_rail`. Partí de lo que **ya quedó anotado en la
documentación existente**, sin evaluar de cero — cada uno tiene su contexto
en el `AGENT_LOG.md`/`DECISIONES.md`:

- **`apps/web` es una sola sesión global en memoria (`let session` en
  `server.ts`), no multi-tenant** — dicho explícitamente en el docstring del
  archivo desde T25 ("conference-demo server, not a multi-tenant app"). Con
  el público cambiando de "gente de Stellar en un stand" a "un evaluador que
  abre un link por su cuenta", esto pasa de curiosidad a riesgo real: si el
  encargado de Tellus prueba el flujo mientras vos (o cualquiera) lo estás
  probando también, una sesión pisa a la otra sin aviso.
- **El vault (`data/mandate-vault.jsonl`) no sobrevive un redeploy de Render
  sin disco persistente** — `render.yaml` sigue sin bloque `disk`. Si Tellus
  abre la bitácora después de un redeploy, la ve vacía sin ninguna
  explicación.
- **Solo `swap-risk-quote` tiene un pago real conectado en el catálogo** —
  el resto se muestra pero no se puede comprar de verdad, y la página lo
  dice explícito. Puede leerse como una demo incompleta para alguien
  evaluando tracción, no solo tecnología.
- **`buy()` (el camino clásico) sigue llamando `executeBazaarPayment`
  directo, no `execute_payment`** (la tool del agente, T26) — deuda de
  consistencia interna, sin impacto visible para quien usa el MVP.
- **El free tier de Render tarda 30–70s en "despertar"** si el servicio
  estaba dormido — mencionado ya en el prompt que generó la landing. Un
  evaluador que abre el link y no ve nada pasar en los primeros segundos
  puede asumir que está roto, no que está arrancando.

Sumale tu propia evaluación fresca, con la audiencia nueva en mente (un
evaluador de negocio/inversión que interactúa solo, sin nadie al lado
explicando) — por ejemplo, y sin asumir que esto ya es la lista final:

- **Brecha visual entre la landing (recién rediseñada, nivel YC) y el MVP**
  (cinco pasos en HTML/CSS plano, sin el mismo nivel de pulido). El CTA de
  la landing lleva directo al MVP — ese salto de calidad visual podría
  restarle seriedad a lo que en sustancia es más fuerte que la landing (acá
  es donde la plata se mueve de verdad, no solo se cuenta).
- **Claridad de cada paso para alguien sin contexto técnico previo** — hoy
  el MVP asume que quien lo usa ya entiende `PurchaseIntent`, Mandato,
  `policy_rail`, etc. Verificá si cada paso explica en una frase simple qué
  está pasando y por qué importa, no solo qué botón apretar.
- **Qué pasa si algo falla en vivo** — un error de red, el bazaar caído, o
  un límite que rechaza la compra a propósito (la demo de la Fase 3 lo hace
  adrede): ¿el MVP explica ese rechazo como una prueba de que el sistema
  funciona, o se ve como un error sin más?

Investigá antes de comprometerte a un diseño (mismo hábito que T19, T22,
T24, T28, T31): si algo depende de un comportamiento real de Render, del
bazaar, o de `@x402/stellar`, verificalo contra el servidor real o el código
instalado antes de diseñar sobre un supuesto.

**Presentale al usuario la lista corta con tu recomendación** — una
pregunta clara, no una lista larga sin opinión. El usuario puede confirmar
uno, pedir que hagas varios, o redirigirte a algo que no está en esta lista.

**Al construir**, seguí el mismo ritmo que ya está establecido en el
proyecto: una rama `cc/<feature>` por hito, tests + `pnpm typecheck` +
`pnpm build` limpios antes de cerrar, verificación real en el navegador
(Claude Browser, no solo tests) contra `pnpm run web`, documentación
actualizada si el cambio lo amerita, entrada en `docs/AGENT_LOG.md`, y
confirmación explícita del usuario antes de mergear a `main` y pushear —
nunca asumida de una aprobación anterior. Si algún candidato termina siendo
más una mejora de UI/copy que un hito técnico numerado (como pasó con la
landing), no hace falta forzarlo a un `T<n>` de `docs/fase-5-mandatevault/`
— usá el mismo criterio que ya se usó ahí.

**No hace falta preguntar de nuevo por el estado del piloto de alumnos ni
por Build Award** — ya se resolvió (`P-3`): quedan pendientes, sin
prioridad, y no es tema de este chat.
