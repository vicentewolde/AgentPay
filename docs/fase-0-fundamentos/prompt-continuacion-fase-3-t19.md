# Prompt de continuación — Fase 3, T19 (PolicyRail)

> Generado el 2026-09-03 al cerrar T18, para pegar como primer mensaje en un
> chat nuevo de Claude Code dentro de esta misma carpeta (`AgentPay/`). El
> chat anterior cerró T16, T17 y T18; se abre uno nuevo para no seguir
> cargando esa conversación completa, ahora que apareció información nueva
> que conviene investigar con contexto fresco.

---

CONTEXTO

Este es AgentPay, un proyecto de pagos agénticos en siete fases sobre Stellar
testnet. Repo público: `github.com/vicentewolde/AgentPay`, rama `main`,
último commit `7f0fce6` (T18), pusheado.

**Fases 1 y 2 cerradas.** Fase 3 (PolicyRail + Mandato) en curso:

- **T16** — `@agentpay/mandate`: el Mandato, el documento firmado por el
  principal (VC-JWT reutilizado, no una criptografía nueva).
- **T17** — `checkMandate(mandate, intent)`: función pura que decide si un
  mandato cubre una compra concreta. Ocho chequeos, ocho códigos de error.
- **T18** — `SpendLedger` + `checkDailyLimit()`: la memoria de gastos que
  hace cumplir `perDay`, tanto de `scope.limits` (credencial, `B-16`) como de
  `grant.limits` (mandato).

482 tests rápidos, 0 fallando. Evidencia y mutation testing de cada hito en
`docs/fase-3-policyrail-mandato/evidencia/T16.md`, `T17.md`, `T18.md`.

**Antes de escribir una sola línea, leé en este orden:**

1. `CLAUDE.md`, en la raíz — reglas de trabajo, y la sección **"Coordinación
   con Devin"** en particular: es un protocolo obligatorio, no opcional, desde
   que se sumó Devin como segundo agente sobre esta misma carpeta.
2. `docs/AGENT_LOG.md` — qué pasó en las últimas sesiones, de los dos
   agentes. Hay una nota de coordinación sobre `website/` que sigue sin
   resolverse del todo (ver más abajo).
3. `docs/fase-3-policyrail-mandato/BITACORA.md` — estado actual, T16–T18
   cerrados, hito a hito en lenguaje llano.
4. `docs/fase-3-policyrail-mandato/ARQUITECTURA.md` — mapa técnico completo:
   la forma del Mandato (§4), `checkMandate` (§6), `SpendLedger` y
   `checkDailyLimit` (§7). La sección §8, sobre PolicyRail, todavía describe
   el diseño *antes* del hallazgo de abajo — puede necesitar revisión.
5. `docs/fase-3-policyrail-mandato/DECISIONES.md` — decisiones `M-1` a
   `M-10`. **`M-1` es la que más importa revisar ahora**: asumía que el
   bazaar del embajador acepta una cuenta de contrato como comprador, "porque
   es lo estándar en Soroban". El hallazgo de abajo pone en duda si esa
   pregunta es siquiera la correcta para este bazaar en particular.
6. `ROADMAP.md` §4.2 (las diez preguntas al embajador) y §4.3 (la
   especificación de la Fase 3, con la tabla de hitos T16–T23).

---

LO NUEVO: EL REPO REAL DEL BAZAAR YA ES PÚBLICO

El usuario compartió el repo real del bazaar del embajador:
**`https://github.com/CaBsCrypto/stellar-bazaar-x402`** (público, Apache-2.0,
activo — último push el mismo día que este prompt). Las diez preguntas de
`ROADMAP.md §4.2` se redactaron sin poder verlo. Ahora se puede, y **antes de
diseñar nada de T19 hay que releerlas contra el código real**, no seguir
asumiendo.

**Una verificación liviana ya hecha** (README y metadata del repo, nada más
profundo — se dejó a propósito para esta sesión) encontró algo que cambia el
marco de las diez preguntas:

> "Bazaar has **no deployed Bazaar smart contract**, escrow, fee split,
> Mainnet payment flow, or public dispute process."
> — README de `stellar-bazaar-x402`

El flujo real que describe su propio README es el estándar **x402** (HTTP 402
Payment Required), no un contrato Soroban con una función de compra:

```
agente descubre el servicio (MCP/REST) → pide el recurso → recibe HTTP 402
→ el agente firma una autorización Ed25519 con su wallet local
→ la envía por header → un Facilitator (hosteado por OpenZeppelin) la
  verifica y la liquida → el Facilitator construye y envía la transacción a
  Stellar
```

