# Brief para Claude Code — F9, piloto externo público

> Documento de contexto para que Claude Code proponga la arquitectura y el
> plan de F9. No es un plan aprobado, no crea tickets y no autoriza cambios de
> código. Las decisiones de producto confirmadas están separadas de las
> preguntas que Claude debe resolver antes de implementar.
>
> Preparado: 2026-09-12. El repo debe permanecer en `main` hasta que Claude
> cree su propia rama y PR de propuesta.

## 1. Propósito de F9

F9 debe simular un uso real de AgentPey de punta a punta, con una persona
externa que recibe un enlace público y puede completar sola el recorrido en
Stellar testnet. No debe necesitar terminal, acceso al repositorio, secretos
de operador ni ayuda humana en tiempo real.

La experiencia buscada es B2B2C:

1. La persona entra a una plataforma de agentes pública.
2. Se registra, crea su perfil y contrata/configura un agente.
3. Revisa y firma un Mandato alojado por AgentPey con su wallet Stellar.
4. Le da una instrucción al agente.
5. El agente descubre un comercio público, consulta catálogo, solicita una
   factura x402 y paga solo si se cumplen las reglas firmadas.
6. El comercio entrega el servicio.
7. La persona puede ver en la plataforma la entrega, el recibo, la
   transacción, el Mandato, permisos, gasto y rechazos; además puede revocar.

F9 se considera listo solo cuando una persona ajena al desarrollo prueba el
camino feliz y los casos guiados de rechazo desde navegador, wallet testnet y
guía pública.

## 2. Nombres y servicios públicos confirmados

- **Plataforma de referencia:** RealOps Agent.
- **Comercio independiente de referencia:** SignalDesk.
- Ambos deben existir con URLs HTTPS públicas, distintas y compartibles. La
  persona debe poder comprobar que ambos existen sin depender de un script del
  agente ni de una URL local.
- Cada página debe explicar claramente que funciona sobre Stellar testnet y
  que el piloto no usa dinero ni activos con valor económico real.

RealOps Agent es la plataforma que construirá el proyecto mientras todavía no
hay un partner externo. SignalDesk es el comercio que construirá el proyecto
mientras todavía no hay un comercio externo integrado. La finalidad es probar
una integración parecida a una real y, después del piloto, poder mostrarla a
partners y comercios potenciales.

## 3. Recorrido que debe experimentar la persona

### 3.1 Registro y perfil en RealOps

- El visitante ingresa con el enlace público de RealOps.
- Crea un perfil escribiendo **email y alias**.
- El acceso se confirma mediante **enlace mágico enviado por email**. Esta
  decisión está autorizada por el usuario.
- RealOps ofrece al menos dos agentes, permite elegir uno y configurar sus
  permisos antes de abrir el consentimiento de AgentPey.

El email pertenece a RealOps. Claude debe definir la frontera de datos para
que AgentPey reciba solo la identidad/tenant que necesita y no convierta el
email en parte del Mandato, Stellar, vault o registros innecesarios. También
debe proponer aviso de privacidad de piloto, expiración de sesión y borrado
de cuenta/datos apropiados.

### 3.2 Agentes y permisos

RealOps debe ofrecer al menos:

1. **Market Brief Agent.** Recibe una instrucción como “compra el reporte
   XLM/USDC”. Busca en SignalDesk un informe de mercado de demostración y
   compra solo si comercio, activo, monto, límite diario y `payTo` coinciden
   con lo autorizado.
2. **AI Token Sandbox Agent.** Consulta y compra créditos digitales de IA
   ficticios, no transferibles y sin valor económico. Son créditos/entitlements
   de producto, no una emisión Stellar ni una oferta financiera.

La persona debe poder ajustar, revisar y entender permisos tales como
comercio permitido, producto/servicio, activo, máximo por compra, máximo por
día y estado activo. Claude debe definir cómo se traduce esa configuración a
un grant y qué se muestra antes de la firma.

### 3.3 Consentimiento y Mandato de AgentPey

- RealOps abre el flujo hospedado de AgentPey para consentimiento.
- La persona ve exactamente el grant: agente, comercios, límites, `payTo`,
  activo y demás permisos aplicables.
- Conecta su wallet Stellar de testnet (F9 inicialmente: Freighter en
  escritorio), revisa y firma el Mandato.
- Al volver a RealOps, ve el estado de su Mandato y permisos vigentes.
- Debe poder revocarlo mediante el flujo de AgentPey ya existente.

Conectar y firmar prueba control de la wallet; **no mueve fondos, no revela la
llave privada y no cobra por sí solo**. Claude debe preservar las reglas y
enforcement existentes: ningún flujo nuevo puede saltar scope, Mandato,
límites diarios, `policy_rail`, revocación o comprobaciones de identidad.

### 3.4 Instrucción, descubrimiento y compra

Una vez activo el Mandato, la persona escribe una instrucción en RealOps. El
agente debe:

1. Descubrir SignalDesk desde un catálogo x402 público y acotado; se busca
   que el descubrimiento sea parecido a uno real, no una llamada oculta a un
   comercio conocido.
