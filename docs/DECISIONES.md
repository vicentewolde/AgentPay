# Decisiones

> Registro de decisiones importantes. Una entrada por decisión, con su motivo y
> la alternativa que se descartó. **No se borran entradas**: si una decisión se
> revierte, se marca como `Superada` y se agrega la nueva.
>
> Contexto: [CONTEXTO.md](CONTEXTO.md) · Avance: [BITACORA.md](BITACORA.md)

Estados: `Vigente` · `Superada` · `Pendiente`

---

## Parte A — Decisiones del brief

Tomadas por Vicente antes de escribir código. **No se re-litigan.** Si al
implementarlas aparece un problema, se avisa y se espera; no se cambian
unilateralmente.

### A-1 · Formato de credencial: perfil VC-JWT · `Vigente`
Data model W3C VC 2.0 serializado como JWS compacto firmado con EdDSA.
**Descartado:** JSON-LD con contexts, canonicalización, Data Integrity proofs,
BBS+. **Motivo:** peso y complejidad injustificados para un piloto de 10 semanas.

### A-2 · Método DID derivable, sin red · `Vigente`
`did:stellar:testnet:<G-address>`. El documento DID se deriva determinísticamente
de la dirección; la llave pública de la cuenta *es* la llave de verificación.
**Motivo:** verificar una firma no debe requerir ninguna llamada de red.

### A-3 · La credencial nunca va on-chain · `Vigente`
On-chain solo van el SHA-256 del JWS compacto, su estado y el registro de
emisores. **Motivo:** privacidad. Ver [CONTEXTO.md](CONTEXTO.md).

### A-4 · Superficie del contrato `agent_registry` · `Vigente`
`register_issuer`, `deactivate_issuer`, `anchor`, `revoke`, `status`. Eventos
`anchored` y `revoked`. TTL de entradas persistentes extendido en cada `anchor`.
**Motivo del TTL:** sin extenderlo, el estado se archiva y la demo se cae en
semanas.

### A-5 · Verificar son exactamente 3 chequeos · `Vigente`
(a) firma contra la llave derivada del DID del emisor; (b) `now` dentro de
`validFrom`/`validUntil`; (c) `status(sha256(jws)) == Active` y emisor activo.

