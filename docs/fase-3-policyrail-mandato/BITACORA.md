# Bitácora — Fase 3 (PolicyRail + Mandato)

> Qué se hizo, qué falta, y qué significa cada cosa en lenguaje llano.
> Especificación de la fase: [ROADMAP.md §4.3](../../ROADMAP.md) ·
> Qué prueba: [CONTEXTO.md](CONTEXTO.md) ·
> Decisiones: [DECISIONES.md](DECISIONES.md) ·
> Salidas crudas de cada hito: [evidencia/](evidencia/)
>
> La numeración de hitos continúa: T1–T8 fue la Fase 1, T9–T15 la Fase 2 (T15
> sigue abierto y bloqueado), esta empieza en **T16**.

---

## Estado actual

**Fecha:** 2026-09-02 · **Último hito cerrado:** T16 · **Siguiente:** T17

El consentimiento del principal ya es un documento firmado y verificable. Un
agente **no puede** firmarse su propio mandato: lo impide la criptografía, no una
regla que se le pida respetar. Falta lo que compara ese mandato contra una
compra concreta (T17), la memoria de gastos que hace cumplir el límite diario
(T18) y el lugar donde el enforcement corre (T19–T21).

| | |
|---|---|
| Tests TypeScript | **425** rápidos (core 74 · **mandate 27** · sdk 11 · cli 29 · agent 252 · scripts 32) |
| Tests de integración | 3 contra testnet real (sin cambios) |
| Tests Rust | 22 en verde (sin cambios — el contrato no se tocó, `M-3`) |
| Paquete nuevo | `@agentpay/mandate` |
| Bloqueado por el embajador | T15 (Fase 2). En esta fase, solo T22 — y por un supuesto explícito, `M-1` |

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T16 | La forma firmada del Mandato | ✅ cerrado |
| T17 | Comparar un mandato contra una compra concreta | ⏳ siguiente |
| T18 | La memoria de gastos, y el límite diario | ⏳ |
| T19 | PolicyRail: dónde se autoriza o se bloquea | ⏳ |
| T20 | Anclar y revocar un mandato en cadena | ⏳ |
| T21 | Cablearlo en el agente | ⏳ |
| T22 | El límite hecho cumplir on-chain, como smart account | 🚧 depende del supuesto `M-1` |
| T23 | Demo de la fase completa | ⏳ |

---

## T16 · La forma firmada del Mandato — cerrado 2026-09-02

**Qué quedó funcionando.** Ahora existe el documento que faltaba: **el permiso
firmado por la persona que pone la plata.** Antes de esto, el sistema tenía la
credencial del agente (firmada por quien lo emitió) y la intención de compra
(firmada por el agente), pero el "yo autorizo esto" del principal era una
suposición, no algo que alguien pudiera revisar después.

Un Mandato dice, en una estructura que se puede verificar sin conexión: *yo,
este principal, autorizo a este agente a gastar hasta este monto, en estos
comercios, con estos activos, desde esta fecha y hasta esta otra.* Y algo que
importa más de lo que parece: **el agente no puede escribirse uno.** Si lo
intenta, la firma no coincide con quien el documento dice que autoriza, y el
sistema se niega antes de producir nada. No es que se le pida al agente que no
lo haga — es que no tiene la llave.

Tres decisiones que se tomaron acá y conviene entender:

- **Un mandato se puede retirar.** Se ancla en el mismo registro en cadena que
  ya usa la credencial, así que el principal puede cortarlo después, sin
  cooperación del agente. Eso no se construyó todavía (es T20), pero el
  documento ya tiene la forma exacta que lo permite, y el contrato no hubo que
  tocarlo.
- **Un mandato siempre tiene fecha de término.** No hay valor por defecto y no
  se puede omitir: un permiso sin vencimiento es exactamente lo que esta fase
  existe para evitar.
- **Dos permisos, gana el más estricto.** Lo que el emisor de la credencial
  firmó y lo que el principal consintió se aplican los dos. Ninguno puede
  ampliar al otro, solo recortarlo.

**Sobre el bloqueante del embajador.** Se decidió avanzar asumiendo que su
bazaar está escrito de la forma estándar de Soroban. Eso quedó registrado como
un **supuesto explícito** (`M-1`), no enterrado en el código, y con la
verificación que lo respalda: la documentación oficial de Stellar dice que un
contrato estándar acepta indistintamente una cuenta clásica y una de contrato.
Si el supuesto resulta falso, lo único que se pierde es un hito, el último.

### Evidencia técnica

Salidas crudas completas en [evidencia/T16.md](evidencia/T16.md).

**Qué se construyó**

- `packages/core/src/jws-document.ts` — la maquinaria de firma JWS,
  generalizada y parametrizada por un perfil (`M-5`). Aditiva: `vc-jwt.ts` de la
  Fase 1 y el firmado de intents de la Fase 2 **no se tocaron**.
- `packages/mandate/` → `@agentpay/mandate` (`M-2`): `mandate.ts` (el esquema
  zod estricto), `create.ts` (`createMandate()`), `sign.ts` (`signMandate()`,
  `verifyMandate()`), `testing.ts` (fixtures con llaves reales, nada stubbeado).
- Tres códigos de error nuevos en la misma unión de `packages/core/src/errors.ts`:
  `InvalidMandate`, `MandateExpired`, `MandateNotYetValid`. `SignerMismatch` se
  reutiliza.

**Comandos**

```
pnpm install
pnpm typecheck     # limpio
pnpm test          # 425 pasando, 0 fallando (384 antes de T16)
```

**Mutation testing** — 11 mutaciones, aplicadas al archivo real y restauradas.
10 cayeron en rojo. La que sobrevivió (`M1`, "`kid` elige la llave de
verificación") resultó ser **equivalente**: el cruce de `kid` corre antes, así
que la mutación no puede cambiar el comportamiento. Analizarla en vez de
descartarla destapó el hueco real —ningún test probaba la fuente de la llave con
`kid` **ausente**— y se agregó ese test. Es el patrón que la Fase 2 anotó cinco
veces y que volvió a pagar acá.

**Lo que este hito deliberadamente no hizo:** comparar un mandato contra un
intent (T17), aplicar `perDay` (T18), anclar o revocar en cadena (T20), tocar el
contrato Soroban (no hizo falta, `M-3`), ni unificar las tres implementaciones
de firma JWS (`M-5` — propuesta registrada, no ejecutada).
