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

**Fecha:** 2026-09-02 · **Último hito cerrado:** T14 · **Siguiente:** T15 (bloqueado por el embajador)

`pnpm demo` corre de punta a punta contra Stellar testnet real, en 12
segundos: emite una credencial, entiende una instrucción en español, firma una
intención de compra, revoca desde afuera y el mismo agente, en el mismo
proceso, ve rechazado el reintento. T9–T14 están cerrados. Lo único que falta
de la fase es T15 — el bazaar real — y depende de las respuestas del
embajador, no de nada que este repo pueda resolver por su cuenta.

| | |
|---|---|
| Tests TypeScript | **384** rápidos (core 60 · sdk 11 · **agent 252** · cli 29 · **scripts 32**) |
| Tests de integración | 3 contra testnet real (sin cambios desde la Fase 1) |
| Tests Rust | 22 en verde (sin cambios) |
| Adaptador de catálogo | `MockCatalogAdapter`, 12 productos |
| Bloqueado por el embajador | solo T15 |

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T9 | De dónde el agente lee qué hay a la venta | ✅ cerrado |
| T10 | Las cuatro herramientas del agente | ✅ cerrado |
| T11 | El agente verifica su propia credencial al arrancar | ✅ cerrado |
| T12 | Chequeo de alcance antes de emitir una intención | ✅ cerrado |
| T13 | La intención de compra firmada | ✅ cerrado |
| T14 | Demo completa en un comando | ✅ cerrado |
| T15 | El catálogo real del bazaar | 🚧 bloqueado por el embajador |

---

## T14 · Demo end-to-end en un comando — cerrado 2026-09-02

**Qué quedó funcionando.** `pnpm demo` es el recorrido completo de la fase,
sin pasos manuales: emite una credencial real y anclada, le da al agente una
instrucción en español, obtiene una intención de compra firmada, revoca la
credencial desde afuera del agente, y el mismo agente —en el mismo proceso,
sin reiniciarse— ve rechazado el reintento de la misma compra. Doce segundos
de pared. El criterio de aceptación pedía menos de noventa.

**No es una simulación de ninguna parte del proceso.** La credencial se
firma y se ancla en testnet de verdad; la revocación es una transacción real,
con su propio hash. Es lo mismo que ya probó la Fase 1 en su test de
integración contra la red viva — acá corre dentro de la demo, no aparte.

**La instrucción en español no la interpreta un modelo de lenguaje.** Se
decidió a propósito: un comparador de palabras contra el catálogo, sin llamada
a ninguna API externa. Tres motivos, registrados en `B-21`: la demo tiene que
ser reproducible para grabarse (la misma frase, siempre el mismo producto);
no puede depender de una llave de API de terceros solo para correr; y sobre
todo, no es ahí donde vive la seguridad. El intérprete únicamente puede
producir qué producto y cuántas unidades — nunca un comercio, un activo o un
monto. Una mala lectura elige mal el producto; no puede otorgarle al agente
autoridad que su credencial no tenga. Hay un test que lo prueba con una
instrucción que lleva una inyección adentro.

**El orden del script también es una decisión, encontrada al construirlo.**
La primera versión emitía la credencial primero y recién después interpretaba
la instrucción. Una instrucción que no matcheaba nada del catálogo fallaba
**después** de haber gastado una transacción real y dejaba una credencial
activa, huérfana, anclada para siempre en el registro. Se invirtió el orden:
la instrucción se lee primero, sin tocar la red, así que un pedido sin sentido
falla en una fracción de segundo y no deja rastro en la cadena.

**El ejemplo de scope que T9 había dejado pendiente ya está, y se usa de
verdad.** `examples/scope.json` autoriza cero compras a propósito
(`B-1`); hacía falta un segundo ejemplo con comercio y activo explícitos para
que la demo pudiera producir un intent. `examples/scope-bazaar.json` es ese
archivo, y `demo.ts` lo lee y valida con el mismo esquema que usa `agentpass
issue --scope` desde la Fase 1 — no un camino nuevo, el mismo.

**El seam para el bazaar real ya está tendido.** `pnpm demo --adapter=bazaar`
falla hoy con un error que nombra T15, sin tocar la red — es el criterio de
aceptación de la fase completa, ya cumplido en su primera mitad: `pnpm demo`
corre con el mock; cuando lleguen las respuestas del embajador, activar el
bazaar real es implementar esa rama, no tocar T9–T14.

