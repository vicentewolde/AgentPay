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

**Fecha:** 2026-09-04 · **Último hito cerrado:** T27 · **Fase 5: en curso**

Cada decisión de `PolicyRail.authorise()` — autorizada o rechazada — queda
ahora en un registro durable y encadenado por hash, que sobrevive un
reinicio del proceso. `apps/web` (el servidor público en Render) quedó
cableado a este vault en vez del `SpendLedger` en memoria.

| | |
|---|---|
| Tests TypeScript | **621** rápidos (604 en T26 + 17 nuevos: 15 de `@agentpay/vault`, 2 de `withVault`) |
| Paquete nuevo | `@agentpay/vault` |
| Código de fases cerradas tocado | Ninguno — `policy-rail.ts` (Fase 3) sin cambios; `apps/agent`/`apps/web` ganaron un seam opcional (`policyRail?`), aditivo |
| Transacción real de la evidencia | pago verificado durante el smoke test de T27: `8d8e72989e14e8a28f5333946b946db617d9b035f75d1a9d4ac7d5176395c33c` |

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T27 | `@agentpay/vault`: bitácora durable, encadenada por hash, de cada decisión de `PolicyRail` | ✅ cerrado 2026-09-04 |
| T28 | Anclar `vault.head()` contra `agent_registry` (transacción companion, `V-3`) | ⏳ pendiente, sin construir |
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
