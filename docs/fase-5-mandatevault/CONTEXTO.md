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

## 3c. Qué prueba T29

Que un humano —no solo un script— puede ver la bitácora completa: cada
decisión (T27), y el estado on-chain **en vivo** de cada anclaje (T28), en
`apps/web` (§5 de la página, "Bitácora (MandateVault)"). El estado de cada
anclaje se lee del registro en el momento de pedirlo, no de lo que el
archivo local dice que pasó — verificado clickeando el flujo completo en un
navegador real. Detalle en `V-10` y `evidencia/T29.md`.

## 3d. Qué prueba T30 — el último candidato técnico, cerrado

Que la credencial y el Mandato de la sesión activa también aparecen en la
misma bitácora, con lo que `agent_registry` dice de ellos **en este
momento** — no un valor recordado localmente. `AgentPass.getRecord(hash)`
(`@agentpass/sdk`, nuevo) expone `get_credential`, el método que el
contrato ya tenía y que ninguna capa pública usaba: issuer, subject,
`issued_at`, `expires_at` y `revoked`, el registro completo que `status()`
colapsa en una sola palabra. Verificado en testnet real, dos veces: contra
la integración del SDK (issue → `getRecord` → revoke → `getRecord` de
nuevo, `revoked` pasa de `false` a `true`) y clickeando el flujo en un
navegador real — revocar el Mandato cambió "mandato (en cadena)" de
`activa` a `revocada` sin recargar la página, mientras la credencial se
mantuvo `activa`. Con esto, los tres eventos que `ROADMAP.md §4.5` nombró
como "materia prima" (credencial, Mandato, decisiones de PolicyRail) están
todos en la misma bitácora. Detalle en `V-11` y `evidencia/T30.md`.

## 4. Qué NO es esta fase

- **No es el cierre del piloto.** Nada de la cohorte de alumnos, la
  comunidad aliada, la demo grabable o el formulario de Build Award — ver
  `ROADMAP.md §4.5`, siguen sin arrancar. Es lo único que le falta a esta
  fase, y no es trabajo de código.

## 5. Fuera de alcance, a propósito

Mainnet, rieles fiat o PSP, `policy_rail` (T22) como pagador de producción —
igual que en las fases anteriores. La ejecución de negocio del piloto (§4) no
es trabajo de código y no se construye desde este repo.
