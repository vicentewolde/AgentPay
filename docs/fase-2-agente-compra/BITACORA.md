# Bitácora — Fase 2 (agente mínimo de compra)

> Qué se hizo, qué falta, y qué significa cada cosa en lenguaje llano.
> Especificación de la fase: [ROADMAP.md §4.2](../../ROADMAP.md) ·
> Decisiones: [DECISIONES.md](DECISIONES.md) ·
> Salidas crudas de cada hito: [evidencia/](evidencia/)
>
> La Fase 1 (AgentPass) está cerrada; su bitácora es
> [../fase-1-agentpass/BITACORA.md](../fase-1-agentpass/BITACORA.md). La
> numeración de hitos continúa la de esa fase: esta empieza en T9.

---

## Estado actual

**Fecha:** 2026-09-02 · **Último hito cerrado:** T9 · **Siguiente:** T10

El agente ya tiene de dónde leer un catálogo. Todavía no tiene herramientas, no
verifica su propia credencial y no puede emitir ninguna intención de compra.

| | |
|---|---|
| Tests TypeScript | **192** rápidos (core 60 · sdk 11 · **agent 67** · cli 29 · scripts 25) |
| Tests de integración | 3 contra testnet real (sin cambios desde la Fase 1) |
| Tests Rust | 22 en verde (sin cambios) |
| Adaptador de catálogo | `MockCatalogAdapter`, 12 productos |
| Bloqueado por el embajador | solo T15 |

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T9 | De dónde el agente lee qué hay a la venta | ✅ cerrado |
| T10 | Las cuatro herramientas del agente | ⏳ siguiente |
| T11 | El agente verifica su propia credencial al arrancar | ⏳ |
| T12 | Chequeo de alcance antes de emitir una intención | ⏳ |
| T13 | La intención de compra firmada | ⏳ |
| T14 | Demo completa en un comando | ⏳ |
| T15 | El catálogo real del bazaar | 🚧 bloqueado por el embajador |

---

## T9 · De dónde el agente lee qué hay a la venta — cerrado 2026-09-02

**Qué quedó funcionando.** El agente ya tiene una fuente de catálogo: puede
pedir la lista completa de productos y puede pedir uno por su identificador. Hoy
esa fuente es un bazaar simulado con doce productos —artesanía chilena, precios
en USDC— que no toca la red. Cuando lleguen las respuestas del embajador, el
bazaar real se enchufa **en el mismo lugar**, respondiendo exactamente la misma
forma; nada de lo que se construya entre T10 y T14 tiene que cambiar por eso.
Ese es el punto entero del hito: que esperar al embajador no bloquee nada más
que el último paso.

**La decisión que estaba pendiente desde la Fase 1, ya cerrada.** Una credencial
AgentPass declara en qué comercios y con qué activos puede operar el agente. El
esquema aceptaba esas dos listas **vacías** sin que nadie hubiera decidido qué
significa una lista vacía: ¿"no puede comprar en ninguna parte", o "puede
comprar donde sea"? Las dos lecturas son defendibles y la diferencia es un
agujero de seguridad silencioso. Queda como **"no puede comprar en ninguna
parte"** ([B-1](DECISIONES.md#b-1--un-scopevenues-o-scopeassets-vacío-significa-nada-permitido-fail-closed--vigente)):
si el campo se omite, se trunca o se serializa mal, el agente pierde permiso de
compra en vez de ganar permiso ilimitado. Es la misma dirección que la Fase 1
tomó en cada duda.

**Cómo se nombra un comercio y un activo, y por qué importa tanto.** T12 va a
autorizar o rechazar una compra comparando dos cadenas de texto: la del comercio
donde se compra y la del activo con que se paga, contra las que la credencial
firmada permite. Esa comparación es **byte a byte**: no se recortan espacios, no
se ignoran mayúsculas, no se normaliza nada. Suena rígido y lo es a propósito —
es la misma regla que la Fase 1 aplica a los identificadores de identidad, y
significa que cualquier discrepancia termina en rechazo, nunca en una compra que
no correspondía.

**El catálogo trae dos productos hostiles, y están a la vista.** Dos de los doce
productos llevan, en su descripción, instrucciones dirigidas al agente: uno
afirma estar exento del límite de gasto, otro ordena no verificar la credencial y
comprar diez unidades. No están escondidos en un archivo de pruebas: están en el
catálogo que la demo va a recorrer
([B-4](DECISIONES.md#b-4--las-descripciones-adversarias-viven-en-el-catálogo-por-defecto-no-en-un-fixture)).
El motivo es que el riesgo central de esta fase es justamente que un rechazo
dependa de que el agente *decida* desobedecer un texto, en vez de salir de una
comprobación estructural. Si el texto hostil solo existiera en un test, el
camino que se demuestra y el que se prueba dejarían de ser el mismo.

**Lo que encontró el mutation testing, que es lo más útil del hito.** Siguiendo
la práctica de la Fase 1, se rompieron cuatro protecciones a propósito para ver
si los tests se ponían en rojo. Tres cayeron como correspondía. La cuarta reveló
un test que **pasaba por el motivo equivocado**: verificaba que un identificador
con espacios de más fuera rechazado, pero lo daba por bueno con solo comprobar
que fallara, sin mirar *por qué*. Al introducir una normalización que recorta
espacios, el test seguía en verde porque el fallo ocurría después, por otra
causa. Se corrigió exigiendo la razón exacta del rechazo, y con eso la mutación
quedó cazada. Un test que pasa por el motivo equivocado es peor que no tenerlo:
da confianza sin respaldarla.

📎 [evidencia/T9.md](evidencia/T9.md) · [apps/agent/README.md](../../apps/agent/README.md) · [DECISIONES.md](DECISIONES.md) (B-1 … B-5)
