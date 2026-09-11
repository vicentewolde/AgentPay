# Decisiones — Fase 6 (AgentGuard + comercialización)

> Una entrada por decisión, con su motivo y la alternativa que se descartó.
> **No se borran entradas**: si una decisión se revierte, se marca como
> `Superada` y se agrega la nueva. Prefijo `C-` (de "Comercialización").

---

### C-1 · Un seed maestro derivado, no un secreto por tenant · `Vigente`
**Fecha:** 2026-09-09 (T32)

`@agentpay/tenancy` deriva las llaves de cada tenant desde un único seed
BIP-39 vía SEP-0005/BIP-44, en vez de generar y guardar un secreto Stellar
independiente por cada uno.

**Motivo.** Con presupuesto casi nulo y un solo desarrollador, la superficie
de custodia que hay que proteger, rotar y auditar debe ser mínima: un seed
maestro en un gestor de secretos es una sola cosa que vigilar, contra N
secretos independientes que crecen con cada tenant nuevo. Es el mismo
patrón que usa Privy (wallets-as-a-service) para wallets de usuario final,
aplicado al estándar propio de Stellar. El costo marginal de un tenant
nuevo pasa a ser una fila en una tabla (su índice), no un secreto nuevo que
alguien tenga que generar y guardar con cuidado.

**Alternativa descartada:** una cuenta cloud (KMS/HSM) por tenant, al
estilo Turnkey. Se descartó por costo — Turnkey cobra desde ~$99 USD/mes
más cargo por firma, muy por encima del techo de $200 USD/mes total del
proyecto — y por complejidad operativa desproporcionada para un piloto con
pocos partners.

### C-2 · El rol (`agent`/`issuer`) se codifica como paridad del índice de cuenta, no como una ruta de derivación separada · `Vigente`
**Fecha:** 2026-09-09 (T32)

Dado un `tenantIndex`, la cuenta SEP-0005 derivada es `tenantIndex * 2` para
el agente y `tenantIndex * 2 + 1` para el issuer — un único nivel de
derivación (`m/44'/148'/<cuenta>'`), no dos rutas distintas por rol.

**Motivo.** SEP-0005 define un solo nivel de cuenta hardened; introducir un
nivel adicional para "rol" habría sido una extensión no estándar del
esquema, sin ganar nada — la paridad par/impar ya garantiza que ningún
tenant colisiona consigo mismo, y es trivialmente invertible (dado un
índice de cuenta, se sabe a qué tenant y rol pertenece: `tenantIndex =
Math.floor(cuenta / 2)`, `role = cuenta % 2 === 0 ? "agent" : "issuer"`) sin
guardar esa relación en ningún lado.

**Alternativa descartada:** dos wallets HD independientes (dos seeds, o dos
sub-árboles de derivación) para separar agente e issuer. Se descartó por
innecesaria — la paridad resuelve la separación con la misma garantía
criptográfica y una sola frase semilla que proteger.

### C-3 · `@agentpay/tenancy` no lee `.env.local` ni ninguna variable de entorno · `Vigente`
**Fecha:** 2026-09-09 (T32)

El paquete recibe el seed maestro como parámetro de función; no tiene
ningún código que lea `process.env` ni archivos de configuración.

**Motivo.** Mismo principio de capas que el resto del monorepo:
`packages/*` es lógica pura y reusable, `apps/*` decide de dónde sale cada
secreto. Hoy `apps/web` seguiría leyendo `.env.local` en desarrollo; la
migración a un gestor de secretos (Doppler/Infisical) es una decisión de
`apps/web`, no de este paquete — así el paquete sigue siendo válido sin
cambios el día que esa decisión cambie.

**Alternativa descartada:** que el paquete leyera `MASTER_MNEMONIC` de
`process.env` directamente, para ahorrarle una línea a quien lo use. Se
descartó porque acopla una librería pura a una convención de configuración
de una sola app, y porque dificulta testear la función con valores
explícitos (como hacen los tests de este mismo hito).

### C-4 · `stellar-hd-wallet` se usa solo para derivar strings, nunca sus objetos `Keypair` · `Vigente`
**Fecha:** 2026-09-09 (T32)

`deriveTenantKeypair` devuelve `{ publicKey, secret }` como strings — nunca
un objeto `Keypair` de la librería `stellar-hd-wallet`.

**Motivo.** `stellar-hd-wallet` depende de `@stellar/stellar-base@13.1.0`
internamente, una versión distinta (y potencialmente distinta identidad de
clase en tiempo de ejecución) de la que trae `@stellar/stellar-sdk@17.0.1`
que ya usa el resto del proyecto. Devolver strings strkey (`G.../S...`) —
un formato de texto estándar, no un objeto de una librería específica— deja
que cualquier llamador reconstruya su propio `Keypair` con la versión del
SDK que ya tiene, sin arriesgar bugs de `instanceof` entre dos copias de la
misma clase.

**Alternativa descartada:** forzar una única versión de `@stellar/stellar-base`
en todo el monorepo vía resoluciones de pnpm. Se descartó por alcance —
resuelve un problema que ni siquiera se manifestó (los tests de este hito
no necesitaron ningún objeto `Keypair` de `stellar-hd-wallet`) a cambio de
fijar una dependencia transitiva de un paquete de terceros.

### C-5 · La columna `entry` es `json`, no `jsonb` · `Vigente`
**Fecha:** 2026-09-09 (T33)

`vault_records.entry` en Postgres se declaró `json`, después de que la
primera versión (`jsonb`) hiciera fallar `verify()` en el propio test de
integración del hito, no en teoría.

**Motivo, con el bug real encontrado.** `computeHash` recalcula sobre
`JSON.stringify({ seq, prevHash, entry })` — sensible al orden de las
claves. Postgres's `jsonb` normaliza el objeto al guardarlo (no promete
preservar el orden de inserción de las claves), mientras que `json`
preserva el texto exacto que se le dio. Con `jsonb`, un registro escrito y
después releído en una instancia nueva (exactamente lo que pasa después de
un reinicio) podía volver con las claves en otro orden — mismo contenido,
`JSON.stringify` distinto, hash recalculado distinto, `verify()` reportando
manipulación que nunca ocurrió. El test
`"survives being reconstructed — the exact scenario a Render restart
forces"` lo encontró de inmediato contra la base real.

**Alternativa descartada:** una función de hash con serialización canónica
(claves ordenadas alfabéticamente) en vez de cambiar el tipo de columna. Se
descartó porque `computeHash` ya es una pieza probada y compartida con el
backend de archivo (`createFileMandateVault`) — cambiarla habría invalidado
retroactivamente cualquier hash ya calculado y anclado on-chain (T28), y el
backend de archivo nunca tuvo este problema porque `JSON.parse`/
`JSON.stringify` de Node sí preservan el orden de las claves de punta a
punta. Cambiar la columna de Postgres es la corrección más chica que no
toca nada ya cerrado.

### C-6 · T33 mantiene el modelo de tenancy por sesión; la identidad Stellar propia por tenant queda para un hito aparte · `Vigente`
**Fecha:** 2026-09-09 (T33)

`createPostgresMandateVault` se cableó en `apps/web` usando el mismo
`sessionId` que ya identificaba cada visitante (antes, la clave de un
archivo JSONL; ahora, la columna `tenant_id`). Ninguna cuenta Stellar nueva
se deriva todavía con `@agentpay/tenancy` (T32) dentro de `apps/web` — todos
los visitantes siguen firmando con `AGENT_SECRET_KEY`/`ISSUER_SECRET_KEY`
compartidos.

**Motivo.** El problema identificado con más urgencia en la investigación de
`P-6` tenía dos mitades independientes: (a) el vault se borra en cada
reinicio de Render (arreglado acá, T33) y (b) los visitantes comparten
fondos e identidad (sigue sin resolver). Resolver (b) de verdad exige
decidir antes un modelo de onboarding —¿se fondea automáticamente una
cuenta nueva por tenant vía Friendbot + trustline de USDC en el momento en
que se crea?, ¿qué dispara "esto es un tenant nuevo" en vez de "otra visita
anónima"?— que todavía no se conversó con el usuario. Separar (a) de (b)
deja lista la pieza de infraestructura (persistencia real) sin bloquearla
en una decisión de producto que merece su propia conversación, siguiendo el
mismo criterio que ya usó `G-8` en la Fase 4 (documentar un hueco conocido
en vez de resolverlo apurado).

**Alternativa descartada:** cablear `@agentpay/tenancy` en el mismo hito,
asumiendo un fondeo automático vía Friendbot para cada tenant nuevo. Se
descartó porque es una decisión de producto (qué cuenta como "tenant", cómo
se fondea, qué pasa si el fondeo falla a mitad de un flujo) que el usuario
no había visto todavía — construirla sin esa conversación arriesgaba
resolver la pregunta equivocada.

### C-7 · Las escrituras del vault de Postgres se serializan con una cola de promesas dentro del proceso · `Vigente`
**Fecha:** 2026-09-09 (T33)

`createPostgresMandateVault` encadena cada `append()` sobre el resultado del
anterior (`writeQueue = writeQueue.then(...)`), en vez de dejar que dos
llamadas concurrentes corran su `INSERT` en paralelo.

**Motivo.** A diferencia del backend de archivo (`V-7`), cuya escritura es
enteramente síncrona y por lo tanto atómica dentro de un tick del event
loop, acá el `INSERT` es async — hay un punto real de suspensión
(`await pool.query(...)`) entre leer `records.length` (para calcular `seq`)
y confirmar la escritura. Sin serializar, dos llamadas a `record()` que se
superpongan podrían calcular el mismo `seq`/`prevHash` y competir por la
misma fila, violando la restricción `primary key (tenant_id, seq)` de forma
impredecible en vez de en orden. La cola de promesas garantiza que la
segunda llamada empiece a leer `records.length` recién después de que la
primera ya empujó su registro — mismo límite ya documentado que el resto
del proyecto acepta (durable dentro de un proceso, no entre más de uno
escribiendo el mismo `tenant_id` a la vez), ahora aplicado a un backend
async.

**Alternativa descartada:** un `SELECT ... FOR UPDATE`/transacción a nivel
de base de datos para serializar entre procesos también. Se descartó por
alcance — el pilot corre una sola instancia de `apps/web` a la vez; resolver
la concurrencia entre procesos es la misma pregunta que "más de una
instancia de Render" abre en general, no algo específico de este hito.

### C-8 · Conectar la wallet ata la identidad del vault, no todavía quién firma el Mandato · `Vigente`
**Fecha:** 2026-09-09 (T34)

El usuario pidió interacción Web3 real al registrarse — conectar una wallet
o crear una nueva. T34 conecta una wallet real (Freighter) y verifica
criptográficamente que el visitante la controla, pero **no** cambia quién
firma la credencial ni el Mandato — eso sigue siendo `ISSUER_SECRET_KEY`/
`AGENT_SECRET_KEY`, igual que antes de este hito.

**Motivo, con el límite técnico real detrás.** Para que la wallet conectada
fuera de verdad el "principal" que firma el Mandato, la firma del documento
tendría que ser un `Ed25519` crudo hecho por esa wallet — pero las wallets
(por diseño, para que un sitio no pueda hacerte firmar a ciegas una
transacción disfrazada de mensaje) no exponen firma cruda: exponen
`signMessage` (SEP-0043), que envuelve el mensaje con el prefijo
`"Stellar Signed Message:\n"` y lo hashea con SHA-256 antes de firmar
(SEP-0053). `verifyMandate` (Fase 3, cerrada) no sabe verificar esa forma —
espera el perfil JWS propio de AgentPass. Extender esa verificación para
aceptar una firma SEP-0053 como alternativa válida es un cambio real al
esquema de firma de una fase cerrada, y merece su propia revisión explícita
con el usuario antes de tocarlo — no se hizo de pasada en este hito.

**Qué sí se resolvió con esto.** La identidad del **tenant** (para efectos
de la bitácora de MandateVault, T33) ahora puede ser la wallet conectada en
vez de una cookie aleatoria por visita — ver `C-9`. Es progreso real hacia
multi-tenancy sin tocar la superficie de firma cerrada.

**Alternativa descartada:** firmar el Mandato con la llave de la plataforma
pero declarando `principal` como la wallet conectada. Se descartó de
inmediato — `checkMandate`/`verifyMandate` comparan que quien firmó
coincida con quien el documento dice ser (`SignerMismatch`); mentir sobre
quién firmó sería el mismo tipo de bypass que `B-25` (Fase 2) ya documentó
como inaceptable, solo que introducido a propósito en vez de por un bug.

### C-9 · El `tenant_id` de una wallet conectada es determinístico, no un UUID aleatorio · `Vigente`
**Fecha:** 2026-09-09 (T34)

`walletTenantId(address)` deriva el `tenant_id`/cookie de sesión de un
visitante conectado como `sha256(address)` recortado y reacomodado con
guiones para tener la misma forma que un UUID — no un UUID v5 real (sin
bits de versión/variante), y no un `randomUUID()`.

