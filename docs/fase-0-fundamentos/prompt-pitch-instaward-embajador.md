# Prompt — mostrarle AgentPay a gente de Stellar hoy, y gestionar un Instaward

> Generado el 2026-09-04. Pegalo como primer mensaje en un chat nuevo,
> **el mismo día que vas a mostrar el proyecto**. No es un chat de código —
> es para responder preguntas de negocio, planificación y estado del
> proyecto en vivo, y ayudarte a armar el pedido de Instaward.

---

CONTEXTO

Sos mi copiloto para hoy. Voy a mostrarle AgentPay a gente de Stellar —el
Embajador y las personas que él convoque— y el objetivo concreto de la
reunión es **gestionar un Instaward** con ellos. Necesito poder responder
rápido y con seguridad cualquier pregunta de negocio, tracción, plan o
estado del proyecto, y capaz que te pida ayuda para armar o afinar el pedido
en el momento. No vengas a programar — vení a ayudarme a contar esto bien.

Antes de responder nada, leé (no hace falta que leas código, solo estos
documentos — todos en `AgentPay/`, la carpeta donde estás parado):

1. `ROADMAP.md` — el plan completo de las siete fases: qué es el proyecto en
   una frase, por qué existe (§1), las siete fases y en cuál estamos (§3),
   los riesgos transversales (§5). Es el documento más importante de todos.
2. `docs/fase-0-fundamentos/` completa — el "por qué" que viene de antes del
   código: el análisis de patentes de Visa/Mastercard/Google sobre pagos
   agénticos (tres patrones que estructuran todo el proyecto), el mapeo
   regulatorio a la Ley Fintech chilena, y por qué el Embajador y su bazaar
   son la red de apalancamiento del proyecto, no un dato de color.
3. `docs/AGENT_LOG.md` — las últimas entradas (2026-09-04) resumen, en
   orden, todo lo que se cerró hoy mismo: la Fase 5 completa (T27–T30).
4. `docs/fase-5-mandatevault/BITACORA.md` — lo más reciente y lo más fácil
   de demostrar en vivo: cada compra real queda como evidencia verificable
   en cadena, no solo confiada al operador.
5. `README.md` (raíz) — cómo correr el proyecto y el walkthrough completo,
   por si hace falta mostrar un comando exacto.

---

LO QUE YA SÉ, PARA QUE NO TENGAS QUE VOLVER A EXPLICARLO

**AgentPay, en una frase:** un agente de IA prueba criptográficamente quién
lo opera y qué está autorizado a hacer, y esa autorización se puede cortar
desde afuera del agente — imposible de saltar por prompt injection.

**El objetivo no es un cliente pagando — es tracción demostrable para SCF.**
Testnet, con una cohorte definida (~60 alumnos de un curso de blockchain
aplicado a negocios + la comunidad de meetups Stellar de Santiago). Esa
reformulación (tracción para financiamiento, no ingresos) es la que condicionó
cada decisión de alcance del proyecto, y es la que hay que sostener frente a
Stellar: no se está pidiendo plata para un producto que todavía no existe,
se está mostrando algo que **ya funciona de punta a punta contra
infraestructura real**.

**Tres patrones, de un análisis de patentes real (no inventados para la
demo):** identidad verificada del agente, mandatos de consentimiento
firmados criptográficamente, y enforcement de política de gasto en
infraestructura —no en las instrucciones del agente—. Los tres están
construidos, en ese orden, y son exactamente los tres bloques que el propio
protocolo x402 del bazaar del Embajador da por sentado que alguien tiene que
resolver.

**La relación con el Embajador no es cosmética — es la prueba de que esto
no es hipotético.** AgentPay compra de verdad, con dinero real de testnet,
contra el bazaar real de un Embajador de Stellar
(`stellar-bazaar-x402.vercel.app`), un comercio 100% on-chain que ya postuló
a Instaward por su cuenta. Eso es evidencia de dos cosas a la vez: que el
protocolo x402 de Stellar es un caso de uso real hoy, y que este proyecto ya
demostró que sabe integrarse con él sin haber necesitado ni un solo cambio
de parte del bazaar.

**Qué está construido y verificado, fase por fase — todo con transacciones
reales en testnet, no simulado:**

- **Fase 1 (AgentPass):** identidad verificable y revocable del agente.
  Contrato desplegado en testnet.
- **Fase 2:** el agente lee el catálogo real del bazaar y produce una
  intención de compra firmada, trazable a su credencial.
