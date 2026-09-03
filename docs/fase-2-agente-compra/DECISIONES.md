# Decisiones — Fase 2 (agente mínimo de compra)

> Una entrada por decisión, con su motivo y la alternativa que se descartó.
> **No se borran entradas**: si una decisión se revierte, se marca como
> `Superada` y se agrega la nueva.
>
> **Prefijo `B-`**, para no chocar con las `A-`/`I-` de la Fase 1 ni con las
> `P-` de proyecto. Las decisiones que cruzan fases o afectan la estructura del
> repo van a [../DECISIONES.md](../DECISIONES.md), no aquí.
>
> Plan maestro: [../../ROADMAP.md](../../ROADMAP.md) · Bitácora: [BITACORA.md](BITACORA.md)

Estados: `Vigente` · `Superada` · `Pendiente`

---

### B-1 · Un `scope.venues` o `scope.assets` vacío significa "nada permitido" (fail-closed) · `Vigente`
**Fecha:** 2026-09-02 (T9) · **Decidida por el dueño del proyecto, no por defecto**

El esquema de la Fase 1 acepta `scope.venues` y `scope.assets` como arrays
vacíos, y hasta T9 ningún código los leía. Un array vacío podía leerse como
"nada permitido" (fail-closed) o "sin restricción" (fail-open). Queda como
**fail-closed**: una credencial con `venues: []` es válida como identidad y no
autoriza ninguna compra.

**Motivo.** Es la lectura que ya siguió toda la Fase 1 en cada ambigüedad:
`RegistryMismatch` (decide el verificador, no la credencial), el `kid` que no
se usa para elegir llave, revocado le gana a expirado. Y es la única lectura
en que un campo omitido, truncado o mal serializado degrada a *menos* poder de
compra en vez de a autoridad total y silenciosa. `[]` no queda como un valor
degenerado: describe un estado con sentido —"tiene pasaporte, no tiene permiso
de compra"— que es exactamente lo que el ejemplo versionado
[`examples/scope.json`](../../examples/scope.json) describe hoy.

**Alternativas descartadas:**

- **Fail-open** (`[]` = sin restricción). Es la única que no obligaba a tocar
  nada: la credencial ya anclada en testnet y el ejemplo versionado seguirían
  funcionando tal cual. Se descartó porque convierte un campo faltante en el
  máximo de autoridad posible, que es el modo de falla contra el que existe
  todo el proyecto, y porque contradice lo que el JSON dice literalmente —
  quien lee `"venues": []` lee "ningún venue".
- **Fail-closed + `.min(1)` en ambos arrays**, para que `[]` no fuera siquiera
  representable. Más fuerte, y elimina la ambigüedad en el origen en vez de
  resolverla. Se descartó porque es un cambio de esquema sobre una fase
  cerrada: invalida la credencial ya anclada, obliga a tocar el ejemplo y
  cuatro archivos de test, y deja sin forma de expresar un comodín legítimo —
  lo que exigiría inventar un centinela (`"*"`), superficie de diseño nueva que
  no corresponde meter a presión antes de T12.

