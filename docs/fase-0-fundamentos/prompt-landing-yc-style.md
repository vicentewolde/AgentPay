# Prompt — rediseñar la landing de AgentPay, nivel YC, para ganar el Instaward

> Generado el 2026-09-05. Pegalo como primer mensaje en un chat nuevo. Es un
> chat de código: vas a diseñar y publicar en vivo una landing page nueva.
> No hace falta que traigas contexto previo — este prompt es autocontenido.

---

CONTEXTO

AgentPay es un proyecto de pagos agénticos sobre Stellar testnet: un agente
de IA prueba criptográficamente quién lo opera y qué puede gastar, y ese
permiso se puede cortar desde afuera del agente. Todo el código, la
documentación de las cinco fases construidas, y la evidencia real en
testnet ya existen en este repo — leelos antes de diseñar nada.

**El objetivo de esta tarea es una sola página: una landing pública en
`apps/web/public/landing.html`**, servida en `https://agentpay-web.onrender.com/landing`
(el route ya existe, ver `apps/web/src/server.ts`, la línea de `serveStatic`
que mapea `/landing` → `/landing.html` — no hace falta tocarla salvo que
decidas cambiar la ruta). Ese link se le va a mandar por WhatsApp a un
referente de Stellar en Chile (Tellus) que va a decidir si me gestiona una
**Instaward de USD 5.000** del Stellar Community Fund. Es una conversación
en curso, ya avanzada — el objetivo de esta landing es específicamente
ayudar a ganarla, no una pieza de marketing genérica.

**Antes de diseñar nada, leé:**

1. `ROADMAP.md` — qué es el proyecto, las siete fases, en cuál estamos.
2. `docs/fase-5-mandatevault/BITACORA.md` — lo más reciente y lo más fuerte
   para mostrar: `policy_rail` (T31) pagando de verdad, con límites que
   aplica la propia red de Stellar dentro de la misma transacción.
3. `apps/web/public/landing.html` (el archivo actual) — ya existe una
   versión, en dos iteraciones previas. La primera era un landing oscuro
   estilo SaaS con badges y tarjetas — se descartó por sentirse genérica,
   "muy IA". La segunda es un documento claro, blanco, con tabla — se
   descartó por sentirse demasiado plana, sin punch de producto. **Esta
   tercera versión tiene que superar a las dos**: el nivel de pulido visual
   de una landing de YC (Linear, Vercel, Stripe, Ramp), no un documento ni
   un template genérico de IA.
4. `apps/web/public/index.html` — la demo interactiva real a la que esta
   landing debe llevar con un CTA. No la toques; sigue funcionando.

---

LO QUE YA SÉ, PARA QUE NO TENGAS QUE VOLVER A BUSCARLO

**Evidencia real, verificable, para usar en la página** (no inventes
números ni hashes — usá exactamente estos, o buscá otros más recientes en
`docs/fase-5-mandatevault/evidencia/`):

| Qué | Valor |
|---|---|
| Contrato `agent_registry` (identidad) | `CARC2SIQ3GTL34LVHSTGFRKDNNBYUXCSMGAUGKWGMT6Z2SDY6FXPP2DT` |
| Pago real vía `policy_rail` (smart account, límites on-chain) | `tx 22f31871dce757438fe306ac40c6395908cb7a08eb19b349d09fd29647324fc7` → `stellar.expert/explorer/testnet/tx/<hash>` |
| Pago real, factura x402 del bazaar del Embajador | `tx fda497c5fd6b9b402ab2839b632730b8710b65dae7aa08c873a19b5ac6db93c2` |
| Anclaje on-chain de una decisión de pago | `tx feda66884b503dd0505f07a9d6be05b27dfd96c82200cf0b5996374430bdd446` |
| Tests | 635 TypeScript + 21 Rust, 0 fallando |
| Commits públicos | 31+ (repo público desde 2026-09-02) |
| Repo | `github.com/vicentewolde/AgentPay` |
| Bazaar integrado | `stellar-bazaar-x402.vercel.app` — comercio real de un Embajador de Stellar, sin haber necesitado que él cambiara una línea de su código |

