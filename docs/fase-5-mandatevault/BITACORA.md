# Bitácora — Fase 5 (MandateVault + cierre de piloto)

> Qué se hizo, qué falta, y qué significa cada cosa en lenguaje llano.
> Especificación de la fase: [ROADMAP.md §4.5](../../ROADMAP.md) ·
> Decisiones: [DECISIONES.md](DECISIONES.md) ·
> Salidas crudas de cada hito: [evidencia/](evidencia/)
>
> La numeración de hitos continúa la de las fases anteriores: T1–T8 Fase 1,
> T9–T15 Fase 2, T16–T23 Fase 3, T24–T26 Fase 4, esta empieza en T27.

---

## Estado actual

**Fecha:** 2026-09-04 · **Último hito cerrado:** T28 · **Fase 5: en curso**

Cada decisión de `PolicyRail.authorise()` — autorizada o rechazada — queda
en un registro durable y encadenado por hash, que sobrevive un reinicio del
proceso (T27). Cada pago real, además, queda vinculado criptográficamente a
la decisión que lo autorizó mediante un hash anclado contra `agent_registry`
— verificable por cualquiera, sin confiar en quien opera el vault (T28).
`apps/web` (el servidor público en Render) quedó cableado a ambos.

| | |
|---|---|
| Tests TypeScript | **628** rápidos (604 en T26 + 17 de T27 + 7 de T28) |
| Paquete nuevo | `@agentpay/vault` (T27) |
| Código de fases cerradas tocado | Ninguno — `policy-rail.ts` (Fase 3) y `payment/x402.ts` (Fase 4) sin cambios; todo lo nuevo se cableó desde `apps/web`/seams opcionales |
| Transacciones reales de la evidencia | pago T27: `8d8e72989e...` · pago T28: `47896c6db6...`, anclaje: `feda66884b...` |

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T27 | `@agentpay/vault`: bitácora durable, encadenada por hash, de cada decisión de `PolicyRail` | ✅ cerrado 2026-09-04 |
| T28 | Ancla `paymentLinkHash(record, paymentTx)` on-chain contra `agent_registry` tras cada pago real | ✅ cerrado 2026-09-04 |
| — | Superficie de consulta (CLI o vista en `apps/web`) | ⏳ pendiente, no elegido todavía |
| — | Indexar los eventos que `agent_registry` ya emite (`Anchored`/`Revoked`) | ⏳ pendiente, no elegido todavía |

---

## T27 · `@agentpay/vault` — bitácora durable de cada decisión — cerrado 2026-09-04

**Qué quedó funcionando, en palabras llanas.** Antes de este hito, si el
servidor de `apps/web` se reiniciaba, perdía toda memoria de cuánto se había
gastado ese día y de cualquier compra que hubiera sido rechazada — solo
quedaba lo que un pago real deja en Stellar, sin nada que diga *por qué* se
autorizó o *por qué* se rechazó una compra. Ahora cada decisión —se apruebe o
se rechace— queda guardada en un archivo que sobrevive un reinicio, y que
cualquiera puede revisar para confirmar que ninguna línea vieja fue editada
después de escrita.

**Antes de escribir código: dos huecos, no uno.** La investigación inicial
encontró que ni la decisión de `authorise()` (aprobada o rechazada) ni el
vínculo entre un pago real y el intent que lo autorizó eran verificables —
el primero porque todo vivía en memoria, el segundo porque nada en la
transacción de pago la referencia. Se planteó resolver ambos en este hito
(bitácora durable + memo on-chain); investigando el segundo apareció que
`@x402/stellar` construye la transacción de pago enteramente dentro del
paquete, sin exponer ningún parámetro de memo — un bloqueante real, no un
detalle. Se le mostró al usuario antes de seguir, junto con la alternativa
que sí es enteramente nuestra (una transacción companion que ancla un hash
contra `agent_registry`, T20 reusado), y quedó confirmada para T28. Detalle
completo en `DECISIONES.md` → `V-3`.

