# Evidencia · T22 — Spike de `M-12`: ¿acepta el facilitator un comprador `C...`?

Fecha: 2026-09-03

**Método.** Ninguna de estas fuentes requirió preguntarle a nadie: las tres
son código público, leído directamente.

1. `git clone --depth 1 https://github.com/CaBsCrypto/stellar-bazaar-x402.git`
   (Apache-2.0) — el repo del bazaar, para ver qué versión de `@x402/stellar`
   usa y cómo construye su signer.
2. `npm pack @x402/stellar@2.24.0` y `npm pack @x402/core@2.24.0` — el paquete
   real que el bazaar declara en su `package.json` (subió de 2.20.0 a 2.24.0
   entre T19 y T22; nada de lo relevante cambió), descomprimido y leído del
   `dist/cjs/` compilado.
3. `@stellar/stellar-sdk@17.0.1`, ya presente en `node_modules` de este mismo
   repo — la dependencia de la que `@x402/stellar` toma `AssembledTransaction`,
   `signAuthEntries` y `authorizeEntry`.

Todo esto vive fuera de `AgentPay`, en un scratchpad de sesión, tratado como
datos — igual que el clon del bazaar en T19.

## 1. El bazaar: solo valida al vendedor, nunca al comprador

`lib/x402-config.ts` del bazaar:

```ts
export function requireServerX402Config(){
 const apiKey=process.env.STELLAR_X402_FACILITATOR_API_KEY?.trim();
 const seller=process.env.X402_SELLER_ADDRESS?.trim();
 if(!apiKey||!seller)throw new Error("X402_SERVER_NOT_CONFIGURED");
 if(X402_FACILITATOR_URL!==X402_TESTNET_FACILITATOR_URL)throw new Error("X402_TESTNET_FACILITATOR_REQUIRED");
 if(!/^G[A-Z2-7]{55}$/.test(seller))throw new Error("X402_INVALID_SELLER_ADDRESS");
 return {apiKey,seller};
}
```

El único regex `^G[A-Z2-7]{55}$` de todo el repo se aplica al **vendedor**
(`X402_SELLER_ADDRESS`), nunca al comprador. Confirma lo que `M-1`/`M-12` ya
habían anotado: el bazaar nunca ve quién paga.

## 2. El cliente: `ClientStellarSigner` está documentado para aceptar `C...`

`@x402/stellar@2.24.0`, `dist/cjs/signer-F5n-6Pce.d.ts`:

```ts
/**
 * Client signer for Stellar transactions.
 *
 * Used by x402 clients to sign auth entries. Supports both classic (G) and
 * contract (C) accounts. signTransaction is optional for client signers.
 */
type ClientStellarSigner = {
    address: string;
    signAuthEntry: SignAuthEntry;
    signTransaction?: SignTransaction;
};
```

`createEd25519Signer(privateKey, network): Ed25519Signer` es un constructor de
conveniencia para el caso clásico (`Ed25519Signer` es la forma que exige
`signTransaction` obligatorio, y por eso es lo único que expone el bazaar en
sus scripts) — no la única forma de producir algo que satisfaga
`ClientStellarSigner`, que es el tipo que `ExactStellarScheme` realmente pide.

## 3. `ExactStellarScheme.createPaymentPayload()` (cliente): agnóstico al tipo de dirección

`dist/cjs/exact/client/index.js`, la función completa que construye el pago:

```js
async createPaymentPayload(x402Version, paymentRequirements) {
  const sourcePublicKey = this.signer.address;
  const { network, payTo, asset, amount, extra, maxTimeoutSeconds } = paymentRequirements;
  ...
  const tx = await contract.AssembledTransaction.build({
    contractId: asset,
    method: "transfer",
    args: [
      nativeToScVal(sourcePublicKey, { type: "address" }), // from
      nativeToScVal(payTo, { type: "address" }),            // to
      nativeToScVal(amount, { type: "i128" })               // amount
    ],
    ...
  });
  ...
  await tx.signAuthEntries({
    address: sourcePublicKey,
    signAuthEntry: this.signer.signAuthEntry,
    expiration: maxLedger
  });
  ...
}
```

`nativeToScVal(x, {type:"address"})` produce un `ScAddress` — Soroban no tiene
un tipo distinto para "dirección que es cuenta" vs "dirección que es
contrato" en este punto; ambas viajan como el mismo `Address`. Nada en esta
función lee `sourcePublicKey` para decidir un camino distinto según su primer
carácter.