**Mutation testing, cuarta vez que una mutación mal escrita enseña más que
una bien escrita.** Cinco protecciones rotas sobre la lógica nueva —el
intérprete y el parser de argumentos del comando—; cuatro cayeron. La quinta,
que dejaba pasar una cantidad de cero, no rompió nada: nadie había escrito
qué debía pasar con "compra 0 mates". El código ya lo manejaba bien
—ignorarlo y usar el valor por defecto—, pero nada lo afirmaba. Se agregó el
test que lo fija, y con él la mutación cae.

**Lo que queda deliberadamente sin resolver.** `check_my_credential` sigue
reportando el estado que vio al arrancar (`B-10`, T11); si se lo llamara
inmediatamente después de revocar a mitad de sesión, diría "activa" un
instante antes de que `create_purchase_intent` lo rechace de verdad. No es un
agujero de seguridad —lo único que autoriza una compra es el chequeo de
`B-17`, y ese sí es correcto en todo momento—, pero es una inconsistencia
real entre lo que el agente *dice* y lo que puede *hacer*, y por eso la demo
no vuelve a llamar a `check_my_credential` después de revocar. Queda anotado
en `B-23` en vez de resuelto en silencio.

📎 [evidencia/T14.md](evidencia/T14.md) · [apps/agent/README.md](../../apps/agent/README.md) · [DECISIONES.md](DECISIONES.md) (B-21 … B-23)

---

## T13 · La intención de compra firmada — cerrado 2026-09-02

**Qué quedó funcionando.** El agente ya produce el documento que era el objetivo
de toda la fase: una **intención de compra firmada con su propia llave**. Dice
quién es el agente, para quién trabaja, en qué comercio, qué producto, cuánta
cantidad, por qué monto exacto, en qué activo, bajo qué límite y hasta cuándo
vale. No mueve dinero y no completa ninguna compra — es una declaración firmada,
que es exactamente lo que la fase prometía.

**Cualquiera puede verificarla, sin pedirle permiso a nadie y sin red.** La firma
se comprueba contra la llave que el identificador del agente ya contiene, igual
que las credenciales de la Fase 1. No hay servidor que consultar para saber si el
documento es auténtico.

**Y es trazable a la credencial que la autorizó.** El intent lleva el hash de esa
credencial. Eso es lo que lo separa de un vale al portador: quien reciba el
documento puede preguntarle al registro en la cadena si la autoridad detrás sigue
en pie. Un intent firmado hace un mes, con la credencial revocada la semana
pasada, sigue siendo una firma auténtica — y el registro dirá que ya no vale.

**Lo que T11 había dejado abierto, resuelto.** La verificación era solo al
arrancar, así que un agente que llevara horas corriendo conservaba su herramienta
de compra aunque lo hubieran revocado. Ahora la credencial **se vuelve a
comprobar contra el registro justo antes de firmar**. Son dos capas: la lista de
herramientas decide qué capacidades existen, y la reverificación decide si la
autoridad sigue viva en el instante exacto de poner la firma. Sin la segunda, la
promesa de la fase —que la autorización se puede cortar desde afuera— sería falsa
para cualquier agente que no se reinicie.

Está probado con el agente corriendo: se revoca desde fuera a mitad de ejecución,
la herramienta todavía figura en su lista porque el arranque la vio activa, y el
intento siguiente falla igual. **El orden también importa y está probado:** el
chequeo de alcance corre primero, así que una compra que el alcance rechaza no
gasta una llamada de red; solo lo que va a firmarse paga ese costo.

**La forma del documento está pensada para no cambiar en la Fase 3.** El Mandato
—el consentimiento firmado del principal— se comparará contra una intención
preguntando quién, para quién, dónde, qué, cuánto, en qué activo, bajo qué límite
y hasta cuándo. Los ocho datos están. Y no hay nada específico del catálogo
simulado.

**Lo que a propósito no lleva: el nombre ni la descripción del producto.** Es
texto del comercio, y un documento firmado no debe poner la firma del agente
sobre la prosa de un tercero. El identificador del producto es lo que el comercio
puede respaldar, y alcanza para dejar establecido qué se pidió. Hay un test que
comprueba que colar una descripción ahí adentro hace fallar la firma.

