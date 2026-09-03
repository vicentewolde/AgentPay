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

**Fecha:** 2026-09-03 · **Último hito cerrado:** T21 · **Siguiente:** T22 (depende de `M-12`)

El consentimiento del principal ya es un documento firmado y verificable
(T16), hay una función que decide si ese consentimiento cubre una compra
concreta (T17), hay memoria de cuánto se gastó hoy (T18), existe el lugar
donde todo eso se aplica junto (T19), ese consentimiento se puede anclar y
cortar desde afuera del agente (T20), y ahora **todo eso corre dentro del
agente real, no como piezas sueltas probadas por separado** (T21):
`create_purchase_intent` solo existe cuando la credencial *y* el mandato
verificaron al arrancar, y cada compra pasa por `PolicyRail` antes de
firmarse.

| | |
|---|---|
| Tests TypeScript | **559** rápidos (core 74 · mandate 44 · sdk 16 · cli 29 · **agent 364** · scripts 32) |
| Tests de integración | 6 contra testnet real (3 credenciales + 3 mandatos) |
| Tests Rust | 22 en verde (sin cambios — el contrato no se tocó, `M-3`) |
| Paquete nuevo | `@agentpay/mandate` |
| Bloqueado por el embajador | **Nada.** Ver abajo |

**Lo que cambió en T19, y es lo más importante de esta fase.** Se leyó el repo
real del bazaar del embajador, que ya es público
([`CaBsCrypto/stellar-bazaar-x402`](https://github.com/CaBsCrypto/stellar-bazaar-x402),
Apache-2.0). De las diez preguntas que estaban bloqueando cosas, **el repo
responde ocho y reformula una**; la única que queda abierta dejó de ser una
pregunta para el embajador (`M-11`, `M-12`). En concreto:

- **T15 deja de estar bloqueado.** No hay contrato de compra que integrar: el
  catálogo es una API pública (MCP/REST) sin credenciales.
- **T19 no necesita permiso de nadie.** El propio protocolo del bazaar define
  un paso `buyer policy authorization` que es del comprador — que es
  exactamente esta pieza (`M-11`).
- **`M-1` quedó `Superada`.** No por falsa: la pregunta que asumía dejó de
  existir. La pregunta 6 se le corrió al SDK de x402 y al facilitator, y es
  verificable leyendo código público (`M-12`).

`sdk` pasó de 11 a 16 tests entre T16 y T17: no es trabajo de esta fase, es el
[PR #1](https://github.com/vicentewolde/AgentPay/pull/1) de Devin (tests
unitarios de `guards.ts`), coordinado y revisado según `P-2` en
`docs/DECISIONES.md`. Cada hito desde T17 se trabaja en su propia rama
(`cc/t17-check-mandate`, `cc/t18-spend-ledger`), siguiendo esa misma
convención — T19 en `cc/t19-policy-rail`, T20 en `cc/t20-anchor-mandate`.

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T16 | La forma firmada del Mandato | ✅ cerrado |
| T17 | Comparar un mandato contra una compra concreta | ✅ cerrado |
| T18 | La memoria de gastos, y el límite diario | ✅ cerrado |
| T19 | PolicyRail: dónde se autoriza o se bloquea | ✅ cerrado |
| T20 | Anclar y revocar un mandato en cadena | ✅ cerrado |
| T21 | Cablearlo en el agente | ✅ cerrado |
| T22 | El límite hecho cumplir on-chain, como smart account | 🚧 depende de un spike, `M-12` |
| T23 | Demo de la fase completa | ⏳ siguiente |

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

---

## T18 · La memoria de gastos, y el límite diario — cerrado 2026-09-03

**Qué quedó funcionando.** Hasta este hito, el sistema solo sabía frenar una
compra individual que fuera demasiado grande. No sabía frenar a alguien que
hiciera muchas compras chicas el mismo día hasta juntar, entre todas, más de
lo que su credencial o su mandato permiten en veinticuatro horas. Ahora sí:
hay una memoria de cuánto se gastó hoy, y una regla que suma la compra nueva a
eso y la rechaza si el total pasa el límite diario.

Un ejemplo real: con un límite de 200 al día, una primera compra de 37 se
registra sin problema; una segunda de 150 todavía entra (37 + 150 = 187); pero
una tercera de 20 ya no —187 + 20 = 207, siete de más— y se rechaza con el
motivo exacto: cuánto se había gastado, cuánto se pedía, cuánto habría dado,
y cuál era el límite.

Dos detalles que conviene entender:

- **El día se corta a la medianoche UTC, siempre.** No importa en qué huso
  horario corra el servidor: "hoy" significa lo mismo para todo el sistema, la
  misma disciplina que ya usan todas las fechas del proyecto.
- **Reenviar la misma compra no cuenta dos veces.** Si un intento se repite
  —una red que falla y reintenta, un mensaje duplicado— el sistema lo nota por
  el identificador único de la compra y no la resta dos veces del presupuesto.

**Lo que este hito deliberadamente dejó para después:** que consultar cuánto
se gastó y registrar una compra nueva pasen como una sola operación
indivisible. Hoy son dos pasos separados, y en un solo proceso corriendo de a
uno (como todo lo que existe hasta ahora en este proyecto) eso no es un
problema real — se vuelve uno recién si más adelante dos compras pudieran
autorizarse al mismo tiempo, y ahí se resuelve, no antes (`M-10`).

### Evidencia técnica

Salidas crudas completas en [evidencia/T18.md](evidencia/T18.md).

**Qué se construyó**

- `apps/agent/src/ledger/spend-ledger.ts` — el puerto `SpendLedger`
  (`spentOn()`, `record()`) y `createInMemorySpendLedger()`, su única
  implementación por ahora.
- `apps/agent/src/ledger/check-daily-limit.ts` — `checkDailyLimit()`, la
  función pura que decide si sumar una compra nueva a lo ya gastado se pasa
  del límite diario. Genérica sobre cuál de las dos autoridades la usa
  (credencial o mandato): el llamador elige el código de error.
- Dos códigos de error nuevos en la misma unión de
  `packages/core/src/errors.ts`: `ScopeDailyLimitExceeded`,
  `MandateDailyLimitExceeded`.

**Comandos**

```
pnpm typecheck     # limpio
pnpm test          # 482 pasando, 0 fallando (455 antes de T18)
```

**Mutation testing** — siete mutaciones sobre las dos piezas nuevas, aplicadas
al archivo real y restauradas. **Las siete cayeron en rojo**, incluida una que
marcaba una compra como "ya vista" antes de validar su monto —lo que habría
dejado sin reintento posible a una compra rechazada por un dato malformado.

**Lo que este hito deliberadamente no hizo:** decidir dónde vive el
enforcement real ni cómo se compone con `checkScope()`/`checkMandate()` (T19),
ni cablear nada al agente (T21), ni resolver la atomicidad entre consultar y
registrar (`M-10`, diferido a T19).

---

## T19 · PolicyRail: dónde se autoriza o se bloquea — cerrado 2026-09-03

**Qué quedó funcionando, en lenguaje llano.** Hasta ahora el proyecto tenía
cuatro chequeos sueltos: uno miraba lo que el emisor firmó, otro lo que el
principal consintió, otro cuánto se gastó hoy. Cada uno contestaba bien su
pregunta, y **ninguno obligaba a nada**: un chequeo que nadie está obligado a
llamar es una sugerencia, no un límite. T19 es la pieza que sí obliga — un
único punto por donde toda compra tiene que pasar, que llama a los cuatro, en
orden, y que un llamador no puede cumplir a medias.

Y agrega un chequeo que no existía y que resultó ser el que faltaba: **¿el
comercio está pidiendo cobrar por la compra que se firmó?** Antes se
verificaba que la compra estuviera dentro de los límites, pero nada comparaba
eso contra lo que el comercio efectivamente pide cobrar. Un comercio que pide
40 por algo firmado en 37 pasaba todos los límites —40 está dentro de todo— y
ahora se rechaza, porque no es la compra que el principal autorizó.

Tres cosas más que ahora son ciertas y antes no:

1. **Lo gastado se anota al autorizar, no al pagar.** Si algo sale mal, el
   agente gasta de menos, nunca de más. Es la regla de "ante la duda, se
   rechaza" aplicada al tiempo.
2. **Dos compras al mismo tiempo ya no se cuelan las dos.** Antes, dos
   autorizaciones simultáneas podían leer el mismo saldo viejo y aprobarse las
   dos. Ahora hacen fila. Es el agujero que `M-10` había dejado anotado
   explícitamente para este hito.
3. **El agente no puede resetear su propio presupuesto.** El día contra el que
   se cuenta lo decide el reloj de PolicyRail, no la fecha que el agente
   escribe en su propio documento firmado. Un agente comprometido que fecha su
   compra "ayer" para caer en un balde vacío ya no consigue nada.

**Lo que este hito descubrió y no construyó, dicho en voz alta.** El campo más
sensible de un cobro —**la cuenta que recibe la plata**— no se chequea contra
nada, porque hoy no existe nada firmado contra qué compararlo: ni la credencial
ni el mandato llevan una lista de destinatarios permitidos. Compararlo contra
un valor que el mismo catálogo entregó daría la apariencia de una verificación
sin la verificación. Queda anotado en `M-14` como el próximo campo que le falta
al Mandato, no como deuda silenciosa.

**Evidencia técnica.** [evidencia/T19.md](evidencia/T19.md) — el recorrido
completo con salidas crudas, incluyendo seis autorizaciones concurrentes contra
un presupuesto que alcanza para dos (pasan exactamente dos) y el intent
fechado ayer que no consigue resetear nada. 38 tests nuevos, 13 mutaciones
deliberadas y las trece cayeron. Dos de esas mutaciones cambiaron el código en
vez de solo confirmarlo: una encontró un bug real —el rail reconciliaba contra
un número y cobraba el presupuesto con otro— y la otra encontró un test que
faltaba.

**Decisiones nuevas:** `M-11` a `M-16`, y `M-1` pasó a `Superada`. La lectura
del repo real del bazaar está en `M-11` y `M-12`; el diseño del rail en `M-13`
a `M-16`.

**Fuera de alcance, a propósito:** liberar una reserva cuando una compra falla
(no existe todavía nada que pueda avisar que falló — ese aviso es el recibo de
settlement, que es de la Fase 4) y cablear el rail dentro del agente (T21).

---

## T20 · Anclar y revocar un mandato en cadena — cerrado 2026-09-03

**Qué quedó funcionando, en lenguaje llano.** El consentimiento firmado del
principal (el Mandato, de T16) ya se podía verificar, pero solo *offline*:
nada impedía que un mandato revocado por el principal siguiera pasando por
válido, porque nadie consultaba la cadena. Ahora sí. El principal ancla el
mandato en el mismo contrato que ya identifica y revoca agentes, y desde ese
momento revocarlo es tan simple como ya lo era revocar una credencial — y
tiene exactamente el mismo efecto: el mismo documento, la misma firma válida,
deja de contar como autorización, sin que el agente haga nada ni pueda
evitarlo.

Y hay un efecto colateral bueno que no se buscaba a propósito: si el registro
**desactiva a un principal entero** (una operación de administrador que ya
existía, para emisores de credenciales), todos los mandatos de esa persona
dejan de verificar también — el mismo interruptor general alcanza ahora tanto
a la identidad de los agentes como al consentimiento de quienes los operan.

**Lo que este hito NO tuvo que construir, y por qué importa.** `M-3` había
anotado un costo pendiente: alguien tiene que registrar al principal como
"emisor" en el contrato antes de que pueda anclar un mandato. La respuesta
resultó ser: nada nuevo. La misma operación que ya registra a un emisor de
credenciales sirve tal cual para un principal — el contrato nunca distinguió
entre los dos roles. Se verificó de punta a punta contra testnet real,
reusando la misma llave que ya está registrada para credenciales.

**Evidencia técnica.** [evidencia/T20.md](evidencia/T20.md) — el ciclo
completo (anclar → verificar → revocar → falla) primero contra un registro
simulado y después **contra Stellar testnet real**, con transacciones
verdaderas. 17 tests nuevos, nueve mutaciones deliberadas: ocho cayeron, y la
que sobrevivió resultó ser una simetría defensiva sin camino real para
alcanzarla — el mismo patrón, sin testear, que ya vive en el código de
credenciales de la Fase 1 desde antes de esta fase.

**Decisiones nuevas:** `M-17` (cómo se resolvió el costo pendiente de `M-3`)
y `M-18` (el único cambio a un paquete de la Fase 1: un método genérico nuevo
en `AgentPass`, sin que `@agentpass/sdk` aprenda qué es un Mandato).

**Nota de coordinación.** Al empezar este hito se encontró otra sesión
escribiendo en la misma carpeta compartida, en la misma rama
`cc/t20-anchor-mandate` — resultó ser Devin, no otra sesión de Claude Code.
El usuario pausó esa sesión y revirtió sus cambios (commit `b6bcee0`) antes de
que este hito arrancara desde `main` limpio. Ver la entrada correspondiente en
`docs/AGENT_LOG.md`.

**Fuera de alcance, a propósito:** cablear esto en el agente real (T21) y
cualquier flujo de registro de principal más allá de reusar
`AgentPass.registerIssuer()` tal cual — si algún día principal y emisor dejan
de ser la misma llave en el piloto, la operación de admin ya existe, solo hay
que correrla para esa dirección nueva.

---

## T21 · Cablearlo en el agente — cerrado 2026-09-03

**Qué quedó funcionando, en lenguaje llano.** Hasta este hito, cada pieza de
esta fase —el Mandato, `checkMandate`, la memoria de gastos, `PolicyRail`, el
anclaje en cadena— estaba probada por su cuenta, aislada. Ninguna estaba
todavía conectada al agente que de verdad compra. Ahora sí: el agente arranca
verificando **dos** documentos, no uno —su credencial y el mandato de quien lo
opera— y la herramienta que produce una compra firmada, `create_purchase_intent`,
directamente **no existe** si cualquiera de los dos falta o no es válido. No es
un mensaje de "no tienes permiso" que un texto astuto pudiera discutir: es que
no hay ninguna herramienta con ese nombre para invocar.

Y cada compra que sí se intenta pasa, ahora de verdad y dentro del agente, por
el único lugar que obliga (`PolicyRail`, T19): lo que firmó el emisor, lo que
consintió el principal, y cuánto se lleva gastado hoy, los tres a la vez,
antes de que el agente firme nada.

**Un detalle que importa tanto como el resto.** Justo antes de cerrar este
hito, al preparar las pruebas de mutación que buscan errores deliberados en el
código, la suite completa encontró uno que **no era deliberado**: el reporte
de si el agente puede o no crear una intención de compra
(`can_create_purchase_intent`, la señal que un operador —o un modelo— lee para
saber si vale la pena intentarlo) estaba devolviendo siempre `true`, sin
importar si la herramienta realmente existía. Dos tests que ya estaban
escritos lo habían estado señalando; se corrigió con una línea, usando el
mismo cálculo que ya decide si la herramienta se construye, en vez de
repetirlo aparte. Es la tercera fase seguida en que el mutation testing
deliberado destapa, de pasada, un bug real que nadie había puesto ahí a
propósito.

**Evidencia técnica.** [evidencia/T21.md](evidencia/T21.md) — el demo completo
contra testnet real emitiendo y anclando credencial *y* mandato, 22 tests
nuevos, ocho mutaciones deliberadas: siete cayeron, y la que sobrevivió resultó
equivalente por la misma razón que ya apareció en T20 — mientras el agente
sostenga un único documento firmado por vez, comparar "la versión de arranque"
contra "la versión recién revisada" del mismo documento no puede dar resultados
distintos, porque los dos vienen de decodificar exactamente los mismos bytes.

**Decisiones nuevas:** `M-19` (el bug real, y por qué correr los tests antes de
escribir una mutación sobre un archivo importa) y `M-20` (por qué la mutación
del mandato fresco-vs-arranque es equivalente, y hasta cuándo).

**Fuera de alcance, a propósito, otra vez:** el contrato `policy_rail` on-chain
(T22, depende de `M-12`), el chequeo de `payTo` en el reto 402 (`M-14`, sigue
sin nada firmado contra qué compararlo), y renovar un mandato sin reiniciar el
agente (lo que haría dejar de ser equivalente a `M-20`).
