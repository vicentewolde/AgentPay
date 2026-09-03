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