2. Consultar catálogo/producto y solicitar la factura 402 estructurada.
3. Comparar intención, producto, comercio, activo, precio y `payTo` contra
   lo autorizado.
4. Pasar por las capas de autorización existentes.
5. Ejecutar el pago x402 y recibir la entrega solo si todas las capas pasan.

El catálogo público **no es una fuente de permiso**. Puede listar comercios
maliciosos, caer o cambiar datos. Claude debe proponer un diseño que lo use
para descubrir candidatos sin que habilite pagos: la autorización final debe
seguir atada a las reglas firmadas y al comercio/factura concretos.

Se investigó Periplo como posible catálogo público del ecosistema x402, pero
Claude debe validar su disponibilidad, encaje técnico y alternativa antes de
elegirlo. No se debe asumir que una búsqueda web libre o scraping HTML es una
base segura de decisión de pago.

### 3.5 SignalDesk y entrega visible

SignalDesk debe tener catálogo humano visible y una interfaz/protocolo para
agentes. Debe ofrecer, como mínimo:

- un informe XLM/USDC de demostración, basado en información permitida,
  sintética o licenciada;
- un paquete de créditos ficticios de IA, no transferibles y sin valor
  económico;
- precio, activo, `payTo`, información de pago x402 y método de entrega
  explícitos;
- respuesta 402 antes de entregar; validación del pago; recibo y referencia
  de liquidación/entrega.

No usar el nombre, contenido o apariencia de Bloomberg sin licencia. El
objetivo es simular la compra de un reporte financiero, no representar que se
vende contenido de Bloomberg.

Tras una compra exitosa, la persona debe ver la entrega de verdad. La fuente
canónica propuesta es una sección **Mis servicios** en RealOps, con artefacto
o acceso al servicio, recibo, identificador de entrega y enlace a la
transacción Stellar. Puede existir email de aviso, pero debe contener solo un
enlace seguro a la sesión/entrega, no adjuntar contenido sensible. Claude
debe definir el modelo de entrega, integridad del recibo y retención.

## 4. Fondos de testnet: decisión confirmada

La persona no debe tener que conseguir USDC testnet ni depositar fondos para
el primer recorrido.

En la primera compra autorizada del tenant con wallet:

- se crea perezosamente su `policy_rail` propio usando el flujo ya existente;
- una cuenta/reserva de USDC testnet manejada por el usuario, fondeada antes
  con suficiente saldo de prueba, aporta el USDC del piloto;
- Friendbot aporta el XLM testnet necesario para la cuenta/despliegue
  operativo según el flujo existente;
- el rail realiza el pago dentro de las reglas firmadas.

La interfaz debe llamarlo de forma clara **crédito patrocinado de prueba**,
mostrar saldo/estado que corresponda y no insinuar que es dinero real. Un
modo de fondeo explícito por el visitante es una decisión futura separada.

Claude debe diseñar los controles operativos, límite de crédito, agotamiento,
idempotencia, observabilidad y recuperación para esa reserva; el usuario no
autoriza que se relajen controles de fondos o autorización para simplificar el
piloto.

## 5. Qué significa agente determinista en este piloto

El primer agente no obtiene autoridad por “ser inteligente”. Su conducta debe
ser repetible y explicable:

- una instrucción reconocida se convierte en una solicitud estructurada;
- se usa catálogo/factura para encontrar una oferta;
- se aplican reglas y se paga únicamente si coincide todo;
- una misma entrada y mismo estado producen la misma decisión y trazabilidad.

Un LLM futuro puede ayudar a convertir lenguaje natural en una intención
estructurada o apoyar descubrimiento, pero no puede ampliar permisos, elegir
un `payTo` fuera de reglas ni ordenar un pago directamente. Claude debe
proponer los límites entre interpretación, búsqueda, decisión y ejecución.

## 6. Lo que el usuario debe poder consultar en RealOps

La plataforma debe exponer, limitado al tenant/sesión correcta:

- Mandato activo, estado y enlace/revisión de permisos;
- agentes contratados y permisos vigentes;
- compras exitosas;
- intentos rechazados y razón entendible;
- monto usado del día y, cuando corresponda, saldo del crédito/rail;
- recibos, entrega y enlace Stellar;
- revocación por el flujo existente.

El visitante no elige un `tenantId` arbitrario desde navegador. El dashboard
operacional interno existente no sustituye esta vista de usuario ni debe
publicarse como tal.

## 7. Casos de aceptación obligatorios

Claude debe proponer evidencia automatizada y una guía pública para que una
persona externa pueda recorrerlos. Como mínimo:

1. Compra exitosa de informe y entrega visible.
2. Compra exitosa de créditos ficticios de IA y entrega visible.
3. Comercio, activo o `payTo` no permitido.
4. Monto sobre máximo por transacción y segunda compra que supera el máximo
   diario.
5. Factura 402 con precio distinto a la intención/reglas.
6. Mandato vencido, revocado y credencial revocada.
7. Wallet firmante distinta del principal esperado.
8. Rail sin saldo; idempotencia que no produce doble pago ni doble entrega.
9. Catálogo caído o producto ausente sin intento de pago.
10. Regreso al perfil/RealOps después de firmar, con estado durable y sin
    perder identidad, Mandato ni trazabilidad.