**Motivo.** Sin esto, cada visita —incluso de la misma wallet— generaría un
`tenant_id` nuevo (como pasaba antes de este hito), y la bitácora de
MandateVault de un usuario que vuelve nunca se encontraría a sí misma.
Con la derivación determinística, conectar la misma wallet dos veces —
verificado en vivo, dos veces— cae siempre en el mismo `tenant_id`, así
que su historial persiste entre visitas, no solo entre reinicios del
servidor (que ya resolvía T33).

**Alternativa descartada:** una tabla `wallet_sessions` en Postgres que
mapee `address → session_id` aleatorio, generado una vez y reusado después.
Se descartó por innecesaria — un hash determinístico da la misma garantía
(mismo input, mismo output, siempre) sin una tabla ni una consulta extra
antes de poder emitir la cookie.

### C-10 · `isConnected()` se llama antes que `requestAccess()`, nunca al revés · `Vigente`
**Fecha:** 2026-09-09 (T34)

El flujo de conexión llama primero a `freighterApi.isConnected()` y solo
sigue a `requestAccess()` si devuelve `true`.

**Motivo, con el bug real encontrado probando contra un navegador sin la
extensión instalada — no leyendo la documentación de Freighter.**
`requestAccess()` espera una respuesta de la extensión vía mensajería del
navegador; si no hay ninguna extensión escuchando, esa promesa **nunca se
resuelve ni rechaza** — cuelga el botón para siempre, sin ningún mensaje de
error. `isConnected()`, en cambio, responde rápido en los dos casos.
Encontrado corriendo la página real sin Freighter instalado y viendo el
botón quedarse colgado, no por inspección de código.

**Alternativa descartada:** envolver `requestAccess()` en un timeout
propio (ej. `Promise.race` con un `setTimeout` de unos segundos). Se
descartó porque agrega un número mágico (¿cuántos segundos son
"razonables" para que alguien apruebe en su wallet?) a cambio de resolver
un problema que `isConnected()` ya resuelve gratis y sin inventar nada.

### C-11 · Deferred, sin construir todavía: una cuenta Stellar propia y fondeada por tenant · `Vigente`
**Fecha:** 2026-09-09 (T34)

`@agentpay/tenancy` (T32) sigue sin cablearse dentro de `apps/web` — cada
tenant, wallet conectada o no, sigue gastando desde la cuenta compartida
`AGENT_SECRET_KEY`.

**Motivo — el bloqueante real no es de código, es de un tercero.**
`scripts/fund-usdc-trustline.ts` (Fase 4) ya documentaba esto: la
trustline de USDC se puede abrir por script, pero el **saldo** de USDC
solo se puede cargar a mano, en el faucet de testnet de Circle (un
formulario web de terceros, no una API). Derivar y fondear con XLM una
cuenta nueva por tenant es automatizable (Friendbot); dejarla con USDC de
verdad para que pueda comprar algo, no — necesitaría una pantalla nueva
("tu wallet no tiene USDC todavía, andá a este faucet") que todavía no se
diseñó ni se le mostró al usuario.

**Alternativa descartada:** lanzar el fondeo automático igual, aceptando
que el primer intento de compra de cada tenant nuevo falle por falta de
saldo. Se descartó porque enviar a alguien a probar el producto y que
falle en el primer clic, sin explicación, es peor que no ofrecer la cuenta
propia todavía — mejor un hueco anotado que una demo rota.

### C-12 · El pool de Postgres pide SSL explícitamente, sin verificar la CA · `Vigente`
**Fecha:** 2026-09-09

`createPostgresMandateVault` pasa `ssl: { rejectUnauthorized: false }` a su
`Pool` de `pg` — antes no pasaba ninguna opción de `ssl`.

**Motivo, con el bug real en producción que lo disparó.** El usuario probó
`apps/web` desplegado en Render y "Iniciar sesión" falló con "could not
reach or initialise the vault's Postgres database" — el mismo código que
en local (contra la misma base de Supabase) funcionaba sin problema.
Supabase exige TLS para conexiones externas; `pg` no lo negocia solo a
partir de una cadena `postgresql://` común, y el paquete de autoridades
certificadoras que trae Node por defecto no incluye la cadena de Supabase
— por eso hace falta `rejectUnauthorized: false` (sigue siendo una
conexión cifrada; lo que se salta es la verificación de la CA, no el
cifrado en sí). Es el mismo ajuste que documentan casi todas las guías de
"conectar Supabase desde Render/Vercel/Heroku". Verificado localmente
antes de aplicarlo: conecta igual con la opción puesta, así que no hay
riesgo de regresión en desarrollo.

**Nota de higiene, en el mismo cambio.** El error real que causó esto
nunca llegaba a ningún lado — ni a los logs del servidor (nada llamaba a
`console.error`) ni a la respuesta HTTP (`details` no llevaba el mensaje
de la causa). Se agregó `console.error` en el punto exacto de la falla y
se sumó `details.cause` al error, que ahora también se muestra en la
página (`apps/web/public/index.html`) — la próxima vez que algo similar
falle, no va a hacer falta adivinar ni pedir los logs de Render a ciegas.

**Alternativa descartada:** verificar la CA de verdad, cargando el
certificado raíz de Supabase explícitamente. Se descartó por ahora —
agrega un archivo más para mantener sincronizado si Supabase rota su CA,
a cambio de una garantía que no cambia el riesgo real del proyecto (los
datos que viajan por acá son la bitácora de un piloto en testnet, no
información sensible de producción).

### C-13 · La wallet firma el Mandato por un camino de verificación paralelo, no extendiendo `verifyMandate` (JWS) · `Vigente` — resuelve el hueco de `C-8`
**Fecha:** 2026-09-09 (T35)