**Mutation testing, y el tercer hallazgo de la fase.** Cinco protecciones rotas;
cuatro cayeron. La quinta —hacer que la verificación elija la llave según lo que
el propio documento declara— **no rompió nada**, y otra vez la mutación era
inalcanzable: el chequeo que la haría peligrosa corre antes y ya lanzaba. Pero al
analizarla apareció que los tests probaban esa protección de forma indirecta:
todos reutilizaban la firma de la víctima, y ninguno construía el ataque real, un
atacante que escribe un documento nombrando a la víctima y lo firma con su propia
llave. Se agregó ese test, con una firma genuina del atacante, y con él la
regresión realista cae de inmediato. Tercera vez en la fase que una mutación mal
escrita enseña más que una bien escrita.

📎 [evidencia/T13.md](evidencia/T13.md) · [apps/agent/README.md](../../apps/agent/README.md) · [DECISIONES.md](DECISIONES.md) (B-17 … B-20)

---

## T12 · Chequeo de alcance antes de emitir una intención — cerrado 2026-09-02

**Qué quedó funcionando.** Antes de crear cualquier intención de compra, el
agente comprueba contra su credencial firmada tres cosas: que el comercio esté
entre los permitidos, que el activo con que se pagaría esté entre los
permitidos, y que el total —precio por cantidad— no supere el límite por
transacción. Si algo falla, el rechazo es estructurado: trae el código exacto de
la causa, el monto que se pedía, el límite contra el que se comparó y la moneda.
No es un intento silencioso ni un mensaje genérico.

**El riesgo central de la fase, resuelto por construcción y no por vigilancia.**
Dos de los doce productos del catálogo llevan instrucciones dirigidas al agente
en su descripción: uno afirma estar exento del límite, otro le ordena comprar
diez unidades. Los dos son rechazados. Pero lo importante no es que sean
rechazados — es **por qué** no podían no serlo: la función que decide *nunca
recibe el producto*. Recibe cuatro datos —comercio, activo, precio unitario,
cantidad— y ninguno de ellos es texto del comercio. No hay un campo por el que
la prosa pueda llegar hasta la decisión. No es que el agente tenga instrucciones
de ignorarla, ni que el texto se limpie antes: el texto no es una entrada.

**Se probó en las dos direcciones, que es lo que hace válida la prueba.**
Agregar una inyección a un producto que estaba permitido no lo vuelve
rechazado; y —esto es lo que más importa— **quitarle la inyección a un producto
rechazado no lo vuelve permitido**. Si el rechazo viniera de que el agente
detectó texto hostil, sacar el texto dejaría pasar la compra. No pasa: sigue
rechazado, con el mismo código y el mismo total al último decimal. Se probaron
nueve estilos de ataque distintos, incluyendo uno que se hace pasar por
instrucción del sistema y otro que simula el resultado de una herramienta.

**La aritmética no usa números con coma flotante, y eso no es purismo.** Los
montos viajan como texto desde la Fase 1 justamente para que ningún redondeo
mueva un límite, y este es el primer código que además tiene que *calcular* con
ellos. Se hace con enteros escalados a siete decimales. En coma flotante,
`0.1 x 3` da `0.30000000000000004` — es decir, una compra de exactamente el
límite se rechazaría por un error de representación. Hay tests que fijan
exactamente esos casos.

**Lo que deliberadamente no se construyó.** El límite diario (`perDay`) no se
aplica: hacerlo exige recordar cuánto se gastó antes, y eso ya es enforcement,
que es de PolicyRail en la Fase 3. Hay un test que fija esa frontera a
propósito, para que media implementación de `perDay` no entre sin que nadie
avise.

**Mutation testing, y el hallazgo de esta vez.** Cinco protecciones rotas a
propósito; cuatro cayeron limpiamente, incluida la que hace que la descripción
del producto influya en la decisión —cae con ocho tests—. La quinta, cambiar la
aritmética a coma flotante, **no rompió nada**. La causa no era una protección
faltante sino una mutación mal escrita: el redondeo que usé borraba el error del
float para todos los valores probados, así que la mutación no cambiaba nada.
Pero al analizarla apareció un hueco real: los tests del chequeo de alcance no
verificaban la aritmética en el borde, solo confiaban en los tests del módulo de
montos. Se agregaron cinco casos al nivel de la decisión, y con eso las dos
formas realistas de la mutación caen — incluida la que antes sobrevivía. Segunda
vez en la fase que una mutación mal escrita enseña más que una bien escrita.

