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
