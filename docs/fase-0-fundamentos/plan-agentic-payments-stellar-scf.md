# Plan de ejecución: AgentPass → PolicyRail → Mandato → MandateGate → MandateVault
### Roadmap hacia postulación SCF (Build Award / Instaward) — Stellar Testnet

**Fecha de inicio:** martes 1 de septiembre de 2026
**Fecha objetivo de postulación formal:** semana del 3 de noviembre de 2026 (10 semanas)
**Herramienta principal de construcción:** Claude Code
**Red:** Stellar Testnet en todas las fases; integración final con el bazaar de un embajador de Stellar (100% on-chain en Stellar)

---

## Resumen ejecutivo

Objetivo: construir y demostrar, con usuarios reales (60 alumnos + comunidad aliada), la pila completa de agentic payments (identidad → política → mandato → comercio real → evidencia) en 10 semanas, y postular a Stellar Community Fund (Build Award y/o Instaward vía el capítulo de un Embajador aliado) con datos de tracción reales, no proyectados.

**Criterio de éxito al final de la Fase 5:** al menos 1 transacción real de extremo a extremo en el bazaar del embajador, ejecutada por un agente con identidad verificable (AgentPass), autorizada por un mandato firmado, limitada por una política de gasto (PolicyRail), y registrada de forma verificable (MandateVault) — más al menos 15-20 alumnos y algunos usuarios de la comunidad aliada con credenciales activas.

**No-objetivos de esta fase (explícitamente fuera de alcance hasta Fase 6):**
- No se vende a clientes comerciales todavía.
- No se toca ningún riel de pago fiat (Transbank/Flow/CMF) — todo queda en rieles nativos de Stellar (testnet), lo que evita cualquier fricción regulatoria en esta etapa.
- No se construye un agente de compras "general" — solo el mínimo necesario para operar contra el catálogo del bazaar del embajador.
- AgentGuard queda fuera de alcance hasta Fase 6.

---

## Decisiones clave que fijan el resto del plan

1. **Build vs. partner del agente autónomo:** se construye internamente (con Claude Code), apuntando directo al catálogo/contratos del bazaar del embajador. Timebox de exploración de partner: hasta el **viernes 5 de septiembre**; si no hay un match evidente para esa fecha, se construye.
2. **Identidades del piloto:** credenciales de prueba por defecto para los 60 alumnos; vinculación a wallet/identidad real es opt-in explícito, no requisito.
3. **Participación del curso:** actividad opt-in con incentivo (bono), no obligatoria con nota — para evitar problemas de consentimiento y para que los datos de uso sean más representativos.
4. **Todo en testnet** hasta que exista una razón concreta para pasar a mainnet (probablemente recién en Fase 6 o al recibir un award).

---

## Fase 0 — Fundaciones (1–7 septiembre)

**Objetivo:** entrar al pipeline de SCF, resolver dependencias externas críticas, fijar arquitectura técnica.

**Tareas:**
- [ ] Enviar el **Interest Form de SCF** (communityfund.stellar.org) — no requiere producto terminado, revisión rolling.
- [ ] Conversación con el embajador: (a) confirmar el mecanismo exacto de integración de su bazaar (contratos Soroban, endpoints, formato del catálogo, cómo se liquidan hoy las compras on-chain); (b) preguntar en qué etapa va su postulación a Instaward y qué feedback ha recibido — esa información reduce incertidumbre para tu propia postulación y abre la puerta a coordinar una narrativa conjunta ("dos proyectos del mismo ecosistema local ya colaborando" es más fuerte que dos postulaciones aisladas).
- [ ] Setup técnico: cuenta Stellar testnet, Friendbot para fondeo, Horizon/Soroban RPC testnet, repo inicial con Claude Code.
- [ ] Decisión final build vs. partner del agente (deadline viernes 5).

**Entregables:**
- Interest Form enviado.
- Documento de 1 página: arquitectura técnica propuesta (qué corre on-chain vs. off-chain, qué estándar de credencial se usa).
- Repo scaffold inicial funcionando (cuenta testnet creada y verificada).