`packages/mandate/src/wallet-sign.ts` agrega `verifyWalletSignedMandate` como
una función nueva e independiente de `verifyMandate` — no una rama dentro de
ella. Un Mandato firmado por wallet no tiene JWS: es el documento en JSON
canónico más una firma SEP-0053 sobre un mensaje-resumen legible
(`mandateChallengeMessage`), verificada con `verifyStellarMessage` (`C-9`,
Fase 6, ya existente desde T34's wallet-connect).

**Motivo, con la incompatibilidad criptográfica real detrás — la misma que
`C-8` dejó anotada sin resolver.** Un JWS compacto EdDSA firma los bytes
crudos de `header.payload`, sin ningún prehash. SEP-0053 (lo único que una
wallet expone para firmar texto arbitrario) firma
`sha256("Stellar Signed Message:\n" + mensaje)` — un esquema de bytes
distinto, no una variante del mismo. Ninguna wallet puede producir jamás una
firma JWS válida; no es una limitación de Freighter en particular, es cómo
está diseñado el estándar (para que un sitio no pueda hacer firmar a ciegas
algo que parece un mensaje pero es otra cosa). Extender `verifyMandate` para
aceptar además una firma SEP-0053 habría significado ramificar una función
de una fase cerrada (Fase 3) según de dónde vino la firma — exactamente el
tipo de cambio silencioso a una decisión cerrada que `CLAUDE.md` prohíbe sin
avisar primero. Se avisó (con esta evidencia) antes de construir nada.

**Cómo quedó separado, en la práctica.** `MandateSource` (`apps/agent`) es
ahora `string | { mandate, signature }` — una unión, no un envoltorio con
discriminador — así que todo el código que ya pasaba un JWS crudo (agente,
tools, tests) sigue compilando sin cambios. `checkOwnMandate` y
`createOnChainMandateVerifier` despachan según `typeof source` hacia
`verifyMandate`+`verifyMandateOnChain` (JWS) o hacia
`verifyWalletSignedMandate`+`verifyWalletSignedMandateOnChain` (wallet) — las
dos ramas comparten el chequeo on-chain (`checkOnChainStatus`, extraído en
este hito) pero nunca comparten la verificación offline de la firma.

**Alternativa descartada.** Ramificar `verifyMandate` internamente según la
forma del string recibido (JWS vs. algo más). Se descartó de inmediato por
la razón de arriba — tocar una función cerrada de la Fase 3 en vez de sumar
una nueva al lado.

### C-14 · Anclar y revocar un Mandato firmado por wallet es un flujo de dos fases (`prepare` → firma en la wallet → `submit`), reusando `AssembledTransaction` de la Fase 1 · `Vigente`
**Fecha:** 2026-09-09 (T35)

`Registry.prepareAnchor`/`prepareRevoke` (`packages/sdk`) arman y simulan la
misma llamada al contrato que `anchor()`/`revoke()` ya hacían, pero se
detienen antes de firmar: devuelven `{ requestId, xdr }` (la transacción sin
firmar, serializada). `Registry.submitSigned(requestId, signedTxXdr)` la
retoma más tarde y la envía, usando el `signedTxXdr` que la wallet devolvió
como si fuera la respuesta de un `signTransaction` normal
(`.signAndSend({ signTransaction: async () => ({ signedTxXdr }) })`).

**Motivo.** Anclar un Mandato en `agent_registry` exige que quien lo firma
sea `issuer.require_auth()` — la wallet, no este servidor, que nunca tuvo ni
va a tener su llave secreta. Una transacción no se puede firmar a mitad de
una petición HTTP y esperar a que el navegador la apruebe: hacen falta como
mínimo dos idas y vueltas (preparar, firmar en la wallet, enviar). En vez de
reconstruir esto a mano contra XDR/RPC crudo, se usó
`AssembledTransaction` — la misma abstracción de `@stellar/stellar-sdk/contract`
que la Fase 1 ya trae adentro de `Client.from(...)` — porque ya expone
exactamente esta forma: `.toXdr()` para serializar sin firmar, y
`.signAndSend({ signTransaction })` acepta cualquier callback con la firma
de una wallet real, sin que este proyecto tenga que saber nada del formato
interno de la transacción.

**Por qué el `Registry` recuerda la transacción preparada en memoria, por
`requestId`, en vez de que el cliente la reenvíe completa.** Enviar solo la
firma (no la transacción entera de vuelta) es más chico y evita que un
cliente que edite el XDR a mano cuele una transacción distinta a la que se
simuló. El costo es que `pendingWrites` vive en memoria del proceso — con
TTL de 10 minutos, igual que `pendingWalletSessions` en `apps/web` — y por
eso las tres peticiones del flujo (`start` → `wallet-consent` → `wallet-anchor`)
tienen que compartir la misma instancia de `AgentPass`/`Registry`: una
instancia nueva por petición no sabría nada del `requestId` que una
petición anterior generó. `apps/web` lo resuelve guardando la instancia
completa en `PendingWalletSession`, no solo sus datos.

**Alternativa descartada.** Reconstruir la transacción a mano (leer el XDR,
armar los `Operation`, firmar) sin pasar por `AssembledTransaction`. Se
descartó por riesgo — reimplementar algo que el propio SDK de Stellar ya
resuelve y prueba, con auth entries de Soroban que son fáciles de armar mal
a mano.

### C-15 · Una wallet conectada se registra como issuer automáticamente, sin aprobación manual · `Vigente`
**Fecha:** 2026-09-09 (T35)

`ensureWalletIsRegisteredIssuer` (`apps/web/src/server.ts`) llama a
`registerIssuer` con la llave de administrador apenas una wallet verificada
(T34) intenta anclar su propio Mandato, si todavía no está registrada o
activa — sin ningún paso intermedio de revisión humana.

**Motivo.** Confirmado explícitamente con el usuario (pregunta directa,
antes de construir esto): para un piloto en testnet, "conectó y probó
criptográficamente que controla la wallet" ya es suficiente confianza para
dejarla anclar sus propios Mandatos — pedir una aprobación manual agregaría
fricción a la demo sin una amenaza real detrás en este contexto (testnet,
sin fondos reales en juego). Es una elección deliberada para esta etapa, no
una política que se vaya a llevar a producción sin revisarla de nuevo.

**Alternativa descartada.** Una cola de aprobación manual (el admin revisa y
aprueba cada wallet nueva antes de que pueda anclar). Se descartó por
alcance — resuelve un problema de confianza que este piloto todavía no
tiene (no hay fondos reales en juego, es testnet) a cambio de fricción real
en cada demo.

### C-16 · Deferred, sin construir en este hito: cuentas propias fondeadas por tenant, aunque la precondición de USDC ya no lo bloquea · `Vigente`
**Fecha:** 2026-09-09 (T35)

Con la wallet ahora firmando de verdad su propio Mandato, el agente sigue
gastando desde la cuenta compartida `AGENT_SECRET_KEY` — `@agentpay/tenancy`
(T32) sigue sin cablearse dentro de `apps/web`. El usuario ya removió el
bloqueante de fondeo de `C-11` (asumiendo que quien conecta su wallet ya
tiene USDC de testnet cargado de antes), pero eso resuelve la mitad del
problema, no las dos.

**Motivo.** Cablear identidad Stellar propia por tenant es una pieza
independiente de que la wallet firme el Mandato — el usuario pidió
explícitamente "dale con la firma del mandato" como alcance de este hito,
no "dale con todo lo de tenancy". Sumarlo de pasada habría sido expandir el
alcance sin que el usuario lo pidiera, la misma razón que ya justificó
`C-6` en T33.

**Alternativa descartada:** cablear `@agentpay/tenancy` en el mismo hito ya
que la precondición de USDC lo desbloquea. Se descartó por alcance — sigue
faltando decidir cómo y cuándo se deriva el índice de tenant de cada
wallet nueva, una conversación de producto que no se tuvo todavía.

### C-17 · La credencial nombra a la wallet como `principal` aunque la siga emitiendo la plataforma · `Vigente`
**Fecha:** 2026-09-10 (T35, corrección)

Cuando hay una wallet conectada, el `credentialSubject.principal` de la
credencial AgentPass es el DID de esa wallet — el mismo que el `issuer` del
Mandato. El `issuer` de la credencial sigue siendo la plataforma
(`ISSUER_SECRET_KEY`), sin cambios.

**Motivo, con el bug real en producción que lo forzó.** T35 hizo que el
Mandato lo firmara la wallet, pero dejó la credencial diciendo que el
principal del agente era la plataforma. `checkMandate` (T17, Fase 3)
compara `mandate.issuer` contra `intent.principal`, y `intent.principal`
se lee de la credencial — así que los dos documentos firmados se
contradecían y **toda compra** de una sesión con wallet fallaba con
`MandatePrincipalMismatch`. El chequeo hizo exactamente lo que debía: es
la evidencia de consentimiento la que no cerraba. Ahora los dos documentos
derivan el principal de un único valor (`principalDid` en `startSession`),
así que no pueden volver a separarse.

**Qué asunción de la Fase 1 cambia esto, dicho explícitamente.**
`packages/core/src/credential.ts` documentaba que `principal` era "siempre
el DID del propio emisor en este piloto — no hay un rol de principal
separado". T35 crea exactamente ese rol separado: la plataforma **atesta**
la identidad y el scope del agente (emisor), la wallet **consiente** el
gasto (principal). Ninguna verificación exigía que coincidieran —era una
observación, no una regla, y no hay ningún esquema ni chequeo que cambie—,
pero el comentario se actualizó para que no siga afirmando algo que dejó
de ser cierto.

**Alternativa descartada:** relajar `checkMandate` para que aceptara un
`principal` distinto del emisor del Mandato. Se descartó de inmediato — es
el chequeo que prueba que quien consintió es quien dice el intent; aflojarlo
sería exactamente el tipo de bypass que `B-25` (Fase 2) dejó documentado
como inaceptable. El problema nunca estuvo en el chequeo, sino en cómo
`apps/web` armaba los documentos.

### C-18 · `apps/web` se testea por costuras extraídas, no levantando el servidor · `Vigente`
**Fecha:** 2026-09-10 (T36)

`server.ts` se partió en tres módulos que no tocan la red ni el estado del
servidor — `env.ts` (leer y validar configuración), `session-documents.ts`
(construir la credencial y el Mandato) y `wallet-session.ts` (cookies,
nonces, y el estado efímero del flujo de wallet) — y los tests apuntan a
esos módulos. `server.ts` queda como cableado, rutas y `listen`.

**Motivo, elegido a partir de dónde fallaron las cosas de verdad.** Los tres
fallos de producción de T35 estuvieron exactamente en dos de esas costuras:
dos en la lectura de configuración (`ADMIN_SECRET_KEY` sin declarar, después
con una clave pública en vez del secreto) y uno en la construcción de los
documentos (`C-17`). Ninguno era un bug de red ni de HTTP; los tres eran
lógica pura que no tenía un solo test porque vivía dentro de un archivo que
levanta un servidor apenas se lo importa. Extraer la lógica pura es lo que
la vuelve testeable sin base de datos, sin testnet y sin puerto.

**Alternativa descartada:** exportar `handle(req, res)` y testear al nivel
de HTTP con `req`/`res` simulados. Se descartó porque el camino más
interesante —iniciar sesión— llama a testnet, a Postgres y al bazaar en la
misma función: un test así necesitaría simular todo eso para llegar a la
línea que importa, y terminaría probando los dobles más que el código. Los
caminos HTTP siguen verificándose como hasta ahora, de punta a punta contra
testnet real, que es donde ese tipo de camino sí se prueba de verdad.

**Un cambio de comportamiento chico, deliberado, en el mismo movimiento.**
Las sesiones de wallet a medio terminar vivían en dos `Map` paralelos (el
valor en uno, su vencimiento en el otro) que había que mantener sincronizados
a mano en cada llamada. Ahora hay un solo `createExpiringStore`, con el
vencimiento chequeado al leer, compartido con los nonces del challenge. De
paso, el nonce se consume **antes** de verificar la firma, no después: un
nonce se gasta por ser presentado, así que una firma incorrecta ya no puede
reintentarse contra el mismo challenge.

### C-19 · Un tenant es la relación (partner, usuario final), no el partner ni el workspace · `Vigente`
**Fecha:** 2026-09-10 (T37)

`CloudOps` es un **partner**. Cada usuario final suyo —`usr_123`— tiene su
propio **tenant**, aislado del resto. El escenario objetivo que el usuario
describió es de ~500 partners con miles de usuarios cada uno, es decir del
orden de **un millón de tenants**; el primer escenario a construir es
deliberadamente de dos partners, dos usuarios y dos comercios.

**Motivo.** Es la única lectura que sostiene las distinciones del brief: un
mismo principal usando la misma wallet con dos partners tiene que quedar en
espacios separados, y eso solo pasa si el tenant incluye al partner **y** al
usuario. Un tenant por partner metería a todos sus usuarios en el mismo
`perDay` y la misma bitácora.

**Consecuencia que obliga a `C-20` y `C-21`.** Un millón de tenants no es una
abstracción gratuita: bajo el modelo de fondos elegido, cada tenant querría
una cuenta Stellar y un contrato propios, y ambos cuestan saldo bloqueado y
renta en la cadena. Ver `C-21`.

**Alternativa descartada:** tenant = partner, con el usuario final como un
`principal` más dentro de él. Se descartó porque colapsa el aislamiento que
es la razón de ser de la entidad — y porque el brief pide explícitamente que
"un mismo principal pueda usar la misma wallet con varios partners y tener
tenants, agentes y mandatos separados".

---

### C-20 · El modelo de fondos del producto es el smart account por tenant, fondeado por el principal · `Vigente`
**Fecha:** 2026-09-10 (T37)

De las cuatro alternativas presentadas en
[PLATAFORMA-PARTNERS.md §4.1](PLATAFORMA-PARTNERS.md), el usuario eligió la
**opción 3**: Vinny fondea un `policy_rail` propio de su tenant, y el agente
gasta desde ahí con `per_tx`/`per_day` aplicados por la red dentro de la
misma transacción que mueve el dinero.

**Motivo.** Es la única de las cuatro donde los límites los aplica la cadena
y no el software, y es literalmente la tesis del proyecto ya escrita en Rust
(`contracts/policy-rail`, T22/T31). La opción 1 (la wallet firma cada pago)
elimina la autonomía que da sentido al producto; la opción 2 se descartó por
un hecho del protocolo y no por preferencia —Stellar da a los firmantes
adicionales *pesos y umbrales, no montos*, así que una "clave de sesión"
sobre una cuenta clásica tiene poder sobre todo el saldo—; la opción 4
(custodia total) es lo que el producto hace hoy en testnet y lo que su propia
narrativa dice que no hay que hacer.

**Lo que queda explícitamente rotulado, no escondido.** La opción 4 sigue
existiendo como **modo demo de testnet**, apagable, para que el visitante
casual pueda probar sin fondear nada. Lo que cambia es que deja de ser el
único modo y deja de ser el modo por omisión de un tenant real.

**Precondición registrada, no construida.** `contracts/policy-rail/src/lib.rs`
no tiene retiro, ni rotación de owner, ni revocación: quien fondee un rail
cuyo owner tenga AgentPay **no puede recuperar su saldo**. En testnet con
montos simbólicos es tolerable y así queda. Antes de cualquier fondo real es
bloqueante. Es un cambio de contrato — área restringida por `CLAUDE.md` — y
**no se construye sin pedido explícito del usuario**.

**Segunda limitación del contrato, encontrada al leerlo para esta decisión.**
`policy_rail` fija **un solo asset** en su constructor (`asset`, documentado
en su propio docstring como simplificación deliberada de `M-14`). Un tenant
que quiera comprar en dos assets necesita dos rails, o un cambio de contrato.
Se registra; no se resuelve.

**Alternativa descartada:** decidir esto más adelante y avanzar con la cuenta
compartida. Se descartó porque el modelo de fondos gobierna el modelo de
entidades, el onboarding y la superficie de API — construir esas tres cosas
sin la decisión tomada garantiza rehacerlas.

---

### C-21 · La identidad on-chain de un tenant se crea de forma perezosa: derivar es gratis, existir en la cadena no · `Vigente`
**Fecha:** 2026-09-10 (T37)

Crear un tenant **no** despliega nada en Stellar. Se le asigna su índice de
derivación y se calcula su par de llaves (`deriveTenantKeypair`, T32), que es
una operación local, offline y sin costo. La cuenta Stellar del agente y el
contrato `policy_rail` del tenant se crean **recién cuando ese tenant va a
gastar de verdad**.

**Motivo, con los números del propio repo.** Bajo `C-19` (un millón de
tenants) y `C-20` (un rail por tenant), crear todo por adelantado significa:
una cuenta Stellar por agente, cada una con el saldo mínimo que la red exige
para que la cuenta exista, más un despliegue de contrato por tenant con su
fee y su renta. El spike de T22 fondeó su rail de prueba con **1 XLM**
(`docs/fase-3-policyrail-mandato/evidencia/T22-spike.md` §8) y midió que la
renta de TTL es la partida que domina el costo —203 831 stroops contra
48 886 sin ella, §9.1—. Multiplicado por un millón de tenants, el costo de
existir en la cadena es del orden de un millón de XLM inmovilizados. La
inmensa mayoría de los usuarios de un partner nunca van a comprar nada.

**Alternativa descartada:** crear la cuenta y el rail al dar de alta el
tenant, para que "todo esté listo". Se descartó por el costo de arriba y
porque no compra nada: el momento en que el tenant necesita su identidad
on-chain es exactamente el momento en que consiente y fondea, no antes.

---

### C-22 · La integración es híbrida: API hospedada para lo que debe ser hospedado, SDK local para lo que debe ser verificable · `Vigente`
**Fecha:** 2026-09-10 (T37)

Confirmado por el usuario. **Hospedado por AgentPay:** alta de tenants y
agentes, flujo de consentimiento, custodia de las llaves derivadas, la
decisión de autorización que necesita estado (`perDay`), la bitácora y los
webhooks. **Biblioteca local en el partner:** verificar la credencial,
verificar el Mandato, `checkScope`, `checkMandate`, armar el
`PurchaseIntent`, hablar x402.

**Motivo.** El proyecto ya está construido así y la tesis depende de ello:
`@agentpass/core`, `@agentpass/sdk`, `@agentpay/mandate` y el motor de
`apps/agent` son bibliotecas puras, verificables sin red. Obligar a un
partner a preguntarle a una API si un Mandato es válido, cuando puede
verificar la firma él mismo, destruye la propiedad que hace al producto
distinto ("verificable, no confiable"). A la inversa, el consentimiento y la
bitácora tienen que estar hospedados porque su valor es justamente que no los
controla la parte interesada: un consentimiento que renderiza el partner deja
de ser evidencia de nada.

**Alternativa descartada:** solo SDK (cada partner hospeda todo), que hace
del consentimiento algo fabricable por el propio partner; y solo API, que
tira la verificabilidad local.

---

### C-23 · El primer partner y el primer comercio los construimos nosotros · `Vigente`
**Fecha:** 2026-09-10 (T37)

El usuario quiere diseñar él mismo, más adelante, un partner de referencia y
un comercio de referencia para la primera compra. Hasta entonces, el piloto
no depende de ningún tercero.

**Motivo, y por qué es una mejora sobre el plan anterior.** El riesgo
transversal número uno del `ROADMAP.md` §5 es la dependencia del embajador —
bloqueante directo en la Fase 2 y estructural en la Fase 4. Construir un
partner y un comercio propios lo elimina del camino crítico: el bazaar del
embajador pasa de ser la única integración posible a ser **la segunda**, lo
que además es la prueba real de que el camino de comercio se generalizó
(F7). Un comercio propio también permite ejercitar las variantes que un
tercero no va a producir a pedido: un `402` con un precio distinto al
cotizado, un asset no autorizado, un destinatario que no coincide.

**Alternativa descartada:** esperar a un partner externo antes de diseñar la
API. Se descartó porque congela el trabajo detrás de una conversación que no
depende de nosotros, y porque una API diseñada sin ningún integrador —ni
propio ni ajeno— se diseña a ciegas.

---

### C-24 · El éxito del piloto en testnet es el flujo completo con todas sus variantes, con una entidad de cada tipo · `Vigente`
**Fecha:** 2026-09-10 (T37)

Definición del usuario, textual: el flujo completo de punta a punta con todas
sus variantes y condicionales, con al menos un usuario, un partner, un
comercio, un agente, una compra y todo lo que la compra involucra. Cada
entidad puede ser externa o construida por nosotros (`C-23`).

**Qué significa "todas sus variantes", para que el criterio sea verificable y
no una intención.** No solo el camino feliz: también cada rechazo que el
sistema sabe producir. Como mínimo — venue no autorizado, asset no
autorizado, monto sobre `perTx`, acumulado sobre `perDay`, mandato fuera de
vigencia, mandato revocado, credencial revocada, principal que no coincide
con el firmante, y un `402` cuyo precio no reconcilia con lo firmado. Cada
uno con su código de error tipado y su registro en la bitácora.

**Motivo.** Es un criterio de completitud, no de volumen: no pide escala,
pide que ninguna rama del árbol de decisión quede sin ejercitar. Encaja con
cómo se verificó cada hito de las Fases 1 a 5.

**Alternativa descartada:** una métrica de volumen (N compras, N partners) o
de tiempo de integración. Se descartaron porque en testnet, sin usuarios
reales, ambas se pueden inflar sin que prueben nada.

---

### C-25 · Decisiones menores resueltas junto con las anteriores · `Vigente`
**Fecha:** 2026-09-10 (T37)

Cerradas sin discusión aparte, siguiendo las recomendaciones de
[PLATAFORMA-PARTNERS.md §4.2](PLATAFORMA-PARTNERS.md):

- **`D4` — namespace del `tenant_id` en el vault:** `<partner_id>:<ULID>`,
  no `sha256(wallet)`. El actual colisiona entre partners, que es
  exactamente lo que `C-19` prohíbe. Las filas ya escritas en
  `vault_records` bajo el id viejo **se quedan donde están**: reescribirlas
  rompería la cadena de hashes, que es lo único que el vault promete.
- **`D5` — fase:** esto sigue siendo **Fase 6**, no una fase nueva. Sus
  etapas 2 y 3 documentadas (`CONTEXTO.md` §5) son literalmente este
  trabajo.
- **`D1` — seed maestro:** gestor de secretos (Doppler o Infisical) cuando
  se cablee la derivación (F4), no antes. Confirma lo que `C-3` anticipó.
- **`D2` — quién emite la credencial:** la plataforma, como hoy (`C-17`).
- **`D3` — alta de emisores on-chain:** por partner al alta, **no** por
  wallet conectada. Reemplaza el registro automático de `C-15`, que es un
  camino de escritura on-chain sin límite pagado por la clave admin y
  disparable por cualquiera. `C-15` queda **superada** cuando F5 lo
  implemente; hasta entonces sigue vigente en `apps/web`.
- **`D6` — correlación de una misma wallet entre partners:** se acepta y se
  declara en testnet; se reevalúa antes de cualquier consideración de
  mainnet.

**Diferidas a pedido del usuario, sin decidir:** qué pasa cuando alguien
conecta varias wallets, y toda condición previa a mainnet. Ninguna de las dos
bloquea el trabajo inmediato.

---

### C-26 · El paquete se llama `@agentpay/directory`, no `registry` · `Vigente`
**Fecha:** 2026-09-10 (T38)

El paquete que guarda partners, tenants, principals, agentes, credenciales y
mandatos se llama **directory**.

**Motivo.** "Registry" ya está tomado dos veces en este monorepo y las dos
veces significa otra cosa: `agent_registry` es el contrato Soroban donde se
anclan y revocan hashes (Fase 1), y `packages/sdk/src/registry.ts` es su
cliente. Un tercer "registry" que nombrara un conjunto de tablas Postgres
obligaría, para siempre, a preguntar cuál de los tres es en cada conversación
—y la confusión caería justo sobre la palabra que nombra el punto de
revocación—.

**Alternativa descartada:** meterlo dentro de `@agentpay/tenancy`. Se descartó
porque ese paquete es deliberadamente puro: no lee entorno, no hace I/O, no
tiene dependencias fuera de la derivación (`C-3`). Agregarle un `Pool` de
Postgres rompería exactamente la propiedad que lo hace testeable sin nada
alrededor.

---

### C-27 · El índice de derivación se asigna por **agente**, no por tenant · `Vigente` — refina `C-1`
**Fecha:** 2026-09-10 (T38)

`deriveTenantKeypair(masterMnemonic, tenantIndex, role)` (T32) mapea un índice
a un par de llaves. Lo que ese índice identifica, desde este hito, es **una
identidad derivada** — y un tenant tiene una o varias, no exactamente una.

**Motivo.** El modelo objetivo pide explícitamente que un tenant pueda tener
más de un agente, y que renovar un mandato no cree un agente nuevo. Con un
índice por tenant, el segundo agente de un tenant no tendría de dónde derivar
llaves. `C-1` y `C-2` se escribieron en T32, antes de que existiera el modelo
de entidades de `C-19`, y asumían la correspondencia uno a uno que ese modelo
después descartó.

**Qué cambia y qué no.** El esquema de derivación de T32 no se toca: sigue
siendo `m/44'/148'/<índice>'` con paridad par/impar para el rol, y sigue
siendo cierto que dos índices distintos nunca colisionan. Lo único que cambia
es quién recibe un índice. `@agentpay/tenancy` no se modificó en este hito;
cuando F4 lo cablee habrá que decidir si el parámetro se renombra o se
documenta el mapeo — anotado, no resuelto.

**Confirmado leyendo el código, no supuesto:** el owner del `policy_rail` es
la llave del agente (`apps/web/src/server.ts`, `ownerSecret: current.agentSecret`),
así que "una identidad derivada" y "una cuenta que puede gastar" son la misma
cosa, y por eso la unidad correcta de asignación es el agente.

**Alternativa descartada:** darle un índice al tenant y derivar los agentes
como sub-rutas de ese índice. Se descartó porque exigiría cambiar el esquema
de derivación de T32 —una pieza cerrada y testeada— para resolver algo que la
asignación de índices ya resuelve sin tocarla.

---

### C-28 · El índice sale de una secuencia de Postgres, no de `max(key_index) + 1` · `Vigente`
**Fecha:** 2026-09-10 (T38)

`directory_key_index_seq`, leída con `nextval`, fuera de la transacción que
inserta el agente.

**Motivo.** El requisito real es **nunca reusar un índice**, no "no dejar
huecos". Una secuencia entrega un valor sin esperar a que termine la
transacción que lo pidió, así que dos creaciones concurrentes no pueden
recibir el mismo número. `max(key_index) + 1` sí puede: dos transacciones que
lean antes de que la otra escriba obtienen el mismo máximo. Y lo que está del
otro lado de esa colisión no es un id duplicado sino **dos agentes derivando
el mismo par de llaves Stellar del seed maestro** — dos tenants gastando de la
misma cuenta.

Los huecos que una secuencia deja al fallar una transacción son gratis: un
índice quemado no le cuesta nada a nadie, y el espacio derivable es de mil
millones de tenants (`InvalidTenantIndex` acota en 2³¹−1 y el rol consume la
paridad).

**Alternativa descartada:** una tabla contador con `update ... returning`. Es
correcta —el lock de fila serializa— pero convierte cada alta de agente en un
punto de contención global, y no compra nada frente a la secuencia.

---

### C-29 · La derivación entra como callback; el seed maestro nunca toca este paquete · `Vigente`
**Fecha:** 2026-09-10 (T38)

`createAgent({ tenantId, derive })` asigna el índice, se lo pasa a `derive` y
guarda la dirección que le devuelvan.

**Motivo, dos razones distintas.** La primera es de seguridad: el seed maestro
es el único secreto de todo el esquema multi-tenant, y un paquete que habla
con Postgres no tiene por qué tenerlo en su alcance. La segunda es de
corrección: con dos llamadas separadas —"dame un índice", después "guardá este
agente"— es cuestión de tiempo que alguien guarde un agente cuya dirección no
corresponde a su propio índice, y esa fila mentiría de forma indetectable
hasta que alguien intente firmar con ella. Con un callback, no hay forma de
expresar esa combinación.

**Alternativa descartada:** que el paquete importe `@agentpay/tenancy` y
derive él mismo. Se descartó por lo anterior; `@agentpay/tenancy` sí aparece
como **devDependency**, usado solo en el test de integración, porque la
afirmación que hay que sostener no es "guarda un número" sino "dos tenants
terminan con identidades Stellar distintas", y eso solo lo muestra la
derivación real.

---

### C-30 · El rechazo de PII en `external_ref` es una heurística declarada, no una garantía · `Vigente`
**Fecha:** 2026-09-10 (T38)

`assertOpaqueExternalRef` rechaza lo que parece un email, un RUT o un teléfono
inequívoco, además de espacios, comillas y ángulos.

**Motivo, dicho sin adornos.** Ningún chequeo sintáctico puede impedir que un
partner decidido mande datos personales — puede mandar el email en base64 y
pasa. Lo que sí atrapa es **el error honesto**: el integrador que cablea
`user.email` porque era el string único a mano. Ese error es común y este es
barato; la malicia es rara y esto no la detiene. El resto lo carga el contrato
con el partner, no el código.

**Una consecuencia de diseño que sale de tomarse esto en serio:** el error
**no** devuelve el valor rechazado en `details`. Repetir un email dentro de un
error que va a un log es exactamente la fuga que la función existe para
evitar. Devuelve el largo y una pista de qué mandar en su lugar.

Se rechaza a propósito una tentación: un string de puros dígitos **se acepta**.
Es muchísimo más frecuente que sea un id de usuario que un teléfono, y
rechazarlo rompería integraciones honestas para atrapar un caso que las reglas
del `+` y los separadores ya cubren.

---

### C-31 · El pool de conexiones es acotado y configurable · `Vigente`
**Fecha:** 2026-09-10 (T38)

`createDirectory` acepta `maxConnections`, y el test de integración usa pools
chicos.

**Motivo, encontrado corriendo el propio test y no leyendo documentación.** La
primera corrida del test de integración —ocho creaciones de tenant y ocho de
agente en paralelo— murió con `EADDRNOTAVAIL` (errno −49) después de 18
minutos: agotamiento de **puertos efímeros locales**, no del servidor. La base
del piloto es un session pooler de Supabase, cada conexión nueva paga un
handshake TLS completo, y `pg` abre una por consulta concurrente hasta llegar
a su `max`. Con el pool acotado las conexiones se reusan, que es a la vez más
rápido y estable.

Queda anotado para el hito de hardening (`G4`/`G11`): el mismo razonamiento
aplica a `createPostgresMandateVault`, que hoy no expone la opción.

---

### C-32 · Un error de `pg` lleva la contraseña adentro — nunca serializar el `cause` crudo · `Vigente`
**Fecha:** 2026-09-10 (T38)

**Hallazgo, no decisión de diseño.** Cuando vitest volcó el error de conexión
de la corrida fallida de `C-31`, el volcado incluía la contraseña de la base
en texto plano: `pg` guarda `connectionParameters` (usuario, host, y
**password**) dentro del objeto de error, y cualquier cosa que serialice ese
objeto la publica.

**Qué se verificó de nuestro lado.** El código de este paquete registra y
propaga solo `error.message`, nunca el objeto: `console.error` recibe el
mensaje, y `details.cause` es el mensaje, no el error. Lo mismo hace
`createPostgresMandateVault` (T33). Ninguno de los dos filtra hoy.

**Qué queda como riesgo latente y para dónde va.** `AgentPassError` conserva el
`cause` original, que es lo correcto para depurar. El riesgo es un
`JSON.stringify` sobre un error atrapado, o un logger que serialice el objeto
completo — algo que la superficie de API de F5 va a tener que hacer bien
desde el primer día. Se anota como requisito de F5/F8: **ningún log
estructurado serializa un error crudo**. No se cambia nada ahora.

---

### C-33 · Antes de F4, todo tenant comparte un único agente — modelado como una fila real, no como una ficción · `Vigente`
**Fecha:** 2026-09-10 (T39)

`@agentpay/directory` (T38) asume el mundo de F4: una identidad Stellar por
tenant, `directory_agents.address` único. Eso todavía no es cierto — todo
visitante sigue firmando con el único `AGENT_SECRET_KEY` compartido
(`C-16`/`C-20`, diferido a F4 a propósito). En vez de aflojar la unicidad que
el esquema protege, o inventar una segunda forma más laxa para este período
transicional, T39 representa la verdad tal cual es: existe **una sola** fila
de agente, compartida por todos los tenants, con una etiqueta que lo dice
explícitamente (`apps/web/src/shared-identity.ts`).

**Consecuencia que obligó a un cambio de esquema.** Con un solo `agentId`
compartido por todos los tenants, `agentId` deja de alcanzar para responder
"¿cuál es la credencial de **este** tenant?" — antes de este hito
`directory_credentials` no tenía columna `tenant_id`. Se agregó vía `alter
table` (T38 ya había creado la tabla, vacía, contra la base real), documentado
en `schema-sql.ts`. Post-F4, cuando cada tenant tenga su propio agente, la
columna sigue siendo correcta — deja de ser la única forma de resolver la
ambigüedad, no una que sobra.

**Por qué no reusar el `tenantIndex` de `@agentpay/tenancy` para esto.**
`deriveTenantKeypair` sigue sin cablearse (`C-16`); cablearlo es,
explícitamente, el trabajo de F4, no de F3. Bootstrapear una fila que ya
existe on-chain (`AGENT_SECRET_KEY` ya está anclado, ya tiene mandatos
firmados) con la maquinaria de derivación de F4 habría mezclado dos
migraciones en un solo hito.

**Alternativa descartada:** relajar `directory_agents.address unique` para
permitir que varios tenants apunten a la misma fila directamente (sin capa
de indirección). Se descartó porque esa unicidad es la garantía central del
esquema — que dos agentes nunca deriven la misma cuenta Stellar — y
relajarla para un caso transicional la debilitaría también para el caso
permanente que llega con F4.

---

### C-34 · La sesión clásica (sin wallet) no se persiste — sigue siendo efímera a propósito · `Vigente`
**Fecha:** 2026-09-10 (T39)

T39 solo agrega persistencia al camino de wallet conectada. El camino
clásico (la plataforma firma como su propio principal) sigue emitiendo
credencial y Mandato nuevos en cada "Iniciar sesión", exactamente como
antes.

**Motivo.** El requisito de F3 es que una wallet pueda volver desde otro
navegador y encontrar lo que ya firmó — eso exige una prueba de control
(la firma SEP-0053) que solo una wallet puede dar. El camino clásico no
tiene ese ancla: no hay "la misma persona volviendo", porque nadie probó
ser nadie. Persistirlo no compraría el objetivo de F3, solo agregaría
filas de un camino que la Fase 6 ya trata como demo.

**Alternativa descartada:** persistir también el camino clásico, usando
algún otro identificador (IP, fingerprint de navegador) como ancla. Se
descartó por no ser una prueba de identidad real — cualquier ancla así
sería más débil que lo que ya existe, y el objetivo del hito es
verificable, no aproximado.

---

### C-35 · La decisión de rehidratar es una función pura, separada de dónde se guarda el estado · `Vigente`
**Fecha:** 2026-09-10 (T39)

`decideRehydration()` (`apps/web/src/session-rehydration.ts`) no toca red, no
tiene reloj propio, no conoce Postgres. Recibe la credencial y los mandatos
que el llamador ya leyó y devuelve `"rehydrate"` o `"issue"`.

**Motivo.** Es la misma disciplina que `checkMandate`/`checkScope` ya siguen,
por la misma razón: la función que decide si algo se reusa o se emite de
nuevo es exactamente la que más conviene poder testear sin un servidor, sin
una base, sin testnet. Los ocho tests de `session-rehydration.test.ts` cubren
cada rama —sin nada que rehidratar, mandato expirado, mandato revocado,
credencial revocada de forma independiente, estado a medio escribir sin
credencial, agente no coincidente (la comparación que empieza a importar de
verdad recién con F4), más de un mandato activo a la vez— sin abrir una
conexión.

**Lo que esta función explícitamente no es: un punto de confianza.** Que un
mandato sea genuinamente válido —no revocado on-chain, no expirado, firmado
por quien dice— lo sigue decidiendo `checkMandate`/`checkScope` y el
verificador on-chain en el momento de la compra, exactamente igual que
antes de T39. Esta función solo decide si iniciar sesión se salta un
`issue()` + anclaje redundantes contra testnet. Una fila desactualizada acá
—revocada por otra vía, por ejemplo— no cuesta nada nuevo: el camino de
compra ya la rechaza, como siempre lo hizo.

**Alternativa descartada:** decidir la rehidratación dentro de
`startSession` directamente, sin extraerla. Se descartó porque es
exactamente el patrón que `C-18`/T36 ya identificó como el que falla en
producción — lógica pura viviendo dentro de una función que además hace
red, sin un solo test posible sin levantar todo alrededor.

---

### C-36 · El bootstrap de identidad compartida y del tenant de un visitante son idempotentes por búsqueda, no por bloqueo · `Vigente`
**Fecha:** 2026-09-10 (T39)

`ensureSharedAgentIdentity()` y `ensureVisitorTenant()`
(`apps/web/src/shared-identity.ts`) siguen el mismo patrón: buscar primero:
si existe, devolverlo; si no, crear, y si la creación falla (una carrera
real entre dos requests concurrentes la primera vez que algo se crea),
volver a buscar en vez de propagar el error de unicidad.

**Motivo.** Este piloto corre un solo proceso, pero ese proceso sirve
requests concurrentes — dos visitantes conectando su wallet al mismo tiempo,
la primera vez que existe cualquiera de estas filas, es un caso real, no
hipotético. Bloquear con una transacción explícita habría funcionado, pero
es más máquina de la que el problema necesita: la carrera ocurre como mucho
una vez por fila (agente compartido: una vez en la vida del despliegue;
tenant de un visitante: una vez por wallet), y perder esa carrera cuesta
exactamente una consulta extra, no un error.

**Verificado con tests, no solo argumentado.** Los cuatro tests de "recovers
when a concurrent call already created the row" simulan la pérdida de la
carrera haciendo que el paso de creación explote, y confirman que la
segunda búsqueda encuentra lo que el ganador creó.

---

### C-37 · Revocar actualiza el directorio antes de que una futura sesión pueda rehidratar el mandato muerto · `Vigente`
**Fecha:** 2026-09-10 (T39)

`/api/session/wallet-revoke-submit` llama `directory.revokeMandate(...)`
después de que la revocación on-chain se confirma.

**Motivo.** Sin esto, `listActiveMandates` seguiría devolviendo el mandato
revocado hasta que expirara por `validUntil` — `decideRehydration` lo
rehidrataría igual, y el primer intento de compra recién ahí fallaría
contra `checkMandate` (correcto, pero tarde: la sesión entera se arma
alrededor de un mandato que ya no sirve). Marcarlo en el directorio hace que
la siguiente vez que esa wallet inicie sesión, `decideRehydration` vea
`activeMandates.length === 0` y emita uno nuevo, encadenado por
`supersedesId` al que se revocó.

**Verificado end-to-end contra testnet real** (no solo en test): revocar,
después iniciar sesión de nuevo, confirmar que pide firma nueva
(`pending: "wallet-consent"`, no rehidratación), completar la renovación, y
consultar el directorio directamente para confirmar que el mandato nuevo
tiene `supersedesId` apuntando al revocado. Ver `evidencia/T39.md`.

---

### C-38 · La verificación de este hito se corrió contra testnet real, con firmas reales, no solo con tests · `Vigente`
**Fecha:** 2026-09-10 (T39)

Cuatro corridas manuales, con un script descartable (nunca commiteado) que
usó `ISSUER_SECRET_KEY` —ya fondeada y ya registrada— como wallet simulada,
firmando con SEP-0053 real y transacciones Stellar reales:

1. Conectar, firmar el Mandato, anclar — primera vez, emite de verdad.
2. Llamar `/api/session/start` una segunda vez, mismo proceso — rehidrata,
   mismos hashes.
3. **Matar el proceso del servidor y levantar uno nuevo** — sin ningún
   estado en memoria — y confirmar que rehidrata desde Postgres solo, con
   los mismos hashes exactos que antes de morir.
4. Una compra real, liquidada por `policy_rail`, ejecutada sobre una sesión
   que nunca pasó por `issue()` en este proceso — prueba que el documento
   rehidratado (reparseado desde `json`, no el objeto original en memoria)
   sigue siendo un `AgentPayMandate` válido para `checkMandate`/`checkScope`.
5. Revocar y confirmar que la sesión siguiente no rehidrata la muerta
   (`C-37`).

**Por qué un script descartable y no un test de integración commiteado.**
El patrón ya establecido por `C-18` (T36): las rutas HTTP de `apps/web` se
verifican contra testnet real, de punta a punta, no simuladas — un test que
mockeara `AgentPass`/Stellar para esto probaría los dobles, no el código.
Lo que sí quedó como test permanente es la lógica pura que gobierna la
decisión (`session-rehydration.test.ts`) y el bootstrap idempotente
(`shared-identity.test.ts`) — la misma división de responsabilidades que
T36 ya estableció.

---

### C-39 · F4 separa identidad de pago; el pago sigue compartido hasta F6 · `Vigente`
**Fecha:** 2026-09-10 (T40)

Antes de escribir código se leyó `apps/agent/src/agent.ts` y se confirmó:
`createAgent()` exige, fallando cerrado, que quien firma (`signer`) sea
exactamente la misma llave que el sujeto de la credencial — pero **nada**
exige que esa misma llave sea también quien paga. En `apps/web`, quién paga
(`signerSecret` en `executeBazaarPayment`, `ownerSecret` del `policy_rail`)
es un parámetro completamente separado del que arma la identidad del
agente. Esto no estaba documentado en ningún lado antes de este hito — se
encontró leyendo, no se asumió.

Con eso confirmado, se le presentaron al usuario tres formas de resolver
que cada tenant nuevo no puede pagar con una cuenta recién derivada sin
cargarle USDC a mano (`C-11`): fondear a mano cada tenant nuevo, adelantar
F6 (el rail por tenant) antes que F4, o **derivar y anclar la identidad de
cada tenant ahora, dejando el pago compartido hasta que F6 le dé a cada uno
su propio `policy_rail` fondeado**. El usuario eligió la tercera.

**Qué prueba este hito, con precisión.** Que cada tenant tiene una
identidad Stellar propia y verificable — su propia credencial, su propio
Mandato, ambos anclados con su propia firma. No prueba que cada tenant
gasta desde su propia cuenta: eso sigue pendiente, es F6, y la razón por la
que sigue pendiente está anotada, no escondida.

**Por qué la identidad no necesita fondeo, aunque el pago sí.** El agente
derivado firma dos cosas: nada on-chain directamente — es el sujeto de la
credencial (una dirección, sin transacción) y el firmante del intent de
compra (`apps/agent/src/intent/sign.ts`, un JWS EdDSA fuera de la cadena,
sin llamada de red). Ninguna de las dos necesita XLM ni USDC. Solo pagar
—mover el SEP-41 de verdad— necesita una cuenta real con saldo, y eso sigue
en la cuenta compartida. Esto es lo que hace posible separar las dos cosas
sin dejar a ningún tenant nuevo con una compra rota.

**Alternativa descartada:** mantener acopladas identidad y pago (como
estaban) y posponer F4 entero hasta que F6 esté listo. Se descartó porque
el modelo de identidad —la parte que `checkMandate`/`checkScope` verifican,
la parte auditable on-chain— es independiente de quién paga, y no había
motivo para bloquear una mitad real y ya construible detrás de la otra.

---

### C-40 · El seed maestro va en `.env.local`/variable de entorno del host, no en un gestor de secretos dedicado — todavía · `Vigente`, revisa `D1`
**Fecha:** 2026-09-10 (T40)

`D1` (T37) decía: "gestor de secretos (Doppler o Infisical) cuando se
cablee la derivación (F4), no antes." Al llegar a F4, se decidió no crear
esa cuenta.

**Motivo.** Crear una cuenta en un servicio de terceros es una acción que
este agente tiene prohibida por sus propias reglas de seguridad — pedirle
al usuario que la cree y conecte las credenciales habría convertido un
hito chico en uno que depende de trabajo manual externo, por un beneficio
que en testnet es marginal: el mismo `.env.local`/variable de entorno de
Render que ya protege `ADMIN_SECRET_KEY`, `ISSUER_SECRET_KEY` y
`AGENT_SECRET_KEY` es, en este momento, el nivel de protección
proporcional al riesgo real —fondos de testnet, presupuesto techo de $200
USD/mes (`P-6`)—. `MASTER_MNEMONIC` queda documentado en `.env.example`
con la misma disciplina que el resto: nunca en `.env.local` versionado,
nunca impreso en un log (se generó y se escribió directo al archivo sin
pasar por la salida de ninguna herramienta).

**Lo que esto no decide.** No cierra `D1` — antes de manejar fondos
reales, un gestor de secretos dedicado sigue siendo la recomendación, y
queda anotado como precondición de cualquier salto a producción, igual
que ya lo estaba.

**Alternativa descartada:** pedirle al usuario que cree la cuenta de
Doppler/Infisical él mismo, ahora, para no reabrir esta decisión más
adelante. Se descartó por ser trabajo manual desproporcionado al riesgo
actual del piloto.

---

### C-41 · La rehidratación de T39 necesitaba saber cuál es la identidad *vigente* del tenant, no solo que credencial y mandato coincidan entre sí · `Vigente`
**Fecha:** 2026-09-10 (T40)

**Hallazgo real, contra testnet, no anticipado al diseñar T39.** La primera
corrida de verificación de F4 contra el servidor real falló con
`SignerMismatch`: un tenant con una credencial persistida *antes* de F4
—cuyo sujeto era la cuenta compartida— intentó rehidratarse usando la
identidad *nueva*, recién derivada, de ese mismo tenant.
`decideRehydration` (T39) solo comparaba que la credencial y el mandato
coincidieran *entre sí* (`C-35`), lo cual seguía siendo cierto para ese
registro viejo — nunca comparaba contra cuál es la identidad que una
sesión nueva usaría *hoy*.

**La corrección.** `decideRehydration` recibe ahora `currentAgentId` — la
fila de `directory_agents` que `ensureTenantAgent` resolvería en este
mismo momento — y exige que la credencial y el mandato activo lo nombren a
él, no solo que se nombren entre sí. Un registro que coincide consigo
mismo pero no con la identidad vigente se trata exactamente igual que si
no hubiera ningún registro: se emite de nuevo, encadenado por
`supersedesId` al que quedó atrás. Dos tests nuevos cubren exactamente
este caso (`session-rehydration.test.ts`): coincidencia interna sin
coincidir con la identidad vigente, y una activa vieja descartada en favor
de una vigente entre varias.

**Por qué esto no es un bug de seguridad, aunque lo encontró un error real
de ejecución.** `createAgent()` lo atajó fallando cerrado — nunca se armó
una sesión con una firma que no correspondía a su propio sujeto. Lo que
esto corrige es la experiencia: sin el arreglo, cada tenant que existía
antes de F4 habría visto un error crudo en vez de una migración silenciosa
a su nueva identidad, la primera vez que volviera a conectar.

---

### C-42 · `render.yaml` reserva `MASTER_MNEMONIC`; el despliegue en sí queda fuera de este hito · `Vigente`
**Fecha:** 2026-09-10 (T40)

Se agregó `MASTER_MNEMONIC` a `render.yaml` (`sync: false`, sin valor) —
mismo patrón que `ADMIN_SECRET_KEY`/`DATABASE_URL`/`POLICY_RAIL_CONTRACT_ID`
en hitos anteriores. Verificado y cerrado únicamente contra el servidor de
desarrollo local y testnet real — el deploy de Render no se tocó, y sin la
variable configurada ahí, el sitio en producción seguirá con el
comportamiento de antes de T40 hasta que alguien complete ese paso
explícitamente.

**Motivo.** Mismo criterio que separó siempre "construir y verificar" de
"desplegar" en este proyecto (T31, T33, T35): un cambio de identidad que
toca el camino de "Iniciar sesión" de todo visitante merece confirmarse
localmente antes de tocar el sitio real, no en el mismo movimiento.

---

### C-43 · Paquete nuevo `@agentpay/partner-api` para el contrato congelado de `/v1` (T45) · `Vigente`
**Fecha:** 2026-09-10 (T45)

`PLATAFORMA-PARTNERS.md` § F5 pedía "esquemas zod nuevos (paquete a
definir)" antes de abrir T46-T50. Se decidió un paquete propio —no sumar
esto a `@agentpay/directory`— porque son responsabilidades distintas:
`directory` persiste, este paquete decide la forma de lo que cruza la red y
quién puede llamarlo. Ninguna de las dos cosas necesita saber de la otra
salvo por los tipos que ya expone (`Tenant`, `AgentInstance`, `MandateRecord`,
`ApiKey`).