### A-6 · Versiones: resolver, no asumir · `Vigente`
La versión del SDK y el protocolo vivo se consultan, no se suponen.
Ver [I-3](#i-3--soroban-sdk-2706-pese-a-que-la-red-corre-protocolo-28--vigente).

### A-7 · `scope.limits` es declarativo en esta fase · `Vigente`
Se firma y se transporta; **nada lo hace cumplir todavía**. El enforcement llega
después. **Motivo:** identidad primero, enforcement después.

---

## Parte B — Decisiones de implementación

Tomadas durante la construcción. Estas **sí** se pueden discutir.

### I-1 · Raíz del monorepo en `agentpass/`, no en la carpeta padre · `Vigente`
**Fecha:** 2026-09-01 (T1)
La carpeta padre `Agenticpay/` ya contenía notas y prompts del usuario. El repo
vive en el subdirectorio `agentpass/` y esas notas quedan fuera, intactas y sin
versionar.

### I-2 · Dos workspaces separados, un solo puente · `Vigente`
**Fecha:** 2026-09-01 (T1)
El workspace de pnpm cubre `packages/*` y `apps/*`. El workspace de Cargo vive
en `contracts/` y **no tiene `package.json`**, así que pnpm no lo ve. El único
artefacto compartido es `deployments/testnet.json`.
**Motivo:** TypeScript nunca importa Rust y Rust nunca sabe de TypeScript. Un
solo punto de contacto es un solo punto que puede romperse.
**Descartado:** Cargo.toml en la raíz junto al package.json (lo que genera
`stellar contract init` por defecto), y plugins que acoplen cargo con node.

### I-3 · `soroban-sdk` 27.0.6 pese a que la red corre protocolo 28 · `Vigente`
**Fecha:** 2026-09-01 (T1)
La regla de [A-6](#a-6--versiones-resolver-no-asumir) dice que la major del SDK
sigue el protocolo de la red, lo que apuntaría a 28. Al resolverlo:

| fuente | valor |
|---|---|
| protocolo vivo de testnet (`getVersionInfo`) | 28 |
| `stellar-cli` estable | 28.0.0 |
| `soroban-sdk` último **estable** | **27.0.6** |
| `soroban-sdk` 28 | solo `28.0.0-rc.1` |
| template de `stellar contract init` (CLI 28.0.0) | pinea `"27"` |

**Motivo:** un contrato compilado con SDK 27 ejecuta sin problema en una red
protocolo 28 — la major del SDK gobierna a qué *host functions nuevas* tienes
acceso, no la compatibilidad de ejecución. El propio CLI 28 pinea 27.
**Descartado:** `28.0.0-rc.1`, por ser release candidate.
**Confirmado por Vicente el 2026-09-01.**
**Vigilancia:** `pnpm run bootstrap` compara el pin contra el protocolo vivo en
cada corrida e imprime una flecha si divergen. Cuando salga el 28 estable, la
flecha seguirá apareciendo hasta que se actualice el pin.

### I-4 · Los tests resuelven a `src/`, no a `dist/` · `Vigente`
**Fecha:** 2026-09-01 (T1)
Cada paquete tiene un `vitest.config.ts` con alias que apuntan al `src/` de sus
hermanos del workspace.
**Motivo:** el ciclo de TDD no requiere un `tsc -b` previo en cada iteración.
La resolución de producción sigue pasando por `exports` → `dist/`.

### I-5 · Un `AgentPassError` con `code` de unión literal · `Vigente`
**Fecha:** 2026-09-01 (T1)
Una sola clase con una propiedad `code` tipada como unión de literales, más
`details` y `cause`.
**Motivo:** `hasErrorCode(e, "CredentialRevoked")` estrecha el tipo igual que una
jerarquía de subclases, sin la ceremonia de una clase por caso.
**Regla derivada:** las superficies aún no implementadas **lanzan**
`NotImplemented`; nunca devuelven `undefined`.

### I-6 · `tsconfig.scripts.json` + `tsx --tsconfig` para `scripts/` · `Vigente`
**Fecha:** 2026-09-01 (T2)
`scripts/` está fuera del grafo de project references y resuelve `@agentpass/*`
vía `paths`.
**Motivo:** `pnpm run bootstrap` funciona en un repo recién clonado, sin build
previo. Sin esto, `scripts/` además quedaba sin typecheckear.

### I-7 · Parser `.env` propio en vez de una dependencia · `Vigente`
**Fecha:** 2026-09-01 (T2)
~40 líneas. Formato propio: `KEY="value"`, comentarios con `#`, sin interpolación.
**Motivo:** el passphrase de Stellar contiene `;` y espacios; una librería de
terceros podría discrepar en los bordes. Un test verifica que
`parse(format(x)) === x` incluso con comillas y backslashes.

### I-8 · Bootstrap declara qué claves posee; el resto se arrastra · `Vigente`
**Fecha:** 2026-09-01 (T2)
`MANAGED_KEYS` enumera las claves que `bootstrap` reescribe. Todo lo demás en
`.env.local` sobrevive bajo un encabezado propio.
**Motivo:** es la garantía de que un re-run de `bootstrap` no borra el contract
id que escribe `deploy:registry`. Probado end-to-end y con test unitario.

### I-9 · `@stellar/stellar-sdk/base` en `core`, no `@stellar/stellar-base` · `Vigente`
**Fecha:** 2026-09-01 (T3)
`@stellar/stellar-base` está **deprecado**: se absorbió dentro de
`@stellar/stellar-sdk`, que en v17 ya no lo usa. Instalarlo habría metido una
segunda implementación de StrKey/Keypair sin mantenimiento.
El subpath `/base` expone `StrKey`, `Keypair` y `Networks` **sin** los clientes
de Horizon ni RPC.
**Motivo:** la restricción "core no hace I/O" queda impuesta por el import, no
por disciplina. Una sola versión de stellar-sdk en el workspace.

### I-10 · `StellarDid` es un tipo *branded* · `Vigente`
**Fecha:** 2026-09-01 (T3)
Solo `stellarAddressToDid`, `parseStellarDid` y `stellarDidSchema` pueden
producir un `StellarDid`.
**Motivo:** un string arbitrario no puede llegar a una función que espera un DID
ya validado. El compilador lo impide.

### I-11 · El parseo de DIDs no es lenient · `Vigente`
**Fecha:** 2026-09-01 (T3)
Sin `trim`, sin normalización de mayúsculas. `" did:stellar:..."` se rechaza.
**Motivo:** un DID que difiere en un byte identifica a **otro sujeto**.
Normalizar silenciosamente es exactamente la clase de fallo que este proyecto
existe para evitar.

### I-12 · Documentación del proyecto en español, código en inglés · `Vigente`
**Fecha:** 2026-09-01
`CONTEXTO`, `BITACORA` y `DECISIONES` en español porque los lee Vicente. Código,
comentarios, mensajes de commit y `README.md` técnico en inglés.
**Motivo:** el repo puede ir a SCF o a colaboradores externos.
**Decidido por Vicente el 2026-09-01.**

### I-13 · Repo privado en GitHub · `Vigente`
**Fecha:** 2026-09-01
`vicentewolde/agentpass`, privado. Hacerlo público después es un clic.
**Motivo:** respaldo inmediato. Nada secreto está commiteado: `.env.local` está
ignorado y el historial completo se auditó antes del primer push.
**Decidido por Vicente el 2026-09-01.**

### I-14 · `kid` es el DID a secas, sin fragmento · `Vigente`
**Fecha:** 2026-09-01 (T4)
El header del JWS lleva `kid: "did:stellar:testnet:G..."`.
**Motivo:** un `did:stellar` tiene exactamente una llave, así que el DID ya la
identifica sin ambigüedad. Un fragmento no agregaría información.
**Descartado:** `<did>#<fragmento>`. Resuelve [P-1](#p-1--formato-del-kid-en-el-header-del-jws--resuelta-en-i-14).
**Regla de seguridad derivada:** el `kid` **no** se usa para elegir la llave de
verificación — lo controla quien construye el JWS. La llave sale del `issuer`
del payload; el `kid` solo se contrasta y si discrepa se rechaza.

### I-15 · Sin documento DID completo ni `publicKeyMultibase` · `Vigente`
**Fecha:** 2026-09-01 (T4)
Nada lo consume: la verificación solo necesita la llave pública cruda, que
`didToPublicKey` ya entrega.
**Motivo:** `publicKeyMultibase` arrastraría una dependencia de base58 para
producir un documento que nadie lee. Se agrega cuando algo lo pida.
Resuelve [P-2](#p-2--documento-did-completo-con-publickeymultibase--resuelta-en-i-15).

### I-16 · `credentialStatus` no lleva el hash de la credencial · `Vigente — pendiente de confirmación de Vicente`
**Fecha:** 2026-09-01 (T4)
El brief especificaba `credentialStatus.id = "<sha256 del JWS compacto, hex>"`.
**Ese campo no se implementó, porque no se puede.**

**1. Es circular.** El valor anclado es `sha256(JWS)`, y el JWS se produce
firmando el payload. Si el payload contiene el hash del JWS, firmar cambia el
JWS, lo que cambia su hash, lo que cambia el payload. No converge; no hay orden
de operaciones que lo resuelva.

**2. Aunque se pudiera, no habría que confiar en él.** Un hash autodeclarado lo
elige quien construye la credencial. Un atacante con una credencial revocada
apuntaría ese campo al hash de otra credencial que siga activa, y el verificador
consultaría el registro por el hash equivocado y obtendría `Active`.

**Implementado:** `credentialStatus` conserva `type` y `registry` — que sí
aportan, porque dicen en qué contrato consultar y van firmados. El verificador
hashea el JWS que efectivamente recibió.
**Costo de revertir:** bajo, es un campo. Si prefieres otra resolución, dilo.

### I-17 · Todos los objetos del esquema son estrictos · `Vigente`
**Fecha:** 2026-09-01 (T4)
Un campo desconocido hace fallar la validación (`z.strictObject`).
**Motivo:** con una sola implementación en ambos extremos, caza typos de
inmediato. **Contrapartida asumida:** si entran verificadores de terceros que
deban tolerar campos nuevos, hay que relajarlo deliberadamente.

### I-18 · Los montos viajan como string · `Vigente`
**Fecha:** 2026-09-01 (T4)
`perTx` y `perDay` son strings decimales con máximo 7 decimales, validados por
regex. **Motivo:** ningún float redondea un límite en el camino.

### I-19 · La firma se verifica antes que la ventana temporal · `Vigente`
**Fecha:** 2026-09-01 (T4)
**Motivo:** si el reloj se chequeara primero, una credencial falsificada **y**
vencida se reportaría como "vencida", ocultando la falsificación. Cubierto por
un test y por un mutation test (invertir el orden pone 5 tests en rojo).

### I-20 · `__constructor` en vez de un `initialize()` separado · `Vigente`
**Fecha:** 2026-09-01 (T5)
El admin se fija en el constructor, que corre atómicamente con el despliegue.
**Motivo:** un `initialize()` aparte deja una ventana entre desplegar e
inicializar en la que cualquiera puede reclamar el admin.

### I-21 · Eventos tipados con `#[contractevent]` · `Vigente`
**Fecha:** 2026-09-01 (T5)
`env.events().publish()` está deprecado en SDK 27.
**Motivo:** además de quitar el warning, los eventos tipados entran en la
**interfaz del contrato**, así que las herramientas externas los descubren
solas. Topics verificados en test: `("agentpass","anchored", issuer, subject)` y
`("agentpass","revoked", issuer)`, exactamente como pedía [A-4](#a-4--superficie-del-contrato-agent_registry--vigente).

### I-22 · Lectores puros añadidos a la superficie · `Vigente`
**Fecha:** 2026-09-01 (T5)
`get_admin`, `get_issuer`, `get_credential`.
**Motivo:** [A-5](#a-5--verificar-son-exactamente-3-chequeos--vigente) exige que
el tercer chequeo sea `status == Active` **y el emisor activo**, pero `CredStatus`
no tiene variante para "emisor desactivado" y la superficie listada no incluía
forma de leerlo. Sin estos lectores A-5 no se puede implementar. No cambian
ninguna decisión: la completan.

### I-23 · Re-anclar un hash existente se rechaza · `Vigente`
**Fecha:** 2026-09-01 (T5)
**Motivo:** si `anchor` sobrescribiera, un emisor podría **resetear a activa una
credencial ya revocada** volviéndola a anclar. Cubierto por test y mutation test.

### I-24 · Un emisor desactivado sí puede revocar · `Vigente`
**Fecha:** 2026-09-01 (T5)
**Motivo:** revocar es una operación de seguridad. Quitarle esa capacidad a un
emisor desactivado sería fallar en la dirección equivocada — dejaría credenciales
vivas sin nadie que pueda cortarlas.

### I-25 · Revocado gana sobre expirado; el borde es inclusivo · `Vigente`
**Fecha:** 2026-09-01 (T5)
Una credencial revocada **y** vencida lee `Revoked`, por ser la afirmación más
fuerte. En el instante exacto de `expires_at` sigue `Active`, igual que el
`validUntil` off-chain de [T4](credential-schema.md). **Motivo:** que los dos
lados de la verificación no discrepen en el borde.

### I-26 · TTL: umbral 30 días, extender a 90, en cada escritura · `Vigente`
**Fecha:** 2026-09-01 (T5)
**Motivo:** [A-4](#a-4--superficie-del-contrato-agent_registry--vigente) advierte
que sin extender el TTL el estado se archiva y la demo se cae en semanas.
**Limitación conocida:** el entorno de tests de Soroban **no simula archivado** —
se comprobó desactivando la extensión por completo y un test de "sigue viva a los
60 días" seguía pasando. Ese test se eliminó por dar confianza falsa. La garantía
real es la aserción directa sobre `get_ttl`, más la verificación contra la red
en T6.

---

## Pendientes de decidir

_(ninguno abierto)_

### P-1 · Formato del `kid` en el header del JWS · `Resuelta en I-14`

### P-2 · ¿Documento DID completo con `publicKeyMultibase`? · `Resuelta en I-15`
