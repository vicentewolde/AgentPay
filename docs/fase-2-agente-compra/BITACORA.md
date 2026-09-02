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

**Fecha:** 2026-09-02 · **Último hito cerrado:** T10 · **Siguiente:** T11

El agente ya tiene de dónde leer un catálogo y ya tiene sus cuatro herramientas.
Dos funcionan; las otras dos existen con su forma definitiva y todavía no hacen
nada. Falta que verifique su propia credencial y que pueda emitir una intención.

| | |
|---|---|
| Tests TypeScript | **219** rápidos (core 60 · sdk 11 · **agent 94** · cli 29 · scripts 25) |
| Tests de integración | 3 contra testnet real (sin cambios desde la Fase 1) |
| Tests Rust | 22 en verde (sin cambios) |
| Adaptador de catálogo | `MockCatalogAdapter`, 12 productos |
| Bloqueado por el embajador | solo T15 |

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T9 | De dónde el agente lee qué hay a la venta | ✅ cerrado |
| T10 | Las cuatro herramientas del agente | ✅ cerrado |
| T11 | El agente verifica su propia credencial al arrancar | ⏳ siguiente |
| T12 | Chequeo de alcance antes de emitir una intención | ⏳ |
| T13 | La intención de compra firmada | ⏳ |
| T14 | Demo completa en un comando | ⏳ |
| T15 | El catálogo real del bazaar | 🚧 bloqueado por el embajador |

---

## T10 · Las cuatro herramientas del agente — cerrado 2026-09-02

**Qué quedó funcionando.** El agente tiene exactamente cuatro cosas que puede
hacer: ver el catálogo, mirar un producto, consultar su propia credencial y
crear una intención de compra. Ni una más. Dos ya funcionan de punta a punta
—las del catálogo, que T9 dejó listo—; las otras dos existen con su nombre
definitivo, sus argumentos definitivos y la forma exacta de su respuesta, pero
todavía no hacen nada: si se las llama, fallan diciendo en qué hito llega su
comportamiento (T11 y T12/T13). Eso es deliberado. Un hueco declarado es más
honesto que una respuesta inventada que parezca correcta.

**La parte que importa: la lista de herramientas *es* el permiso.** Llamar a una
herramienta se hace por nombre contra la lista que el agente ve. Si una
herramienta no está en esa lista, no es que esté "prohibida" —no existe—, y el
error que sale lo dice así: `UnknownTool`. La diferencia no es cosmética. Un
permiso denegado es un mensaje, y un mensaje se puede discutir, reinterpretar o
sortear con la instrucción correcta. Una herramienta ausente no tiene con qué
discutirse. Es el mecanismo entero sobre el que se apoya el hito siguiente:
cuando en T11 la credencial esté revocada, `create_purchase_intent`
simplemente no se va a incluir en la lista. Ese comportamiento ya está
construido y probado; a T11 solo le queda decidir *cuándo* aplicarlo.

**"Cuatro herramientas, ninguna más" no es una regla que haya que recordar.**
Los nombres son una unión cerrada de literales en el código, y el nombre de
toda herramienta tiene ese tipo. Escribir una quinta herramienta no compila.
Deja de ser algo que alguien tenga que cazar en una revisión de código.

**Ningún handler ve datos sin validar.** Cada herramienta declara la forma de
sus argumentos, y esa forma se comprueba antes de que su código corra. Un
argumento de más no se ignora en silencio: se rechaza. Y el mismo esquema que
valida es el que se convierte en la descripción que recibe el modelo, así que no
hay dos versiones del contrato que se puedan desfasar entre sí.

**El texto hostil sigue pasando tal cual.** `list_products` devuelve las
descripciones de los doce productos sin tocar, incluidas las dos que le dan
instrucciones al agente. Es lo decidido en `B-5` y hay un test que lo fija: lo
que impide que ese texto importe no es filtrarlo, es que en T12 la autorización
va a salir de comparar campos estructurados. Filtrarlo daría la señal falsa de
que la seguridad depende de limpiar prosa.

**Mutation testing.** Cuatro protecciones rotas a propósito —saltarse la lista
al invocar, saltarse la validación de argumentos, cambiar el orden de la lista,
permitir registrar dos veces la misma herramienta—. Las cuatro cayeron, cada una
en los tests correctos. A diferencia de T9, esta vez ninguna pasó por el motivo
equivocado y no hubo que endurecer nada después.

📎 [evidencia/T10.md](evidencia/T10.md) · [apps/agent/README.md](../../apps/agent/README.md) · [DECISIONES.md](DECISIONES.md) (B-6 … B-8)

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
