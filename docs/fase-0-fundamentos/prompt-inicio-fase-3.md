# Prompt de arranque — Fase 3 (PolicyRail + Mandato)

> Generado el 2026-09-02 al cerrar la Fase 2, para pegar como primer mensaje
> en un chat nuevo de Claude Code dentro de esta misma carpeta (`AgentPay/`).

---

CONTEXTO

Este es AgentPay, un proyecto de pagos agénticos en siete fases sobre Stellar
testnet. Repo público: `github.com/vicentewolde/AgentPay`.

**Fase 1 (AgentPass — identidad verificable) cerrada.** Contrato desplegado en
`CARC2SIQ3GTL34LVHSTGFRKDNNBYUXCSMGAUGKWGMT6Z2SDY6FXPP2DT`. `did:stellar` +
VC-JWT (JWS compacto EdDSA), tres chequeos de verificación (firma → ventana →
registro), revocación real desde fuera del agente.

**Fase 2 (agente mínimo de compra) cerrada, T9–T14.** Un agente lee un
catálogo, verifica su propia credencial al arrancar (T11) y otra vez justo
antes de firmar (T13), aplica un chequeo de alcance estructural que ninguna
inyección de texto puede mover (T12), y produce un `PurchaseIntent` firmado
con su propia llave, trazable al hash de la credencial que lo autorizó (T13).
`pnpm demo` corre el ciclo completo contra testnet real —emitir, instrucción
en español, intent firmado, revocar, reintento rechazado— en ~12 segundos.
384 tests rápidos en el repo, 0 fallando. Solo **T15** (el bazaar real) sigue
abierto, bloqueado por el embajador — no por nada que este repo pueda
resolver solo.

Vas a construir la Fase 3: PolicyRail (el límite de gasto se hace cumplir en
infraestructura, no en el prompt) + Mandato (el consentimiento del principal
es una estructura firmada, no una casilla marcada).

Antes de escribir una sola línea, leé en este orden:

1. `ROADMAP.md` §4.3 — la especificación de esta fase, tal como está hoy: qué
   prueba, por qué PolicyRail y Mandato van juntas, y **por qué todavía no
   tiene desglose de tareas** (ver más abajo, es central).
2. `docs/fase-2-agente-compra/ARQUITECTURA.md` — mapa técnico de lo que la
   Fase 2 te deja, sin tener que leer el código. Leé completo el §7 (la forma
   exacta del `PurchaseIntent` — es lo que Mandato tiene que poder comparar) y
   el §8 (el bloqueante que esta fase comparte con T15).
3. `docs/fase-1-agentpass/ARQUITECTURA.md` §3–§5 — el patrón `did:stellar` +
   VC-JWT que Mandato debería reutilizar, no reinventar (ver más abajo).
4. `docs/DECISIONES.md` — decisiones de proyecto (prefijo `P-`). Solo hay una,
   `P-1`, monorepo único.
5. `CLAUDE.md`, en la raíz. Sus reglas de trabajo **no cambian** en esta
   fase, con una excepción explícita: el punto 5 todavía lista `PolicyRail,
   Mandato, MandateGate, MandateVault` como fuera de alcance — esa línea se
   escribió para la Fase 1 y hay que actualizarla ahora, a mano, antes de
   tocar código, para que diga lo que de verdad es alcance de esta fase
   (PolicyRail y Mandato entran; MandateGate y MandateVault siguen afuera,
   son de la Fase 4 y 5).

---

LO PRIMERO QUE TENÉS QUE HACER: ESTA FASE NO TIENE DESGLOSE DE TAREAS TODAVÍA

A diferencia del arranque de la Fase 2 —que ya tenía T9 a T15 numeradas y
descriptas en el brief original—, `ROADMAP.md §4.3` dice explícitamente que
Fase 3 **no tiene desglose de tareas todavía**, y por qué: su diseño depende
de la respuesta del embajador a una pregunta puntual (la 6 de las diez ya
enviadas): **¿el comprador puede ser una cuenta de contrato (`C...`), o solo
una cuenta clásica (`G...`)?** Esa respuesta decide si PolicyRail puede vivir
**on-chain**, como *smart account* que hace cumplir el límite en la misma
transacción de compra, o si tiene que vivir como **middleware off-chain** que
autoriza antes de que la transacción se firme — dos arquitecturas distintas,
no una variación de la misma. Diseñar el enforcement en detalle antes de esa
respuesta repetiría el error que la Fase 0 evitó a propósito: construir
contra un caso de uso imaginario.

**Lo que sí se puede decir ya, porque no depende de esa respuesta** (tomado de
`ROADMAP.md §4.3`, no lo repitas de memoria, léelo ahí):