**Qué contiene, exactamente lo que T45 pedía y nada más:** los DTOs
snake_case de `/v1` (tenants, agentes, mandatos de solo lectura,
`consent_sessions`) con sus funciones de mapeo desde los tipos internos de
`@agentpay/directory`; el contrato de autenticación (`Authorization: Bearer
ap_test_...`, reutilizando `Directory.authenticate()` que T38 ya construyó);
el enum de permisos de API key; la semántica exacta de idempotencia; y el
envelope de error/éxito. Cero rutas HTTP, cero cambios a `apps/web`.

**Verificado:** `git diff --stat d493d63..HEAD -- apps contracts` no
devuelve nada — ningún punto de autorización tocado. 42 tests nuevos (de
823), todos puros, sin red ni base de datos. `pnpm typecheck`/`pnpm build`
limpios.

**Alternativa descartada:** escribir los esquemas directamente dentro de
`apps/web` o de `@agentpay/directory`. Se descartó porque F5's tickets de
Codex (T46 OpenAPI, T47 SDK, T48 webhooks) necesitan importar estas formas
sin arrastrar ni un servidor HTTP ni una conexión a Postgres.

---

### C-44 · El permiso de API key se llama `ApiScope`, no `Scope` · `Vigente`
**Fecha:** 2026-09-10 (T45)