## 4. El helper de firma del `stellar-sdk` (no de `@x402/stellar`): acepta una firma arbitraria

`@stellar/stellar-sdk@17.0.1`, `lib/cjs/base/auth.js`, dentro de
`authorizeEntry()` — la función que `tx.signAuthEntries()` llama por cada
entrada:

```js
if (sigResult !== null && typeof sigResult === "object" && "signatureScVal" in sigResult) {
  const candidate = sigResult.signatureScVal;
  const asScVal = toScVal(candidate);
  if (asScVal === null) {
    throw new TypeError(`signatureScVal must be an xdr.ScVal, ...`);
  }
  signatureScVal = asScVal;
  targetAddress ??= sigResult.address;
} else {
  // ... construye { public_key, signature } — el formato clásico —
  // solo si el signer NO devolvió `signatureScVal` explícito.
}
```

Un `signAuthEntry` que devuelve `{ signatureScVal }` controla **exactamente**
qué `ScVal` llega como `signature_args` a `__check_auth` si la dirección
autorizante es un contrato. No hay validación de forma más allá de "es un
`ScVal` válido" — la validación de contenido es responsabilidad del propio
`__check_auth`, como debe ser.

## 5. El facilitator (servidor): tampoco distingue, y reenvía la firma sin tocarla

`dist/cjs/exact/facilitator/index.js`, `validateAuthEntries()`:

```js
validateAuthEntries(invokeOp, facilitatorAddresses, fromAddress, maxLedger, transaction, simResponse) {
  for (const auth of invokeOp.auth) {
    const credentialsType = auth.credentials().switch();
    if (credentialsType !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
      return invalidVerifyResponse("invalid_exact_stellar_payload_unsupported_credential_type", fromAddress);
    }
    // ... expiración, sin sub-invocaciones ...
  }
  const authStatus = gatherAuthEntrySignatureStatus({ transaction, simulationResponse: simResponse });
  if (!authStatus.alreadySigned.includes(fromAddress)) { /* falta firma */ }
  if (authStatus.pendingSignature.length > 0) { /* firma extra pendiente */ }
}
```

Y `gatherAuthEntrySignatureStatus` (mismo archivo):

```js
if (credentialsType === xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
  const address = Address.fromScAddress(addressCredentials.address()).toString();
  const isSigned = signature.switch().name !== "scvVoid";
  isSigned ? alreadySigned.push(address) : pendingSignature.push(address);
}
```

Solo comprueba: tipo de credencial `Address` (no `SourceAccount`), no
sub-invocaciones, expiración dentro de tolerancia, y que la firma no sea
`scvVoid`. **Nunca** decodifica la `ScAddress` para distinguir cuenta de
contrato, y **nunca** inspecciona la forma interna de la firma. En `settle()`,
la operación (`invokeOp`, con su `auth` ya incluido) se reinserta tal cual en
la transacción reconstruida — el facilitator no vuelve a firmar la
autorización del comprador, solo firma el sobre de la transacción con su
propia llave para pagar el fee.

`_verify()` separadamente valida, vía los eventos de la simulación, que hubo
exactamente un evento `transfer` con el `from`/`to`/`amount`/`asset`
esperados — semántica del SEP-41, no del tipo de cuenta.

## 6. Búsqueda negativa: no hay ningún regex `G...`-only aplicado al pagador

```
$ grep -rn "isValidEd25519PublicKey\|StrKey\.\(is\|decode\)" stellar/dist/cjs/*.js stellar/dist/cjs/*/*/*.js
(sin resultados)
```

El único regex de formato de cuenta en todo `@x402/stellar` (`STELLAR_DESTINATION_ADDRESS_REGEX`)
acepta `G`, `C` y `M` por igual, y se aplica al **destinatario** (`payTo`) del
lado cliente, no al pagador.

## 7. Conclusión de la lectura de código

**Respuesta a M-12: sí, un comprador `C...` (`policy_rail` como smart
account) es viable con el stack real (`@x402/stellar` + facilitator de
OpenZeppelin).** Ningún componente de la cadena de pago inspecciona ni
restringe el tipo de dirección del pagador; todo el camino —cliente, SDK de
firma, facilitator— trata `Address::Account` y `Address::Contract` de forma
idéntica hasta el punto en que el host de Soroban decide, él mismo, si
verifica la firma nativamente (cuenta clásica) o invoca `__check_auth`
(cuenta de contrato).