**Riesgo/dependencia:** el embajador no responde a tiempo → no bloquea Fase 0, pero si no hay respuesta para el 7/9, se avanza igual con supuestos razonables y se ajusta en Fase 3.

---

## Fase 1 — AgentPass + agente mínimo + piloto (8 septiembre – 5 octubre)

### Semana 2 (8–14 sept): Setup técnico de AgentPass
**Entregable:** AgentPass v0 — emisión y verificación de una credencial de prueba (1 agente, 1 verificación exitosa) en testnet.

### Semana 3 (15–21 sept): Agente mínimo + preparación del piloto
- Agente mínimo capaz de leer el catálogo del bazaar del embajador y generar una "intención de compra" (aún sin ejecutar pago real).
- Documento del ejercicio para los alumnos: instrucciones, consentimiento opt-in, guía de wallet testnet.
**Entregable:** Demo interna del agente leyendo el catálogo real del embajador; material del piloto listo para publicar.

### Semana 4 (22–28 sept): Lanzamiento del piloto con los 60 alumnos
- Actividad en clase, dashboard de métricas activo desde el día 1.
**Entregable:** Piloto lanzado. Meta: ≥25 alumnos con credencial AgentPass emitida en la primera semana.

### Semana 5 (29 sept – 5 oct): Cierre de ventana + análisis
- Cierre de la primera ventana de uso, análisis de patrones reales (qué compran, con qué frecuencia) para calibrar PolicyRail con datos, no supuestos.
**Entregable:** Reporte Fase 1 (alumnos activos, credenciales emitidas, intenciones de compra generadas) + esquema borrador del Mandato.

**Métrica de salida de Fase 1:** ≥30 credenciales AgentPass emitidas a usuarios reales, dashboard de uso funcionando.

---

## Fase 2 — PolicyRail + Mandato (6–19 octubre, en paralelo)

### Semana 6 (6–12 oct): Construcción
- PolicyRail: motor de límites de gasto que vive fuera del prompt del agente.
- Mandato v1: estructura firmada criptográficamente (qué se autoriza buscar / comprar / pagar), calibrada con los datos reales de la Fase 1.
**Entregable:** PolicyRail + Mandato integrados con AgentPass — loop completo funcionando en testnet con el agente mínimo (identidad → mandato → límite enforzado → intento de bloqueo exitoso ante una compra fuera de política, como prueba).

### Semana 7 (13–19 oct): Validación con usuarios reales
- Segunda ola de uso con un subconjunto de alumnos, ahora con políticas activas.
- Arranca en paralelo la construcción de MandateVault (ver Fase 4).
**Entregable:** Loop completo (identidad + mandato + política) validado con usuarios reales, no solo en pruebas internas.

**Métrica de salida de Fase 2:** al menos 1 caso documentado de una compra bloqueada correctamente por PolicyRail pese a estar "autorizada" por el agente — esta es la prueba de concepto central del patrón 3.

---

## Fase 3 — MandateGate en el bazaar del embajador (20 octubre – 2 noviembre)

### Semana 8 (20–26 oct): Integración real
- Integración del Mandato al checkout on-chain del bazaar del embajador (dado que es 100% Stellar, la integración es directa vía transacciones/contratos Soroban, sin capa de PSP intermedia).
**Entregable (hito crítico):** primera compra real de extremo a extremo en el bazaar del embajador, mediada por un agente con identidad + mandato + política, en testnet.

### Semana 9 (27 oct – 2 nov): Activación de comunidad aliada
- Campaña/evento con el organizador de la comunidad aliada para generar usuarios fuera del curso — esto es la señal de "uso más allá del piloto forzado" que fortalece la postulación.
**Entregable:** al menos 10-15 usuarios de la comunidad aliada con credencial activa y/o transacción realizada.