**Cómo quedó construido.** `@agentpay/vault`, paquete nuevo: un archivo JSON
Lines, *append-only*, donde cada línea es un registro con su propio hash y el
hash del registro anterior — editar cualquier línea vieja rompe todos los
hashes posteriores, y `verify()` lo confirma recorriendo la cadena entera.
Implementa las mismas tres firmas que `SpendLedger` (Fase 3) sin importar ese
tipo — TypeScript acepta el objeto donde se lo espera solo por tener la forma
correcta, el mismo patrón que `RegistryAccess` ya usó en T20. Un decorador
nuevo, `withVault`, envuelve cualquier `PolicyRail` para que un rechazo
también quede guardado — las concesiones ya llegaban solas, porque
`LocalPolicyRail.authorise()` (Fase 3, sin tocar) ya llamaba
`ledger.record(...)` al aprobar. `apps/agent` ganó un parámetro opcional
(`policyRail?`) para poder inyectar ese decorador sin cambiar una sola línea
del código cerrado de la Fase 3.

**Evidencia técnica.** 17 tests nuevos (621 en total, de 604): 15 en
`packages/vault/src/vault.test.ts` (acumulación exacta de montos, dedupe por
`intentId` en concesiones, sin dedupe en rechazos, reconstrucción del estado
tras "reiniciar" el proceso, detección de una línea editada), 2 en
`apps/agent/src/policy/with-vault.test.ts` (una concesión pasa sin tocar el
vault, un rechazo queda registrado con su código/razón/detalles).
`pnpm typecheck` y `pnpm build` (monorepo completo) limpios.

**Verificado en vivo, no solo con tests.** Se levantó `apps/web` localmente
y se corrió el flujo real: `POST /api/session/start` (credencial + Mandato
emitidos y anclados), `POST /api/session/buy` (pago x402 real, asentado en
testnet: `8d8e72989e14e8a28f5333946b946db617d9b035f75d1a9d4ac7d5176395c33c`),
`POST /api/session/revoke`. El archivo `data/mandate-vault.jsonl` apareció
con exactamente un registro `granted` para ese intent — confirma que la
deduplicación por `intentId` (`M-15`/`G-11`, una compra real llama
`authorise()` dos veces) sigue funcionando tal cual con el vault en el rol
del ledger.

**Por qué.** Es lo primero que la definición de "listo" de esta fase pide
(`ROADMAP.md §4.5`): que cada decisión del sistema quede como evidencia
consultable, no solo como texto de terminal que se pierde al cerrar la
sesión.

Documentación nueva: toda la carpeta `docs/fase-5-mandatevault/`
(`CONTEXTO.md`, `ARQUITECTURA.md`, este `BITACORA.md`, `DECISIONES.md` con
`V-1` a `V-7`, `evidencia/T27.md`). `CLAUDE.md` actualizado (nota de alcance,
tabla de documentación). Archivos nuevos: `packages/vault/` completo,
`apps/agent/src/policy/with-vault.ts` (+ test). Archivos tocados:
`apps/agent/src/agent.ts`, `apps/agent/src/tools/agent-tools.ts`,
`apps/agent/src/index.ts`, `apps/web/src/server.ts`, `packages/core/src/errors.ts`
(`VaultCorrupted` nuevo), `.gitignore` (`/data/`), `tsconfig.json` raíz.

Pendiente: mergear `cc/t27-mandate-vault` a `main` y pushear (a confirmar con
el usuario). Siguiente: T28 (anclar `vault.head()` on-chain, `V-3`), o
priorizar la superficie de consulta primero — ninguno elegido todavía.

**Cierre, mismo día.** El usuario confirmó mergear y pushear T27. Después
pidió seguir avanzando con los hitos sin pausar a preguntar en cada uno.

## T28 · Anclar el vínculo pago↔decisión contra `agent_registry` — cerrado 2026-09-04

**Qué quedó funcionando, en palabras llanas.** Antes de este hito, un pago
real en Stellar era indistinguible de cualquier otro pago de esa misma
cuenta — nada en la transacción decía "esto fue autorizado por este
Mandato, para esta compra". Ahora, después de cada pago real, queda una
segunda transacción, chica y separada, que ancla una prueba de esa relación
contra el mismo contrato que ya guarda el estado de las credenciales y los
mandatos. Cualquiera que tenga el registro del vault (T27) y el hash del
pago puede recalcular esa prueba y preguntarle al contrato si coincide —sin
tener que confiar en el operador del servidor para nada de eso.