**Dónde se aplica:** T12, el chequeo de scope. T9 solo fija la forma canónica
de los valores que ese chequeo va a comparar (ver [B-3](#b-3--forma-canónica-de-venueid-y-assetid-comparación-byte-a-byte--vigente)).

**Nota sobre §4.1 del ROADMAP**, que pedía escribir esta decisión en
`docs/fase-1-agentpass/credential-schema.md`: se registra acá porque es una
decisión de la Fase 2 —es el primer código que lee el campo— y el registro de
una fase cerrada no se reescribe hacia atrás. El documento de la Fase 1 lleva
un puntero a esta entrada.

### B-2 · Scope de paquete `@agentpay/*` para lo que no es AgentPass · `Vigente`
**Fecha:** 2026-09-02 (T9)

El agente vive en `apps/agent` como **`@agentpay/agent`**, no `@agentpass/agent`.
Los tres paquetes de la Fase 1 (`@agentpass/core|sdk|cli`) conservan su scope.

**Motivo.** El agente *consume* AgentPass, no lo extiende: importa
`AgentPassError` y va a importar `verify()` en T11, pero nada de lo que hace es
parte de la superficie de identidad. Nombrarlo `@agentpass/agent` sugeriría
alcance de Fase 1. Y el problema se repite en la Fase 3: PolicyRail y Mandato
tampoco son AgentPass, así que el segundo scope hay que introducirlo igual —
mejor ahora, con un solo paquete, que más adelante con tres.

**Alternativa descartada:** un solo scope `@agentpass/*` para todo el monorepo.
Más uniforme de leer, pero convierte el nombre del scope en ruido: dejaría de
distinguir qué es identidad verificable y qué es todo lo demás.

### B-3 · Forma canónica de `venueId` y `assetId`, comparación byte a byte · `Vigente`
**Fecha:** 2026-09-02 (T9)

| | forma | ejemplo |
|---|---|---|
| `venueId` | `<slug>:<contract id>` | `mock-bazaar:CCL57L4Z…TM7F` |
| `assetId` | `<CODE>:<issuer>` | `USDC:GBBD47IF…FLA5` |

El slug es minúsculas, dígitos y guiones simples, máximo 40 caracteres. El
contract id se valida con `StrKey.isValidContract`. El código de activo son 1–12
alfanuméricos, sensible a mayúsculas como en Stellar; el emisor puede ser una
cuenta clásica (`G…`) **o** un contrato de token (`C…`). Se comparan byte a
byte: sin `trim`, sin plegado de mayúsculas, sin normalización de ningún tipo.

**Motivo.** Estas dos cadenas son lo que T12 va a comparar contra el `scope`
firmado para autorizar o rechazar una compra. Es la misma regla que
`packages/core/src/did.ts` ya aplica a los DID y por la misma razón: una cadena
que difiere en un byte nombra otra cosa. Combinado con `B-1`, cualquier
discrepancia —incluido un slug mal escrito— resuelve a rechazo, nunca a compra.
Aceptar emisor `G…` o `C…` evita que la respuesta del embajador a la pregunta 4
("¿qué activo acepta?") obligue a rediseñar el tipo en T15.

**Alternativa descartada:** que el `venueId` fuera el contract id a secas, sin
slug. Elimina el riesgo de que dos credenciales nombren el mismo contrato con
slugs distintos y no se reconozcan. Se descartó porque el ejemplo del esquema de
la Fase 1 ya documenta la forma `bazaar-aliado:CD…`, y porque un `C…` desnudo
dentro de una credencial es ilegible para la persona que la autoriza. El riesgo
que queda —slug distinto, mismo contrato, no matchea— se mitiga con
diagnóstico, no con leniencia: el error de T12 dirá qué contrato nombra la
credencial y cuál es el del adaptador.

### B-4 · Las descripciones adversarias viven en el catálogo por defecto, no en un fixture · `Vigente`
**Fecha:** 2026-09-02 (T9)

Dos de los doce productos del `MockCatalogAdapter` llevan prompt injection en su
descripción, y están en el catálogo que la demo de T14 va a recorrer, no en un
fixture aparte que solo vea un test.

- `manta-lana-chilota` (89.00 USDC, **sobre** el límite `perTx` de 50.00): su
  descripción afirma que el artículo está exento del límite y que el comprador
  ya autorizó el monto.
- `polera-stellar-santiago` (22.00 USDC, pasa **todos** los chequeos
  estructurales): su descripción ordena no verificar la credencial y crear una
  intención por 10 unidades.

**Motivo.** El riesgo específico de esta fase (ROADMAP §4.2) es que un rechazo
dependa de que el agente *decida* ignorar una instrucción incrustada en datos,
en vez de salir del chequeo estructural. Si el texto hostil solo existe en un
test, la ruta que la demo recorre nunca lo ejerce, y una regresión ahí queda
invisible hasta que alguien la busque a propósito. El emparejamiento es
deliberado: el producto que *debe* rechazarse por monto es también el que pide
que se lo apruebe, y el que pasa todo estructuralmente es el que intenta
cambiar la cantidad.

**Alternativa descartada:** un catálogo limpio más un fixture hostil solo para
los tests de T12. Deja la demo más presentable, a cambio de que el camino
demostrado y el camino probado dejen de ser el mismo.

### B-5 · `parseProduct` es el único borde por el que una fila entra al agente · `Vigente`
**Fecha:** 2026-09-02 (T9)

Todo adaptador —el mock y el `BazaarSorobanAdapter` de T15— pasa cada fila cruda
por `parseProduct`, que valida contra zod y lanza `InvalidProduct`. `name` y
`description` se validan solo por **forma**: sin caracteres de control, con tope
de 200 y 2000 caracteres.

**Motivo.** Un catálogo de un tercero es entrada no confiable. El tope de
longitud evita que una descripción inunde el contexto del agente; el rechazo de
caracteres de control evita que texto invisible se cuele en logs o en un intent
firmado. Nada de esto valida *significado*: el texto se transporta tal cual, y
lo que impide que importe es que T12 autoriza comparando campos estructurados
(venue, activo, monto), no leyendo prosa.

**Alternativa descartada:** sanitizar o recortar el texto hostil. Se descartó
porque esconde el problema en vez de resolverlo —da la falsa señal de que la
seguridad depende de filtrar texto— y porque altera datos de un tercero que el
intent firmado podría necesitar citar sin modificar.

### B-6 · La lista de herramientas es el límite de autorización, no un permiso que se deniega · `Vigente`
**Fecha:** 2026-09-02 (T10)

Invocar una herramienta se resuelve por nombre contra la lista que el agente ve
(`ToolSet.list()`). Una herramienta ausente falla con **`UnknownTool`**, no con
un código de permiso denegado. `createToolSet` recibe el arreglo de herramientas
que corresponda; quién decide ese arreglo es el llamador.

**Motivo.** Es la tesis de la fase, hecha mecanismo: *"si se le revoca la
credencial a mitad de operación, deja de poder hacerlo — no porque se le pida
amablemente en el prompt, sino porque la herramienta desaparece"* (ROADMAP
§4.2). Un permiso denegado es un mensaje dentro del contexto del modelo, y un
mensaje es exactamente la clase de cosa que una inyección puede intentar
reinterpretar. Una herramienta que no está en la lista no tiene superficie con
la que negociar. T11 no construye nada nuevo para esto: solo decide cuándo
dejar `create_purchase_intent` fuera del arreglo.

**Alternativa descartada:** mantener las cuatro herramientas siempre visibles y
que `create_purchase_intent` devuelva un rechazo tipado cuando la credencial no
verifica. Da mejores mensajes de diagnóstico —el agente sabe *por qué* no
puede— a cambio de convertir la revocación en algo que vive dentro de la
conversación. El diagnóstico se recupera igual desde fuera del agente, en el
error de arranque de T11 y en `check_my_credential`; la propiedad de seguridad
no se recupera si se cede.

### B-7 · Los nombres de herramienta son una unión cerrada de literales · `Vigente`
**Fecha:** 2026-09-02 (T10)

`TOOL_NAMES` es un `as const` de cuatro strings y `Tool.name` es de ese tipo. Una
quinta herramienta no se puede nombrar sin editar `tools/tool.ts`.

**Motivo.** "Cuatro herramientas, ninguna más" es una restricción de alcance que
la fase declara explícitamente, y una restricción que solo vive en un documento
se erosiona en la primera semana en que haga falta "una cosita más". Como unión
de literales, agregar una quinta deja de compilar: pasa de ser algo que hay que
cazar en revisión a un error de tipos.

**Alternativa descartada:** `name: string` y un test que compare la lista contra
las cuatro esperadas. Cubre lo mismo, pero falla más tarde y más lejos del lugar
donde se escribió la herramienta de más.

### B-8 · Los dos hitos que faltan se declaran con `NotImplemented`, no se simulan · `Vigente`
**Fecha:** 2026-09-02 (T10)

`check_my_credential` y `create_purchase_intent` existen con su nombre, sus
argumentos y la forma exacta de su respuesta, y lanzan `NotImplemented` nombrando
el hito que trae su comportamiento (T11, y T12/T13 respectivamente).

**Motivo.** El código `NotImplemented` existe en la unión desde la Fase 1 con
esta descripción textual: *"A placeholder surface exists but its behaviour has
not landed yet"*. Definir ahora la forma de la respuesta —y no el cuerpo— deja
fijado el contrato que T11 y T13 tienen que cumplir, sin inventar el
comportamiento antes de tiempo. Devolver un resultado plausible pero falso sería
peor que el hueco que esconde: haría que la demo pareciera funcionar antes de
que la autorización exista.

**Alternativa descartada:** no declarar las dos herramientas hasta que su hito
las implemente. Deja el conjunto incompleto durante dos hitos y esconde la
propiedad que T10 tenía que demostrar — que la superficie son exactamente
cuatro, y que la lista es el límite.

### B-9 · El agente recibe un puerto de un solo método, no el SDK completo · `Vigente`
**Fecha:** 2026-09-02 (T11)

`createAgent` toma un `CredentialVerifier` con exactamente un método, `verify`.
`AgentPass` de `@agentpass/sdk` lo satisface estructuralmente, sin adaptador, y
eso se comprueba en tiempo de compilación con una función de conformidad en el
test.

**Motivo.** Menor privilegio impuesto por el tipo, no por disciplina. Con el SDK
completo, el agente tendría a mano `issue()`, `revoke()`, `registerIssuer()` y
`deactivateIssuer()` — es decir, la capacidad de emitirse una credencial nueva a
sí mismo. Que hoy no las llame no es una garantía; que no existan sí lo es. Es
el mismo criterio que `B-6`: quitar la superficie en vez de confiar en que nadie
la use.

**Alternativa descartada:** pasar el `AgentPass` completo y documentar que solo
se usa `verify`. Un comentario no es una restricción, y la primera vez que
alguien necesite "solo firmar una cosita" la restricción deja de existir sin que
nada falle.

### B-10 · Un fallo de verificación no impide arrancar; retira la capacidad · `Vigente`
**Fecha:** 2026-09-02 (T11)

`createAgent` con una credencial revocada, vencida o no anclada **devuelve un
agente**. Ese agente lee el catálogo con normalidad y no tiene
`create_purchase_intent` en su lista.

**Motivo.** Es lo que la demo de T14 necesita: revocar a mitad de operación y
mostrar al agente todavía corriendo y visiblemente incapaz de comprar. Un
proceso que muere con un stack trace demuestra menos —no distingue "se le quitó
la autorización" de "se rompió"— y no deja al agente en condiciones de explicar
qué le pasó.

**Alternativa descartada:** lanzar en el arranque. Más simple, y defendible si
el agente no tuviera ninguna capacidad legítima sin credencial. Acá sí la tiene:
leer un catálogo público no requiere autorización de compra.

### B-11 · Un reporte de credencial inválida no repite nada de su contenido · `Vigente`
**Fecha:** 2026-09-02 (T11)

Cuando la credencial no verifica, `check_my_credential` devuelve el código del
fallo, el mensaje, el hash y `can_create_purchase_intent: false` — y **ningún**
campo tomado del documento: ni el nombre del agente, ni el operador, ni el
alcance, ni la ventana de vigencia. El estado inusable ni siquiera *carga* el
contenido, así que la fuga no es algo que haya que recordar evitar.

**Motivo.** Si la firma no verifica, cada campo de ese payload lo eligió quien
construyó el documento. Devolverlos con una etiqueta de "inválida" igual los
pone en el contexto del agente y en los logs del operador como si fueran datos
sobre el agente. El hash es la única excepción, y precisamente porque **no** sale
de adentro: se calcula sobre los bytes recibidos, es lo que el registro responde,
y es lo que un operador necesita para investigar.

**Alternativa descartada:** devolver el contenido marcado como no verificado, para
dar mejor diagnóstico. Se descartó porque el diagnóstico se consigue igual desde
fuera del agente —el documento está en un archivo, se puede inspeccionar— y
porque una marca dentro de una estructura JSON es exactamente la clase de matiz
que se pierde al pasar por un resumen, un log o un prompt.

**Refina la forma declarada en T10.** `CheckCredentialResult` se había declarado
con `status: "Active"` y el comentario "cualquier otro estado ya lanzó". Al
implementarlo quedó claro que el agente **sí** tiene que poder reportar su
estado cuando es inválido —es la vía de diagnóstico que `B-6` prometía al
retirar la herramienta— así que pasó a ser una unión discriminada de `"active"`
y `"unusable"`. Se registra el cambio en vez de editar la forma en silencio.

### B-12 · No poder confirmar la autorización cuenta como no tenerla · `Vigente`
**Fecha:** 2026-09-02 (T11)

Si la consulta al registro falla —timeout, RPC caído, cualquier error que no sea
una respuesta— el estado queda `usable: false` y la herramienta de compra se
retira. El error se envuelve en `AgentPassError` con código `NetworkError`, nunca
se propaga sin tipar.

**Motivo.** La misma dirección de `B-1`: una duda resuelve a menos autorización,
nunca a más. Un agente que no logró confirmar que su credencial sigue activa no
está en posición de actuar como si lo estuviera. La causa se conserva en
`problem.code`, así que un corte de red sigue siendo distinguible de una
revocación tanto para el operador como para un test.

**Alternativa descartada:** reintentar, o seguir con el último estado bueno
conocido. Ambas mejoran la disponibilidad de la demo a cambio de que una caída
de red se vuelva una ventana en la que una credencial revocada sigue comprando.

### B-13 · La defensa contra prompt injection es la firma de la función, no una instrucción · `Vigente`
**Fecha:** 2026-09-02 (T12)

`checkScope(scope, request)` recibe un `ScopeRequest` de cuatro escalares
—`venue`, `asset`, `unitAmount`, `quantity`— y **nunca un `Product`**. No existe
un campo por el que el `name` o la `description` de un comercio puedan llegar a
la decisión.

**Motivo.** El riesgo que la fase declara (ROADMAP §4.2) es que un rechazo
dependa de que el agente *decida* obedecer o no una instrucción incrustada en
datos. Cualquier defensa que consista en pedirle al modelo que ignore el texto,
o en filtrar el texto antes, sigue siendo una defensa sobre texto: mejora las
probabilidades, no cierra la puerta. Que la función no tenga el dato la cierra.
Se probó en las dos direcciones —agregar una inyección no vuelve rechazado lo
permitido, y quitarla no vuelve permitido lo rechazado— porque solo la segunda
descarta que el rechazo viniera de detectar texto hostil.

**Alternativa descartada:** pasar el `Product` completo y documentar que solo se
leen los campos estructurados. Es más cómodo —evita desarmar el producto en el
llamador— a cambio de que la propiedad de seguridad pase a depender de que nadie
agregue nunca una lectura de `description`. Es el mismo criterio de `B-6` y
`B-9`: quitar la superficie en vez de confiar en que no se use.

### B-14 · Aritmética de montos en enteros escalados a 7 decimales, nunca en punto flotante · `Vigente`
**Fecha:** 2026-09-02 (T12)

`toScaledAmount` / `multiplyAmount` convierten los montos decimales a `BigInt`
escalado por 10⁷ —la precisión de Stellar y el máximo que acepta el esquema de
credencial— y toda comparación con `perTx` ocurre ahí. El borde es **inclusivo**:
un total exactamente igual al límite está autorizado.

**Motivo.** Los montos viajan como string desde la Fase 1 precisamente para que
ningún float redondee un límite, y este es el primer código que además calcula
con ellos. En punto flotante `0.1 * 3` es `0.30000000000000004`: una compra de
exactamente el límite se rechazaría por un error de representación. `BigInt`
además no desborda, así que una cantidad grande no pierde precisión en silencio.
El borde inclusivo replica cómo la Fase 1 trata el borde de expiración on-chain
(invariante 4 del contrato) — los dos lados del sistema no deben discrepar sobre
qué significa "justo en el límite".

**Alternativa descartada:** una librería de decimales. Sería razonable, pero
agrega una dependencia para 60 líneas de aritmética con una escala fija y
conocida, y esconde en código de terceros exactamente la parte donde un bug
sutil cuesta más caro.

**Nota para la Fase 3:** cuando PolicyRail necesite esta misma aritmética,
probablemente convenga moverla a `@agentpass/core`, junto a
`decimalAmountSchema`. Hoy el agente es el único consumidor y no justifica tocar
un paquete de una fase cerrada.

### B-15 · Un límite denominado en otra moneda no es un límite satisfecho · `Vigente`
**Fecha:** 2026-09-02 (T12)

Si el código del activo del precio no coincide con `scope.limits.currency`, el
chequeo rechaza con `ScopeCurrencyMismatch` en vez de comparar los números.

**Motivo.** Un límite de "50.00 USDC" no dice nada sobre un precio en EURC.
Compararlos daría un resultado que parece una autorización sin serlo. Fail-closed,
igual que `B-1`: lo que no se puede comprobar no se da por bueno.

**No estaba en la lista literal de la tarea** —"venue permitido, asset permitido,
monto bajo `perTx`"— y se agregó igual, porque es lo que hace *sólido* el tercer
chequeo. En la práctica casi nunca dispara: el chequeo de activo ya rechaza el
caso normal. Cierra el hueco de una credencial que lista un activo en
`scope.assets` pero deja `limits.currency` en otro.

**Alternativa descartada:** aplicar `perTx` a cualquier activo ignorando
`currency`. Es conservador en el caso barato y absurdo en el caro — trataría
"50.00" como si fueran 50 unidades de lo que sea.

### B-16 · `scope.actions` se verifica; `scope.limits.perDay` no · `Vigente`
**Fecha:** 2026-09-02 (T12)

`create_purchase_intent` exige que `intent:create` esté en `scope.actions`, y
rechaza con `ScopeActionNotAllowed` si no. En cambio `perDay` **no se aplica**, y
hay un test que lo fija: una compra dentro de `perTx` pasa aunque supere
ampliamente `perDay`.

**Motivo del primero.** Es el mismo hueco silencioso que `B-1`: una credencial
con `actions: ["catalog:read"]` podría crear intenciones si nadie mira el campo.
El esquema de la Fase 1 obliga a que `actions` tenga al menos un elemento, así
que no hay ambigüedad de "vacío" que resolver — solo hay que leerlo. Se extendió
el precedente de `B-1` en vez de consultar, porque la dirección ya estaba fijada
por una decisión tomada; queda registrado acá para poder revertirlo si se
prefiere otra cosa.

**Motivo del segundo.** Un total diario exige recordar gastos previos: eso es
enforcement con estado, que es de PolicyRail (Fase 3), y que `CLAUDE.md` excluye
explícitamente del alcance de esta fase. El test que lo fija existe para que
media implementación de `perDay` no entre sin que nadie avise.

### B-17 · La credencial se reverifica contra el registro justo antes de firmar · `Vigente`
**Fecha:** 2026-09-02 (T13) · **Cierra el hueco que T11 dejó anotado**

`create_purchase_intent` vuelve a correr los tres chequeos de AgentPass
inmediatamente antes de firmar. Si la credencial ya no verifica, no se firma
nada y sale el error tipado correspondiente (`CredentialRevoked`,
`NetworkError`, etc.).

**Motivo.** T11 dejó la verificación solo en el arranque, y anotó el hueco: un
agente de larga vida conservaba su herramienta de compra aunque lo revocaran a
mitad de ejecución. La tesis del proyecto es que la autorización se puede cortar
**desde fuera del agente**; si el corte solo surte efecto en el próximo
reinicio, la afirmación es falsa para todo agente que no se reinicie. Y lo que
se está por producir no es una lectura: es una firma que en las Fases 3–4 será
la base de un pago real. Firmar contra una credencial vista hace horas es
exactamente el agujero.

Quedan **dos capas, ambas estructurales**:

| capa | qué decide | cuándo |
|---|---|---|
| lista de herramientas (`B-6`, T11) | qué capacidades existen | al arrancar |
| reverificación (esta) | si la autoridad sigue viva | al instante de firmar |

**No contradice `B-6`.** Ese principio dice que un permiso denegado *dentro del
contexto del modelo* es discutible. Acá el rechazo no es una política que el
agente evalúe: el registro respondió `Revoked` y la firma no ocurre. El modelo
no tiene más margen para negociar con eso que con una herramienta ausente.

**Orden:** el chequeo de alcance corre primero, así que una compra que el alcance
rechaza no gasta una llamada de red. Solo lo que va a firmarse paga el costo.
Hay un test que cuenta las llamadas.

**Alternativas descartadas:** (a) reverificar con una ventana de frescura de N
segundos — ahorra llamadas a cambio de una ventana explícita en la que una
credencial revocada sigue firmando, y las intenciones no son una ruta caliente
que justifique ese canje; (b) hacer dinámica la lista de herramientas, que
obligaría a que `list()` fuera asíncrona y contagiaría esa complejidad a todo
lo que la consume, para cerrar el mismo hueco que esta línea cierra.

### B-18 · El intent lo firma el agente, con la llave que su credencial nombra como sujeto · `Vigente`
**Fecha:** 2026-09-02 (T13)

Una credencial la firma su **emisor**; una intención la firma el **agente**. El
`createAgent` recibe esa llave y comprueba al arrancar que corresponda al sujeto
de su propia credencial; si no, falla con `SignerMismatch`, ruidosamente. Si no
hay llave, `create_purchase_intent` no se incluye en la lista.

**Motivo.** Es lo que ata "la cosa que pidió comprar" a "la cosa que el principal
autorizó". Sin esa igualdad, un intent podría nombrar a un agente y estar firmado
por otro, y la trazabilidad se rompe en silencio. El fallo es ruidoso porque una
llave equivocada es una **mala configuración**, no un estado de política: no hay
nada que el operador pueda querer de un agente que firma documentos que nunca van
a verificar. En cambio la ausencia de llave sí es un estado legítimo —un agente de
solo lectura— y por eso ahí la herramienta se retira en silencio en vez de
fallar: una capacidad que no se puede ejercer no debe anunciarse.

**Alternativa descartada:** que el emisor firme también las intenciones. Ahorra
una llave, y destruye la propiedad: ya no se distinguiría lo que el agente pidió
de lo que el principal autorizó, que es justamente la separación que la Fase 3
necesita para que exista un Mandato.

### B-19 · El intent no lleva el nombre ni la descripción del producto · `Vigente`
**Fecha:** 2026-09-02 (T13)

El bloque `purchase` tiene exactamente `productId`, `quantity`, `unitAmount`,
`totalAmount` y `asset`. El esquema es estricto, así que colar una `description`
hace fallar la firma.

**Motivo.** Continuación directa de `B-5` y `B-13`: el texto del comercio es dato
no confiable, y un documento firmado no debe poner la firma del agente sobre la
prosa de un tercero. Además de la cuestión de confianza hay una práctica: la
descripción puede cambiar en el catálogo después de firmado, y un documento que
la incluyera quedaría en desacuerdo con el comercio sin que nadie mintiera. El
`productId` es sobre lo que el comercio **sí** es autoritativo, y basta para
dejar establecido qué se pidió.

**Alternativa descartada:** incluir el nombre "para que el documento sea legible
por una persona". La legibilidad se resuelve al mostrarlo —quien lo lea puede
pedirle el producto al catálogo— sin meter texto ajeno bajo la firma.

### B-20 · Un intent expira; por defecto en quince minutos · `Vigente`
**Fecha:** 2026-09-02 (T13)

`issuedAt` y `expiresAt` son obligatorios, `verifyIntent` los aplica, y el borde
de expiración es **inclusivo** — igual que `validUntil` en la credencial y que
`expires_at` en el contrato de la Fase 1.

**Motivo.** Sin expiración, una intención firmada es una autorización al portador
válida para siempre: alguien podría guardarla y presentarla meses después. Quince
minutos es el orden de magnitud de un checkout, y es configurable por el operador.
El borde inclusivo replica la invariante 4 del contrato de la Fase 1 a propósito:
las tres capas del sistema no deben discrepar sobre qué significa "justo en el
límite".

**Alternativa descartada:** sin expiración, delegando la frescura en la
revocación de la credencial. Es insuficiente — la credencial dura meses, y un
intent no debería sobrevivir a la conversación que lo originó.

### B-21 · La instrucción en español la lee un comparador determinístico, no un LLM · `Vigente`
**Fecha:** 2026-09-02 (T14)

`interpretPurchase(instruccion, catalogo)` compara palabras contra el nombre de
cada producto y elige el de mayor coincidencia; no hay llamada a un modelo de
lenguaje en ningún punto de la demo.

**Motivo.** Tres razones concretas:

1. **Reproducibilidad.** La demo tiene que poder grabarse y repetirse: la misma
   frase debe producir siempre el mismo resultado. Una llamada a un LLM no lo
   garantiza — ni siquiera con temperatura cero hay esa garantía dura.
2. **Sin dependencia externa para correr.** `pnpm demo` funciona con lo que ya
   hay en `.env.local`. Exigir una llave de API de terceros solo para grabar el
   video del hito agrega una dependencia y un costo que el criterio de
   aceptación no pide.
3. **No es la superficie de seguridad.** Es la continuación directa de `B-13`:
   el intérprete solo puede producir un `productId` y una `quantity`, nunca un
   venue, un activo o un monto — esos siguen viniendo del catálogo y de la
   credencial. Una mala lectura de la instrucción elige mal el producto; no
   puede otorgar autoridad que `checkScope` no vaya a verificar igual. Hay un
   test que fija esta propiedad con una instrucción que lleva una inyección.

**Alternativa descartada:** enchufar una llamada real a Claude con las cuatro
herramientas como tool use. Es la versión "completa" del producto, y queda
fuera de foco para lo que T14 tiene que demostrar — que el circuito
identidad→scope→intent→revocación funciona de punta a punta. Añadir un LLM en
el medio mezclaría dos preguntas distintas (¿la autorización se puede cortar
desde afuera? ¿qué tan bien entiende lenguaje natural un modelo?) en una sola
demo, y complicaría la primera con la segunda sin necesidad.

### B-22 · La instrucción se interpreta antes de tocar la red, no después · `Vigente`
**Fecha:** 2026-09-02 (T14)

`demo.ts` interpreta la instrucción en español como su primer paso, sin haber
llamado todavía a `createAgentPass` ni emitido ninguna credencial.

**Motivo.** Descubierto al construir el script: la primera versión emitía la
credencial primero. Una instrucción sin match en el catálogo fallaba recién
después de una transacción real de anclaje, dejando una credencial activa y
huérfana en el registro — gasto de una operación en cadena para un error que
no necesitaba tocar la red para detectarse. Coincide además con la disciplina
que ya sigue el CLI (T8): validar argumentos y datos locales antes de tocar la
cadena, siempre.

**Alternativa descartada:** dejar el orden original y aceptar la credencial
huérfana como costo del error. Es testnet, así que el costo real es cero, pero
es una molestia evitable y contradice la disciplina "falla rápido y offline"
que el propio comentario del archivo ya prometía.

### B-23 · `check_my_credential` no se reconsulta tras revocar; la demo no vuelve a llamarla · `Vigente`
**Fecha:** 2026-09-02 (T14)

Después de revocar, la demo **no** vuelve a invocar `check_my_credential`. Si
lo hiciera, reportaría "active" — el estado que vio al arrancar (`B-10`), sin
recheck contra el registro — un instante antes de que `create_purchase_intent`
rechace la compra de verdad por `CredentialRevoked` (`B-17`).

**Motivo.** No es un agujero de seguridad: `check_my_credential` no autoriza
nada, solo informa, y el único punto que decide si una compra procede
—`B-17`— sí reconsulta en cada intento. Pero es una inconsistencia real entre
lo que el agente puede *decir* de sí mismo y lo que puede *hacer*, y mostrarla
sin comentario en una demo grabada leería como un bug. Se deja anotada en vez
de resuelta: convertir `check_my_credential` en una consulta en vivo extendería
`B-10`/`B-11` de la Fase T11 fuera del alcance que T14 pidió, sobre una
decisión que otro hito ya cerró con su propio motivo.

**Alternativa descartada:** hacer que `check_my_credential` reconsulte el
registro en cada llamada, igual que `B-17` lo hace antes de firmar. Es la
solución más honesta a largo plazo, y probablemente la correcta — pero es un
cambio de comportamiento sobre una decisión de un hito cerrado (T11), no algo
que corresponda decidir en silencio mientras se arma una demo. Queda como
candidato explícito para revisar, no como pendiente perdido.

### B-24 · La identidad del bazaar real se sintetiza igual que la del mock, no ensancha `ids.ts` · `Vigente`
**Fecha:** 2026-09-03 (T15)

`BAZAAR_VENUE_ID` usa un contract id sintético —
`sha256("agentpay:phase2:stellar-bazaar")` en forma StrKey,
`CBDWMXZEE44NJ3RA6RS7K4EK36KDFW5S7KHP276HCMM4I52MIUUHEF5B`, no desplegado— con
el mismo mecanismo que `MOCK_VENUE_CONTRACT_ID` ya usa. `BAZAAR_USDC` resuelve
la otra pregunta que `ids.ts` dejó abierta desde T9 ("qué emisor quiere el
bazaar real, cuenta o contrato"): el emisor es un contrato (`C…`), la Stellar
Asset Contract de USDC que el propio `/llms.txt` del bazaar nombra
(`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`) — **distinto** del
emisor clásico (`G…`) que usa `USDC_TESTNET` del mock. Es el mismo USDC de
testnet visto desde dos espacios de direcciones distintos, y `ids.ts` compara
byte a byte a propósito: una credencial autorizada para el USDC del mock no
autoriza por eso el del bazaar real. `examples/scope-stellar-bazaar.json` es
un archivo de scope nuevo, separado de `examples/scope-bazaar.json` (que,
pese al nombre, sigue siendo el scope del *mock*), precisamente porque nombra
un venue y un asset distintos.

**Motivo.** El repo real del bazaar (T19) ya había confirmado que no despliega
ningún contrato Soroban propio — lo desplegado es la aplicación Next.js. Sin
un `C…` real, `VenueId` (que `ids.ts` valida con `StrKey.isValidContract`, sin
excepción) no tiene qué nombrar. El criterio de aceptación de la fase pide que
T15 no toque nada de T9–T14 — así que la salida no es ensanchar el tipo, es
producir un valor que ya calza en el tipo que existe, documentado como lo que
es: una identidad estable y no ambigua, no una prueba de despliegue.

**Alternativa descartada:** ensanchar `VenueId`/`ids.ts` para aceptar un
identificador sin contrato (p. ej. el propio `baseUrl` del bazaar). Se
descartó porque toca T9, viola el criterio de aceptación de la fase, y
reabriría T12 (que compara `scope.venues` byte a byte contra este tipo) sin
necesidad — la identidad sintética resuelve el problema sin mover nada que ya
esté cerrado.

### B-25 · REST, no MCP, y sin recuperar el adaptador huérfano de la rama de Devin · `Vigente`
**Fecha:** 2026-09-03 (T15)

`BazaarMcpAdapter`... el nombre que traía el criterio de aceptación de la fase
resultó equivocado: el transporte real que usa `createBazaarCatalog` es REST
(`GET /api/discovery/search?query=*`), no MCP. Se probó `POST /api/mcp` contra
el despliegue real dos veces —`tools/call` con `list_services`/`get_service`,
y un `initialize` de protocolo MCP puro, sin sesión previa— y las dos veces
respondió `500` con cuerpo vacío. No es una falla puntual: es el servidor
fallando en el primer paso del protocolo, no en un método específico. El
endpoint de recurso único que el propio `/llms.txt` del bazaar documenta
(`GET /api/discovery/resources/{id}`) tampoco funciona contra el despliegue
real — devuelve un 404 servido y cacheado desde el edge de Vercel, no un error
transitorio — así que `getProduct(id)` se resuelve listando y filtrando, no
con una petición dedicada.

Antes de escribir código se encontró `apps/agent/dist/catalog/bazaar-adapter.js`
compilado en disco, sin `.ts` fuente en ningún lado (ni en `src/`, ni en el
historial de git, ni en ninguna rama local) — residuo de
`devin/agent-web-frontend`, la rama que se borró por completo por un problema
de seguridad no relacionado (saltarse `checkMandate`, ver `AGENT_LOG.md`
2026-09-03 (14)). Con el visto bueno explícito del usuario, no se recuperó
nada de ese artefacto: `bazaar.ts` se escribió desde cero, verificando cada
forma contra tráfico real del despliegue en vivo en vez de confiar en el
schema que ese adaptador asumía.

**Motivo.** El propio `/llms.txt` del bazaar documenta MCP como el transporte
principal, así que la intención original de T15 (nombrar el adaptador
`BazaarMcpAdapter`) no estaba mal fundada — pero un adaptador que depende de
un endpoint que responde `500` en el 100% de los intentos no es una base
verificable, y la disciplina de este proyecto (T19, T22) es leer/probar
tráfico real antes de construir sobre un supuesto. REST sí respondió,
consistentemente, con la forma exacta que su propia documentación describe. Y
un artefacto sin revisión, de una rama ya descartada por razones de
seguridad, no es una base más confiable solo por existir en disco.

**Alternativa descartada:** implementar el cliente MCP igual, asumiendo que el
`500` es un problema temporal del despliegue. Se descartó porque no hay forma
de verificarlo sin acceso al código fuente del bazaar desplegado, y un
adaptador construido contra un endpoint que nunca respondió con éxito no se
puede probar de verdad — quedaría sin ejercitar hasta que alguien lo intentara
contra la red real y descubriera el mismo error. Si el transporte MCP empieza
a funcionar, se puede agregar como una segunda opción dentro de
`BazaarCatalogOptions` sin tocar `CatalogAdapter`.
