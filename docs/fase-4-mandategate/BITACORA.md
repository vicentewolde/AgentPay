# Bitácora — Fase 4 (MandateGate)

> Qué se hizo, qué falta, y qué significa cada cosa en lenguaje llano.
> Especificación de la fase: [ROADMAP.md §4.4](../../ROADMAP.md) ·
> Decisiones: [DECISIONES.md](DECISIONES.md) ·
> Salidas crudas de cada hito: [evidencia/](evidencia/)
>
> La numeración de hitos continúa la de las fases anteriores: T1–T8 Fase 1,
> T9–T15 Fase 2, T16–T23 Fase 3, esta empieza en T24.

---

## Estado actual

**Fecha:** 2026-09-03 · **Último hito cerrado:** T25 · **Fase 4: T24 y T25 cerrados**

Un `PurchaseIntent` firmado se puede convertir en un pago real, y ahora
también desde un navegador: `apps/web` (`pnpm run web`) es una página simple
que emite credencial y Mandato, ejecuta un pago x402 real contra el bazaar, y
revoca el Mandato — todo clickeable, todo verificado con transacciones reales
en Stellar testnet.

| | |
|---|---|
| Tests TypeScript | **589** rápidos (sin cambios sobre T24 — `apps/web` es un servidor de demo, sin tests propios, mismo criterio que `scripts/`) |
| Dependencias nuevas | `@x402/stellar@^2.24.0`, `@x402/core@~2.24.0` (T24, `apps/agent`); ninguna nueva en T25 (`apps/web` no agrega paquetes de terceros) |
| Transacciones reales de la evidencia | pago T24: `fda497c5...`, ledger 4488970 · pago desde el navegador (T25): `53a4be61...`, ledger 4489237 · revocación (T25): `7d8de04a...` |

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T24 | Ejecutar un pago x402 real (sin frontend) | ✅ cerrado 2026-09-03 |
| T25 | Frontend simple (`apps/web`) | ✅ cerrado 2026-09-03 |

---

## T24 · Ejecutar un pago x402 real — cerrado 2026-09-03

**Qué quedó funcionando.** El agente ya no se detiene en un `PurchaseIntent`
firmado. `executeBazaarPayment` (`apps/agent/src/payment/x402.ts`) toma ese
intent, golpea el recurso pagado real del bazaar, recibe el reto `402` real
(no simulado), lo reconcilia contra lo que el intent dice —usando
`reconcileTerms`/`PolicyRail.authorise()`, construidos en la Fase 3 y nunca
antes ejercitados con un desafío real— y solo si el rail autoriza, firma y
envía la autorización de pago con `@x402/stellar`. El recibo final trae el
hash de la transacción real.

**Nunca firma antes de autorizar.** Es la propiedad de seguridad central de
este hito, y está probada directamente: un test cuenta las llamadas a
`fetch` y confirma que, cuando `PolicyRail` rechaza, solo hubo una — la del
reto inicial. Nunca se construyó ni se envió una autorización de pago para
algo que el rail no aprobó.

**Prerrequisito resuelto: la cuenta del agente ya puede pagar en USDC.**
`pnpm run fund:usdc` (nuevo) abrió el trustline de USDC en la cuenta del
agente con una transacción real en testnet
(`dddf08d3e1175fc4922187f4f8894712756ae0a3ec228df059c11c314627051c`); el
usuario fondeó el saldo a mano en el faucet de USDC testnet de Circle.

**Dos identidades del bazaar, confirmadas con matemática, no solo leídas.**
El reto `402` real nombra el activo por la dirección completa de su contrato
SAC (`CBIELTK6...`), no por el código `"USDC"` que trae el catálogo de
discovery (T15). Se verificó con `Asset.contractId()` del propio
`@stellar/stellar-sdk` que ese contrato es el wrapper determinístico exacto
del mismo emisor USDC clásico que el mock ya usa — la nota de `B-24`
("probablemente el mismo activo") queda confirmada, no solo sostenida.

**Un hallazgo que solo apareció leyendo el paquete real instalado, no el
spike anterior.** El reto `402` de v2 viaja en un header `PAYMENT-REQUIRED`
(base64) — el cuerpo JSON solo, sin ese header, no alcanza. Un test que solo
fabricaba el cuerpo falló hasta corregirlo. El spike de T22 había leído
`@x402/stellar` para otra pregunta (¿acepta un pagador `C...`?) y nunca había
mirado esta parte del paquete.

**Corrida completa contra testnet real y el bazaar real, a la primera vez
que se corrió con la cuenta ya fondeada:**

```
[4/5] Pago real contra el bazaar (x402)
  recurso   https://stellar-bazaar-x402.vercel.app/api/x402/swap-risk?pair=XLM%2FUSDC&amount=100&side=buy

[5/5] Recibo
  settled   true
  tx        fda497c5fd6b9b402ab2839b632730b8710b65dae7aa08c873a19b5ac6db93c2
  explorer  https://stellar.expert/explorer/testnet/tx/fda497c5fd6b9b402ab2839b632730b8710b65dae7aa08c873a19b5ac6db93c2
  payer     GAK6E5E7L63ZYFZZZFXDTYVG6MVAKILSHI5FITGH5U4ORACEZQ4GFP2K
```

