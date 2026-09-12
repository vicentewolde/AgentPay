# Plan F9 — piloto público RealOps Agent + SignalDesk

> Decisiones del usuario confirmadas el 2026-09-12. Define resultado,
> límites y evidencia de F9; no autoriza por sí solo cambios de custodia,
> llaves, firma, contratos o autorización.

## Resultado que debe existir

Una persona externa recibe un enlace HTTPS público de **RealOps Agent** y,
sin terminal ni acceso al repositorio, crea un perfil, contrata un agente,
firma un Mandato hospedado por AgentPey con una wallet Stellar de testnet,
le da una instrucción y recibe un servicio comprado de verdad a
**SignalDesk**, un comercio x402 independiente y público.

RealOps y SignalDesk no son pantallas sobre scripts locales:

- **RealOps Agent** tiene landing pública, registro por email y alias,
  catálogo de agentes, configuración de permisos, panel del usuario y URL
  HTTPS compartible.
- **SignalDesk** tiene landing pública, catálogo humano y para agentes,
  documentación de pago x402 y una URL HTTPS distinta.
- Ambas páginas dicen visiblemente que usan Stellar testnet y que los
  créditos/activos de piloto no tienen valor económico.

La URL final puede vivir bajo agentpey.com cuando exista Custom Domain; antes,
cada servicio usa su propia URL HTTPS estable de Render. Una URL local nunca
satisface F9.

## Actores y límites de confianza

| Actor | Responsabilidad | Nunca recibe |
|---|---|---|
| Visitante | Perfil, elección de agente, permisos, conexión de wallet, firma y revocación | API key, seed o llave del agente |
| RealOps backend | Relación email/alias/sesión ↔ tenant; llamada autenticada a /v1 | Llave privada de wallet |
| AgentPey | Consentimiento, documentos firmados, reglas y pago autorizado | Email como parte del Mandato o Stellar |
| Runner | Descubre catálogo, forma solicitud y usa el camino autorizado | Capacidad de saltar Mandato, scope o rail |
| SignalDesk | Publica catálogo, emite 402, verifica pago y entrega servicio | Datos privados de RealOps |

El email es PII de **RealOps**, no de AgentPey: no cruza /v1, Mandato,
Stellar, vault ni logs. RealOps usa enlace mágico, aviso de privacidad de
piloto, retención acotada y borrado de cuenta. El correo de entrega solo
avisa que un servicio está listo y enlaza a la sesión; nunca adjunta reporte
ni datos sensibles.

## Producto de referencia

### RealOps Agent

El perfil ofrece dos agentes, con permisos entendibles antes de abrir el
consentimiento hospedado:

1. **Market Brief Agent.** Encuentra y compra un XLM/USDC Market Brief de
   SignalDesk dentro de comercio, activo, monto, límite diario y payTo
   firmados.
2. **AI Token Sandbox Agent.** Consulta y compra AI Sandbox Credits:
   créditos digitales ficticios, no transferibles y sin valor económico. La
   entrega es una asignación y recibo dentro de SignalDesk, no una emisión de
   activo Stellar ni una oferta financiera.

La persona puede escribir, por ejemplo, “compra el reporte XLM/USDC”. La
primera versión del agente es determinista: transforma una instrucción
entendida en una solicitud estructurada y vuelve a validar todo antes de
pagar. Un LLM futuro solo puede ayudar a buscar o redactar; nunca modifica
permisos ni ejecuta pagos directamente.

### SignalDesk

SignalDesk vende dos servicios de bajo monto testnet:

- un informe de mercado de demostración con datos permitidos, sintéticos o de
  fuente licenciada; no usa nombre, contenidos ni apariencia de Bloomberg;
- un paquete de créditos ficticios de IA, con identificador de entrega y
  recibo verificable.

Cada producto publica precio, activo, payTo, esquema y forma de entrega. El
comercio responde 402 antes de entregar, valida el pago x402 y devuelve una
respuesta firmada o hasheable con deliveryId, recibo y referencia de
liquidación. RealOps conserva el artefacto en “Mis servicios” y notifica por
email con un enlace a esa vista. El hash del recibo queda ligado al registro
durable de la decisión.

## Descubrimiento real, pago acotado

El agente consulta un catálogo x402 público por Internet, idealmente Periplo,
y encuentra SignalDesk allí. Esto hace real el descubrimiento; nunca concede
permiso de gasto.

1. Descubrimiento público de candidatos.
2. Lectura de producto y factura 402 de SignalDesk.
3. Comparación de venue, asset, precio y payTo contra la intención.
4. Scope, Mandato, límite diario y policy_rail.
5. Pago y entrega solo si todas las capas coinciden.