**Lo que esta lectura de código no podía contestar, y sí una medición real**
(§8, más abajo): si el fee de un `__check_auth` propio entra bajo el techo
que el facilitator aplica, y si el flujo completo efectivamente asienta en
un ledger — no solo que el código no lo prohíba.

## 8. Medición empírica: contrato real, testnet real, transacción real

Con la lectura de código dando luz verde, el siguiente paso no fue seguir
leyendo — fue construirlo. `contracts/policy-rail/` (nuevo crate en el
workspace de Rust) implementa `CustomAccountInterface` con un
`__check_auth` mínimo: verifica una firma Ed25519 contra una llave `owner`
fijada al desplegar, sin ningún enforcement de `perTx`/`perDay` todavía —
exactamente lo necesario para medir el costo, ni una línea más. 6 tests
Rust (`cargo test -p policy-rail`) y 5 mutaciones deliberadas, las cinco
cayeron — detalle en `docs/fase-3-policyrail-mandato/BITACORA.md`, entrada
de T22.

**El experimento, contra Stellar testnet real, sin facilitator ni faucet de
USDC** (`scripts/t22-fee-probe.ts`, script de un solo uso, borrado tras
capturar esta evidencia):

1. Se desplegó `policy_rail` con una llave Ed25519 nueva y descartable como
   `owner` — `stellar contract deploy`, pagado por una cuenta ya fondeada de
   este mismo repo (`ADMIN_SECRET_KEY`).
2. Se lo fondeó con 1 XLM nativo, transferido desde esa misma cuenta admin al
   contrato — el activo específico no importa para esta medición: el costo
   de recursos de un `transfer` SEP-41 más un `__check_auth` es el mismo
   contrato compilado sin importar qué activo mueva, y XLM no necesita ningún
   faucet externo.
3. Se construyó un segundo `transfer`, esta vez **desde** `policy_rail`
   (el contrato como `from`), firmado con una `SorobanAuthorizationEntry`
   custom: la llave `owner` firma el payload exacto que el host pide
   verificar, empaquetado en el mismo formato `{public_key, signature}` que
   el propio `__check_auth` espera.
4. Se simuló, y **la simulación reportó `minResourceFee`: 29 890 stroops** —
   contra el techo de 50 000 que el facilitator aplica. **Entra**, con margen.
5. Se envió de verdad. **Asentó.** Hash de la transacción:
   `9708b4d93ad8ba3a9726c66e49c3e4835e275297f2362912ef23226ebb8a2c0f`,
   status `SUCCESS`.

```
[5/5] Resultado de la simulación
  minResourceFee         29890 stroops
  techo del facilitator  50000 stroops
  ¿entra bajo el techo?  SÍ

[6/6] Enviar de verdad, para confirmar que asienta (no solo simula)
  tx hash                9708b4d93ad8ba3a9726c66e49c3e4835e275297f2362912ef23226ebb8a2c0f
  status                 SUCCESS
```

**Lo que este número es, y lo que todavía no es.** 29 890 stroops es el costo
de la versión más simple posible de `__check_auth` — una verificación de
firma, nada más. El margen bajo el techo (20 110 stroops, un 40% del total)
es lo que queda disponible para el enforcement real de `perTx`/`perDay`:
leer el gasto del día desde el storage del contrato y comparar contra un
límite. Ese costo adicional todavía no está medido — es lo primero que hay
que volver a correr una vez que esa lógica exista, no algo que este número
ya garantice.

**Conclusión de M-12, completa:** un comprador `C...` no solo es viable en
el papel — un `policy_rail` mínimo, desplegado y firmado de verdad,
efectivamente paga con su propia autorización on-chain, dentro del
presupuesto de fee que el facilitator real exige, en Stellar testnet real.

## 9. El spike creció a lo que iba a ser: `perTx` y `perDay` de verdad

El margen de la §8 (20 110 stroops) era, en teoría, espacio para el
enforcement real. Se construyó, y **el primer intento lo gastó entero y
sobró pedir más.**

### 9.1 Primer intento: 203 831 stroops — el 4× del techo

