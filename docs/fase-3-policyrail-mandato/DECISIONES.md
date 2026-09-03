# Decisiones — Fase 3 (PolicyRail + Mandato)

> Una entrada por decisión, con su motivo y la alternativa que se descartó.
> **No se borran entradas**: si una decisión se revierte, se marca como
> `Superada` y se agrega la nueva.
>
> **Prefijo `M-`**, para no chocar con `A-`/`I-` (Fase 1), `B-` (Fase 2) ni
> `P-` (proyecto, en [../DECISIONES.md](../DECISIONES.md)).

Estados: `Vigente` · `Superada` · `Pendiente` · `Supuesto`

---

### M-1 · Se asume la respuesta a la pregunta 6 del embajador, y se asume explícitamente · `Superada`
**Fecha:** 2026-09-02 · **Hito:** T16 · **Superada el 2026-09-03 (T19)** por `M-11` y `M-12`

> **Por qué quedó superada.** No porque resultara falsa, sino porque la
> pregunta que asumía dejó de ser la pregunta. Al leerse el repo real del
> bazaar (`github.com/CaBsCrypto/stellar-bazaar-x402`, público, Apache-2.0) se
> confirmó que **no existe contrato de compra desplegado**: el flujo real es
> x402 sobre HTTP, y quien construye y envía la transacción es un *facilitator*
> de terceros. El razonamiento de abajo —"un `buy(buyer: Address)` con
> `buyer.require_auth()` acepta `C...` sin hacer nada especial"— sigue siendo
> cierto de Soroban y del token SEP-41, pero ya no describe ningún eslabón que
> este proyecto tenga que atravesar. Ver `M-11` (lo que esto habilita) y `M-12`
> (a quién se le corrió la pregunta 6).


Se avanza asumiendo que el bazaar del embajador está escrito **de la forma
estándar de Soroban**, y por lo tanto que **el comprador puede ser una cuenta de
contrato (`C...`)**. Es una decisión del usuario, tomada a sabiendas de que la
respuesta real no llegó.

**Motivo.** En Soroban, `Address` no distingue entre una cuenta clásica y una
cuenta de contrato. El patrón estándar de un contrato de compra —
`fn buy(buyer: Address, …)` seguido de `buyer.require_auth()`— acepta las dos
sin que el contrato haga nada especial. La documentación oficial lo dice
directamente:

> "A contract that implements the CustomAccountInterface and `__check_auth`
> becomes a contract account. If any contract calls `require_auth` for the
> Address of this contract, the Soroban host will call `__check_auth`"
> — [Authorization § Contract Account](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization#contract-account)

La misma página describe, como ejemplo canónico de `__check_auth`, exactamente
lo que PolicyRail necesita: *"customizable rules […] to allow spending more than
X units of token Y only given signature weight Z"*.

Es decir: la pregunta 6 se responde sola **si** el bazaar es estándar. Solo se
responde "solo `G...`" si el bazaar se salió del patrón.

**Lo que este supuesto cuesta si resulta falso.** Únicamente el trabajo del
smart account. Por eso el desglose de tareas separa lo que depende del supuesto
(un solo hito, al final) de lo que no (todo el resto). Si el embajador contesta
"solo `G...`", el camino off-chain ya está construido y funcionando.

**Lo que este supuesto NO autoriza.** No se asume nada sobre las otras nueve
preguntas. No se asume que el bazaar exista, ni su API, ni su catálogo. T15
sigue bloqueado igual.

**Alternativa descartada:** esperar la respuesta antes de tocar código. Habría
sido lo más seguro en términos de diseño, pero congela una fase entera por una
respuesta que este repo no controla, y el costo de recibirla tarde crece con
cada pieza que la espera.

**No se encontró** ningún requisito de Stellar Community Fund que hable del tipo
de cuenta del comprador. La justificación de arriba se apoya en el modelo de
autorización de Soroban, no en un requisito de SCF.

---

### M-2 · El Mandato vive en un paquete propio, `@agentpay/mandate` · `Vigente`
**Fecha:** 2026-09-02 · **Hito:** T16

El documento y su firma viven en `packages/mandate`, publicado como
`@agentpay/mandate`, no dentro de `@agentpass/core` ni de `apps/agent`.

**Motivo.** Es la misma lógica de `B-2`: el Mandato **consume** AgentPass, no lo
extiende. `@agentpass/core` sigue siendo la capa de identidad de la Fase 1, y
una fase cerrada no empieza a cargar documentos de fases posteriores. El scope
`@agentpay/*` ya agrupa a los consumidores (`@agentpay/agent`).

Y una razón que descarta la tercera opción por sí sola: **el Mandato lo firma el
principal, no el agente.** Meterlo dentro del paquete del agente invertiría
justamente la relación que la fase intenta probar.

**Alternativa descartada:** `@agentpass/core`. Habría evitado un paquete nuevo y
dejado la maquinaria VC-JWT al lado de lo que reutiliza — pero a costa de que
`core` deje de significar "identidad de la Fase 1".

---

### M-3 · El Mandato es revocable desde afuera, reusando `agent_registry` sin tocarlo · `Vigente`
**Fecha:** 2026-09-02 · **Hito:** T16 (la forma) · T20 (el anclaje)

El principal ancla `sha256(mandate JWS)` con el `anchor()` del contrato de la
Fase 1 y lo corta con `revoke()`. No hay contrato nuevo ni cambio al existente.

**Motivo.** La superficie del contrato encaja sin sobrar nada:

| `anchor(issuer, cred_hash, subject, expires_at)` | el Mandato |
|---|---|
| `issuer` | `issuer` — el principal |
| `cred_hash` | `sha256(jws)` |
| `subject` | `credentialSubject.id` — el agente |
| `expires_at` | `validUntil` |

Y la tesis del proyecto —*la autorización se corta desde fuera del agente*—
debería aplicar al consentimiento igual que a la identidad. Un consentimiento
que no se puede retirar es más débil que la credencial que ya existe.

Por eso el documento conserva la forma de sobre W3C VC 2.0 de la Fase 1 y el
nombre de propiedad `credentialStatus`: no es imitación, es lo que hace que el
mapeo de arriba no tenga huecos.

**Costo conocido:** el principal tiene que estar registrado como emisor en el
registro. Hoy, en la demo, principal y emisor son la misma llave, así que no
cambia nada; cuando dejen de serlo, hay que registrarlo. Queda anotado como lo
primero a resolver en T20.

**Alternativas descartadas:** (a) solo ventana temporal, sin anclaje —
consentimiento no retirable; (b) un contrato `mandate_registry` nuevo — semántica
propia para mandatos, pero es un contrato Soroban más desplegado y mantenido, y
probablemente trabajo de la Fase 4, no de esta.

---

### M-4 · Dos límites, y gana el más estricto · `Vigente`
**Fecha:** 2026-09-02 · **Hito:** T16 (la decisión) · T17 (la implementación)

Un intent queda bajo dos autoridades: `scope.limits` de la credencial (lo que su
emisor firmó) y el `grant.limits` del Mandato (lo que el principal consintió).
**Ambos chequeos corren y los dos tienen que permitir.** `checkScope()` de la
Fase 2 no se toca; `checkMandate()` se suma.

**Motivo.** Es `B-1` aplicado a dos fuentes en vez de a una lista vacía: dos
autoridades que no coinciden nunca amplían permisos, solo los reducen. Con la
regla contraria, un mandato podría autorizar más de lo que el emisor de la
credencial firmó — el principal podría excederse de su propia credencial, y la
credencial dejaría de ser un límite.

Por eso `mandateGrantSchema` **es** `scopeSchema`, reusado tal cual: la
comparación solo es significativa —y solo es type-safe— si las dos cosas tienen
la misma forma.

**Alternativa descartada:** que el Mandato sustituya a `scope.limits`. Una sola
fuente de verdad es más simple de explicar, pero abre exactamente el agujero de
arriba.

---

### M-5 · La maquinaria JWS se generaliza en `core`, sin reescribir las fases cerradas · `Vigente`
**Fecha:** 2026-09-02 · **Hito:** T16

Se agregó `packages/core/src/jws-document.ts` — `signJwsDocument` /
`verifyJwsDocument`, parametrizados por un `JwsDocumentProfile`. El Mandato lo
usa. `vc-jwt.ts` (Fase 1) y `apps/agent/src/intent/sign.ts` (Fase 2)
**no se reescribieron** para usarlo.

**Motivo.** La Fase 1 estableció el patrón para credenciales y la Fase 2 lo
reaplicó a mano para intents. El Mandato sería la tercera copia de ~150 líneas
donde vive la regla más delicada del proyecto (`kid` nunca elige la llave):
tres copias de eso es tres lugares donde puede divergir. Generalizarlo es
aditivo y no toca nada existente.

Reescribir las otras dos **sí** las tocaría, y son fases cerradas con su propia
evidencia y sus propios mutation tests. Unificar las tres es una propuesta
razonable — **pendiente, no ejecutada**, y no algo para hacer de pasada dentro
de otro hito.

**Costo conocido y aceptado:** por un tiempo, `core` tiene dos maneras de firmar
un documento. Es feo y está documentado; la alternativa era peor.

**Alternativa descartada:** una tercera copia dentro de `@agentpay/mandate`.
Cero riesgo para las fases cerradas, pero multiplica por tres el lugar donde
puede aparecer una regla de verificación sutilmente distinta.

---

### M-6 · El Mandato lleva `mandateId`; la credencial de la Fase 1 no lleva nada equivalente · `Vigente`
**Fecha:** 2026-09-02 · **Hito:** T16

Cada mandato lleva un `mandateId` (uuid). La credencial de la Fase 1 no tiene
campo análogo.

**Motivo.** No es simetría rota por descuido: es una consecuencia directa de la
**invariante 1 del contrato** (re-anclar un hash ya existente se rechaza, para
que un emisor no pueda resetear a `Active` algo ya revocado). Dos mandatos
idénticos en todo lo demás —mismo agente, mismo grant, misma ventana— serían
byte a byte iguales, colisionarían en `sha256(jws)`, y el segundo **nunca podría
anclarse**. Con las credenciales el caso es menos probable porque las ventanas
temporales suelen diferir, pero un mandato re-emitido tras una revocación es
justamente el caso donde todo lo demás sí coincide.

Hay un test que lo fija: dos mandatos construidos con los mismos argumentos
tienen hashes distintos.

**Alternativa descartada:** derivar unicidad de `validFrom` con precisión de
milisegundos. Funciona por accidente hasta que dos llamadas caen en el mismo
milisegundo, y hace que la corrección dependa de la resolución del reloj.

---

### M-7 · `validUntil` es obligatorio en un Mandato · `Vigente`
**Fecha:** 2026-09-02 · **Hito:** T16

`createMandate()` no tiene valor por defecto para `validUntil`, y no se puede
omitir.

**Motivo.** Un consentimiento sin fecha de término es una autorización
permanente, que es exactamente lo que esta fase existe para evitar. Un valor por
defecto —aunque fuera corto— convertiría esa decisión en algo que se toma por
no escribir nada. `validFrom` sí tiene default (`now`), porque "desde ahora" es
la única lectura razonable de su ausencia.

**Alternativa descartada:** un TTL por defecto, como el de quince minutos del
intent (`B-20`). Un intent es una acción puntual y su TTL corto es una
protección; un mandato es una autorización sostenida, y elegir por el principal
cuánto dura su propio consentimiento no le corresponde al código.

---

### M-8 · `checkMandate()` compara el `issuedAt` del intent contra la ventana del mandato · `Vigente`
**Fecha:** 2026-09-03 · **Hito:** T17

Además de los cinco chequeos que `checkMandate()` hereda casi al pie de la
letra de `checkScope()` (acción, venue, asset, moneda, monto), se agregó uno
que no tiene equivalente en la Fase 2: si `intent.issuedAt` cae fuera de
`[mandate.validFrom, mandate.validUntil]`, la compra se rechaza con
`MandateWindowMismatch`, aunque todo lo demás coincida.

**Motivo.** `checkMandate` es una función pura, sin reloj inyectado — a
diferencia de `verifyMandate()` (T16), que sí recibe un `now` porque su trabajo
es decir si el documento es válido *en este instante*. Para comparar un
documento contra otro, la instancia de tiempo correcta no es "ahora": es el
momento que el propio intent declara como el suyo, `issuedAt`. Eso mantiene la
función determinista (mismos dos documentos, siempre la misma decisión, sin
importar cuándo se ejecute el código) y cierra un caso real: un mandato
verificado como vigente por un llamador con un reloj mal puesto, o una
reconstrucción posterior de la decisión con fines de auditoría, no puede
autorizar retroactivamente una compra que en su momento cayó fuera de ventana.

Ambos bordes son inclusivos, siguiendo la misma convención que `validUntil` en
la Fase 1, el `expires_at` del contrato, y la propia ventana del mandato en
`verifyMandate()`.

**Alternativa descartada:** que `checkMandate` reciba `now` y compare contra
eso, delegando en el llamador la responsabilidad de ya haber verificado ambos
documentos por separado. Se descartó porque duplicaría una responsabilidad que
`verifyMandate()` y `verifyIntent()` ya tienen cada uno la suya, y porque
introduciría no-determinismo en una función que el resto del código —y
cualquier auditoría futura de MandateVault, Fase 5— necesita que sea
repetible.

---

### M-9 · Los códigos de error de `checkMandate()` son propios, no reutilizan los de `checkScope()` · `Vigente`
**Fecha:** 2026-09-03 · **Hito:** T17

Aunque el `grant` del mandato y el `scope` de la credencial comparten forma
(`M-4`), sus chequeos producen códigos distintos:
`ScopeVenueNotAllowed`/`MandateVenueNotAllowed`, y así con cada uno.

**Motivo.** Bajo `M-4` un intent tiene que satisfacer **dos** autoridades. Si
las dos usaran el mismo código de error, un log o un test no podría distinguir
cuál de las dos lo rechazó — una ambigüedad que le costaría exactamente a la
persona que más la necesita: quien audite después por qué una compra no se
autorizó. Ocho códigos nuevos son más verbosos que reutilizar cinco, pero la
alternativa escondía información en el nombre del error en vez de mostrarla.

**Alternativa descartada:** un único código genérico como `PolicyDenied` con
`details.authority: "scope" | "mandate"`. Habría sido menos código en
`errors.ts`, pero movería la distinción del tipo del error a un campo de
`details` que un llamador podría olvidar leer — el mismo motivo por el que el
proyecto ya prefiere `code` sobre inspeccionar `message`.

---

### M-10 · `SpendLedger` separa consultar de registrar; la atomicidad entre las dos queda para T19 · `Vigente`
**Fecha:** 2026-09-03 · **Hito:** T18

`SpendLedger` expone `spentOn()` (consulta) y `record()` (escritura) como dos
operaciones separadas, no una sola que compare-y-registre atómicamente. Quien
compone las dos —consultar, decidir con `checkDailyLimit()`, y solo si
permite, registrar— es responsabilidad de quien orqueste el flujo completo:
T19 (`PolicyRail`) y, más tarde, T21.

**Motivo.** Es el mismo patrón de separación que ya rige `checkScope()` y
`checkMandate()`: una función pura que decide, y un puerto de I/O aparte del
que esa decisión depende, nunca los dos fundidos en una sola pieza. Fundir
consulta y escritura en una operación atómica hoy —antes de saber si el
enforcement real corre off-chain o on-chain (`M-1`)— fijaría una forma de
concurrencia (una promesa que se resuelve una sola vez, en un solo proceso)
que puede no ser la correcta para ninguno de los dos caminos: un middleware
off-chain con más de una instancia necesita un lock o una transacción de base
de datos; un *smart account* on-chain resuelve la atomicidad con la propia
transacción de Soroban, gratis, sin que este código tenga que hacer nada.

**Riesgo conocido y aceptado, explícitamente, hasta T19.** Dos llamadas
concurrentes a `checkDailyLimit()` con la misma consulta desactualizada de
`spentOn()` podrían las dos "ver" espacio para gastar y las dos aprobar, y
juntas exceder `perDay` — un TOCTOU clásico. En esta fase, con un único
proceso Node.js orquestando todo secuencialmente (igual que la Fase 2), el
riesgo real es nulo; se vuelve real recién si T19 introduce paralelismo real,
momento en el que hay que resolverlo ahí, no fingir haberlo resuelto acá.

**Alternativa descartada:** un método único `tryRecord(entry, perDay):
Promise<DailyLimitDecision>` en el propio `SpendLedger`, atómico por
construcción. Se descartó porque mezclaría la decisión pura (`checkDailyLimit`,
que no debería tener que conocer nada de almacenamiento) con el puerto de I/O
dentro de la misma interfaz — exactamente la fusión que el resto del proyecto
evita a propósito — y porque comprometería a una forma de atomicidad antes de
que T19 decida dónde vive el enforcement real.

---

### M-11 · PolicyRail off-chain no depende del bazaar: el protocolo ya reserva el lugar · `Vigente`
**Fecha:** 2026-09-03 · **Hito:** T19

El enforcement off-chain de PolicyRail **no necesita ningún hook, permiso ni
cambio del lado del embajador**. El propio protocolo del bazaar define un paso
que es del comprador, y ese paso es exactamente donde vive `authorise()`.

**Motivo.** No es una interpretación optimista; está escrito en su repo. La
máquina de estados de `docs/BUYER_PROVIDER_PAYMENT_FLOW.md` tiene siete
estados, y el cuarto es:

| State | Primary actor | Observable contract |
|---|---|---|
| **Buyer policy authorization** | **Buyer** | **Independent allowlist, budget and card reconciliation** |

Y el README lo dice sin rodeos: *"The buyer owns policy approval. A UI
selection is not cryptographic authorization."* La frontera no custodial es una
propiedad que ellos publicitan, no una concesión que haya que negociar: el
bazaar no firma por el comprador y nunca ve quién es el comprador.

"Allowlist, presupuesto y reconciliación de la card" es, palabra por palabra,
lo que `checkScope` + `checkDailyLimit` + la reconciliación de términos
(`M-14`) ya hacen. Su propio cliente tiene un juguete en ese lugar —
`BazaarAgentClient.validatePaymentPolicy()`, con `maxPriceAllowedUsdc`,
`allowedNetworks` y `allowedAssets` pasados al constructor. La diferencia con
AgentPay es exactamente la tesis del proyecto: allá los límites son constantes
de un objeto que el proceso del agente puede reescribir; acá vienen de un
documento firmado por el principal, revocable desde fuera, con memoria de
gasto.

**Consecuencias, más allá de T19.**

- **T19 vale al 100%, sin supuestos.** Deja de ser "el camino de respaldo por
  si la pregunta 6 sale mal" y pasa a ser el camino correcto.
- **La pregunta 5 está respondida, y mejor de lo que se preguntaba:** un
  tercero no solo *puede* construir y enviar la transacción — es la **única**
  forma en que el flujo funciona. El comprador solo firma una autorización.
- **La Fase 4 (MandateGate) deja de ser el hito de mayor riesgo del proyecto.**
  `ROADMAP.md §4.4` dice que depende de convencer al embajador de aceptar un
  hook de autorización en su checkout. Ya no: el hook es un paso del comprador,
  y la licencia es Apache-2.0. Pasa de problema de coordinación entre equipos a
  problema de código.

**Alternativa descartada:** seguir esperando la respuesta del embajador antes
de construir T19. Ya no hay nada que esperar en este punto concreto — el repo
es público y responde la pregunta mejor que un mail.

---

### M-12 · La pregunta 6 se le corrió a `@x402/stellar` y al facilitator, y es verificable sin preguntarle a nadie · `Pendiente`
**Fecha:** 2026-09-03 · **Hito:** T19 (la decisión) · T22 (lo que la necesita)

`M-1` preguntaba si el **bazaar** acepta un comprador `C...`. La pregunta ya no
es del bazaar. La cadena real tiene tres eslabones y solo el tercero decide:

| Eslabón | ¿Le importa que el comprador sea `C...`? |
|---|---|
| El bazaar | **No.** Nunca ve al comprador; solo valida que el *vendedor* sea `G...` (`requireServerX402Config`, `lib/x402-config.ts`) |
| El token USDC (SAC, SEP-41) | **No.** `transfer(from: Address, …)` + `require_auth()` acepta cuenta de contrato sin nada especial — acá `M-1` tenía razón, y la sigue teniendo |
| **`@x402/stellar` + el facilitator de OpenZeppelin** | **Sí, y es el que decide** |

El cliente que el bazaar usa solo expone `createEd25519Signer(seed, red)` —
una seed de cuenta clásica. Un *smart account* exigiría producir un
`SorobanAuthorizationEntry` con `SorobanCredentials::Address` cuyos
`signature_args` van a `__check_auth`, y que el facilitator lo acepte, lo
simule y lo envíe. Que el flujo firme **autorizaciones Soroban** y no
transacciones clásicas está confirmado (`docs/X402_TESTNET.md`: *"Facilitator/
SDK handle Soroban auth verification, expiry, replay protection and
settlement"*), así que la puerta no está cerrada por diseño — pero nada en el
repo del bazaar prueba que esté abierta.

**Lo que esta decisión fija:** T22 (el contrato `policy_rail` como smart
account) **no se compromete** hasta un spike corto que lea el paquete
`@x402/stellar` 2.20.0 y el spec de x402-stellar y conteste si una cuenta de
contrato puede ser `payer`. El spike no depende de ninguna respuesta de nadie:
es un paquete público (Apache-2.0) y un spec público.

**Por qué esto es mejor que `M-1`, aunque siga siendo una pregunta abierta.**
El riesgo se movió de "una respuesta que no controlamos y que no llegó" a "una
lectura de código que podemos hacer nosotros cuando queramos". Y el costo de
que la respuesta sea "no" no cambió: se pierde T22 y nada más, porque T19 ya
funciona en los dos escenarios.

**Alternativa descartada:** asumir de nuevo, ahora que el facilitator soporta
cuentas de contrato. Sería repetir `M-1` con menos justificación que la
original — `M-1` al menos se apoyaba en la documentación oficial de Soroban;
acá no hay nada equivalente que citar.

---

### M-13 · `authorise()` recibe el pedido completo, no solo el intent · `Vigente`
**Fecha:** 2026-09-03 · **Hito:** T19

El esbozo de `ARQUITECTURA.md §8` decía `authorise(intent: PurchaseIntent)`. La
firma real es `authorise(request: AuthorisationRequest)`, donde el pedido lleva
el intent, el `scope` de la credencial verificada, el mandato verificado y —
cuando existe— los términos de pago que el comercio pide.

**Motivo.** Un intent no se autoriza contra sí mismo. Las dos autoridades que
`M-4` obliga a satisfacer viven fuera del intent: `scope.limits` está en la
credencial y `grant.limits` en el mandato. Pasarlas como argumentos, en vez de
que el rail las tenga guardadas de cuando se construyó, mantiene a
`LocalPolicyRail` **sin estado propio salvo el ledger** — y por lo tanto
testeable sin construir un agente entero, igual que `checkScope` y
`checkMandate` lo son.

Y sobre todo: el rail nunca recibe documentos sin verificar. Recibe un `Scope`
(ya extraído de una credencial que verificó) y un `AgentPayMandate` (ya
verificado), no un JWS que tendría que verificar él. Verificar firmas es de
`@agentpass/core` y `@agentpay/mandate`; PolicyRail decide, no verifica. Es la
misma división que hace que `checkScope` no sepa nada de criptografía.

**Alternativa descartada:** fijar `scope` y `mandate` al construir el rail
(`createLocalPolicyRail({ ledger, scope, mandate })`). Es cómodo para el agente
—tiene una credencial y un mandato— pero convierte al rail en algo que hay que
reconstruir cuando el mandato se renueva, y hace que un test de un caso límite
tenga que fabricar un rail nuevo por caso.

---

### M-14 · Los términos de pago se reconcilian primero, y solo sobre lo que hay documento firmado para comparar · `Vigente`
**Fecha:** 2026-09-03 · **Hito:** T19

`authorise()` compara los términos que el comercio pide contra lo que el intent
dice, **antes** que cualquier otro chequeo, y solo sobre tres campos: `venue`,
`asset` y `amount`.

**Por qué primero.** Los demás chequeos contestan *si esta compra está
permitida*. Este contesta *cuál es la compra*. Contestar "permitida" sobre una
compra distinta de la que está por pagarse no es un chequeo débil: es un
chequeo sobre otra cosa. Si el comercio pide 40 USDC y el intent firmado dice
18.50, no importa que 18.50 esté dentro del mandato.

Es el eslabón que faltaba para que el enforcement signifique algo en un flujo
x402: el reto `402` trae un `PaymentRequirements` fijado (`scheme`, `network`,
`payTo`, `asset`, `amount`, `maxTimeoutSeconds`, `extra.{resourceUrl, method,
route, inputHash}`), y ese objeto es lo que el comprador firma. Un límite que
se verifica contra el intent pero no contra lo que se está por firmar se
saltea solo.

**Por qué solo tres campos, y qué queda afuera dicho en voz alta.** Se
comparan los campos para los que **existe un documento firmado que diga qué
esperar**. `payTo` —la cuenta que cobra— es probablemente el campo más
sensible del reto 402, y **no se chequea**, porque hoy no hay nada firmado
contra qué compararlo: ni el `scope` de la credencial ni el `grant` del
mandato tienen una lista de destinatarios. Fingir un chequeo ahí —compararlo
contra un valor que el mismo catálogo entregó— daría la ilusión de una
verificación sin la verificación. Queda anotado como **el próximo campo que le
falta al Mandato**, y como pregunta abierta, no como deuda silenciosa.

**Los términos son opcionales, y eso no es una puerta abierta.** El camino del
catálogo simulado no tiene reto 402; ahí no hay términos que reconciliar, y la
decisión lo dice explícitamente en `reconciled: false` en vez de aparentar
haber chequeado. Un llamador que **tiene** términos y no los pasa se está
mintiendo a sí mismo; la decisión devuelta deja esa mentira visible en su
propio resultado.

**Alternativa descartada:** meter `PaymentTerms` dentro del `PurchaseIntent` y
firmarlo. Es probablemente lo correcto en la Fase 4, cuando el intent y el reto
402 existan en el mismo instante — pero hoy el intent se firma **antes** de que
haya un reto 402, y cambiar su forma es tocar `B-13`/T13 desde una fase
posterior por una integración que todavía no se construyó.

---

### M-15 · PolicyRail reserva: consulta, decide y registra en una sola sección crítica · `Vigente`
**Fecha:** 2026-09-03 · **Hito:** T19 — cierra el pendiente que `M-10` dejó abierto

`M-10` dejó explícitamente para T19 la atomicidad entre `spentOn()` y
`record()`. Se resuelve así: `LocalPolicyRail.authorise()` hace las tres cosas
—consultar el gasto del día, decidir, y registrar si autorizó— **dentro de una
sección crítica serializada por sujeto**, y el gasto se registra **al
autorizar**, no al pagar.

**Motivo, la parte de la serialización.** Es el TOCTOU que `M-10` nombró: dos
`authorise()` concurrentes leen el mismo `spentOn()` desactualizado, las dos
ven espacio y las dos aprueban. La sección crítica es una cadena de promesas
por sujeto dentro del proceso — la forma más chica que cierra el agujero sin
tocar el puerto `SpendLedger` que T18 ya fijó. **Es tan fuerte como el ledger
en memoria sobre el que se apoya, y ni un poco más:** con un ledger durable y
más de una instancia, la sección crítica tiene que ser una transacción de base
de datos o un lock distribuido, y esta cadena de promesas no ayuda en nada.
Dicho acá para que quien haga ese cambio lo sepa, en vez de descubrirlo.

**Motivo, la parte de reservar.** Hay dos momentos posibles para registrar:

| | Si la compra no llega a concretarse | Si hay concurrencia |
|---|---|---|
| Registrar al autorizar (**elegido**) | Cuenta de más: el presupuesto del día queda consumido hasta la medianoche UTC | Correcto |
| Registrar al liquidar | Exacto | Varias autorizaciones pueden pasar y juntas exceder `perDay` |

Contar de más es *fail-closed*: el agente gasta menos de lo que podría.
Contar de menos deja pasar gasto que el principal no autorizó. `B-1` ya fijó
para toda la Fase 2 que ante la duda se rechaza, y esto es la misma regla
aplicada al tiempo.

**Lo que esto cuesta, y por qué el remedio no se construye ahora.** Un intent
autorizado que nunca se convierte en pago consume presupuesto del día igual.
El remedio es una liberación (`release`/`void`) cuando la compra falla — y
**hoy no existe nada que pueda decirle a PolicyRail que una compra falló**: ese
aviso es el recibo de settlement, que es de la Fase 4. Construir la liberación
ahora sería construir la mitad de arriba de un puente. Queda anotado como
trabajo de la Fase 4, junto al recibo que lo dispara.

**Alternativa descartada:** dejar el registro afuera de `authorise()`, en manos
de quien orqueste (T21). Deja el TOCTOU exactamente donde `M-10` lo dejó, y le
pasa a cada llamador la responsabilidad de acordarse — que es justo el tipo de
"chequeo que alguien tiene que recordar hacer" que esta fase existe para
eliminar.

---

### M-16 · El presupuesto diario se lleva por agente, con el reloj del rail y no con el del intent · `Vigente`
**Fecha:** 2026-09-03 · **Hito:** T19

El `subject` que `M-10` dejó deliberadamente opaco es **el DID del agente**
(`intent.agent`), y el día UTC contra el que se cuenta sale de un reloj que se
le inyecta al rail, nunca de `intent.issuedAt`.

**Motivo del sujeto.** Las dos alternativas obvias —el hash de la credencial o
el `mandateId`— tienen el mismo agujero: **reemitir el documento resetea el
presupuesto del día**. Un emisor que reemite la credencial, o un principal que
firma un mandato nuevo, borrarían el gasto acumulado sin que nadie lo note. El
DID del agente es la llave más estrecha que ninguna reemisión puede resetear,
porque es lo único que no cambia cuando cambian los documentos.

Un solo presupuesto no debilita a `M-4` ("gana el más estricto"): las dos
autoridades se chequean igual, contra el **mismo** total del día, cada una con
su propio `perDay` y su propio código de error (`ScopeDailyLimitExceeded` /
`MandateDailyLimitExceeded`, `M-9`). Llevar dos totales separados daría siempre
el mismo número, porque todo gasto que pasa por este rail cuenta contra las
dos — y encima chocaría con el de-duplicado por `intentId` que `SpendLedger`
hace **global**, que impide registrar el mismo intent dos veces bajo dos
sujetos.

**Motivo del reloj.** `intent.issuedAt` lo firma el agente, sobre su propio
documento. Un agente comprometido que quisiera resetear su presupuesto del día
solo tendría que fechar el intent ayer. Que el rail use su propio reloj hace
que ese ataque no exista: el día contra el que se cuenta no es un campo que el
sujeto controlado por el atacante pueda elegir. (`M-8` sí compara `issuedAt`
contra la ventana del mandato, y eso está bien: ahí la pregunta es otra —si el
consentimiento estaba vigente— y fechar el intent fuera de la ventana solo
consigue que lo rechacen.)

**Límite conocido:** un mismo agente operando bajo dos principales distintos
compartiría un presupuesto. En este piloto principal y emisor son la misma
llave y hay un solo principal, así que no cambia nada; si algún día dejan de
serlo, el sujeto pasa a ser `agente + principal` y esta entrada se supera.

**Alternativa descartada:** el hash de la credencial como sujeto, que era lo
más fiel a "el presupuesto de esta credencial". Se descartó por el reseteo por
reemisión de arriba.