Cada caso debe dejar un mensaje comprensible para la persona, código tipado
para integradores/operación y registro durable; cuando haya pago, también
recibo y enlace Stellar.

## 8. Estado relevante del proyecto antes de F9

F1 a F8 ya entregaron capacidades que F9 debe reutilizar, no reemplazar:

- API `/v1` para partners con autenticación, aislamiento, idempotencia,
  tenants, agentes, consent sessions y consulta de mandatos.
- Flujo hospedado de consentimiento donde el principal revisa grant, conecta
  Freighter y firma Mandato en Stellar testnet.
- Identidad/mandato/sesiones persistidos y flujos de wallet resistentes a
  reinicios; expiración de estados efímeros.
- `policy_rail` por tenant creado y fondeado en el primer pago con wallet;
  límites aplicados y controles de retiro/rotación existentes.
- Comercio x402 genérico con registro de venues y un comercio de referencia
  ya existente. SignalDesk debe ser un comercio nuevo, no una máscara del
  bazaar existente.
- Hardening de concurrencia de límite diario, retención, logging y panel
  interno de métricas/alertas.

Antes de diseñar, Claude debe leer el estado real de `main`, en particular
`docs/AGENT_LOG.md`, `docs/fase-6-agentguard-comercializacion/BITACORA.md`,
`docs/fase-6-agentguard-comercializacion/DECISIONES.md`,
`docs/fase-6-agentguard-comercializacion/PLATAFORMA-PARTNERS.md`, `CLAUDE.md`
y `AGENTS.md`. Este brief describe la intención del usuario; el código y la
documentación vigente son la fuente de capacidades realmente disponibles.

## 9. Límites y trabajos explícitamente fuera de F9

- Mainnet, fondos reales y cobro real.
- Publicar paquetes npm como objetivo del piloto.
- Delegar a un LLM autoridad de pago.
- Pedir terminal, secretos, API keys o depósitos al visitante.
- Mostrar datos de otro tenant o usar email como identificador en AgentPey.
- Convertir créditos ficticios en un token Stellar transferible.
- Decir que existe soporte móvil sin una prueba end-to-end real.

La compatibilidad inicial es Freighter en navegador de escritorio. Se deja
anotado para después investigar y probar una **segunda wallet compatible con
auth entries en móvil**. No se debe prometer soporte móvil antes de probarlo.

## 10. Lo que debe entregar Claude Code primero

Antes de implementar, Claude debe crear su propia propuesta de plan y abrir
un PR de documentación. Esa propuesta debe incluir, como mínimo:

1. Arquitectura de RealOps, SignalDesk y AgentPey; fronteras de confianza y
   datos, incluyendo PII y sesiones por email mágico.
2. Diagrama del recorrido y de los estados: registro, agente, grant,
   consentimiento, firma, ejecución, 402, pago, entrega, revocación y
   rechazos.
3. Modelo de entidades y propiedad de cada dato; contratos/API necesarios,
   sin inventar rutas públicas si puede reutilizarse la API existente.
4. Diseño de runner determinista, descubrimiento público acotado y validación
   de factura/producto antes de pago.
5. Diseño de SignalDesk: catálogo público, x402, recepción/verificación,
   entrega, recibos y evidencia de integridad.
6. Diseño de crédito patrocinado testnet y controles para reserva, saldo,
   idempotencia, fallos y operación.
7. Diseño de la interfaz pública de ambos servicios, guía externa y entrega
   visible al visitante.
8. Modelo de seguridad/amenazas: autenticación, aislamiento tenant, PII,
   redirecciones, callbacks, phishing, duplicados, manipulación de catálogo o
   factura, agotamiento de reserva y rutas de revocación.
9. División en hitos pequeños, orden, dependencias, responsables, archivos
   de riesgo y qué puede delegarse a Codex solo después de contratos
   congelados.
10. Estrategia de pruebas: unitarias, integración, testnet real, despliegue
    público y protocolo de prueba externa reproducible.
11. Criterio de salida, métricas cualitativas/cuantitativas del piloto,
    registro de incidencias y regla para decidir si F9 cerró.

La propuesta debe identificar con claridad toda decisión que aún requiera al
usuario en vez de asumirla. En particular, debe recomendar y justificar:

- proveedor y mecanismo concreto de email mágico;
- hosting/dominios, separando RealOps y SignalDesk;
- catálogo x402 público concreto y fallback si no está disponible;
- formato del contenido/entitlement y entrega segura;
- límites del crédito patrocinado y controles de la reserva;
- qué datos necesita cada servicio y por cuánto tiempo;
- definición exacta de las instrucciones deterministas admitidas en la
  primera versión.

## 11. Regla de coordinación

Claude Code es el responsable de la propuesta, arquitectura, PR y decisiones
sensibles de F9. Codex no debe iniciar código ni diseño alternativo de F9 por
su cuenta. Una vez que Claude congele contratos y divida el trabajo, podrá
delegar UI, documentación, fixtures o tests acotados.
