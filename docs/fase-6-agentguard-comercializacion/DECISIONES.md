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