**Hallazgo al construir, no al planificar.** `@agentpass/core` ya exporta
`Scope`/`scopeSchema` para el scope de gasto de una credencial o mandato
(`actions`/`venues`/`assets`/`limits`) — un concepto central del proyecto
desde la Fase 2. El borrador inicial de este hito nombró igual al permiso de
una API key ("puede este key llamar esta ruta"), lo cual habría dejado dos
`Scope` completamente distintos, importables desde dos paquetes distintos,
en el mismo proyecto.

**La corrección.** Renombrado a `ApiScope`/`apiScopeSchema`/`API_SCOPES` en
`@agentpay/partner-api`, con un comentario en el propio archivo explicando
por qué. Ninguna colisión de imports es posible ahora — un lector que ve
`Scope` sabe que es gasto; uno que ve `ApiScope` sabe que es acceso a la API.

**Alternativa descartada:** mantener `Scope` en el paquete nuevo y confiar en
que el import con alias (`import { Scope as ApiScope }`) evite la confusión
en la práctica. Se descartó porque depende de que cada archivo que lo
importe recuerde hacerlo — el nombre correcto en el origen no depende de la
disciplina de cada consumidor.

---

### C-45 · La lista de permisos de `/v1` es más chica que la propuesta en `PLATAFORMA-PARTNERS.md` §2.7 · `Vigente`
**Fecha:** 2026-09-10 (T45)