Confirmado directamente contra Horizon (no solo confiando en la respuesta de
`@x402/stellar`): `successful: true`, ledger `4488970`, y el saldo de USDC de
la cuenta pasó de `20.0000000` a `19.9990000` — exactamente 0.001 USDC, el
precio del producto.

**Por qué.** Es la pieza que faltaba para que "el agente puede comprar en el
bazaar real" deje de ser una intención firmada y sea, de verdad, dinero
movido — el reclamo central de MandateGate.

Documentación tocada: `CLAUDE.md` (la nota de alcance de la Fase 4 y de "UI
web" pasa a reflejar que están en curso), `ROADMAP.md` §4.4, este
`BITACORA.md`, `DECISIONES.md` (`G-1` a `G-7`), más `evidencia/T24.md`.
Archivos nuevos: `apps/agent/src/payment/x402.ts` (+ test),
`scripts/fund-usdc-trustline.ts`, `scripts/demo-real-payment.ts`. Archivos
tocados: `apps/agent/src/catalog/bazaar.ts` (`mapAssetContract`,
`getBazaarServiceRoute`), `scripts/lib/network.ts` (`getTrustline`,
`openTrustline`).

Pendiente: mergear `cc/t24-x402-payment` a `main` y pushear (a confirmar con
el usuario). Siguiente: T25, el frontend simple (`apps/web`) que dispara este
mismo flujo desde un navegador.

## T25 · Frontend simple (`apps/web`) — cerrado 2026-09-03

**Qué quedó funcionando.** `pnpm run web` levanta un servidor Node chico
(`node:http`, sin framework nuevo) y una página HTML/CSS/JS sin build step,
con cuatro pasos clickeables: ver el catálogo real del bazaar, iniciar una
sesión (emite credencial + Mandato, ambos anclados en testnet), comprar de
verdad (el mismo `swap-risk-quote` que T24 probó — pago x402 real, no
simulado), y revocar el Mandato desde afuera. Todas las llaves quedan del
lado del servidor; el navegador solo ve JSON.

**Probado en un navegador real, de punta a punta, no solo leído.** Corrida
completa vía Claude Browser contra el servidor real: sesión iniciada
(credencial `609b25f4...`, mandato `00e2864d...`), compra real ejecutada
(intent `2fea12a9...`, tx `53a4be61...`, confirmada en Horizon: `successful:
true`, ledger 4489237), Mandato revocado (tx `7d8de04a...`, credencial
confirmada `Active` en vivo), reintento de compra rechazado con
`MandateRevoked` — la misma historia que `pnpm demo` narra por terminal,
ahora clickeable. Un producto sin pago real conectado ("Ledger Brief") dio un
mensaje claro (`NotImplemented`) en vez de fallar oscuro.

**Un bug real, encontrado probando el flujo, no leyendo el código.** El
primer intento usaba un `perDay` de Mandato ajustado (como hace `pnpm demo`)
para poder mostrar un rechazo en la segunda compra — pero la **primera**
compra se rechazó. La causa: una compra real llama `PolicyRail.authorise()`
dos veces (T19 estructural + T24 con los términos reales), y
`checkDailyLimit` no sabe que la segunda llamada es del mismo `intentId` que
la primera — la cuenta dos veces contra el límite, aunque el ledger solo
guarde una. Documentado en `DECISIONES.md` → `G-8`, con la consecuencia
práctica dicha en voz alta (el `perDay` efectivamente usable por el camino de
pago real es aproximadamente la mitad del nominal) y por qué no se corrigió
en este hito — es una decisión de diseño de la Fase 3 que merece su propia
conversación, no un parche apurado.

**Por qué.** Es la pieza que el usuario pidió explícitamente: "algo
funcional para mostrar a personas de Stellar" — no una demo de terminal, algo
que alguien pueda mirar en un navegador y ver dinero moverse de verdad.

Documentación tocada: este `BITACORA.md`, `DECISIONES.md` (`G-8`), más
`evidencia/T25.md`. Archivos nuevos: `apps/web/` completo (`package.json`,
`tsconfig.json`, `src/server.ts`, `public/index.html`), `.claude/launch.json`
(para poder previsualizar el servidor).

Pendiente: mergear `cc/t25-web-frontend` a `main` y pushear (a confirmar con
el usuario). **Fase 4: T24 y T25 cerrados.** Ningún hito nuevo decidido
todavía — candidatos anotados y no construidos: resolver `G-8` (el costo
doble contra `perDay`), la lista de `payTo` permitidos que falta en el
Mandato (`M-14`), y convertir el pago en una tool del agente (`G-4`).