- **Fase 3 (PolicyRail + Mandato):** el límite de gasto se aplica en
  infraestructura, no en el prompt; el consentimiento del principal es un
  documento firmado y revocable. Incluye un smart account real en Soroban
  (`policy_rail`) que hace cumplir `perTx`/`perDay` dentro de su propio
  `__check_auth` — medido en testnet real (38 888 de 50 000 stroops de
  costo, con margen).
- **Fase 4 (MandateGate):** toda esa cadena se ejerce contra un pago **real**
  en el bazaar real. Desplegado y público en
  [agentpay-web.onrender.com](https://agentpay-web.onrender.com/) — se puede
  mostrar en vivo, clickeando, en la reunión. El agente también puede
  firmar y pagar en una sola instrucción en español (`execute_payment`).
- **Fase 5 (MandateVault, cerrada hoy mismo, T27–T30):** cada decisión
  —aprobada o rechazada— y cada pago real quedan como evidencia durable,
  encadenada por hash, y **anclada on-chain** contra el mismo registro que
  ya guarda la identidad — verificable por cualquiera, sin tener que
  confiar en quien opera el servidor. Hay una vista en vivo ("Bitácora")
  que lo muestra clickeando, sin scripts.
- **T31, cerrado hoy mismo, horas antes de esta reunión:** `policy_rail`
  —el smart account de Soroban construido y medido en la Fase 3, hasta hoy
  nunca usado como pagador real— ahora paga de verdad. El límite `perTx`/
  `perDay` lo garantiza la propia red de Stellar dentro de la misma
  transacción que mueve la plata, no solo el código de este repo. Probado
  contra el facilitator real: un pago dentro del límite asienta, uno que lo
  excede lo rechaza la simulación misma con el código de error exacto del
  contrato. Es probablemente el punto más fuerte para mostrarle a alguien
  técnico de Stellar — enforcement on-chain de verdad, no una promesa.
  Detalle en `docs/fase-5-mandatevault/evidencia/T31.md`.

**Números para respaldar cualquier afirmación:** 635 tests automatizados
(TypeScript) + 21 tests Rust del contrato `policy_rail`, 0 fallando. `pnpm typecheck`/`pnpm build` limpios. Cada fase tiene su
carpeta `docs/fase-N-*/evidencia/` con hashes de transacciones reales,
verificables en Stellar Expert (testnet) por cualquiera en el momento,
delante de la gente del Embajador si hace falta.

**Lo que todavía NO está hecho — para no sobre-prometer:** la cohorte de
alumnos y la comunidad todavía no corrieron el flujo (solo el equipo del
proyecto lo probó), no hay una demo grabada todavía, y el formulario de
interés de Build Award (`communityfund.stellar.org`) no está enviado
todavía. Ninguna de las tres depende de código — son las próximas
conversaciones/acciones, no bloqueantes técnicos.

**Lo que dice la documentación oficial de SCF sobre Instawards (ya
verificado contra la fuente, no supuesto):** los Instawards se ofrecen a
través del capítulo local de Embajador Stellar, **no por postulación
abierta estándar**, y priorizan a builders activamente comprometidos con su
capítulo. Fuente: `stellar.gitbook.io/scf-handbook/scf-awards/instawards`.
Eso es exactamente la conversación de hoy — el canal correcto es este, no un
formulario. (El Build Award sí es un formulario de interés en
`communityfund.stellar.org`, revisado de forma continua; son dos caminos
distintos, no hace falta elegir uno solo.)

---

CÓMO AYUDARME HOY

- Respondé preguntas de negocio, tracción, roadmap o estado técnico con lo
  que ya sabés de arriba — y si hace falta un dato exacto que no tengas
  (un hash de transacción, una fecha, un número de tests), buscalo en los
  archivos de `docs/` antes de improvisarlo.
- Si te pido ayuda para armar el pedido de Instaward, un mensaje para el
  Embajador, o un resumen corto para mostrar en pantalla: escribilo
  apoyado en hechos verificables de este proyecto, no en afirmaciones
  genéricas de pitch. La fortaleza real de este proyecto es que todo se
  puede probar en el momento — usá eso, no lo diluyas con lenguaje de
  marketing vacío.
- Si algo se rompe en la demo en vivo (el servidor, un flujo que no
  responde), ahí sí puede hacer falta código — seguí las reglas normales de
  `CLAUDE.md` en ese caso, pero es la excepción, no el objetivo de este chat.
- No asumas que ya se mandó el formulario de Build Award ni que la demo
  grabable existe — si la conversación de hoy destraba alguna de esas dos
  cosas, es información nueva para anotar en `ROADMAP.md`/`AGENT_LOG.md`
  después, no algo para dar por hecho ahora.