Se agregó a `contracts/policy-rail/` lo que la Fase 2/3 ya definía
off-chain: leer `scope.limits.perTx` contra el monto de la transferencia,
leer y acumular el gasto del día contra `perDay`, con el mismo criterio de
`M-16` (el reloj es el del contrato, nunca un dato que la transacción
traiga). Cinco valores de configuración (`owner`, `asset`, `per_tx`,
`per_day`, `valid_until`) fijados al desplegar, y un contador por día
(`SpentOn(day)`) que se lee, se compara y se escribe **dentro del mismo
`__check_auth`** — sin la ventana entre consultar y registrar que `M-15`
documentó como el costo conocido de `LocalPolicyRail`.

Funcionalmente, perfecto: 21 tests de Rust, todos en verde. El fee real:

```
minResourceFee   203831 stroops
techo            50000 stroops
¿entra?          NO — lo excede por casi 4×
```

Un `__check_auth` que solo firma cuesta 29 890. Agregarle dos comparaciones
de enteros y un contador lo llevó a 203 831. La diferencia no podía ser el
cómputo — comparar dos `i128` es trivial. Tenía que ser el I/O de storage.

### 9.2 Aislando la causa: no son las lecturas, es el TTL de una entrada nueva

Primer sospechoso, descartado: consolidar `owner`/`asset`/`per_tx`/`per_day`/
`valid_until` —cinco claves de instance storage separadas— en un solo
`struct Config` leído de una vez. Resultado: 203 786. Prácticamente nada.

Segundo experimento, decisivo: quitar temporalmente las dos llamadas a
`extend_ttl()` (la del storage de instancia y la de la entrada de gasto del
día) sin tocar nada más.

```
con las dos extend_ttl     203 786 stroops
sin ninguna extend_ttl      48 886 stroops   <- toda la diferencia está acá
```

**Extender el TTL de una entrada de storage recién creada, hasta 90 días de
una vez, es lo que cuesta caro** — no crearla, no leerla, no escribirla.
Soroban cobra la extensión de TTL como renta: saltar de "recién nacida" a
"vive 90 días" es un salto grande, y el salto es lo que se paga. La
instancia (`Config`) no sufre esto en la práctica —ya estaba en 90 días
desde el `__constructor`, así que extenderla de nuevo es casi gratis, un
`extend_ttl` que no tiene que mover nada—; la entrada `SpentOn(day)`, en
cambio, nace en cada transacción nueva del día y se le pedía el mismo salto
de 90 días que a la configuración, que vive para siempre.

Ese era el error real: **`SpentOn(day)` recibió, por copiar la constante sin
pensarlo, el mismo horizonte de 90 días que algo que sí necesita vivir 90
días.** Un contador que solo importa por el día que nombra no tenía ninguna
razón para pedir ese horizonte.

### 9.3 La corrección: el TTL que la entrada realmente necesita, y el tipo de storage correcto

Dos cambios, no uno:

1. **Un TTL corto y propio para `SpentOn(day)`** (`SPEND_ENTRY_TTL_THRESHOLD`/`_EXTEND_TO`,
   medio día / dos días) en vez del horizonte de 90 días de la configuración.
2. **`temporary()` en vez de `persistent()`.** Un contador que expira solo
   —y a quien nadie le importa leer pasado ese punto— es exactamente lo que
   el storage temporal de Soroban existe para modelar: sin renta, borrado
   por el propio host cuando su TTL vence. Es, además, más correcto que
   `persistent()`: nada en este sistema necesita que el gasto de un día
   sobreviva más que ese día.

Con los dos cambios, con el evento `SpendAuthorised` de vuelta (se había
probado quitarlo también — ahorraba ~1 100 stroops, mucho menos que el TTL
— y no hacía falta sacrificarlo):

```
minResourceFee   38888 stroops
techo            50000 stroops
¿entra?          SÍ — margen de 11 112 stroops (22%)
```

### 9.4 Confirmado en cadena, con los tres casos que importan

Contrato desplegado en testnet real — `owner` descartable, `asset` = XLM
nativo (mismo motivo que en §8: el costo no depende del activo),
`perTx = 0.5 XLM`, `perDay = 0.8 XLM`:

