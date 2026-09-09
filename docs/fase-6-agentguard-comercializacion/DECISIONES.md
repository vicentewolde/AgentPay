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
