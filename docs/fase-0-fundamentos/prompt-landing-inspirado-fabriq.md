# Prompt para Claude Code — Landing v2, inspirada en patrones de Agentic Fabriq

> Este archivo es un brief de negocio/narrativa, escrito en el chat de estrategia.
> No define arquitectura ni decisiones técnicas — eso lo resuelve Claude Code al
> implementarlo. Pensado para pegarse entero como prompt inicial de una sesión.

## Contexto para Claude Code

Estamos ajustando `apps/web/public/landing.html` (y opcionalmente el material de
demo/video) tomando **patrones de presentación**, no producto ni código, de un
competidor conceptual (Agentic Fabriq, "Okta para agentes", YC-backed). La
lógica de negocio de por qué se adaptan estos tres cambios está resuelta — acá
solo se define QUÉ construir. Vos decidís CÓMO, con el mismo criterio de
"mínimo que demuestra la tesis" que ya aplicamos en el resto del proyecto
(ver `docs/DECISIONES.md`).

**No copiar:** texto literal, identidad visual, ni el nombre/marca de Agentic
Fabriq en ningún lado. Se adaptan patrones estructurales, no contenido.

**Regla dura que ya está en `ROADMAP.md` / `DECISIONES.md` y sigue aplicando:**
todo en testnet, nada de la palabra "producción", ningún dato que no se pueda
verificar en el repo o en Horizon/Stellar Expert en el momento de publicarse.

---

## Cambio 1 — Feed de actividad en vivo

**Qué mostrar:** un widget tipo "actividad reciente" en la landing (y opcional
en el video demo) que liste eventos reales del flujo de MandateVault a medida
que ocurren: algo como `credencial emitida` → `mandato firmado` →
`pago ejecutado (hash ...)` → `revocado` → `verificación falla tras revocar`,
cada uno con su timestamp relativo ("hace 2s", "hace 1m").

**Fuente de datos — importante:** no hardcodear una lista fija de eventos de
ejemplo. Si `MandateVault` ya expone o puede exponer los eventos reales
registrados en testnet (via `deployments/testnet.json` o el registro de
`@agentpay/vault`), usar esos datos reales, aunque sea un snapshot estático
tomado del historial real en vez de un feed live conectado a la red. Preferí
"real pero congelado" antes que "en vivo pero simulado" — si hay que elegir,
la honestidad del dato pesa más que el efecto de "tiempo real".

**Criterio de listo:** alguien que mire el widget y después vaya a Stellar
Expert puede encontrar exactamente esos eventos.

---

## Cambio 2 — Números como hero, no como pie de página

**Qué mostrar:** 3-4 bloques grandes y visualmente prominentes cerca del tope
de la landing (arriba del pliegue si es posible), con una cifra grande y una
etiqueta corta debajo. Ejemplos de qué métricas usar — **pero verificar el
número real contra el repo antes de escribirlo**, no asumir los valores de
conversaciones anteriores:

- Tests totales pasando (correr la suite y contar, no reusar un número viejo)
- Commits en la historia pública de git (`git log --oneline | wc -l`)
- Transacciones verificables en Horizon (contra `deployments/testnet.json` o
  el registro real)
- Fases completas de las 6 (o el conteo que corresponda al momento de correr esto)

**Importante:** estos números van a quedar desactualizados apenas se sigan
sumando commits/tests. Generá el bloque de forma que sea fácil de actualizar
(idealmente leyendo los valores de una fuente única, no copiados a mano en el
HTML), y dejá una nota en el commit o en `docs/fase-5-mandatevault/BITACORA.md`
de que estos números deben revisarse antes de cada reenvío a Tellus/SCF.

**Criterio de listo:** cada número en pantalla es verificable ahora mismo
contra el repo o contra Horizon, sin excepción.

---

## Cambio 3 — Sección "cada era de pagos necesitó su propia capa de confianza"

**Qué mostrar:** una sección corta, tipo línea de tiempo horizontal o vertical,
con 4 pasos:

1. Tarjetas físicas — firma manual
2. Pagos online — número de tarjeta + CVV
3. Wallets móviles — biometría del dueño
4. **Pagos agénticos — necesitan mandatos on-chain verificables** (acá va
   AgentPay/Mandato, marcado visualmente distinto a los tres anteriores, como
   "esto es lo que falta y lo que estamos construyendo")

**Tono:** afirmar que cada paso necesitó una nueva capa de confianza porque el
que paga ya no es una persona presente físicamente — no inventar estadísticas
de mercado que no tengamos, mantenerlo como argumento lógico, no cuantitativo.

**Criterio de listo:** la sección conecta directamente con el "¿Qué es?" que
ya existe en la landing — es una extensión de esa idea, no una sección aislada.

---

## Qué NO tocar en esta sesión

- No agregar la matriz visual de políticas (agente+usuario×recurso) — quedó
  fuera de alcance para esta ronda, es candidato para Fase 6.
- No agregar insignias de respaldo institucional (YC, inversores, "Backed by
  X") — no tenemos ninguna confirmada todavía. Si hay espacio de diseño para
  una en el futuro, dejarlo vacío o no incluirlo, no simularlo.
- No cambiar el nombre del proyecto en esta sesión — eso es una decisión de
  negocio pendiente y separada (ver `docs/DECISIONES.md`), no se resuelve acá.

## Al terminar

Registrar esta sesión como entrada nueva en `docs/fase-5-mandatevault/BITACORA.md`
(o donde corresponda según el estado actual de esa fase), y anotar en
`docs/DECISIONES.md` si alguna de las tres implementaciones implicó una decisión
de scope que valga la pena dejar registrada con su alternativa descartada.