- `scope.limits` ya viaja firmado en la credencial de la Fase 1, declarativo
  desde el día uno (`A-7`). PolicyRail no inventa ese campo, lo hace cumplir.
- Mandato hereda el patrón de credencial de la Fase 1 (VC-JWT + `did:stellar`)
  — es un documento distinto, no una criptografía distinta.
- Un `PurchaseIntent` de la Fase 2 no puede convertirse en compra real si
  excede lo que el Mandato autoriza, y esa comprobación no puede depender de
  que el agente "decida" respetarla.

**Antes de escribir código, proponeme un desglose de tareas para esta fase**
(numeración continua: empieza en T16, aunque T15 siga abierto y bloqueado —
no se renumera). Mi sugerencia de punto de partida, para que la propongas o
la corrijas, no para que la des por buena sin más: separar lo que **no**
depende de la pregunta 6 —la forma firmada del Mandato, y una función pura
`checkMandate(mandate, intent) → decisión` que compare un intent contra un
mandato, con la misma disciplina que `checkScope()` ya usa en la Fase 2 (fail-
closed, aritmética exacta, nunca le pasa texto de terceros a la decisión)— de
lo que **sí** depende —dónde vive el enforcement real, que es exactamente el
tipo de cosa que T15 dejó para después con un adaptador mock primero. Es el
mismo patrón que ya funcionó en T9–T15: construir contra lo verificable hoy,
dejar explícito y aislado lo que espera una respuesta externa. Decime si te
parece razonable, o si preferís esperar la respuesta del embajador antes de
tocar código.

---

EL BLOQUEANTE EXTERNO

Las diez preguntas al embajador (§4.2 de `ROADMAP.md`) siguen sin respuesta.
Ya bloquean T15 completo; ahora, con esta fase, la pregunta 6 específicamente
también bloquea el diseño detallado de PolicyRail. Vale la pena que decidas
con el usuario si conviene reenviar o hacer seguimiento de esas preguntas
antes de avanzar mucho más — cuantas más piezas dependan de esa respuesta, más
caro sale recibirla tarde.

---

REGLAS DE TRABAJO (las mismas de siempre, con la excepción del punto 5 de
`CLAUDE.md` que ya se explicó arriba)

1. Cerrá cada hito y mostrame el resultado antes de encadenar el siguiente.
   Antes de empezar uno, 3-4 líneas de qué vas a hacer.
2. No cambies una decisión de cualquier `DECISIONES.md` unilateralmente —
   avisá, mostrá evidencia, proponé la alternativa, esperá. Esto incluye no
   asumir en silencio una respuesta a la pregunta 6 del embajador.
3. Al cerrar un hito: primero qué quedó funcionando en lenguaje llano,
   después la evidencia técnica (comandos reales, salidas reales).
4. Documentación del proyecto en español; código, comentarios, mensajes de
   commit y READMEs técnicos en inglés.
5. Al cerrar el primer hito de esta fase, creá `docs/fase-3-policyrail-mandato/`
   (o el nombre de carpeta que te parezca mejor, mientras siga el patrón
   `fase-N-nombre`) con su propio `CONTEXTO.md`, `ARQUITECTURA.md`,
   `BITACORA.md` y `DECISIONES.md` (prefijo `M-`, para no chocar con `A-`/`I-`
   de la Fase 1, `B-` de la Fase 2, ni `P-` de proyecto), siguiendo
   exactamente el patrón de `docs/fase-2-agente-compra/`.
6. Errores tipados vía `AgentPassError` + `code` — nunca `throw new
   Error("...")` genérico, nunca `undefined` en un fallo. Códigos nuevos van a
   la misma unión de `packages/core/src/errors.ts`.
7. Todo dato que cruce un borde pasa por zod. Sin credenciales hardcodeadas.
8. Mandato, si reutiliza VC-JWT como se espera, probablemente conviene que
   viva en `@agentpass/core` o un paquete nuevo `@agentpay/mandate` — no lo
   decidas solo, proponelo con el motivo antes de crear la carpeta.
9. Seguí la disciplina de testing de las Fases 1 y 2: mutation testing
   deliberado en cada punto crítico, no solo cobertura de línea. En la Fase 2
   pasó varias veces que una mutación mal escrita —una que no cambiaba el
   comportamiento real— reveló un hueco de cobertura más valioso que una
   mutación bien escrita. Si una mutación no cae, no la descartes sin
   preguntarte por qué.

Empezá confirmando que leíste lo de arriba, actualizá la línea 5 de
`CLAUDE.md` (mostrame el diff antes de commitear nada), proponeme el
desglose de tareas de esta fase, y esperá mi confirmación antes de tocar
código.