**Cinco fases construidas, todas cerradas:** identidad revocable (T1-T8) →
agente que lee catálogo real y firma intenciones de compra (T9-T15) →
límite de gasto y consentimiento firmado, aplicados en infraestructura, no
en el prompt (T16-T23) → pago real x402 en el bazaar (T24-T26) → evidencia
verificable anclada on-chain, más `policy_rail` pagando de verdad con
límites que la propia red aplica (T27-T31). Lo único que falta del piloto
es la ejecución de negocio (cohorte de alumnos, comunidad, demo grabada) —
**no digas que ya está corriendo con usuarios reales, todavía no arrancó.**

**Despliegue — cero fricción, ya resuelto:** el archivo que edités
(`apps/web/public/landing.html`) se sirve desde el mismo servicio gratuito
de Render que ya corre la demo (`render.yaml`, plan free, sin nueva cuenta,
sin nuevo dominio). Un `git push` a `main` dispara el redeploy automático —
tarda 1-3 minutos en construir.

---

QUÉ TENÉS QUE HACER

1. **Diseñar y escribir `apps/web/public/landing.html` desde cero**, en el
   estilo que se pide abajo, **en inglés por defecto y con un cambio a
   español** (ver la sección "Idioma"). Es HTML/CSS puro, sin build step —
   mismo patrón que ya usa `index.html` (fuente del sistema o una fuente de
   Google Fonts si suma, cero frameworks, cero JS de terceros; el único JS
   propio permitido es el inline del cambio de idioma).
2. **Verificarla en el navegador antes de darla por terminada** — mobile
   (375px, así se abre desde WhatsApp) y desktop, contra el servidor real
   (`pnpm run web`, la ruta `/landing`), no solo abriendo el archivo suelto.
   Revisá que no haya errores de servidor, y probá el cambio de idioma
   (inglés → español → inglés) en los dos tamaños.
3. **Publicarla de verdad**: commit en una rama `cc/<nombre>` (seguí el
   protocolo de `CLAUDE.md`, sección "Coordinación con Devin"), merge a
   `main`, y `git push origin main` para que Render la despliegue. Confirmá
   que quedó viva en `https://agentpay-web.onrender.com/landing` antes de
   cerrar la tarea — el free tier de Render tarda ~30-70s en "despertar" si
   estaba dormido, tenelo en cuenta al verificar.
4. Cerrá con un resumen corto, en español, de qué decisiones de diseño
   tomaste y por qué — no hace falta actualizar `BITACORA.md` de ninguna
   fase, esto no es un hito numerado del proyecto, es una pieza de
   comunicación.

---

DIRECCIÓN DE DISEÑO — "nivel YC", en concreto

No es un pedido vago de "que se vea bien". Esto es lo que separa una
landing de startup en serio de una landing genérica de IA:

- **Una sola afirmación de valor, enorme, en los primeros 3 segundos.** No
  tres oraciones — una idea, dicha una vez, con autoridad. El resto de la
  página existe para respaldarla, no para repetirla con otras palabras.
- **Tipografía como el 80% del diseño.** Un buen par de fuentes (una para
  títulos con personalidad, una para texto de lectura) hace más trabajo que
  cualquier color o ilustración. Mirá cómo Linear, Vercel o Ramp tratan el
  tamaño, el peso y el espaciado del texto antes de tocar el color.
- **Un solo color de acento, usado con disciplina.** No un arcoíris de
  badges de colores. El fondo puede ser oscuro o claro — elegí uno y
  ejecutalo con convicción, no ambos a medias.
- **Espacio en blanco generoso.** El instinto de "IA genérica" es llenar
  cada sección con tarjetas, iconos y texto. Una landing de YC real respira
  — menos elementos, cada uno con más peso.
- **La evidencia real es el héroe, no un detalle al final.** Esta landing
  tiene algo que el 95% de los proyectos de hackathon no tiene: hashes de
  transacciones reales, verificables ahora mismo. Esa es la ventaja
  competitiva real frente a otros que van a postular a la misma Instaward
  — dale el protagonismo visual que se merece, no la trates como letra
  chica.
- **Un CTA, claro, que no compite con nada más.** Llevar a la demo en vivo
  (`/`) tiene que ser la acción obvia, no una de cinco opciones.
- **Movimiento sutil, si lo usás — nunca decorativo.** Una transición de
  entrada suave o un hover discreto suma; una animación llamativa sin
  propósito resta.