```
[4/6] Primer transfer — 0.5 XLM, dentro de perTx y perDay
  minResourceFee    38888 stroops
  ¿entra?           SÍ (margen: 11112)
  tx hash           16907491d8f83e0020d7e8f1d3d2525eebd26d4d370e385a293b1aa0a244b6e0
  status            SUCCESS

[5/6] Segundo transfer — otros 0.5 XLM (0.5+0.5=1.0 > 0.8 de perDay)
  resultado         rechazado, como se esperaba
  detalle           HostError: Error(Auth, InvalidAction) ...
                    "failed account authentication with error",
                    Error(Contract, #8)   <- PerDayExceeded, el código exacto

[6/6] Tercer transfer — 0.3 XLM (0.5+0.3=0.8, exactamente el límite)
  tx hash           ba11d8391ba8808c3d23d53365787bd28bfe7181b712cd5c7a65e48125b79f2d
  status            SUCCESS
```

El segundo transfer se rechaza en la **simulación misma** — nunca llega a
someterse a la red — con el código de error exacto del contrato
(`Error::PerDayExceeded = 8`), no un error genérico. El tercero confirma que
el rechazo del segundo no dejó nada mal registrado: el contador seguía en
0.5 XLM gastados, y 0.5 + 0.3 = 0.8 — exactamente el límite, permitido
porque el chequeo es `> per_day`, no `>=`.

### 9.5 Mutation testing sobre la versión completa

Catorce mutaciones deliberadas sobre `__check_auth` y el constructor —el
chequeo de expiración, la identidad del firmante, la verificación
criptográfica, la forma de la invocación autorizada, `perTx`, `perDay`, el
registro del gasto, y la validación de los parámetros del constructor.
**Las catorce cayeron.**

```
killed    expiry check removed
killed    signatures.len() != 1 check removed
killed    public_key == owner check removed
killed    ed25519_verify skipped
killed    auth_contexts.len() != 1 check removed
killed    contract/fn_name/args-length match removed
killed    from == current_contract_address() check removed
killed    amount <= 0 check removed
killed    perTx comparison off-by-one (>= instead of >)
killed    perTx check removed
killed    perDay check removed
killed    spend recording skipped
killed    constructor limit validation removed
killed    constructor expiry validation removed
```

(Las primeras corridas de este mismo lote reportaron siete de estas catorce
como `SURVIVED`. No eran huecos: el archivo había cambiado de forma —la
consolidación en `Config`, el cambio a `temporary()`— y los patrones del
script de mutación seguían buscando el código viejo. Al no encontrar nada
que mutar, el archivo quedaba intacto y, por supuesto, pasaba todos los
tests. Corregidos los patrones para que apuntaran al código real, las
catorce cayeron. Vale la pena decirlo en voz alta: un mutation testing que
reporta "sobrevivió" merece la misma desconfianza que uno que reporta
"cayó" — hay que mirar si la mutación en verdad se aplicó antes de creerle
cualquiera de los dos resultados.)

### 9.6 Conclusión de T22

`policy_rail` hace cumplir `perTx` y `perDay` dentro de la misma transacción
que mueve la plata, sin la ventana entre consultar y registrar que
`LocalPolicyRail` tiene off-chain (`M-15`), con margen real de fee bajo el
techo del facilitator, verificado con transacciones reales —no solo
simuladas— en Stellar testnet. El wasm final: 9528 bytes.

**Lo que sigue fuera de alcance, a propósito, todavía:** el Mandato en sí
—este contrato no sabe qué es un principal, ni una ventana de vigencia
firmada por nadie más que quien lo desplegó, ni una lista de venues— y el
chequeo de `payTo`, que sigue sin nada firmado contra qué compararlo
(`M-14`). `policy_rail` prueba que el camino on-chain funciona y cabe en el
presupuesto real; no reemplaza al Mandato ni a `LocalPolicyRail`, los
complementa como una segunda implementación posible del mismo puerto.

---

**Actualización 2026-09-04 (T31).** El evento `SpendAuthorised` que §9.3
decidió conservar —costaba ~1 100 stroops y no hacía falta sacrificarlo por
fee— fue **quitado del contrato**. Motivo nuevo, que en su momento no se
conocía: el facilitator exige que todo evento de contrato de la simulación de
un pago sea un `transfer`, así que mientras el rail lo emitiera no podía pagar
ninguna factura x402 (`invalid_exact_stellar_payload_event_not_transfer`).
Detalle, y qué se pierde y qué no, en
`docs/fase-5-mandatevault/DECISIONES.md` → `V-13`. La conclusión de §7 (un
comprador `C…` es viable) quedó confirmada por un pago real en T31, con una
salvedad que esta lectura no había alcanzado: el paso de firma de
`@x402/stellar` no sirve para cuentas de contrato y hubo que reemplazarlo
(`V-12`).
