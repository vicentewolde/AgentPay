# Contexto — Fase 4 (MandateGate)

> Qué prueba esta fase, qué **no** es, y qué queda deliberadamente afuera.
> Especificación: [ROADMAP.md §4.4](../../ROADMAP.md) ·
> Mapa técnico: [ARQUITECTURA.md](ARQUITECTURA.md) ·
> Estado: [BITACORA.md](BITACORA.md) · Decisiones: [DECISIONES.md](DECISIONES.md)

---

## 1. La frase

> Toda la cadena de la Fase 3 —identidad, política, mandato— no vale nada si
> nunca se ejerce contra un checkout real. Esta fase es donde un
> `PurchaseIntent` firmado deja de ser una intención y se convierte en plata
> que efectivamente se mueve, en un comercio que este repo no controla.

## 2. Cómo arrancó, en la práctica

Las Fases 2 y 3 cerraron con T9–T23 completos. T15 (2026-09-03) le dio al
agente un catálogo **real** del bazaar del embajador — de solo lectura. Todo
lo que el agente producía contra ese catálogo real seguía siendo un
`PurchaseIntent` firmado, nunca un pago.

El usuario pidió explícitamente, en la misma sesión que cerró T15, ir más
allá: que el agente ejecute compras y pagos **reales** (en testnet) contra el
bazaar, con un frontend simple para mostrárselo a la comunidad de Stellar.
Eso es, literal y precisamente, MandateGate — adelantado respecto de lo que
`ROADMAP.md` tenía anotado ("sin diseñar", condicionado a "cómo resulte la
Fase 3"), porque la Fase 3 ya había resuelto la ambigüedad arquitectónica que
esa nota anticipaba (`M-11`, T19: el protocolo x402 reserva un paso de
autorización de política que es del comprador, sin cooperación del bazaar).

## 3. Qué prueba T24 — el primer hito

Que un `PurchaseIntent` firmado se puede convertir en un pago real: golpear
el reto `402` real de un endpoint pagado del bazaar, reconciliarlo contra lo
firmado (`reconcileTerms`/`PolicyRail.authorise()`, ya construidos en la Fase
3, nunca antes ejercitados con un desafío real), y solo entonces firmar y
enviar la autorización de pago con `@x402/stellar`. Verificado con una
transacción real, asentada en Stellar testnet, con el saldo de USDC de la
cuenta del agente efectivamente bajando lo que el producto costaba — no una
simulación, no una respuesta confiada a ciegas de una librería.

## 4. Qué NO es esta fase, todavía

- **No usa `policy_rail` (la cuenta de contrato de T22).** El pagador de T24
  es la cuenta clásica del agente. `policy_rail` sigue siendo el camino
  "duro" documentado en `M-21`/`M-22` — viable, medido, pero no elegido para
  esta demo. Ver `G-1`.
- **No convierte el pago en una quinta herramienta del agente.** Ejecutar un
  pago real vía instrucción en español (en vez de por script/servidor) mueve
  el pago detrás del mismo límite de autorización que hoy protege
  `create_purchase_intent` — una decisión de seguridad aparte, deliberadamente
  no tomada todavía. Ver `G-4`.
- **No resuelve el hueco de `payTo`.** `M-14` (Fase 3) ya documentó que nada
  firmado nombra qué cuenta puede cobrar. Sigue así — el reto real confirmó
  que `payTo` es una cuenta clásica del bazaar, pero nada la verifica contra
  el Mandato.
- **No es MandateVault** (Fase 5): el recibo del pago se imprime en la
  terminal, no queda como evidencia consultable en cadena más allá de la
  transacción Stellar misma.

## 5. Qué sí cambia respecto al alcance documentado

`CLAUDE.md` marcaba "cualquier UI web" y "MandateGate (Fase 4)" como fuera de
alcance mientras la Fase 3 estaba en curso. Con la Fase 3 cerrada y el visto
bueno explícito del usuario para avanzar sobre las dos, ambas notas se
actualizan al cerrar T24 — mismo patrón que `M-1` (Fase 3): una decisión de
alcance no se cambia en silencio, se documenta cuándo y por qué se superó.

## 6. Fuera de alcance, a propósito (todavía vigente)

MandateVault (Fase 5) · Stellar mainnet · rieles fiat o PSP · `policy_rail`
como pagador de producción · una lista de `payTo` permitidos en el Mandato ·
convertir el pago en una tool del agente.