Esto importa porque la pregunta 6 (¿comprador `C...` o solo `G...`?) asume que
existe un contrato de compra al que hacerle esa pregunta. Si el mecanismo real
es un *Facilitator* de terceros que firma y envía usando una autorización que
el agente ya firmó, la pregunta correcta puede ser otra — y la respuesta a la
pregunta 5 (¿un tercero puede construir y enviar la transacción?) parece que
**ya es que sí, por diseño del protocolo**, lo cual sería una noticia muy
buena para PolicyRail.

**Dos documentos del propio repo van directo al punto y son la primera lectura
técnica de esta sesión, antes que cualquier diseño:**

- `docs/BUYER_PROVIDER_PAYMENT_FLOW.md` — el flujo completo como máquina de
  estados. Su propio diagrama nombra un paso **"buyer policy"** entre el 402 y
  el settle — es, literalmente, dónde encajaría PolicyRail.
- `docs/LISTING_PURCHASE_ESCROW_FUTURE.md` — el modelo de compra/escrow que el
  bazaar todavía no construyó, documentado como trabajo futuro de ellos.

Usá `gh api repos/CaBsCrypto/stellar-bazaar-x402/contents/<path>` o el clon
del repo para leerlos, y buscá también el código real del Facilitator/verify/
settle (probablemente bajo rutas de API de Next.js) para ver si la
autorización firmada es una transacción Stellar clásica firmada por una cuenta
`G...`, un `SorobanAuthorizationEntry`, o algo específico del protocolo x402
que no es ninguna de las dos cosas tal como el proyecto las viene pensando.

**Lo que se espera de esta sesión antes de tocar código:**

1. Investigar lo suficiente del repo real (los dos documentos de arriba, más
   el código del flujo de pago) para releer las diez preguntas de
   `ROADMAP.md §4.2` y decir, para cada una, si el repo ya la responde, la
   vuelve irrelevante, o sigue abierta.
2. Decir explícitamente si `M-1` sigue siendo un supuesto razonable, si hay
   que reformularlo, o si la pregunta 6 tal como está escrita ya no es la
   pregunta correcta para este bazaar. **No cambiar `M-1` en silencio** — la
   regla 2 de `CLAUDE.md` aplica igual que a cualquier otra decisión.
3. Con eso resuelto, recién ahí proponer cómo cambia (si cambia) el diseño de
   T19 que `ARQUITECTURA.md §8` ya esboza, y esperar confirmación antes de
   escribir código.

**Esto probablemente también afecta a T15** (el `BazaarSorobanAdapter` de la
Fase 2, bloqueado) y a la Fase 4 (MandateGate) — ninguna de las dos es el
trabajo de esta sesión, pero si el hallazgo de arriba las cambia de forma
importante, vale la pena decirlo y anotarlo, no solo resolverlo para T19 y
seguir de largo.

---

PENDIENTE DE COORDINACIÓN, SIN RESOLVER

`docs/AGENT_LOG.md` tiene una nota sin cerrar del todo: Devin dice haber
commiteado `website/` en una rama `devin/website` para resolver un estado sin
commitear que quedó en la carpeta compartida. Al cerrar la sesión anterior,
`website/` seguía apareciendo como **sin trackear** en el `git status` de
`main` (revisado, no solo asumido). Antes de cualquier `git checkout`,
`clean` o `reset` en esta carpeta: correr `git status` y `git log
devin/website` para entender qué pasó realmente, y no asumir que la nota del
log ya cerró el tema. `website/` no es parte del alcance de esta fase de
ninguna manera — es una tarea aparte de Devin, y las decisiones sobre ella
son del usuario.

---

REGLAS DE TRABAJO (las de siempre)

1. Cerrá cada hito y mostrame el resultado antes de encadenar el siguiente.
   Antes de empezar uno, 3-4 líneas de qué vas a hacer.
2. No cambies una decisión de cualquier `DECISIONES.md` unilateralmente —
   avisá, mostrá evidencia, proponé la alternativa, esperá. Esto incluye no
   revisar `M-1` en silencio a partir de lo que encuentres en el repo real.
3. Al cerrar un hito: primero qué quedó funcionando en lenguaje llano,
   después la evidencia técnica (comandos reales, salidas reales, mutation
   testing).
4. Documentación del proyecto en español; código, comentarios, mensajes de
   commit y READMEs técnicos en inglés.
5. Seguí el protocolo de `CLAUDE.md` § "Coordinación con Devin" sin excepción:
   rama `cc/<feature>`, nunca directo a `main`; `git status`/`git log` antes
   de tocar nada; entrada en `AGENT_LOG.md` al cerrar la sesión.

Empezá confirmando que leíste lo de arriba, investigá el repo real del bazaar
lo necesario para responder el punto 1 de "Lo que se espera de esta sesión",
proponeme tu lectura de las diez preguntas y de `M-1`, y esperá mi
confirmación antes de diseñar o tocar código de T19.
