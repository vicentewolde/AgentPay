# Contexto — Fase 5 (MandateVault + cierre de piloto)

> Qué prueba esta fase, qué **no** es, y qué queda deliberadamente afuera.
> Especificación: [ROADMAP.md §4.5](../../ROADMAP.md) ·
> Mapa técnico: [ARQUITECTURA.md](ARQUITECTURA.md) ·
> Estado: [BITACORA.md](BITACORA.md) · Decisiones: [DECISIONES.md](DECISIONES.md)

---

## 1. La frase

> Cada decisión del sistema —cada compra autorizada, cada una rechazada—
> tiene que quedar como evidencia que sobrevive un reinicio, y que cualquiera
> puede verificar no fue editada después del hecho. Confiar en el operador no
> alcanza; tiene que poder probarse.

## 2. Cómo arrancó, en la práctica

`ROADMAP.md §4.5` mezcla dos trabajos muy distintos: ingeniería sobre este
repo (MandateVault) y ejecución de negocio del piloto (cohorte de alumnos,
comunidad aliada, demo grabable, formulario de Build Award). Al arrancar esta
fase se le preguntó al usuario en qué punto estaba lo segundo, porque
condiciona si construir MandateVault tiene sentido todavía. Respuesta: nada
del piloto arrancó todavía — ni alumnos, ni comunidad, ni formulario. El
usuario pidió avanzar con el diseño de MandateVault igual, con datos
simulados por ahora (los que T24–T26 ya producen contra testnet real).

Antes de escribir código se investigó qué evidencia produce hoy el sistema.
Dos huecos reales, no uno:

1. **La decisión de `PolicyRail.authorise()` — autorizada o rechazada, y por
   qué — no quedaba registrada en ningún lado durable.** `SpendLedger`'s
   implementación en memoria (Fase 3) se pierde al reiniciar el proceso; un
   rechazo nunca tocaba el ledger en absoluto, solo la respuesta HTTP o la
   salida de terminal.
2. **No hay ningún vínculo criptográfico entre un pago asentado y el intent/
   mandato que lo autorizó.** `executeBazaarPayment` (T24) no agrega memo ni
   referencia — un pago en Stellar es indistinguible de cualquier otro pago
   de esa cuenta. "Este pago fue autorizado por este mandato" era algo que
   había que **confiar**, no algo que se pudiera **probar** mirando solo
   datos públicos.

Se planteó cerrar ambos huecos en un mismo hito (bitácora durable + memo
on-chain). Investigando el segundo antes de comprometerse, apareció un
bloqueante real: `@x402/stellar` construye y firma la transacción de pago
**enteramente dentro del paquete** (`ExactStellarScheme.createPaymentPayload`,
vía `contract.AssembledTransaction.build(...)` de `@stellar/stellar-sdk`) y no
expone ningún parámetro de memo. Parchear una dependencia de terceros nunca
fue el estilo de este proyecto (T19/T22/T24 leyeron paquetes reales, nunca
los tocaron). Se lo señaló al usuario antes de seguir, con la alternativa que
sí es enteramente nuestra — una transacción companion que ancla el hash de la
decisión contra `agent_registry`, reusando el mecanismo que T20 ya construyó
para credenciales y mandatos — y el usuario la confirmó. Ver `V-3`.

## 3. Qué prueba T27 — el primer hito

Que cada decisión de `PolicyRail.authorise()` —autorizada o rechazada— queda
en un registro durable, encadenado por hash, que sobrevive un reinicio del
proceso y que cualquiera puede verificar no fue editado después (`verify()`
recomputa la cadena entera). `apps/web`, el único servidor que corre
continuamente (desplegado en Render), quedó cableado a este vault en vez del
`SpendLedger` en memoria de T19.

## 3b. Qué prueba T28

Que un pago real asentado y la decisión de `PolicyRail` que lo autorizó
quedan vinculados criptográficamente, verificable por cualquiera sin
confiar en quien opera el vault: `paymentLinkHash(record, paymentTx) =
sha256(record.hash + ":" + paymentTx)`, anclado contra `agent_registry` con
la misma llave que ya ancla credencial y mandato. Verificado en testnet
real: `agentpass.status(linkHash)` devuelve `"Active"` consultado de forma
completamente independiente del archivo del vault. Detalle en `V-3`,
`V-8`, `V-9` y `evidencia/T28.md`.

## 4. Qué NO es esta fase, todavía

- **No tiene superficie de consulta.** `list()`/`verify()` existen como
  métodos del objeto `MandateVault`, pero no hay CLI ni vista en `apps/web`
  que los exponga a un humano todavía.
- **No indexa los eventos que `agent_registry` ya emite** (`Anchored`,
  `Revoked` de credencial y mandato) — esos ya son consultables vía Horizon,
  pero nada en este repo los correlaciona con el resto de la evidencia.
- **No es el cierre del piloto.** Nada de la cohorte de alumnos, la
  comunidad aliada, la demo grabable o el formulario de Build Award — ver
  `ROADMAP.md §4.5`, siguen sin arrancar.

## 5. Fuera de alcance, a propósito

Mainnet, rieles fiat o PSP, `policy_rail` (T22) como pagador de producción —
igual que en las fases anteriores. La ejecución de negocio del piloto (§4) no
es trabajo de código y no se construye desde este repo.