**Riesgo principal de esta fase:** depende de la disponibilidad del embajador. Mitigación ya incorporada desde Fase 2: el loop completo ya es demostrable solo con los alumnos aunque esta integración se retrase.

---

## Fase 4 — MandateVault (en paralelo, desde semana 7 hasta semana 9)

**Objetivo:** cada mandato, decisión de política y transacción queda registrada de forma verificable (anclaje de hashes en Stellar).
**Entregable:** MandateVault operativo, con el histórico completo del piloto (Fase 1 a 3) consultable y verificable — este es tu material de evidencia técnica ("real on-chain impact") para la postulación.

---

## Fase 5 — Postulación formal (3–9 noviembre)

**Tareas:**
- [ ] Consolidar métricas finales: # credenciales emitidas, # agentes activos, # transacciones bajo política, # mandatos firmados, integración viva con el bazaar del embajador, usuarios de la comunidad aliada.
- [ ] Redactar la propuesta SCF Build Award (track Open, por la novedad del patrón identidad+política+mandato, o Integration, por la integración con el bazaar del embajador — decidir según cuál round esté abierto en ese momento).
- [ ] Pedir al embajador y al organizador de la comunidad aliada que actúen como referentes formales.
- [ ] Explorar en paralelo la vía Instaward vía el capítulo de un Embajador aliado — camino más corto si su propia postulación ya abrió esa puerta.

**Entregable:** postulación enviada, con datos de tracción reales (no proyectados) y al menos dos referentes de la comunidad Stellar.

---

## Fase 6 — Siguientes pasos (desde 10 noviembre)

- AgentGuard: exploración técnica como siguiente capa.
- Con el caso de uso ya demostrado y (potencialmente) financiado, iniciar conversaciones comerciales para PolicyRail y StableBudget con clientes reales, usando este piloto como prueba social y técnica.

---

## Tabla resumen de hitos

| Semana | Fechas | Hito principal | Entregable clave |
|---|---|---|---|
| 1 | 1–7 sept | Interest Form + arquitectura | Interest Form enviado |
| 2 | 8–14 sept | AgentPass v0 | Credencial emitida/verificada en testnet |
| 3 | 15–21 sept | Agente mínimo | Demo leyendo catálogo real del embajador |
| 4 | 22–28 sept | Lanzamiento piloto | ≥25 alumnos con credencial |
| 5 | 29 sept–5 oct | Cierre + análisis | Reporte Fase 1 + esquema Mandato |
| 6 | 6–12 oct | PolicyRail + Mandato | Loop completo funcionando en testnet |
| 7 | 13–19 oct | Validación real | Caso documentado de bloqueo por política |
| 8 | 20–26 oct | **MandateGate en bazaar del embajador** | Primera compra real E2E |
| 9 | 27 oct–2 nov | Activación de la comunidad aliada | 10-15 usuarios comunidad activos |
| 10 | 3–9 nov | Postulación SCF | Propuesta enviada con referentes |
| 11+ | 10 nov + | Fase 6 | AgentGuard + primeras conversaciones comerciales |

---

## Notas sobre el proceso SCF (vigente a la fecha de este plan)

- SCF 7.0 (lanzado enero 2026) tiene tres tracks en el Build Award: **Open** (caso de uso novedoso on-chain, revisado por panel + voto comunitario), **Integration** (construir sobre herramientas existentes del ecosistema, solo panel) y **RFP** (respuesta a una necesidad específica publicada por SCF).
- El Interest Form se revisa de forma rolling; si calificas, te invitan a un round específico con fecha de entrega.
- Los Build Awards se pagan en tramos (10% / 20% / 30% / 40%), cada uno debe justificarse dentro de 90 días del pago anterior.
- El **Instaward** se otorga vía capítulos locales de Embajador — camino más corto para builders en etapa temprana, que es exactamente el caso de el embajador y el tuyo.
- El programa de referidos no es obligatorio pero pesa fuertemente en la evaluación — de ahí la importancia de que el embajador y el organizador de la comunidad aliada figuren como referentes.
