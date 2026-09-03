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

**Fecha:** 2026-09-03 · **Último hito cerrado:** T17 · **Siguiente:** T18

El consentimiento del principal ya es un documento firmado y verificable (T16),
y ahora también hay una función que decide si ese consentimiento cubre una
compra concreta (T17). Falta la memoria de gastos que hace cumplir el límite
diario (T18) y el lugar donde el enforcement corre de verdad (T19–T21).

| | |
|---|---|
| Tests TypeScript | **455** rápidos (core 74 · mandate 27 · sdk 16 · cli 29 · **agent 282** · scripts 32) |
| Tests de integración | 3 contra testnet real (sin cambios) |
| Tests Rust | 22 en verde (sin cambios — el contrato no se tocó, `M-3`) |
| Paquete nuevo | `@agentpay/mandate` |
| Bloqueado por el embajador | T15 (Fase 2). En esta fase, solo T22 — y por un supuesto explícito, `M-1` |

`sdk` pasó de 11 a 16 tests entre T16 y T17: no es trabajo de esta fase, es el
[PR #1](https://github.com/vicentewolde/AgentPay/pull/1) de Devin (tests
unitarios de `guards.ts`), coordinado y revisado según `P-2` en
`docs/DECISIONES.md`. Este hito, en adelante, se trabaja en su propia rama
(`cc/t17-check-mandate`), siguiendo esa misma convención.

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T16 | La forma firmada del Mandato | ✅ cerrado |
| T17 | Comparar un mandato contra una compra concreta | ✅ cerrado |
| T18 | La memoria de gastos, y el límite diario | ⏳ siguiente |
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

---

## T17 · `checkMandate()` — cerrado 2026-09-03

**Qué quedó funcionando.** Ahora hay una función que responde una pregunta muy
concreta: *¿este permiso firmado cubre esta compra en particular?* Recibe el
mandato del principal y la intención de compra del agente, y compara los dos,
sin tocar la red, sin depender de un reloj, y sin poder ser influida por nada
que un comercio haya escrito en su catálogo — porque la intención de compra
nunca lleva ese texto (eso ya se decidió en la Fase 2).

La comparación revisa, en orden, de lo más básico a lo más específico:

1. **¿Este mandato es para este agente?** Si alguien intenta usar el permiso de
   otro agente, se rechaza acá, antes de mirar nada más.
2. **¿Lo firmó el mismo principal que la compra dice representar?**
3. **¿El mandato permite crear compras, en este comercio, con este activo?**
4. **¿El límite de gasto está en la misma moneda que el precio?**
5. **¿La compra se hizo dentro del período en que el mandato estaba vigente?**
   Es un chequeo nuevo, que no existía en la Fase 2: un mandato tiene su propia
   fecha de inicio y de término, y una compra fechada afuera de esa ventana no
   quedó cubierta, aunque todo lo demás coincida.
6. **¿El monto está dentro de lo que el mandato autoriza por transacción?**

Cualquier compra que falle en alguno de estos seis puntos queda rechazada, con
el motivo exacto y sin ambigüedad sobre cuál de las dos autoridades —la
credencial o el mandato— fue la que dijo que no.

**Lo que este hito deliberadamente no resuelve todavía:** el límite diario
(`perDay`) sigue sin aplicarse, por la misma razón que en la Fase 2 — necesita
memoria de compras anteriores, y eso es T18. Y esta función todavía no está
conectada al agente: eso es T21. Hoy es una pieza aislada, probada a fondo por
su cuenta.

### Evidencia técnica

Salidas crudas completas en [evidencia/T17.md](evidencia/T17.md).

**Qué se construyó**

- `apps/agent/src/mandate/check-mandate.ts` — `checkMandate()` y
  `mandateCheckError()`, mismo patrón exacto que `checkScope()` de la Fase 2:
  decisión pura (`MandateAllowed | MandateDenied`), nunca lanza, el llamador
  decide cuándo convertir una negación en un `AgentPassError`.
- Ocho códigos de error nuevos en la misma unión de
  `packages/core/src/errors.ts`: `MandateAgentMismatch`,
  `MandatePrincipalMismatch`, `MandateActionNotAllowed`, `MandateVenueNotAllowed`,
  `MandateAssetNotAllowed`, `MandateCurrencyMismatch`, `MandateWindowMismatch`,
  `MandateAmountExceeded`.
- `apps/agent` pasa a depender de `@agentpay/mandate` — el primer consumidor
  real del paquete de T16.

**Comandos**

```
pnpm typecheck     # limpio
pnpm test          # 455 pasando, 0 fallando (425 antes de T17)
```

**Mutation testing** — once mutaciones sobre las seis comparaciones y el
cálculo del monto, aplicadas al archivo real y restauradas. **Las once
cayeron en rojo**, incluida una que cruzaba los campos de identidad
(comparar `issuer` contra `intent.agent` en vez de `intent.principal`) — la
que más tests tumbó, 23 de 30, porque romper la identidad correcta invalida
casi todo lo que la suite da por sentado.

**Nota de coordinación.** Entre el cierre de T16 y el inicio de este hito se
estableció la convención de trabajar en ramas `cc/<feature>` (`P-2` en
`docs/DECISIONES.md`, por la incorporación de Devin como segundo agente sobre
la misma carpeta). Este hito es el primero en seguirla: se trabajó en
`cc/t17-check-mandate`.

**Lo que este hito deliberadamente no hizo:** aplicar `perDay` (T18), conectar
`checkMandate` al agente real (T21), decidir dónde vive el enforcement (T19).
