# Decisiones — Fase 3 (PolicyRail + Mandato)

> Una entrada por decisión, con su motivo y la alternativa que se descartó.
> **No se borran entradas**: si una decisión se revierte, se marca como
> `Superada` y se agrega la nueva.
>
> **Prefijo `M-`**, para no chocar con `A-`/`I-` (Fase 1), `B-` (Fase 2) ni
> `P-` (proyecto, en [../DECISIONES.md](../DECISIONES.md)).

Estados: `Vigente` · `Superada` · `Pendiente` · `Supuesto`

---

### M-1 · Se asume la respuesta a la pregunta 6 del embajador, y se asume explícitamente · `Supuesto`
**Fecha:** 2026-09-02 · **Hito:** T16

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