📎 [evidencia/T12.md](evidencia/T12.md) · [apps/agent/README.md](../../apps/agent/README.md) · [DECISIONES.md](DECISIONES.md) (B-13 … B-16)

---

## T11 · El agente verifica su propia credencial al arrancar — cerrado 2026-09-02

**Qué quedó funcionando.** Al arrancar, el agente comprueba su propia
credencial: que la firma sea auténtica, que esté dentro de su ventana de
vigencia, y que el registro en la cadena la siga dando por activa con su emisor
todavía habilitado. El resultado de esa comprobación decide qué puede hacer. Si
la credencial está bien, tiene sus cuatro herramientas. Si fue revocada, si
venció, si nunca se ancló o si su emisor fue dado de baja, **la herramienta de
compra sencillamente no está en su lista**.

**Y ahí está el punto de toda la fase.** Al agente no se le dice que no puede
comprar. No hay un permiso denegado, ni un mensaje, ni una regla en el prompt
que alguien pueda intentar reinterpretar. La herramienta no existe: pedirla
devuelve "no hay ninguna herramienta con ese nombre". La autorización se cortó
desde afuera —desde la cadena, por el emisor— y lo que el agente percibe es la
ausencia de una capacidad, no una negativa que se pueda discutir.

**El agente no se cae: se queda sin poder de compra.** Con la credencial
revocada sigue leyendo el catálogo perfectamente. Lo que se le quitó es la
autorización para comprar, no el programa entero. Eso es lo que hace posible la
demo de T14: revocar a mitad de operación y que el agente siga corriendo,
visiblemente incapaz de completar la compra.

**Puede explicar por qué, y ahí hay una decisión de seguridad fina.**
`check_my_credential` reporta el estado. Cuando la credencial está activa,
informa todo: quién la emitió, a qué agente identifica, hasta cuándo vale, y qué
alcance firmado tiene. Cuando **no** verifica, informa el código del fallo y el
hash del documento, y **nada de lo que el documento dice por dentro**. La razón:
si la firma no es auténtica, cada campo de ese documento lo eligió quien lo
falsificó, y repetir su contenido sería presentar una falsificación como si
fuera un dato. El hash es la excepción, porque no se lee de adentro del
documento — se calcula sobre los bytes que efectivamente llegaron.

**No poder confirmar cuenta como no estar autorizado.** Si la consulta al
registro falla por una caída de red, el agente no asume que todo está bien: se
queda sin la herramienta de compra igual. Es la misma dirección de `B-1`. La
causa igual queda registrada, así que un corte de red se sigue distinguiendo de
una revocación.

**El agente no puede emitir ni revocar credenciales, y eso lo garantiza el
tipo.** Recibe un verificador con un solo método, no el SDK completo. No es una
convención que haya que respetar: no existe la función que le permitiría emitir
una credencial para sí mismo. Que el SDK real encaje en ese puerto sin adaptador
se comprueba al compilar.

**Cómo se prueba sin red.** El doble de test corre de verdad la criptografía
—firma Ed25519 real, ventana de vigencia real— y simula únicamente la consulta
al registro, que es lo único que necesita red. Un doble que también falsificara
la firma no probaría nada; con este, el test de la credencial con firma
adulterada tiene valor real.

**Mutation testing.** Cuatro protecciones rotas a propósito. Las cuatro
cayeron. Una de ellas —hacer que el estado inválido filtre el contenido del
documento— necesitó dos intentos: la primera versión estaba mal escrita y no
filtraba nada, así que no probaba nada. Reescrita como la regresión que de
verdad ocurriría (alguien agrega el contenido "para dar mejor diagnóstico"),
cayó sola. Una mutación que no cambia el comportamiento no es evidencia.

📎 [evidencia/T11.md](evidencia/T11.md) · [apps/agent/README.md](../../apps/agent/README.md) · [DECISIONES.md](DECISIONES.md) (B-9 … B-12)

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