§2.7 proponía `tenants:write`, `agents:write`, `consent:create`,
`mandates:read`, `mandates:revoke`, `payments:authorize`, `vault:read` —una
lista "mínima, separada por daño" pensada para toda la superficie eventual
de la plataforma, no solo para T45. Congelar esa lista completa ahora habría
dejado permisos que ninguna ruta existente o planeada en la tabla de F5
(T45-T50) revisa todavía.

**Lo que se congeló en su lugar:** `tenants:read`, `tenants:write`,
`agents:read`, `consent_sessions:read`, `consent_sessions:write`,
`mandates:read` — exactamente los que T45's alcance nombra (tenants,
agentes, `consent_sessions`, mandatos de solo lectura). Se renombró
`consent:create` a `consent_sessions:write`/`consent_sessions:read` por
consistencia interna (`recurso:acción` en todos los casos, no una excepción
para consentimiento).

**Motivo.** Un permiso que una API key puede pedir pero que ninguna ruta
real revisa es peor que no tenerlo: aparenta estar cableado y no lo está. Se
prefiere extender la lista, aditivamente, el día que un ticket construya la
ruta que ese permiso protegería (`mandates:revoke` con la ruta de
revocación, `payments:authorize` con lo que F7 defina, `vault:read` con el
panel de partner que F5 explícitamente deja fuera de alcance).

**Alternativa descartada:** congelar la lista completa de §2.7 ahora, como
"reservada para más adelante". Se descartó por la razón de arriba.

---

### C-46 · La idempotencia se congela como decisión pura, no como tabla · `Vigente`
**Fecha:** 2026-09-10 (T45)

T45 pedía "la semántica exacta de idempotencia", no su almacenamiento.
`resolveIdempotency` es una función pura que recibe un `lookup` inyectado
—de dónde sale `(partner_id, key) → respuesta` no lo decide este paquete— y
devuelve `"proceed"` o `"replay"`, o lanza `IdempotencyKeyConflict`/
`IdempotencyKeyRequired`. El mismo patrón que `checkMandate`/`checkScope`
del proyecto: la decisión se prueba sola, sin una base de datos real detrás.

**Detalle que sí quedó fijado, porque es observable desde afuera:** TTL de
24 horas (`PLATAFORMA-PARTNERS.md` §2.7), el hash del cuerpo se calcula
sobre una forma canónica (claves ordenadas recursivamente, arrays intactos)
para que `{a:1,b:2}` y `{b:2,a:1}` no se traten como cuerpos distintos, y un
registro vencido se trata exactamente como si no existiera —incluso si el
cuerpo de la repetición es distinto— en vez de devolver un conflicto contra
algo que ya expiró.

**Pendiente, a propósito:** dónde vive la tabla `(partner_id, key) →
respuesta` es una decisión de la ruta que la usa (T49 o un ticket sucesor),
no de este paquete.

---

### C-47 · `consent_sessions` es solo esquema en T45 — sin persistencia, con un prefijo de id provisional · `Vigente`
**Fecha:** 2026-09-10 (T45)

`@agentpay/directory` no tiene tabla de `consent_sessions` — T38 no la
construyó porque F3 resolvió el consentimiento con el flujo de wallet
conectada que ya existe, no con el flujo hospedado que F5 describe para
partners. T45 solo define la forma de la petición (`tenant_id`, un `grant`
que reutiliza `mandateGrantSchema` de `@agentpay/mandate` sin
redescribirlo) y de la respuesta (`id`, `status`, `consent_url`,
`mandate_id`, con los dos últimos nulos hasta que la sesión se completa).

**El prefijo `cns_`** se fijó en `consent-sessions.ts` replicando el
formato ULID-detrás-de-prefijo de `ids.ts` (mismo largo, mismo alfabeto
Crockford) sin que `@agentpay/directory` sepa nada de `consent_sessions`
todavía — es una convención documentada para que quien construya la
persistencia no tenga que decidir el formato del id además de todo lo
demás, no una tabla real.

**Hallazgo, no pedido explícitamente — brecha en la tabla de F5.** Ninguno
de los tickets T45-T50 nombra explícitamente "implementar los handlers de
`/v1`" (crear un tenant de verdad, completar un `consent_session` cuando la
wallet firma, etc.) — T49 solo describe el middleware de autenticación
("una api key revocada deja de poder llamar cualquier ruta"), y T50 asume
que para entonces "la API responde de verdad". Falta un ticket, o una
ampliación explícita del alcance de T49, que conecte este contrato con
`@agentpay/directory` y con el flujo hospedado de wallet-connect. Anotado
para el usuario antes de abrir T49 — no resuelto en este hito porque no era
su alcance.

---

### C-48 · La forma del evento de webhook se publica antes de tener nada que lo dispare · `Vigente`
**Fecha:** 2026-09-10 (post-T45)

T48 (webhooks, tabla de F5) dependía explícitamente de "la forma del evento
de webhook publicada por Claude" — sin eso, no había nada que delegar
todavía. Se agregó `webhooks.ts` a `@agentpay/partner-api`: los siete
nombres de evento de `PLATAFORMA-PARTNERS.md` §2.7, el sobre
(`id`/`type`/`created_at`/`data`), y el esquema de firma
(`AgentPay-Signature: t=<ms>,v1=<hmac>`, ventana de replay de cinco
minutos) — con `sign`/`verify` como funciones puras.

**Por qué `data` queda `z.record(unknown)` y no cuatro schemas tipados.**
Los eventos `mandate.*` sí podrían tipar `data` hoy contra
`mandateResourceSchema`; los `payment.*` no — F7 (comercio genérico)
todavía no diseña qué es un "pago" en `/v1`. Tipar cuatro de siete y dejar
tres sueltos habría sido peor contrato que dejar los siete iguales hasta
que el código que efectivamente emite cada uno decida su forma. T48 no
necesita el tipo de `data` para construir un worker de entrega con
reintentos — solo necesita el sobre y la firma.

**Qué sigue sin decidir, a propósito.** El *cuándo* se dispara cada evento
— qué código llama a "encolar este webhook" y en qué momento exacto — no
está acá. Esa decisión vive donde vive la lógica que la motiva (T49 o
después), nunca en el paquete de contrato ni en el worker de entrega de
Codex.

**Alternativa descartada:** esperar a T49 para publicar esto también, y
abrir T46/T47/T48 juntos recién entonces. Se descartó porque T46 y T47 ya
estaban listos para delegarse sin esto — atarlos a T49 solo por
conveniencia de agrupar hubiera demorado sin necesidad el trabajo que
Codex sí puede empezar hoy.

---

### C-49 · T49 se parte en dos: tenants/agentes/mandatos ahora, `consent_sessions` en un hito nuevo (T51) · `Vigente`
**Fecha:** 2026-09-10 (T49)

T49, tal como quedó descripto en la tabla de F5, solo hablaba del
middleware de autenticación — la brecha `C-47` ya había anotado que
faltaba un ticket para "implementar los handlers de verdad". Investigando
`apps/web` antes de escribir código aparecieron dos piezas más sin
ticket: no existe ninguna forma de crear un `Partner`/`ApiKey` hoy, y
`consent_sessions` no tiene tabla, ruta ni página hospedada — necesita
reutilizar el flujo de firma de wallet que ya existe
(`/api/session/wallet-consent`, `/api/session/wallet-anchor`), pero es
una pieza grande por sí sola.

