# Prompt de arranque — Fase 0/1: AgentPass sobre Stellar Testnet

Pega este mensaje completo en un chat nuevo (dentro de este mismo proyecto) para que Claude te ayude a producir el plan técnico ejecutable, y de ahí pásalo a Claude Code.

---

Actúa como un ingeniero senior full-stack con experiencia en Stellar/Soroban y en diseño de sistemas de identidad verificable (DIDs / Verifiable Credentials). Vas a ayudarme a preparar el kickoff técnico de un proyecto que voy a construir con Claude Code.

## Contexto del proyecto

Estoy construyendo una pila de "agentic payments" sobre Stellar testnet, aplicando tres patrones inspirados en patentes/protocolos de Visa, Mastercard y Google:

1. **Identidad del agente**: credenciales verificables que vinculan un agente de IA a una persona/empresa real y a un alcance definido.
2. **Mandatos de consentimiento firmados**: autorización estructurada en capas (qué se autoriza buscar, comprar, pagar), firmada criptográficamente.
3. **Enforcement de política de gasto en infraestructura**: límites que viven fuera del prompt del agente, imposibles de saltar por prompt injection.

El objetivo de las próximas semanas NO es vender a un cliente — es demostrar uso real (con 60 alumnos de un curso que enseño + una comunidad de meetups Stellar en Santiago) para postular a Stellar Community Fund (Build Award e Instaward vía un capítulo local de Embajador).

## Orden de construcción (ya decidido, no lo cuestiones, ayúdame a ejecutarlo)

1. **AgentPass** — emisión y verificación de credenciales de agente (primero).
2. **Agente mínimo de compra** — function-calling contra el catálogo/contratos de un bazaar de e-commerce ya construido por un tercero (el embajador), que es **100% on-chain en Stellar**.
3. **PolicyRail** — motor de límites de gasto en infraestructura.
4. **Mandato** — esquema de autorización firmado (en paralelo a PolicyRail).
5. **MandateGate** — integración del mandato en el checkout real del bazaar del embajador.
6. **MandateVault** — registro/evidencia verificable de cada mandato + decisión + transacción.

## Restricciones técnicas

- Todo en **Stellar Testnet**. Nada de mainnet, nada de rieles fiat (sin Transbank/Flow/PSP — es intencional, para no tocar regulación financiera en esta fase).
- El agente de compra debe ser **mínimo**: no un shopping agent genérico, solo lo necesario para operar contra el catálogo de un bazaar específico.
- Prioriza velocidad de iteración sobre arquitectura perfecta — esto es un piloto de 10 semanas, no un producto de producción.
- Usaré **Claude Code** para toda la implementación.

## Lo que necesito que produzcas en esta conversación

1. **Arquitectura técnica concreta** para AgentPass + el agente mínimo: qué estándar de credencial usar (W3C VC sobre Stellar, o alternativa más simple si el estándar completo es sobreingeniería para un piloto de 10 semanas), qué SDK de Stellar/Soroban usar, cómo se estructura el repo.
2. **Una lista de tareas secuenciadas y acotadas**, cada una con criterio de aceptación claro, cubriendo específicamente:
   - Semana 2: setup técnico + AgentPass v0 (emitir y verificar una credencial de prueba en testnet).
   - Semana 3: agente mínimo leyendo el catálogo del bazaar del embajador y generando una intención de compra (sin ejecutar pago todavía).
3. **El texto final listo para pegar como primer mensaje en Claude Code**, en formato de instrucción de proyecto (contexto + tarea inmediata + criterios de aceptación), para que Claude Code pueda arrancar a codear sin necesitar más contexto mío.

No necesito que construyas PolicyRail, Mandato, MandateGate ni MandateVault todavía — eso es de fases posteriores. Enfócate solo en dejar lista la ejecución de AgentPass + el agente mínimo.

Si necesitas información que no tengo (por ejemplo, si el bazaar del embajador expone una API o solo contratos Soroban directos), dime exactamente qué pregunta debo hacerle al embajador antes de poder avanzar.