**Las dos preguntas que T27 había dejado explícitamente sin resolver
(`V-3`)** se contestaron antes de escribir código: quién firma la
transacción de anclaje (la misma llave del principal/issuer que ya ancla
credencial y mandato — el agente nunca fue un issuer registrado, y
convertirlo en uno solo para esto habría sido otra decisión de confianza
aparte) y qué se ancla, con qué cadencia (no `vault.head()` a secas, sino
`sha256(record.hash + ":" + paymentTx)` — un valor que solo existe si la
decisión *y* el pago pasaron los dos — después de cada pago real, no en
lote). Detalle completo con las alternativas descartadas en `DECISIONES.md`
→ `V-3` (actualizada), `V-8`, `V-9`.

**Cómo quedó construido.** `apps/agent/src/vault/anchor-payment.ts`:
`paymentLinkHash` (pura), `anchorPaymentDecision` (llama
`registry.anchor()`, la misma llamada cruda de T20) y `verifyPaymentAnchor`
(recalcula el hash y pregunta `registry.status()` — la mitad de verificación
que cualquier tercero puede correr). `apps/web`'s `buy()` llama a esto
después de que el pago ya asentó — nunca antes, y un fallo del anclaje no
revierte ni oculta el pago (`V-9`): queda como su propio paso en la
respuesta, no como una excepción que rompe todo lo demás.

**Un detalle real, encontrado en el primer smoke test, no en los tests
unitarios.** El primer intento buscaba el registro del vault por la
dirección cruda del agente (`G...`); la búsqueda no encontraba nada, porque
el vault guarda `intent.agent`, que es un DID (`did:stellar:testnet:G...`),
no la dirección sola. `apps/web` ya tenía `stellarAddressToDid` importado
para otra cosa — se usó para la conversión, sin agregar ninguna dependencia
nueva.

**Evidencia técnica.** 7 tests nuevos (628 en total, de 621) en
`apps/agent/src/vault/anchor-payment.test.ts`: determinismo y unicidad de
`paymentLinkHash`, que `anchorPaymentDecision` llama al registro con los
parámetros correctos, que `verifyPaymentAnchor` recalcula el mismo hash y
devuelve lo que el registro responda (incluido `"Unknown"` para algo nunca
anclado). `pnpm typecheck`/`pnpm build` limpios.

**Verificado en testnet real, de punta a punta, dos veces.** Primero contra
el servidor local (`apps/web`): compra real asentada
(`47896c6db6f28d1e8020fb8f2a95e9b23d299a748ad3934d6d3f8a0dc8f6a6c3`), anclaje
real confirmado
(`feda66884b503dd0505f07a9d6be05b27dfd96c82200cf0b5996374430bdd446`), hash
anclado `ab4dfb10bb9d07b356ae9a1d4e4eabef8e8c608a8ec780b3f89cc2bfc394827b`.
Segundo, **de forma completamente independiente** — un script chico, sin
tocar el vault ni ningún código de este repo más que `AgentPass.status()` —
le preguntó al contrato por ese hash exacto y devolvió `"Active"`: la prueba
de que el anclaje es real y consultable por cualquiera, no solo algo que el
propio servidor afirma.

**Por qué.** Cierra el segundo de los dos huecos que la investigación
inicial de esta fase encontró (`CONTEXTO.md §2`) — el que T27 no pudo
cerrar por el bloqueante de `@x402/stellar`. Con esto, la frase de
`CONTEXTO.md §1` ("confiar en el operador no alcanza; tiene que poder
probarse") queda cierta para las dos mitades de una compra real: la decisión
(T27) y el pago (T28).

Documentación tocada: `CONTEXTO.md` (`§3b` nueva), `ARQUITECTURA.md` (`§7`
reescrita), este `BITACORA.md`, `DECISIONES.md` (`V-3` actualizada, `V-8` y
`V-9` nuevas), más `evidencia/T28.md`. Archivos nuevos:
`apps/agent/src/vault/anchor-payment.ts` (+ test). Archivos tocados:
`apps/agent/src/index.ts`, `apps/web/src/server.ts`.

Pendiente: mergear `cc/t28-anchor-payment` a `main` y pushear. Fase 5: T27 y
T28 cerrados. Siguiente, sin elegir todavía: la superficie de consulta (CLI
o vista en `apps/web` que muestre el vault y el estado de sus anclajes), o
indexar los eventos que `agent_registry` ya emite para credencial y mandato.
La ejecución de negocio del piloto sigue sin arrancar — no es trabajo de
código.