**Decisión:** este hito (T49) resuelve la mitad de lectura/creación
simple —tenants, agentes, mandatos, más el script de bootstrap de
partner/API key—. `consent_sessions` (tabla, rutas, página hospedada)
queda para un hito nuevo, **T51**. `T50` (la guía/ejemplo de Codex) pasa a
depender de ambos, no solo de T49 — su criterio de "listo" en
`PLATAFORMA-PARTNERS.md` § F5 ("crea un tenant, abre un consentimiento y
consulta un mandato") no puede cumplirse sin `consent_sessions`.

**Motivo.** Cerrar todo junto habría sido un PR enorme y difícil de
revisar de una sola vez — exactamente lo que la regla de "un hito, una
revisión" de este proyecto busca evitar. Partiendo el trabajo, la mitad
más chica y menos riesgosa (lecturas, sin tabla nueva salvo idempotencia)
cierra y se revisa antes de abrir la mitad que sí toca el flujo de firma
de wallet.

**Alternativa descartada:** ampliar el alcance de T49 para incluir
`consent_sessions` completo. Descartada por el tamaño del PR resultante.

---

### C-50 · Tabla `directory_idempotency`, resolviendo lo que `C-46` dejó pendiente · `Vigente`
**Fecha:** 2026-09-10 (T49)

`C-46` (T45) congeló la semántica exacta de idempotencia como una función
pura (`resolveIdempotency`, en `@agentpay/partner-api`) sin decidir dónde
vive `(partner_id, key) → respuesta`. T49 lo resuelve: tabla nueva
`directory_idempotency` en `@agentpay/directory` (clave primaria
`(partner_id, key)`, `response_body` en `json` — mismo criterio que
`directory_mandates.document`, no hay hash calculado sobre el valor pero
tampoco hay motivo para que Postgres reordene claves de algo que solo se
reproduce tal cual), con dos métodos nuevos en el puerto
(`findIdempotentResponse`, `recordIdempotentResponse`). `apps/web`'s
`partner-routes.ts` pasa `directory.findIdempotentResponse` directo como
el `lookup` que `resolveIdempotency` pide — sin conversión, porque el
esquema de `IdempotencyRecord` en `@agentpay/directory` replica el de
`@agentpay/partner-api` campo por campo a propósito (`directory` no puede
depender de `partner-api` — la dependencia va al revés).

**`recordIdempotentResponse` es un upsert (`on conflict do update`), no un
insert puro.** Dos reintentos concurrentes de la misma key corriendo la
misma operación de negocio dos veces en paralelo no son un conflicto real
— son el mismo hecho lógico escrito dos veces. Fallar cerrado ahí (una
violación de unicidad cruda) habría sido peor experiencia que dejar
ganar a cualquiera de las dos escrituras, porque ambas escriben la misma
respuesta.

**Alternativa descartada:** guardar la idempotencia en el propio proceso
de `apps/web` (un `Map`, como el resto de las sesiones hoy). Descartada
por la misma razón que motivó `@agentpay/directory` entero (`G7`): un
restart pierde el registro, y una API key reintentando después de un
deploy volvería a crear el tenant.

---

### C-51 · `findMandateById` y `listMandates`, nuevos en `@agentpay/directory` · `Vigente`
**Fecha:** 2026-09-10 (T49)

`/v1/mandates/{id}` identifica un mandato por su `id` (`mdt_...`), no por
su `mandateHash` — el único lookup que existía (`findMandateByHash`) es
el que usa el registro on-chain, un concepto distinto. Y un partner
consultando el historial de un tenant quiere ver también los mandatos
revocados o expirados, no solo los activos que `listActiveMandates` ya
filtraba (ese método sigue exactamente igual, para lo que ya lo usa
`apps/web`). Ambos métodos son lecturas puras, aditivas, sin tocar el
esquema de la tabla ni ningún método existente.

---

### C-52 · `scripts/create-partner.ts`: crear un partner es un script de operador, no una ruta HTTP · `Vigente`
**Fecha:** 2026-09-10 (T49)

No existía ninguna forma de crear un `Partner` ni de emitir su primera
`ApiKey` — se confirmó buscando en todo el repo antes de diseñar T49.
`PLATAFORMA-PARTNERS.md` § F5 deja "panel de partner" explícitamente
fuera de alcance, así que exponer esto como una ruta HTTP habría sido
construir la mitad de una superficie de administración que nadie pidió
todavía, y que necesitaría su propia autenticación (distinta de la de
`/v1`, pensada para partners, no para el operador del proyecto). El
script sigue el mismo patrón que `scripts/bootstrap.ts` ya usa para
llaves Stellar: se corre a mano, una vez por partner, imprime el secreto
una sola vez y no lo guarda en ningún lado más que su hash en Postgres.
`--scopes` por defecto otorga la lista completa de `API_SCOPES` — no hay
manera de que un partner pida menos todavía, y limitarlo por defecto solo
generaría una vuelta manual de "che, dame más permisos" sin ganar nada en
seguridad real durante el piloto.

**Alternativa descartada:** una ruta `/admin/partners` gateada por
`ADMIN_SECRET_KEY` (el mismo patrón que ya protege el registro de
emisores on-chain). Descartada por ahora — es más superficie de la que
esta fase necesita, y puede agregarse después sin romper nada si alguna
vez hace falta crear partners sin acceso a la base de datos directamente.

---

### C-53 · Un tenant o mandato de otro partner responde `404`, nunca `403` · `Vigente`
**Fecha:** 2026-09-10 (T49)

`GET /v1/tenants/{id}`, `GET /v1/mandates/{id}` y las dos rutas
`?tenant_id=` resuelven primero el recurso y comparan su `partnerId`
contra el de la API key autenticada. Si no coincide, la respuesta es
`TenantNotFound`/`MandateNotFound` (`404`) — igual que un id que
directamente no existe — nunca `ScopeNotGranted` ni ningún código que
confirme "esto existe, pero no es tuyo". Mismo criterio que `InvalidApiKey`
ya aplica entre una key desconocida y una revocada (`C-44`, T45): decirle
a un partner "ese id es de otro" es información que no necesita para
integrar bien, y sí le sirve a alguien enumerando ids ajenos.

Verificado contra Postgres real, no solo en el test unitario: un segundo
partner de prueba, con su propia API key, recibió `404` al pedir el
tenant del primero.

---

### C-54 · La idempotencia cachea cualquier resultado de un intento ya autenticado, éxito o error · `Vigente`
**Fecha:** 2026-09-10 (T49)

`resolveIdempotency` (T45) no distingue "cachear solo éxitos" de "cachear
todo" — decide replay/conflicto por el hash del cuerpo, sin mirar qué
pasó la primera vez. T49 sigue esa misma línea: `respondOrCache` (en
`partner-routes.ts`) guarda el resultado de `POST /v1/tenants`
—cualquiera sea: un `201` nuevo, un `200` de `TenantAlreadyExists`
resuelto a nivel de negocio, o un error de validación— bajo la misma
`Idempotency-Key`. Lo único que queda
deliberadamente **fuera** de ese cacheo es el fallo de autenticación en
sí (`MissingApiKey`/`InvalidApiKey`/`ScopeNotGranted`): esos ocurren antes
de saber siquiera de qué partner se trata, así que no hay bajo qué
`partnerId` guardarlos.

**Por qué no seguir el criterio de "no cachear 4xx" que usan algunas APIs
públicas.** Habría exigido inventar una regla nueva —qué códigos "cuentan"
como que no pasó nada— que el contrato congelado en T45 no pedía y que
un partner integrando desde la documentación no puede adivinar sin leer
el código. La regla simple ("la misma llamada, exactamente, siempre
responde igual mientras la key no expire") es la que ya está escrita y
probada.

**Alternativa descartada:** cachear solo `2xx`. Descartada por lo de
arriba — y porque habría dejado sin resolver qué hacer con el `200` que
`POST /v1/tenants` devuelve cuando el `external_ref` ya existía (ese caso
sí se cachea, es un resultado válido de un intento completo).

---

### C-55 · `directory_consent_sessions`: `proposed_grant` en vez de `grant`, y dos ventanas de tiempo distintas · `Vigente`
**Fecha:** 2026-09-10 (T51)

Dos decisiones de la tabla nueva, encontradas escribiendo el SQL, no en el
diseño:

1. **La columna se llama `proposed_grant`, no `grant`.** `GRANT` es
   palabra reservada de SQL (el propio comando de privilegios de
   Postgres) — usarla sin comillas rompe cada sentencia que la toque.
   Ninguna herramienta ni test la hubiera atrapado hasta ejecutarse contra
   Postgres real. El nombre del campo en TypeScript sigue siendo `grant`
   (el mapeo de columnas ya traduce `snake_case` a `camelCase` en cada
   entidad de este paquete) — el cambio queda contenido en el SQL.
2. **`expires_at` (la ventana de la invitación) es un campo aparte de
   `valid_until` (la ventana del Mandato que resultaría de firmarla).**
   Confundirlos habría atado cuánto tiempo tiene Vinny para decidir si
   firma a cuánto tiempo dura el Mandato una vez firmado — dos cosas que
   un partner puede querer configurar de forma completamente
   independiente (una invitación de una hora para un Mandato de tres
   meses es el caso normal, no una excepción).

---

### C-56 · `session-documents.ts` gana un `grant` opcional, sin tocar el único call site que ya existía · `Vigente`
**Fecha:** 2026-09-10 (T51)

`buildSessionDocuments` (T36, protege el invariante `C-17`) pasaba
siempre `scope.scope` como el `grant` del Mandato — nunca soportó
`payTo`, aunque `@agentpay/mandate` lo tiene desde `M-14`. Un
`consent_session` necesita que el partner pueda proponer `payTo`.

**La corrección.** `SessionDocumentsParams` gana `grant?: MandateGrant`,
que por defecto es `scope.scope` — exactamente el valor que el único call
site de antes de T51 (`server.ts`'s `startSession`) ya usaba. Ese call
site no cambió una línea, y los seis tests que fijan el invariante
`C-17` tampoco. La credencial sigue recibiendo solo `scope.scope`
—`credentialSubject.scope` no puede expresar `payTo`, no es una
limitación nueva de T51— y el Mandato recibe el `grant` explícito cuando
se pasa uno.

**Alternativa descartada:** una función nueva y paralela
(`buildConsentSessionDocuments`) en vez de extender la existente.
Descartada porque habría duplicado exactamente la lógica que protege
`C-17` —derivar el `principal` una sola vez y usarlo en ambos
documentos— en dos lugares que tendrían que mantenerse de acuerdo para
siempre.

---

### C-57 · El flujo hospedado de consentimiento se autentica por el id de la invitación, sin API key · `Vigente`
**Fecha:** 2026-09-10 (T51)

`GET /api/consent/{id}` y las tres rutas de firma
(`wallet-verify`/`start`/`wallet-consent`/`wallet-anchor`) no piden
`Authorization`. Quien las llama es el **principal** (Vinny), no el
partner — no tiene, ni debería tener, una API key de `/v1`. El id del
`consent_session` (un ULID de 128 bits, la misma familia de ids que
`@agentpay/directory` ya usa para todo) es la capacidad que autoriza:
mismo modelo de confianza que un link de sobre de DocuSign, o el link de
recuperación de contraseña de cualquier producto — quien tiene el link
puede actuar, y el link es indistinguible de un ULID al azar. `apps/web`
nunca lista `consent_sessions`, así que no hay forma de enumerarlos.

**Riesgo real, y por qué se acepta.** Si el link se filtra (queda en un
log de un proxy, en un historial de navegador compartido) antes de que
Vinny lo use, quien lo tenga puede firmar el Mandato en su lugar. Esto es
exactamente el riesgo que cualquier magic link tiene, no uno nuevo de
este diseño — mitigado por la ventana corta de `expires_at` (1 hora,
`C-55`), no eliminado. Un `consent_session` ya completado se rechaza de
nuevo (`ConsentSessionAlreadyCompleted`), así que un link reusado después
de firmar no puede firmar una segunda vez.

**Alternativa descartada:** exigir que el partner también pase su API key
en la página hospedada (vía query param u otro mecanismo). Descartada
porque expondría el secreto de `/v1` en una URL que termina en el
navegador de un tercero — el propio principal, no un sistema del
partner — precisamente el tipo de exposición que `PLATAFORMA-PARTNERS.md`
§2.7 evita para las API keys en general.

---

### C-58 · Un Mandato de `consent_session` nunca encadena `supersedesId` · `Vigente`
**Fecha:** 2026-09-10 (T51)

El flujo de wallet-connect (T35/T39) sí encadena `supersedesId` porque
ahí "renovar sin crear un agente nuevo" es un requisito explícito del
producto (`G7`) — cada tenant tiene, en cualquier momento, como mucho un
Mandato activo, y volver a conectar debe encontrar ese Mandato, no
apilar uno nuevo. Un `consent_session` es distinto: un partner puede
legítimamente pedir varios consentimientos independientes para el mismo
tenant a lo largo del tiempo (un `perDay` para gastos chicos, otro
consentimiento aparte para una compra puntual más grande), y no hay
ninguna regla de producto que diga que el segundo reemplaza al primero.
T51 no impone esa relación — cada Mandato de `consent_session` es
independiente. Si un producto real necesita "esto reemplaza el anterior",
es una decisión de negocio para cuando exista un caso real, no algo para
adivinar acá.

---

### C-59 · `consent.html`, la página que consume estos endpoints, es un hito aparte (T52) y delegable · `Vigente`
**Fecha:** 2026-09-10 (T51)

T51 deja `/consent/{id}` respondiendo `404` (no hay archivo que
`serveStatic` pueda servir todavía) — a propósito. Todo el backend se
verificó de punta a punta contra Postgres y testnet reales con un script
descartable que firma como lo haría Freighter (misma técnica que
T39/T40), sin necesitar ningún navegador. La página que un humano
realmente ve —conectar wallet, mostrar el `grant`, disparar las mismas
llamadas que el script ya probó— no decide nada: es HTML/JS que llama a
endpoints ya estables, la misma descripción que ya calificó como
delegable a Codex la vista de historial de solo lectura de F3
(`PLATAFORMA-PARTNERS.md` § F3). Construirla ahora, en el mismo hito, sólo
habría hecho el PR más grande sin agregar riesgo real a revisar.

---

### C-60 · El registro de venues/assets reemplaza `mapAsset` hardcodeado, con `resolveJsonModule` para que "agregar un comercio" sea datos, no código · `Vigente`
**Fecha:** 2026-09-11 (T53)

F7 pedía que agregar un comercio nuevo no tocara ningún archivo `.ts`.
`bazaar.ts` (Fase 2/4) tenía el mapeo de assets hardcodeado directamente en
código — una función `mapAsset` con un único `if (code !== "USDC")` — así
que un segundo comercio x402 habría necesitado un archivo entero shaped
igual que `bazaar.ts`, con su propio `mapAsset` copiado y pegado.

**La solución.** `apps/agent/src/catalog/registry.ts` valida (zod,
`z.strictObject`) y le indexa un array de filas —una por venue, cada una
con su `slug`, `contractId`, `baseUrl` opcional y sus `assets` (`code` +
`issuer`)— fallando cerrado (`InvalidVenueRegistry`, código nuevo en
`AgentPassErrorCode`) ante un venue duplicado o un asset repetido dentro
del mismo venue, no solo ante una fila mal formada. `mapAssetCodeForVenue`/
`mapAssetIssuerForVenue` son los sucesores genéricos de `mapAsset`/
`mapAssetContract`: mismo fallo cerrado (`InvalidProduct` ante un código o
issuer que el venue no nombra), ahora sobre cualquier venue registrado, no
solo el bazaar. `venues.json` es la fila real de datos —el bazaar del
embajador, hoy el único venue— y agregar uno nuevo es agregar una fila ahí,
no escribir TypeScript.

**El adaptador HTTP también se generalizó.** `x402-catalog.ts` es
`bazaar.ts`'s antigua lógica de fetch (`GET /api/discovery/search`, el
`ServiceCard`, `getServiceRoute`) parametrizada por `{ venueId, registry,
baseUrl?, fetchImpl? }` en vez de estar atada a un venue. `bazaar.ts` queda
como una capa delgada de compatibilidad: sus constantes exportadas
(`BAZAAR_VENUE_ID`, `BAZAAR_USDC`, etc.) y `createBazaarCatalog`/
`mapAssetContract`/`getBazaarServiceRoute` sin cambiar su firma pública,
para que `scripts/demo.ts`, `payment/x402.ts` y `apps/web/src/server.ts`
no necesiten tocar una línea. `baseUrl` se mantiene como override explícito
opcional (no solo dato del registro) porque los tests y el deploy real
siguen necesitando apuntar a una URL distinta de la que trae `venues.json`.

**`resolveJsonModule`, nuevo en `apps/agent/tsconfig.json`.** `venues.json`
se importa con `import ... with { type: "json" }` (sintaxis de atributos de
importación que `NodeNext` + TS 5.9 exige) en vez de leerlo con
`node:fs` en tiempo de ejecución — la alternativa que el propio repo ya usa
en `scripts/demo.ts` para otros JSON. Se descartó esa alternativa porque
`apps/agent` se consume como paquete compilado (`dist/index.js`) desde
`scripts/` y `apps/web/src/server.ts`, no solo vía `tsx`: un `fs.readFileSync`
relativo a `import.meta.url` se rompe en `dist/` a menos que algo copie el
JSON ahí, y este repo no tiene ningún paso de copia de assets. Con
`resolveJsonModule`, `tsc -b` sí copia `venues.json` a `dist/catalog/` como
parte de la compilación normal — verificado importando el `dist/` compilado
directamente, no solo con `tsx`. Nota de proceso: `tsc -b` en modo de
referencias de proyecto no descubrió el JSON con el `include` original
(`"src/**/*"`, TS6307) aunque un `tsc` suelto sobre el mismo `tsconfig.json`
sí lo hacía — hizo falta agregar `"src/**/*.json"` explícito al `include`.

**Alternativa descartada:** un registro en Postgres (como
`@agentpay/directory`), para que el script de alta de comercio (T55)
escribiera contra una base real en vez de un archivo. Descartada porque
`apps/agent` es el agente CLI original (Fase 2–4), sin conexión a Postgres
—esa es la superficie de `apps/web`/Fase 6— y montar una dependencia nueva
a una base de datos solo para esta fase habría sido una superficie mucho
más grande que lo que F7 pedía resolver.

Documentación tocada: `PLATAFORMA-PARTNERS.md` (F7, T53 cerrado, T54–T56
renumerados desde el borrador original T51–T54, que colisionaba con los
números reales de F5), `BITACORA.md`. Archivos nuevos:
`apps/agent/src/catalog/registry.ts` (+ test, 13 casos),
`apps/agent/src/catalog/default-registry.ts`,
`apps/agent/src/catalog/x402-catalog.ts`,
`apps/agent/src/catalog/venues.json`. `bazaar.ts` reescrito como
compatibilidad; `bazaar.test.ts` sin cambios, 16/16 en verde. Código nuevo:
`InvalidVenueRegistry` en `packages/core/src/errors.ts`.

---

### C-61 · `policy_rail` gana un `principal` distinto del `owner`: la wallet retira y rota, la llave delegada solo gasta · `Vigente`
**Fecha:** 2026-09-11 (T57)

`G9` decía que `policy_rail` no tenía ninguna forma de sacar fondos ni de
cambiar quién autoriza pagos. Solo existían lectores de configuración y
`__check_auth`, que aprueba un pago con la firma de un único `owner` — en
el piloto, una llave de AgentPay. Si un cliente real fondeaba ese contrato,
no podía recuperar su plata: la única salida era un pago firmado por una
llave que no es suya. Bloqueante duro para F6 (cuenta pagadora por tenant)
y para cualquier conversación de mainnet.

**La decisión: dos autoridades separadas, no una sola con más permisos.**
`Config` gana un campo, `principal: Address` — la wallet del cliente,
fijada una sola vez en el constructor, igual que `owner`/`asset`/`per_tx`/
`per_day`/`valid_until`. Quién autoriza el gasto día a día (la llave
delegada del agente, `owner`, vía el `__check_auth` custom) queda separado
de quién tiene la última palabra sobre el contrato (la wallet del cliente,
`principal`, vía `Address::require_auth()` — el mecanismo nativo de
Soroban, el mismo que ya usa cada firma de wallet en este proyecto).
Consecuencia buscada: el agente nunca necesita ni ve la llave de la
wallet, y el cliente puede retirar su saldo o cortar la llave de gasto en
cualquier momento sin que AgentPay coopere.

**Dos funciones nuevas, y `__check_auth` no se tocó.** `withdraw(to,
amount)` exige `principal.require_auth()`, rechaza `amount <= 0` con
`InvalidWithdrawAmount` (código `9`, nuevo) e invoca `transfer` sobre el
asset del rail. Ese `transfer` **no** reentra a `__check_auth`: cuando el
propio contrato inicia la llamada, Soroban autoriza implícitamente un
`from == env.current_contract_address()`; `__check_auth` solo se dispara
cuando una transacción *externa* —el pago x402— le pide a este contrato que
autorice algo desde afuera. `set_owner(new_owner)` exige lo mismo y
reescribe el `Config` completo (es una sola entrada de storage).

**Ninguna de las dos respeta `valid_until`, a propósito.** Un rail vencido
es exactamente el que más necesita una salida; bloquear ahí sería recrear
`G9` con un temporizador en vez de para siempre. Por la misma razón
`withdraw` tampoco pasa por `per_tx`/`per_day`: esos límites acotan lo que
la *llave delegada* puede gastar, no lo que el dueño del dinero puede
recuperar. Verificado en la red real con un retiro de quince veces el
`per_tx` del rail (`evidencia/T57.md` §4.1).

**Sin chequeo de forma sobre `new_owner`.** Cualquier valor de 32 bytes es
una clave Ed25519 sintácticamente válida, y no hay nada acá que pueda
distinguir un error de tipeo de una clave cuyo secreto vive donde el
contrato no ve. Poner un owner que nadie puede firmar detiene los pagos,
que es un fallo estrictamente más seguro que el opuesto — y `withdraw`
sigue funcionando.

**Alternativa descartada:** hacer que `withdraw` y `set_owner` pasaran por
el mismo `__check_auth`/`owner` que ya existe, en vez de agregar un campo.
Descartada porque es justamente el problema que `G9` describe: quien
autoriza el gasto pasa a poder vaciar la cuenta, y el cliente que puso los
fondos no puede hacer nada sin esa llave. La separación es el punto, no un
detalle de implementación. **Segunda alternativa descartada:** un
`principal` mutable (una función `set_principal`). Descartada porque quien
pudiera llamarla se quedaría con los fondos; fijarlo en el constructor
significa que un rail mal apuntado se reemplaza desplegando otro, que es
barato, en vez de dejar abierta una puerta que no lo es.

**El rail compartido del piloto no se redesplegó.** Sigue con el
constructor viejo —sin `principal`, sin salida de fondos— hasta que se
decida migrarlo, que es una decisión aparte. Por eso `principal` es
`nullable` en `policyRailDeploymentSchema` (`scripts/lib/deployment.ts`):
es el único rail registrado que no tiene uno on-chain, y romper su lectura
habría roto todos los scripts que tocan `deployments/testnet.json` por un
rail que este hito no estaba cambiando.

Documentación tocada: `PLATAFORMA-PARTNERS.md` (fila `G9` marcada
resuelta; F6 gana su primer ticket real), `BITACORA.md`, `evidencia/T57.md`.
Archivos tocados: `contracts/policy-rail/src/lib.rs`,
`contracts/policy-rail/src/test.rs` (+11 tests, 21 → 32),
`scripts/deploy-policy-rail.ts` (`--principal <G...>`, requerido y sin
default), `scripts/lib/deployment.ts` y su test (+2).

---

### C-62 · El rail por tenant es solo para sesiones con wallet real; el camino clásico sigue en el rail compartido · `Vigente`
**Fecha:** 2026-09-11 (T58)

El plan de T58 asumía que "rail por tenant" reemplazaba enteramente al
rail compartido — incluido retirar `POLICY_RAIL_CONTRACT_ID` del todo.
Leyendo `server.ts` de cerca antes de escribir código apareció algo que
el plan no había separado: el camino **clásico** (sin conectar wallet,
`C-34`) también puede pedir pagar vía rail (`body.payer === "policy-rail"`
no distingue), pero su "principal" es la propia plataforma firmando por
sí misma (`principalAddress: issuer.publicKey()`) — una ficción de demo
para poder mostrar el flujo sin wallet, no un cliente real. Nunca pasa por
`ensureTenantAgent`, no tiene fila en `directory_agents`, no tiene wallet
real vinculada. Desplegar un contrato Soroban por cada visita sin wallet
no tendría dueño real a quien pertenecerle, y gastaría fondos de la
reserva en contratos que nadie puede después retirar de forma
significativa (el "principal" sería la propia plataforma).

**La decisión:** `ensureTenantPolicyRail` solo se invoca cuando la sesión
tiene una identidad de tenant real (`tenantAgentId` — viene de
`ensureTenantAgent`, F4/T40) y una wallet vinculada (`walletAddress`,
`directory.bindPrincipal`). El camino clásico sigue leyendo
`POLICY_RAIL_CONTRACT_ID` y pagando desde `AGENT_SECRET_KEY`, exactamente
como antes de este hito — `DemoSession.railContractId` pasa a documentarse
como "el rail compartido, camino clásico", no como el general.

Esto no reabre ni contradice ninguna decisión previa: es la misma línea
que `C-34` ya trazó para la identidad (el camino clásico no tiene una
propia, y no la necesita para lo que demuestra) aplicada ahora también al
pago, que es exactamente donde `C-39`/`C-40` ya decían que la separación
de F4 terminaba y donde empezaba el trabajo de F6.

**Alternativa descartada:** desplegar igual un rail para el camino
clásico, con `principal = issuer` (la propia plataforma). Descartada
porque no prueba nada que el rail compartido no probara ya, y multiplica
contratos Soroban reales (costo de rent, fees de despliegue) por cada
visitante sin wallet de la demo — exactamente el tipo de gasto que `C-21`
ya advierte evitar para identidades que no van a usarse de verdad.

Documentación tocada: `BITACORA.md` (T58), `evidencia/T58.md`. Archivos
tocados: `packages/directory/src/{schema-sql,entities,directory}.ts` (+
`directory.integration.test.ts`, +3 tests), `apps/web/src/tenant-rail.ts`
(nuevo) y su test, `apps/web/src/server.ts` (`buy()`, `finishSession`),
`render.yaml`, `.env.example`.

---
