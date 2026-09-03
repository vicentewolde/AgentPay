# Decisiones — Fase 4 (MandateGate)

> Una entrada por decisión, con su motivo y la alternativa que se descartó.
> **No se borran entradas**: si una decisión se revierte, se marca como
> `Superada` y se agrega la nueva. Prefijo `G-` (de "Gate").

---

### G-1 · El pagador es la cuenta clásica del agente, no `policy_rail` · `Vigente`
**Fecha:** 2026-09-03 (T24)

`executeBazaarPayment` firma con la cuenta clásica (`G...`) del agente —
`AGENT_SECRET_KEY` directo, vía `createEd25519Signer` de `@x402/stellar` —
no con el contrato `policy_rail` que T22 construyó y midió.

**Motivo.** `policy_rail` fue un spike deliberado (`M-21`, Fase 3): probó que
un pagador `C...` es viable y que su `__check_auth` con `perTx`/`perDay`
cabe en el techo de fee del facilitator, con margen. No fue construido para
reemplazar a `LocalPolicyRail` — es una segunda implementación posible del
mismo puerto `PolicyRail`. Para el objetivo concreto de esta sesión (algo
funcional para mostrar a la comunidad de Stellar, pagos reales en testnet),
la cuenta clásica es la ruta más simple: no hay que desplegar ni financiar un
contrato por agente, y `LocalPolicyRail` (T19) ya hace exactamente el trabajo
de autorización que un `policy_rail` on-chain haría, solo que off-chain.

**Alternativa descartada:** desplegar `policy_rail` y usarlo como pagador
real. Se descartó por alcance, no por defecto técnico — sigue siendo el
camino "duro" documentado (`M-21`/`M-22`), disponible para cuando el proyecto
necesite enforcement on-chain de verdad (p. ej. si el agente corre en un
entorno donde `LocalPolicyRail` no puede confiarse).

### G-2 · La identidad sintética del venue y el USDC del bazaar quedan confirmadas, no solo asumidas · `Vigente`
**Fecha:** 2026-09-03 (T24)

`B-24` (T15, Fase 2) ya había resuelto la identidad del venue (contract id
sintético, no desplegado) y del USDC del bazaar (`BAZAAR_USDC`, emisor
contrato `CBIELTK6...`), pero describía la relación con el USDC clásico del
mock como "probablemente el mismo activo, dos direcciones". T24 lo confirma
con matemática: `Asset.contractId()` del propio `@stellar/stellar-sdk`
instalado, aplicado a `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
(el emisor de `USDC_TESTNET`), produce exactamente `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.

**Motivo.** El reto `402` real (T24) nombra el activo por su dirección de
contrato completa, no por código — a diferencia del `ServiceCard` de
discovery, que solo da `"USDC"`. Verificar que ambas direcciones son el mismo
activo subyacente (no solo "probablemente") importa porque confirma que
`mapAssetContract()` no está adivinando: hay una relación matemática
determinística entre el emisor clásico que el resto del proyecto ya usa y el
contrato que el bazaar realmente cobra.