- **Cero jerga sin explicar** ("prompt injection", "smart account",
  "on-chain") — este proyecto ya sabe explicar sus tres patrones (identidad,
  límite de gasto, revocación) en lenguaje llano; usá esas explicaciones,
  no las tecnifiques de nuevo.
- **Inglés por defecto, con cambio a español.** La página carga en inglés
  (ver la sección "Idioma" más abajo). El inglés tiene que sonar nativo y
  sobrio, no traducido: frases cortas, cero adverbios de relleno, cero
  mayúsculas de título en medio de una oración.
- **El español, cuando se muestra: español de Chile, sin voseo.** Nada de
  "vos", "podés", "querés" — "tú", "puedes", "quieres". Repasá el archivo
  entero con `grep -inE '\bvos\b|podés|querés|tenés|sos\b'` antes de darlo
  por terminado (la evidencia técnica, los hashes y los nombres propios no
  se traducen).

**Ejemplos de referencia de calidad** (no copiar el layout, sí el nivel de
pulido y la disciplina tipográfica/de color): linear.app, vercel.com,
ramp.com, stripe.com/es-cl. Todas resuelven "somos técnicamente serios y
esto es grande" sin un solo emoji ni una tarjeta con ícono redondo.

---

IDIOMA — inglés por defecto, español a un clic

El referente que va a abrir este link es chileno, pero la Instaward la
evalúa gente del Stellar Community Fund que trabaja en inglés, y el link se
va a reenviar. Por eso:

- **La página carga siempre en inglés.** Es el idioma por defecto, sin
  detección de navegador ni redirecciones: `<html lang="en">` al cargar.
- **Un control discreto para cambiar a español**, arriba a la derecha o al
  final del header — algo del tipo `EN / ES`, del tamaño de un pie de
  página, no un botón grande que compita con el CTA. El estado activo se
  distingue con peso o color, no con un recuadro.
- **El cambio es instantáneo, sin recargar y sin segunda página.** Un solo
  archivo `landing.html` con los dos idiomas dentro: cada texto traducible
  lleva su versión en ambos (por ejemplo `data-en` / `data-es`, o dos nodos
  hermanos y se muestra uno). Nada de `landing-es.html`, nada de query
  params, nada de router.
- **Se permite el mínimo JavaScript inline necesario** para el cambio y
  para recordar la elección en `localStorage` — sigue sin haber build step,
  frameworks ni JS de terceros. Al cambiar de idioma, actualizá también el
  atributo `lang` del `<html>`.
- **Si el JS no corre, la página tiene que verse completa en inglés.** El
  español es la mejora, el inglés es la base.
- **Las dos versiones tienen que estar completas y al mismo nivel.** Nada
  de traducir solo el hero y dejar el resto en inglés, ni de dejar frases
  sueltas sin traducir. Lo que no se traduce: hashes, direcciones de
  contrato, nombres de red y de producto, y los números de la tabla de
  evidencia.
- **Cuidá que el layout aguante los dos idiomas.** El español ocupa
  ~15-20% más caracteres: revisá que ningún título se rompa feo ni desborde
  a 375px al cambiar de idioma.

Verificá el cambio de idioma en el navegador, en mobile y desktop, como
parte del punto 2 de "Qué tenés que hacer".

---

RESTRICCIONES QUE NO SE NEGOCIAN

- No toques `apps/web/public/index.html` (la demo) ni `apps/web/src/server.ts`
  salvo que necesites ajustar el mapeo de la ruta `/landing`.
- No inventes métricas, transacciones o usuarios que no existan — la fuerza
  de este proyecto es que todo es verificable; una sola afirmación
  exagerada le resta credibilidad a todo el resto.
- No repitas el error de las dos versiones anteriores: ni el pastiche
  oscuro con badges, ni el documento plano de tabla. Este es un tercer
  intento — que se sienta como un producto real, no como un resumen ni
  como una plantilla.
- Cero costo nuevo, cero cuentas nuevas, cero dependencias externas más
  allá de una fuente de Google Fonts si hace falta. La única excepción de JS
  es el script inline propio del cambio de idioma — ninguna librería de
  i18n, ningún archivo `.js` aparte.
- No entregues la página solo en español ni solo en inglés: los dos idiomas,
  completos, en el mismo archivo, con inglés por defecto.