Un catálogo público puede caerse, listar un comercio malicioso o cambiar un
precio. Por eso no es fuente de permiso. Búsqueda web libre y scraping HTML
quedan fuera: no entregan una factura estructurada ni una base segura para
decidir pagos.

## Wallet y fondeo de testnet

Conectar Freighter y firmar el Mandato prueba control de la wallet; no expone
la llave privada, no cobra y no fondea por sí solo. En la primera compra
permitida, el flujo vigente crea perezosamente el policy_rail propio:

- Friendbot aporta XLM testnet a la cuenta operativa necesaria para desplegar;
- una reserva de USDC testnet manejada y fondeada previamente por el usuario
  aporta crédito simbólico al rail;
- el rail, no el navegador, paga a SignalDesk dentro de límites firmados;
- la wallet del principal conserva retiro de saldo o rotación de la llave
  delegada, por el flujo existente.

La interfaz lo muestra como **crédito patrocinado de prueba**, con saldo y
aviso de que no es dinero real. F9 no exige USDC de faucet ni depósito del
visitante. Un modo posterior de fondeo explícito por el principal es una
decisión de fondos aparte.

## Pantallas y evidencia del visitante

RealOps restringe siempre la información al tenant de la sesión actual; el
navegador nunca elige un tenantId arbitrario.

1. Registro y acceso por enlace mágico.
2. Catálogo y contratación de agentes.
3. Configuración y revisión de permisos.
4. Estado del consentimiento y Mandato.
5. Instrucción y estado de ejecución.
6. **Mis servicios**: artefacto, recibo, deliveryId y enlace Stellar.
7. Actividad: compras, rechazos, consumo diario, saldo de rail y permisos.
8. Revocación mediante el flujo existente de AgentPey.

El status-dashboard actual sigue siendo panel interno. No se expone Postgres
ni se publica ese dashboard como sustituto de la vista del usuario.

## Orden de trabajo para Claude Code

| Etapa | Resultado | Dueño y riesgo |
|---|---|---|
| F9.0 | Arquitectura, PII, sesiones, fronteras RealOps/AgentPey/SignalDesk y amenazas | Claude |
| F9.1 | RealOps público: registro, perfil, dos agentes y grant | Claude define contrato; UI solo después |
| F9.2 | Consentimiento alojado y reanudación segura en RealOps | Claude: wallet, sesión y Mandato |
| F9.3 | SignalDesk: catálogo, 402, verificación, entrega y recibo | Claude define contrato x402 |
| F9.4 | Descubrimiento público y runner confiable | Claude: catálogo y ejecución |
| F9.5 | Lectura tenant-scoped de actividad y servicios | Claude define superficie; UI/tests delegables |
| F9.6 | Matriz completa y evidencia | Claude dirige pagos/revocación |
| F9.7 | Deploy público, guía y prueba externa | Claude coordina cierre |

No se asignan números nuevos todavía: F9.0 debe separar primero los bordes de
autorización en tickets pequeños. Codex solo puede recibir UI, presentación,
fixtures, documentación o tests aprobados; no runner, fondos, firmas,
contratos ni rutas de autorización.

## Matriz mínima de aceptación

Camino feliz y variantes se corren con perfiles/tenants aislados. Cada una
deja mensaje humano, código tipado, registro durable y, cuando aplica, enlace
Stellar y recibo.

- compra exitosa de informe y entrega en Mis servicios;
- compra exitosa de créditos ficticios de IA;
- comercio, asset o payTo no permitido;
- monto sobre perTx y segunda compra sobre perDay;
- factura 402 con precio distinto de la intención;
- Mandato vencido, revocado y credencial revocada;
- wallet firmante distinta del principal;
- rail sin saldo e idempotencia sin doble pago/registro;
- catálogo caído o producto ausente, sin intento de pago.

F9 queda listo cuando una persona externa, con navegador, Freighter de
escritorio testnet y guía pública, completa el camino feliz y variantes
guiadas sin terminal, secretos ni ayuda humana en tiempo real.

## Compatibilidad móvil, diferida explícitamente

F9 promete Freighter en navegador de escritorio. Queda anotado como trabajo
posterior evaluar y probar una segunda wallet que soporte firmas de auth
entries en móvil; no se declara compatibilidad móvil sin prueba end-to-end.

## Referencias investigadas

- [x402 on Stellar — documentación oficial](https://developers.stellar.org/docs/build/agentic-payments/x402)
- [stellar/x402-stellar](https://github.com/stellar/x402-stellar)
- [Periplo](https://github.com/Eras256/Periplo)
- [Stellar AI Agent Kit (SCF #37)](https://communityfund.stellar.org/project/stellar-ai-agent-kit-mr6)
- [REAPP, SCF #43](https://communityfund.stellar.org/awards/reciQ16Y1ztmnmE3N)