**Alternativa descartada:** dejar la nota de `B-24` como estaba ("probablemente
el mismo activo") sin verificarla. Se descartó porque la disciplina del
proyecto (T19, T22, T15) es verificar contra la fuente real cuando la
pregunta importa para una decisión de mapeo de identidad — y esta lo es.

### G-3 · `routeTemplate`/`input` viven en `bazaar.ts`, no en `CatalogAdapter.Product` · `Vigente`
**Fecha:** 2026-09-03 (T24)

`getBazaarServiceRoute()` — necesaria para saber qué URL golpear y qué
parámetros rellenar antes de poder pagar — lee campos del `ServiceCard`
(`routeTemplate`, `input`) que `Product` (T9) nunca expuso.

**Motivo.** `Product` es deliberadamente venue-agnóstico (T9: "lo que corre
`list_products`/`get_product`, y la superficie exacta que cualquier adaptador
implementa"). Agregarle `routeTemplate` habría tocado una decisión cerrada de
la Fase 2 por una necesidad que es exclusivamente del bazaar y exclusivamente
de pagar, no de listar. `getBazaarServiceRoute()` hace su propia lectura del
discovery endpoint (reusando `fetchServiceCards`, la misma función interna
que ya alimenta `createBazaarCatalog`), y vive en el mismo archivo que ya es
dueño de esa lectura.

**Alternativa descartada:** ensanchar `Product`/`productSchema` con un campo
opcional `routeTemplate`. Se descartó porque un mock catalog o un futuro
adaptador de otro venue no tienen ningún `routeTemplate` que ofrecer, y un
campo opcional que solo un adaptador llena es una señal de que no pertenece
al tipo compartido.

### G-4 · Ejecutar un pago real es una función exportada, no una quinta `tool` del agente — todavía · `Vigente`
**Fecha:** 2026-09-03 (T24)

`executeBazaarPayment` es una función que un script o un servidor de
confianza llama directamente. No está en `TOOL_NAMES`, no es invocable vía
`agent.tools.invoke(...)`, y por lo tanto la instrucción en español que
`interpretPurchase` lee no puede, hoy, disparar un pago real.

**Motivo.** `B-6` (Fase 2) estableció que la lista de herramientas *es* el
límite de autorización, no un permiso que se deniega por separado — agregar
una quinta tool de pago real es extender ese límite a una superficie con
consecuencias financieras reales, y merece su propia decisión explícita, con
su propio análisis de qué inyección de prompt podría intentar disparar un
pago no deseado. Construirlo "de paso" dentro de T24, cuyo objetivo era
probar que el pago *funciona*, habría mezclado dos preguntas de riesgo muy
distinto.

**Alternativa descartada:** agregarla como quinta tool directamente en T24.
Se descartó porque el frontend (T25) puede llamar `executeBazaarPayment`
directamente desde su propio servidor —igual que `scripts/demo-real-payment.ts`
ya hace— sin necesitar que sea una tool del agente todavía. La decisión de
exponerla al lenguaje natural queda pendiente, explícita, para cuando haya
una razón concreta de producto que la pida.

### G-5 · Dos `PolicyRail`, un solo `SpendLedger` compartido · `Vigente`
**Fecha:** 2026-09-03 (T24)

`scripts/demo-real-payment.ts` construye su propio `SpendLedger`
(`createInMemorySpendLedger()`), lo pasa a `createAgent({..., ledger})` **y**
construye su propio `PolicyRail` (`createLocalPolicyRail({ ledger })`) con
la misma instancia, para pasárselo a `executeBazaarPayment`. Son dos objetos
`PolicyRail` distintos — el que vive dentro de `createAgentTools` y el que el
script arma — pero comparten el mismo ledger.

**Motivo.** `authorise()` se llama dos veces para el mismo `intentId`: una
dentro de `create_purchase_intent` (T19, sin `terms`), otra dentro de
`executeBazaarPayment` (T24, con los `terms` reales del reto `402`). `M-15`
ya documentó que `SpendLedger.record()` deduplica por `intentId` — pero solo
si ambas llamadas escriben al **mismo** ledger. Con dos ledgers separados, el
gasto se contaría dos veces, rompiendo la garantía que el diseño de T19
prometía. Compartir la instancia es lo mínimo necesario para que esa promesa
siga siendo cierta ahora que existe una segunda llamada real a `authorise()`.

**Alternativa descartada:** exponer el `PolicyRail` interno del agente a
través de `Agent` (el objeto que devuelve `createAgent()`), para que el
llamador reuse exactamente el mismo objeto en vez de construir uno paralelo
con el mismo ledger. Se descartó por alcance — cambia la superficie pública
de `Agent` (Fase 2/3) por una necesidad de T24, y el resultado práctico
(mismo ledger, dedupe funcionando) es idéntico sin tocarla. Queda anotado
como una limpieza posible si T25 necesita algo más elaborado.

### G-6 · `demo:pay-real` es un script separado, no un flag de `pnpm demo` · `Vigente`
**Fecha:** 2026-09-03 (T24)

`scripts/demo-real-payment.ts` es un archivo nuevo, no un `--pay-real`
agregado a `scripts/demo.ts`.

**Motivo.** `pnpm demo` (T14/T23) es la evidencia en video/terminal de las
Fases 2 y 3 — sus seis pasos están probados y no debían arriesgarse por una
séptima pieza con una superficie de fallo nueva (red externa, un facilitator
de terceros, firma real de dinero). Un script separado, con un único
objetivo (probar que el pago se ejecuta), aísla cualquier sorpresa del pago
real del resto de la narrativa ya probada.

**Alternativa descartada:** agregar el flag a `demo.ts`, renumerando sus seis
pasos a siete condicionalmente. Se descartó por el riesgo de regresión sobre
un script ya evidenciado, y porque el objetivo de T24 —probar el mecanismo de
pago, con la menor cantidad de piezas en juego— se sirve mejor con un
producto siempre igual (`swap-risk-quote`, sin interpretación de lenguaje
natural) que con la flexibilidad completa de `pnpm demo`.

### G-7 · El punto de entrada público de `@x402/*` se leyó del paquete instalado, no del spike de T22 · `Vigente`
**Fecha:** 2026-09-03 (T24)

Antes de escribir `payment/x402.ts`, se leyeron los `.d.mts` reales de
`@x402/stellar@2.24.0` y `@x402/core@2.24.0` instalados
(`node_modules/.pnpm/@x402+*/`) — `x402Client`, `x402HTTPClient`,
`ExactStellarScheme`, `createEd25519Signer`, y la forma exacta de
`PaymentRequirements`/`PaymentPayload`/`SettleResponse`.

**Motivo.** El spike de T22 (`T22-spike.md`) había leído estos mismos
paquetes, pero solo sus *internals* (`createPaymentPayload`,
`validateAuthEntries`) para responder si un pagador `C...` era viable — nunca
la superficie pública que un consumidor real (un cliente x402 comprando de
verdad) usa para orquestar el flujo completo (`x402HTTPClient`, con su
manejo de headers `PAYMENT-REQUIRED`/`PAYMENT-SIGNATURE` según versión de
protocolo). Asumir esa superficie desde lo que T22 ya había leído habría sido
exactamente el tipo de supuesto que T19/T22/T15 evitaron a propósito.

**Hallazgo directo de esta lectura:** el reto `402` real de v2 viaja en un
header `PAYMENT-REQUIRED` (base64), no solo en el cuerpo JSON —
`x402HTTPClient.getPaymentRequiredResponse()` solo cae al cuerpo para
`x402Version === 1`. Un test que solo fabricaba el cuerpo, sin el header,
falló hasta corregirlo — la propia disciplina de leer el paquete real
encontró el error antes de que llegara a producción.

**Alternativa descartada:** ninguna considerada — es la aplicación directa de
una disciplina ya establecida en el proyecto, no una decisión con dos
caminos.

### G-8 · Una compra real cuesta el doble contra `perDay`, y por ahora se documenta en vez de arreglarse · `Vigente`
**Fecha:** 2026-09-03 (T25)

Probando `apps/web` con un `perDay` de Mandato ajustado a solo el doble del
precio del producto (`"0.0015"` contra un producto de `0.001`), la **primera**
compra se rechazó — no la segunda, como la intuición (y el patrón de `pnpm
demo`) hacía esperar.

**Causa, confirmada leyendo `checkDailyLimit` y `PolicyRail.authorise()`:**
una compra real llama `authorise()` **dos veces** — una vez estructural
dentro de `create_purchase_intent` (T19, sin `terms`), otra con los términos
reales dentro de `executeBazaarPayment` (T24). `SpendLedger.record()`
deduplica por `intentId` (`M-15`), así que el **monto guardado** en el
ledger no se duplica — pero `checkDailyLimit(perDay, spentToday, amount)`
no sabe nada de `intentId`: en la segunda llamada, `spentToday` ya incluye
lo que la primera llamada acaba de registrar, y el chequeo vuelve a sumarle
`amount` encima. El resultado: una sola compra real consume `2 × su monto`
contra el límite diario en el momento de decidir, aunque el ledger termine
guardando solo `1 ×`. Con un `perDay` ajustado a exactamente `2 × monto`,
ese margen se agota en la primera compra, no en la segunda.

**Qué se hizo en este hito:** `apps/web` usa el mismo `perDay` que ya trae
`examples/scope-stellar-bazaar.json` (`5.00`, generoso) para el Mandato, en
vez de uno ajustado como hace `pnpm demo` — la misma elección que
`scripts/demo-real-payment.ts` (T24) ya había hecho, sin haber quedado
anotada como decisión en ese momento. Con eso, comprar es confiable en cada
clic; la demo de "el Mandato dice que no" queda a cargo exclusivo del botón
de revocación (`MandateRevoked`), que no depende de esta aritmética.

**Qué NO se hizo, a propósito.** No se tocó `checkDailyLimit` ni
`PolicyRail.authorise()` — son diseño cerrado de la Fase 3, y "arreglar" esto
implica una decisión real todavía no tomada: ¿`authorise()` debería saber
que una segunda llamada con el mismo `intentId` es una re-verificación, no
una compra nueva, y no debería sumar el monto dos veces al chequeo? ¿O es
correcto que cueste el doble, como un margen de seguridad implícito contra
un pago que se re-intenta? Ninguna de las dos respuestas es obvia, y
tomarla apurado dentro de un hito de frontend habría sido exactamente el
tipo de decisión que este proyecto prefiere parar y anotar en vez de
resolver de pasada.

**Consecuencia práctica, dicha en voz alta:** mientras `executeBazaarPayment`
exista y se use, el `perDay` efectivamente utilizable por el camino de pago
real es aproximadamente la mitad del `perDay` nominal del Mandato — un
`perDay` de `5.00` deja margen real para `~2.50` en compras por este camino,
no `5.00`. Para esta demo (compras de `0.001`) el margen sobra por completo;
para un uso real con montos más grandes, esto necesita resolverse antes de
confiar en el número nominal.

**Alternativa descartada:** ajustar el `perDay` del Mandato de `apps/web` a
un valor que sí alcance a mostrar un rechazo en la segunda compra (existe
matemáticamente — hay que fijarlo entre `2×monto` y `3×monto`, y el
rechazo cae dentro de `executeBazaarPayment`, no dentro de
`create_purchase_intent`). Se descartó por frágil: depende de un cálculo
exacto que un futuro cambio de precio del producto rompería en silencio, y
el punto donde efectivamente rechaza (la firma del pago, no la firma del
intent) no es el que `pnpm demo` ya narra — hubiera sido una historia
distinta contada como si fuera la misma.

### G-9 · `apps/web` se despliega en Render, sin control de acceso · `Vigente`
**Fecha:** 2026-09-03

El usuario pidió, después de cerrar T25, que el demo sea mostrable a otros —
no solo `localhost`. Dos decisiones explícitas, preguntadas y no asumidas:

**Plataforma: Render, no Vercel.** `apps/web` es un servidor `node:http`
con estado en memoria (una sesión de demo, un `Map` de sesión, colas de
`PolicyRail` por sujeto) — necesita un proceso que viva entre pedidos, no
funciones serverless aisladas que Vercel invocaría una por request sin
garantizar que caigan en la misma instancia. Render (y Railway, la otra
opción ofrecida) mantienen un proceso persistente; se eligió Render porque
el usuario la prefirió entre las dos.

**Sin contraseña ni ningún control de acceso, a propósito.** Cualquiera con
el link puede hacer clic en "Comprar" y disparar un pago x402 real (~0.001
USDC de testnet) sin autenticarse. Es la forma correcta de un demo público
de este proyecto en concreto — mostrar el flujo completo abierto es el
punto, y el costo real de cada clic es centavos de un activo de prueba.

**Lo que este repo prepara, y lo que no.** `render.yaml` (Blueprint) fija el
comando de build (`pnpm install --frozen-lockfile && pnpm build`) y el de
arranque (`pnpm --filter @agentpay/web run start`) — ambos verificados
localmente, corriendo exactamente esos comandos antes de escribir el
archivo, no asumidos desde la documentación de Render. Las cuatro variables
de entorno secretas (`ISSUER_SECRET_KEY`, `AGENT_SECRET_KEY`,
`AGENT_REGISTRY_CONTRACT_ID`) quedan marcadas `sync: false` — Render no las
pide durante el Blueprint, y **nunca las escribe ni las ve esta sesión de
Claude Code**: el usuario las copia de su propio `.env.local` al panel de
Render, a mano. Entrar credenciales en un formulario de terceros es una de
las acciones que este asistente tiene prohibido hacer por su cuenta.

**Consecuencia operativa, anotada:** una cuenta de demo pública y sin
traba eventualmente necesita que alguien la vuelva a fondear en USDC — no
hay auto-refill. Una compra que se queda sin saldo falla como un
`AgentPassError` visible en la UI, no como un crash silencioso.

**Alternativa descartada:** Vercel. Es la plataforma que el propio bazaar
usa, pero su modelo serverless no calza con el estado en memoria de
`apps/web` sin reescribirlo para guardar sesión en algo externo (una base de
datos, Redis) — trabajo real, no una opción de configuración, y fuera de lo
que "front simple" pedía.
