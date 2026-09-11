# Bitácora — Fase 6 (AgentGuard + comercialización)

> Qué se hizo, qué falta, y qué significa cada cosa en lenguaje llano.
> Contexto: [CONTEXTO.md](CONTEXTO.md) · Decisiones: [DECISIONES.md](DECISIONES.md) ·
> Salidas crudas de cada hito: [evidencia/](evidencia/)
>
> La numeración de hitos continúa la de las fases anteriores: T1–T8 Fase 1,
> T9–T15 Fase 2, T16–T23 Fase 3, T24–T26 Fase 4, T27–T31 Fase 5, esta
> empieza en T32.

---

## Estado actual

**Fecha:** 2026-09-11 · **Último hito cerrado:** T60 · **Fase 6: en curso**

Un visitante ya puede conectar una wallet Stellar real (Freighter), firmar
de verdad su propio Mandato, y cada tenant deriva y ancla su propia
identidad Stellar — el pago real todavía sale de una cuenta compartida
hasta F6 (`C-39` a `C-42`, T40). `/v1` ya es real: un partner con su
propia API key (emitida con `pnpm run partner:create`) puede crear un
tenant, leerlo, listar sus agentes y consultar sus mandatos contra
Postgres de verdad — con idempotencia y aislamiento entre partners
verificados, no solo diseñados (`C-49` a `C-54`, T49). El círculo
completo funciona de punta a punta, con página incluida: un partner
propone un `grant` (con `payTo` si quiere), un principal la abre en
`/consent/{id}`, revisa cada permiso propuesto, conecta su wallet y
firma — y el Mandato resultante queda anclado en testnet y consultable
por el partner (`C-55` a `C-59` de T51, página `consent.html` de T52).
F5 cierra del todo: hay una guía con `curl` exactos
(`examples/cloudops-partner-integration.md`, T50) que un partner externo
puede seguir de punta a punta sin tocar el repo — el "listo cuando" de
la fase, cumplido y verificado, no solo escrito. Y arrancó F7: agregar un
comercio x402 nuevo ya no significa escribir un archivo entero shaped
como el viejo `bazaar.ts` — es una fila en `venues.json` (T53), validada
y fallando cerrado ante un asset que ese venue no nombra, igual que el
`mapAsset` hardcodeado de antes pero ahora reutilizable por cualquier
venue registrado. Y se destrabó F6: hasta T57, la plata que
entraba a un `policy_rail` solo podía salir con la firma de la llave de
AgentPay, así que un cliente que lo fondeara no podía recuperarla —
`G9`, el bloqueante duro. Ahora el contrato distingue dos autoridades:
la llave delegada del agente sigue gastando dentro de sus límites, y la
wallet del cliente puede retirar todo o cambiar esa llave cuando
quiera, sin que AgentPay coopere (`C-61`). Y F7 quedó completa: hay dos comercios en
el catálogo del agente — el bazaar del embajador y un segundo x402 real
e independiente (`examples/reference-merchant/**`, T54) — y agregar
cualquiera de los dos, o uno nuevo, es una fila en `venues.json`, no
código. Y F6 avanzó su parte central: un tenant que conecta una wallet
real y llega a pagar ya recibe su **propio** `policy_rail` — desplegado y
fondeado la primera vez que compra, no antes — en vez de compartir el de
siempre. Verificado en testnet real con dos tenants pagando cada uno desde
un contrato distinto, y un tercero rechazado por la red, no por el
software, al superar su `per_day` (T58). El camino clásico sin wallet
sigue exactamente igual que antes, pagando del rail compartido. Y F6
completa sus tres entregables: `pnpm run check:rail-balances` (T60) lee
el saldo USDC real de cada rail de tenant, para detectar uno quedándose
sin fondos antes de que una compra falle contra él.

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T32 | `@agentpay/tenancy`: deriva un par de llaves Stellar (agente + issuer) por tenant desde un único seed maestro, vía SEP-0005/BIP-44 | ✅ cerrado 2026-09-09 |
| T33 | `MandateVault` sobre Postgres, reemplaza el JSONL en disco efímero de Render; cableado en `apps/web` | ✅ cerrado 2026-09-09 |
| T34 | Conectar wallet (Freighter) con verificación criptográfica real (SEP-0053); da a cada wallet un `tenant_id` estable en el vault | ✅ cerrado 2026-09-09 |
| T35 | La wallet conectada firma de verdad el Mandato (SEP-0053) y ancla/revoca la transacción on-chain con su propia firma | ✅ cerrado 2026-09-09 |
| T36 | Blindar `apps/web`: costuras testeables extraídas de `server.ts` y 49 tests donde antes no había ninguno | ✅ cerrado 2026-09-10 |
| T37 | Diseño de la plataforma para partners: modelo de entidades, modelo de fondos, plan de diez fases — **sin una línea de código** | ✅ cerrado 2026-09-10 |
| T38 | `@agentpay/directory`: el registro durable de partners, tenants, principals, agentes, credenciales y mandatos | ✅ cerrado 2026-09-10 |
| T39 | Persistencia de sesión: una wallet que vuelve encuentra su credencial y su Mandato ya firmados, en vez de que se emitan de nuevo | ✅ cerrado 2026-09-10 |
| T40 | Identidad técnica por tenant: cada uno deriva y ancla su propia credencial y Mandato — el pago sigue compartido hasta F6 | ✅ cerrado 2026-09-10 |
| T45 | `@agentpay/partner-api`: el contrato congelado de `/v1` — esquemas, autenticación, permisos, idempotencia — sin rutas todavía | ✅ cerrado 2026-09-10 |
| T46 | OpenAPI 3.1 de `/v1` generado desde los esquemas zod de T45, sin librerías nuevas | ✅ cerrado 2026-09-10 (Codex, PR #6) |
| T47 | `@agentpay/partner-sdk`: cliente tipado sobre `fetch` nativo para las siete rutas de `/v1` | ✅ cerrado 2026-09-10 (Codex, PR #7) |
| T48 | `@agentpay/webhooks`: worker de entrega con reintentos y backoff, firma HMAC | ✅ cerrado 2026-09-10 (Codex, PR #8) |
| T49 | `/v1` cableado de verdad contra `@agentpay/directory`: tenants, agentes, mandatos, idempotencia, aislamiento entre partners | ✅ cerrado 2026-09-10 |
| T51 | `consent_sessions`: un partner propone un grant, un principal lo firma por wallet en un flujo hospedado, el Mandato queda anclado — backend completo, verificado sin la página | ✅ cerrado 2026-09-11 |
| T52 | `consent.html`: la página que un principal realmente ve — muestra el grant completo, conecta wallet, firma el Mandato — sobre los endpoints que T51 dejó estables | ✅ cerrado 2026-09-11 (Codex, PR #13) |
| T50 | `examples/cloudops-partner-integration.md`: la guía con `curl` exactos para que un partner externo integre `/v1` sin tocar el repo — cierra el "listo cuando" de F5 | ✅ cerrado 2026-09-11 (Codex, PR #15) |
| T53 | Registro de venues/assets (`registry.ts` + `venues.json`) y adaptador x402 genérico (`x402-catalog.ts`) — reemplaza el `mapAsset` hardcodeado de `bazaar.ts`, que queda como capa de compatibilidad | ✅ cerrado 2026-09-11 |
| T57 | `withdraw` y `set_owner` en `policy_rail`, gateados por la wallet del principal — resuelve `G9`, el bloqueante duro de F6 | ✅ cerrado 2026-09-11 |
| T55, T56 | Script de alta de comercio (`scripts/register-venue.ts`) y tests del adaptador genérico sobre un segundo venue sintético | ✅ cerrados 2026-09-11 (Codex, PR #16) |
| T54 | Comercio de referencia x402 independiente (`examples/reference-merchant/**`) — segundo venue real, cierra F7 | ✅ cerrado 2026-09-11 (Codex, PR #17) |
| T58 | Rail `policy_rail` por tenant: desplegado y fondeado sin CLI, la primera vez que un tenant con wallet real paga; verificado en testnet con dos tenants en rails distintos y un tercero rechazado por `per_day` | ✅ cerrado 2026-09-11 |
| T60 | `scripts/check-rail-balances.ts`: lee el saldo USDC real de cada rail de tenant, avisa si está bajo — completa los tres entregables de F6 | ✅ cerrado 2026-09-11 |

---

## T32 · `@agentpay/tenancy` — derivación de llaves por tenant — cerrado 2026-09-09

**Qué quedó funcionando, en palabras llanas.** Hoy, cualquiera que visite
`apps/web` firma con la misma identidad Stellar que todos los demás
visitantes — dos secretos fijos (`AGENT_SECRET_KEY`, `ISSUER_SECRET_KEY`)
compartidos. Este hito construye la pieza que lo resuelve sin que cada
tenant nuevo necesite una cuenta cloud ni un secreto propio que alguien
tenga que generar, guardar y rotar a mano: un único "seed maestro" (una
frase de 24 palabras) del que se derivan, de forma determinística, un par
de llaves distintas por cada tenant — una para el agente, otra para el
emisor de credenciales — igual que hacen los proveedores de wallets como
Privy, aplicado al estándar propio de Stellar (SEP-0005).

**Por qué esta pieza primero.** Es el bloqueante identificado en la
investigación previa a este hito (`docs/DECISIONES.md → P-6`): sin esto,
cualquier partner piloto nuevo compartiría fondos e identidad con todos los
demás — un riesgo de integridad del piloto, no solo de escala.

**Cómo quedó construido.** Paquete nuevo `@agentpay/tenancy`:
`deriveTenantKeypair(masterMnemonic, tenantIndex, role)` deriva un par
público/secreto Stellar válido a partir del seed maestro y un índice de
cuenta SEP-0005 (`m/44'/148'/<cuenta>'`) — par (par/impar) según el rol
(`agent`/`issuer`), así el par de un mismo tenant nunca colisiona consigo
mismo, y dos tenants nunca colisionan entre sí mientras cada uno reciba un
`tenantIndex` propio. `generateMasterMnemonic()` genera el seed una única
vez. El paquete no lee `.env.local` ni ninguna variable de entorno — recibe
el seed maestro como parámetro, para que quien lo llame decida de dónde
sale (hoy `.env.local` en desarrollo; un gestor de secretos en producción,
etapa siguiente). Se usó `stellar-hd-wallet` (implementación de SEP-0005
del propio ecosistema Stellar) solo para la derivación — el par resultante
se pasa como texto plano (`G.../S...`) a cualquier `Keypair.fromSecret()`
de `@stellar/stellar-sdk`, sin acoplar la versión de `stellar-base` que esa
librería trae internamente a la que usa el resto del proyecto.

**Evidencia técnica.** 9 tests nuevos (644 en total, de 635):
determinismo (misma llamada, mismo resultado), que cada tenant recibe
llaves distintas, que el par agente/issuer de un mismo tenant nunca
colisiona, que las llaves tienen la forma strkey correcta de Stellar
(`G.../S...`), que un índice negativo o no entero se rechaza con
`InvalidTenantIndex` (código nuevo en `AgentPassError`), y que una frase
que no es BIP-39 válida se rechaza con `ConfigError`. `pnpm typecheck` y
`pnpm build` (monorepo completo) limpios — ver `evidencia/T32.md`.

**Por qué es un paquete nuevo y no un método más de `@agentpass/sdk`.**
Deriva llaves de un seed multi-tenant — un concepto de la Fase 6 que no
existía en ninguna fase anterior. Agregarlo a un paquete de la Fase 1
hubiera sido forzar una responsabilidad nueva en un paquete ya cerrado; un
paquete propio, sin depender de ninguna `apps/*`, sigue la misma regla de
capas que el resto del monorepo (`packages/*` es reusable, `apps/*` solo
cablea).

Documentación tocada: `CLAUDE.md` (tabla de documentación, nota de
alcance del punto 5), `ROADMAP.md` (§3, §4.5, §4.6), `docs/DECISIONES.md`
(`P-6` nueva), toda la carpeta `docs/fase-6-agentguard-comercializacion/`
(nueva). Archivos nuevos: `packages/tenancy/` completo. Archivos tocados:
`packages/core/src/errors.ts` (`InvalidTenantIndex` nuevo), `tsconfig.json`
raíz (referencia nueva).

Pendiente: mergear `cc/multi-tenant-vault` a `main` y pushear (a confirmar
con el usuario). Siguiente: cablear `@agentpay/tenancy` dentro de
`apps/web` (reemplazar los dos secretos fijos), lo cual necesita decidir
antes dónde vive el seed maestro (gestor de secretos) y dónde persiste el
índice de cada tenant — probablemente junto con la migración del vault de
JSONL a Postgres, ya que ambas cosas necesitan la misma tabla de tenants.

---

## Licencia del repo (sin numerar) — 2026-09-09

Al preparar el contenido de difusión técnica (`P-6`, semana 3 del plan de
GTM) se encontró que el repo, pese a ser público, no tenía ninguna licencia
explícita — "todos los derechos reservados" por defecto. Se agregó
`LICENSE` (Apache-2.0) en la raíz, más el campo `license` en el
`package.json` raíz y en los dos `Cargo.toml` de `contracts/`. Detalle
completo, con la alternativa descartada (MIT) y la nota sobre el titular
del copyright, en `docs/DECISIONES.md → P-7`.

No es un hito numerado — es un fix de higiene legal encontrado en el
camino, sin código de producto de por medio. `pnpm typecheck` y
`cargo check` (los dos crates) verificados limpios después del cambio.

## T33 · MandateVault sobre Postgres — cerrado 2026-09-09

**Qué quedó funcionando, en palabras llanas.** Antes de este hito, si el
servidor de `apps/web` se reiniciaba a mitad de una visita —exactamente lo
que le pasa en Render cada vez que se redespliega, o cuando el plan
gratuito lo apaga por inactividad—, la bitácora de esa visita desaparecía
por completo: el archivo vivía en un disco que Render borra en cada
reinicio. Ahora la bitácora vive en una base de datos real (Postgres, hoy
en Supabase) que no se borra con el servidor. Se probó en vivo, no solo en
teoría: sesión real, compra real pagada por `policy_rail`, se mató el
proceso del servidor a propósito, se lo volvió a levantar, y las dos
entradas de antes del reinicio seguían ahí, con la cadena de hashes
íntegra.

**Un bug real, encontrado por el propio test de integración, no leyendo
documentación.** La primera versión guardaba cada entrada en una columna
`jsonb` — y `verify()` empezó a reportar manipulación donde no la había.
La causa: `jsonb` de Postgres no promete conservar el orden de las claves
de un objeto al guardarlo, y el hash de cada registro se calcula sobre
`JSON.stringify(entry)`, que sí depende de ese orden. Bastaba que Postgres
reordenara las claves al guardar para que, al releer el registro en un
proceso nuevo, el hash recalculado no coincidiera con el guardado —
exactamente el síntoma que `verify()` está diseñado para detectar, pero
disparado por una particularidad de Postgres, no por una edición real.
Cambiar la columna a `json` (que sí preserva el texto exacto) lo resolvió.
Detalle completo en `DECISIONES.md → C-5`.

**Cómo quedó construido.** `createPostgresMandateVault` (paquete
`@agentpay/vault`) implementa el mismo contrato `MandateVault` que
`createFileMandateVault` — mismos ocho métodos, misma bitácora encadenada
por hash — reusando además sus mismas funciones puras de aritmética y
hashing (`packages/vault/src/internal/amount.ts`, separadas del archivo
original en este mismo hito para que ninguna de las dos implementaciones
pudiera divergir por accidente). Al construirse, crea su propia tabla
(`vault_records`) si hace falta y carga en memoria todas las filas del
`tenant_id` pedido — igual que el backend de archivo carga su archivo
entero al arrancar — así que `list()`, `head()` y `verify()` siguen siendo
síncronos como el resto del proyecto ya espera. `apps/web` pasó a usarlo en
`startSession`, con el mismo `sessionId` de cookie que antes nombraba el
archivo — ver `DECISIONES.md → C-6` para por qué el hito se detiene ahí y
no le da todavía a cada tenant su propia identidad Stellar (T32 sigue sin
cablear).

**Evidencia técnica.** 5 tests de integración nuevos, corridos contra la
base real de Supabase del piloto (no una base de prueba separada): que
graba y suma montos, que deduplica por `intentId`, que refusals y anclajes
conviven en la misma cadena, que **sobrevive reconstruirse** —el escenario
exacto de este hito— y que dos tenants nunca se pisan. Cada test crea su
propio `tenant_id` al azar y borra sus propias filas al terminar, para no
dejar basura en la base real. `pnpm typecheck`/`pnpm build` (monorepo
completo) y la suite rápida (649 tests) limpios. Ver `evidencia/T33.md`
para las salidas completas, incluida la secuencia de verificación en vivo
(iniciar → comprar → matar el servidor → levantarlo → confirmar que la
bitácora sigue ahí).

Documentación tocada: `docs/DECISIONES.md` (sin cambios — es de fase),
`docs/fase-6-agentguard-comercializacion/` (`BITACORA.md`, `DECISIONES.md`
`C-5` a `C-7`, `evidencia/T33.md`). Archivos nuevos:
`packages/vault/src/internal/amount.ts`, `packages/vault/src/postgres-vault.ts`
(+ test de integración), `packages/vault/vitest.integration.config.ts`.
Archivos tocados: `packages/vault/src/vault.ts` (sin cambio de
comportamiento, solo la extracción), `packages/vault/src/index.ts`,
`packages/vault/package.json`, `apps/web/src/server.ts` (`vaultPathFor`
eliminada), `.env.example`, `.gitignore` (entrada de `/data/` eliminada,
ya sin uso), `render.yaml` (`DATABASE_URL` nueva, secreta).

Pendiente: mergear `cc/postgres-vault` a `main` y pushear (a confirmar con
el usuario) — esta rama sigue apilada sobre `cc/multi-tenant-vault`
(`P-6`/T32), así que ambas se mergean juntas. El usuario tiene que cargar
`DATABASE_URL` en el dashboard de Render antes de que el próximo deploy
funcione — mismo patrón que `POLICY_RAIL_CONTRACT_ID` en su momento, pero
esta sí es secreta (`sync: false`). Siguiente decisión, sin resolver
todavía: el modelo de onboarding/fondeo para darle a cada tenant real su
propia identidad Stellar (`C-6`).

## T34 · Conectar wallet (Freighter) — interacción Web3 real — cerrado 2026-09-09

**Qué quedó funcionando, en palabras llanas.** El usuario pidió que un
visitante nuevo tenga que registrarse con su wallet, con interacción Web3
de verdad, no un formulario disfrazado. Ahora la página tiene un primer
paso — "Conectar wallet" — donde alguien con la extensión Freighter
instalada firma un mensaje de un solo uso para probar que controla esa
cuenta de Stellar. La wallet nunca revela su llave secreta; el servidor
verifica la firma con criptografía real (el mismo estándar, SEP-0053, que
usan las wallets de Stellar para "probá que sos vos" fuera de una
transacción). Quien conecta la misma wallet dos veces cae siempre en el
mismo lugar de la bitácora (T33) — su historial ya no depende de la cookie
al azar de una sola visita.

**Lo que esto NO hace todavía, dicho en voz alta.** La wallet conectada
todavía no es quien firma el Mandato — eso sigue siendo la llave de la
plataforma. Y el agente todavía gasta desde la cuenta compartida, no desde
una cuenta propia de cada tenant. Los dos huecos están anotados con su
motivo técnico exacto, no ignorados — ver `DECISIONES.md → C-8` y `C-11`.

**Cómo quedó construido.** `verifyStellarMessage` (`apps/web/src/wallet/`)
implementa SEP-0053 de punta a punta: `sha256("Stellar Signed Message:\n" +
mensaje)`, verificado como firma Ed25519 cruda contra la dirección
reclamada. `POST /api/wallet/challenge` emite un nonce de un solo uso;
`POST /api/wallet/verify` lo consume, verifica la firma, y si es válida
fija la cookie de sesión a `walletTenantId(address)` —
`sha256(dirección)` reacomodado con guiones para tener la forma de un UUID
(`C-9`)— así la misma wallet siempre vuelve al mismo `tenant_id`. El
frontend carga `@stellar/freighter-api` (el build UMD oficial, vía CDN, sin
paso de build) en vez de un kit multi-wallet completo — de los kits
disponibles, Freighter es el único wallet de Stellar que este piloto
necesita hoy; sumar más queda anotado, no descartado.

**Dos bugs reales, ninguno encontrado leyendo documentación.** Primero:
`Keypair.sign()` de `@stellar/stellar-sdk` devuelve un `Uint8Array` plano,
no un `Buffer` de Node — llamarle `.toString("base64")` directo no falla,
pero tampoco hace lo que parece; hay que envolverlo en `Buffer.from(...)`
primero. Encontrado porque el propio test de la firma de referencia fallaba
sin ningún mensaje de error obvio. Segundo, más serio: `requestAccess()` de
Freighter espera una respuesta de la extensión del navegador y **nunca
resuelve ni rechaza** si no hay ninguna instalada — el botón se queda
colgado para siempre, sin ningún error visible. Encontrado clickeando el
botón real en un navegador sin la extensión, no leyendo la API. Se
corrigió llamando primero a `isConnected()` (que sí responde rápido en los
dos casos) y solo pidiendo acceso si devuelve `true`. Detalle completo en
`DECISIONES.md → C-10`.

**Evidencia técnica.** 5 tests nuevos en `apps/web` — la primera cobertura
de tests que tiene esta app (`apps/web` no tenía tests propios hasta este
hito, exactamente como quedó anotado en el BITACORA de la Fase 4). `pnpm
typecheck`/`pnpm build` (monorepo completo) limpios.

**Verificado en vivo, dos veces.** Primero, el camino feliz: se generó un
keypair de prueba y se firmó un challenge real exactamente como lo haría
Freighter (sin atajos del servidor), verificado contra el servidor real
—incluidos los dos casos de seguridad (reusar un nonce ya gastado, y una
firma de una wallet distinta a la que dice ser), los dos rechazados
correctamente— y confirmando que la misma wallet, en dos conexiones
separadas, siempre cae en el mismo `tenant_id`. Segundo, el camino sin
wallet instalada: clickeando el botón real en una pestaña nueva del
navegador (Claude Browser, sin la extensión Freighter), apareció
correctamente "Freighter not found..." sin colgarse — confirma el arreglo
del segundo bug. Ver `evidencia/T34.md`.

**Por qué esta forma y no otra.** El usuario pidió explícitamente "que
haya interacción Web3" al decidir entre wallet propia o creada — conectar
una wallet real y verificarla criptográficamente es la forma más genuina
de eso, sin inventar una capa de cuentas propia que compita con lo que
Stellar ya resuelve.

Documentación tocada: `docs/DECISIONES.md` (`P-8`, el nombre "TirevPay" —
sin ejecutar el rename todavía), `docs/fase-6-agentguard-comercializacion/`
(`BITACORA.md`, `DECISIONES.md` `C-8` a `C-11`, `evidencia/T34.md`).
Archivos nuevos: `apps/web/src/wallet/verify-message.ts` (+ test),
`apps/web/vitest.config.ts`. Archivos tocados: `apps/web/src/server.ts`,
`apps/web/public/index.html`, `apps/web/package.json`.

Pendiente: mergear `cc/wallet-connect` a `main` y pushear (a confirmar con
el usuario). Sin resolver todavía, a propósito: extender `verifyMandate`
para aceptar una firma SEP-0053 como alternativa (haría a la wallet
conectada la firmante real del Mandato, `C-8`); dar a cada tenant su
propia cuenta Stellar fondeada (`C-11`, bloqueado por el faucet manual de
USDC de Circle); y el rename completo a "TirevPay" (`P-8`), todavía sin
ejecutar en ningún archivo.

---

## Fix de producción: el vault de Postgres no conectaba desde Render (sin numerar) — 2026-09-09

El usuario probó `apps/web` real en Render tras el deploy de T33/T34 y
"Iniciar sesión" falló con "could not reach or initialise the vault's
Postgres database" — el mismo código conectaba sin problema en local
contra la misma base de Supabase. Causa: Supabase exige TLS para
conexiones externas y `pg` no lo negocia solo; hacía falta pasar
`ssl: { rejectUnauthorized: false }` al `Pool`. De paso se encontró que el
error real nunca llegaba a ningún lado —ni a los logs del servidor ni a la
respuesta HTTP— así que también se agregó `console.error` en el punto de
la falla y `details.cause` en el error, mostrado ahora en la página.
Detalle completo, con la alternativa descartada, en `DECISIONES.md → C-12`.

Verificado: conexión explícita con SSL probada contra la base real antes
de aplicar el cambio (sigue conectando igual en local, sin regresión), los
5 tests de integración del vault y los 17 rápidos siguen en verde, `pnpm
typecheck`/`pnpm build` (monorepo completo) limpios. No se pudo verificar
todavía contra el Render real —el usuario tiene que redesplegar y probar
de nuevo—, a diferencia del resto de los hitos de esta fase.

**Segunda vuelta, mismo día — el SSL no era la única causa.** Con el
logging del error real ya en su lugar (el fix de arriba), el usuario probó
de nuevo y esta vez el mensaje fue explícito: `ENETUNREACH` contra una
dirección `2600:...` — una IPv6. La conexión "Direct connection" de
Supabase resuelve solo a IPv6, y Render (como la mayoría de los hosts
PaaS) no tiene salida a internet por IPv6, solo IPv4 — por eso conectaba
sin problema desde la computadora del usuario (que sí tiene ruta IPv6) y
nunca desde Render. La solución de Supabase para exactamente este caso es
el **"Session pooler"** (`*.pooler.supabase.com`), que resuelve solo a
IPv4 — confirmado con `dig` antes de usarlo, sin ningún registro `AAAA`.

Al armar la nueva cadena aparecieron dos problemas más, los dos resueltos
con el mismo truco del portapapeles de T33 (nunca pasar la contraseña por
el chat): la cadena que copia Supabase para el pooler también trae
`[YOUR-PASSWORD]` sin reemplazar, igual que la directa; y una contraseña
recién reseteada tardó **~30 segundos** en sincronizarse hacia el pooler
—la misma contraseña funcionaba de inmediato contra la conexión directa,
pero el pooler seguía rechazándola hasta esperar un poco y reintentar—.
Los dos quedaron documentados en `.env.example` para que la próxima vez no
haga falta redescubrirlos.

Verificado: los 5 tests de integración del vault corridos de punta a
punta contra la conexión por pooler, todos en verde.

## T35 · La wallet firma de verdad el Mandato — cerrado 2026-09-09

**Qué quedó funcionando, en palabras llanas.** Hasta T34, conectar una
wallet solo probaba quién era el visitante; el permiso de gasto (el
Mandato) lo seguía firmando la plataforma en su nombre. Ahora, si conectás
tu wallet antes de "Iniciar sesión", es tu propia wallet la que aprueba
ese permiso — dos firmas tuyas, en dos ventanas de Freighter: primero un
mensaje que resume el Mandato en texto legible (montos, límites, hasta
cuándo vale), después la transacción real que lo deja anclado en la
blockchain de Stellar. Revocarlo más tarde también lo firma tu wallet, no
la plataforma. Si no conectaste ninguna wallet, todo sigue exactamente
como antes (T25–T34): la plataforma firma por vos, sin ningún paso extra.

**El problema técnico real, y por qué no se resolvió estirando código de
la Fase 3.** Una wallet nunca puede producir la firma que el Mandato
usaba hasta ahora (un JWS compacto EdDSA) — no es una limitación de
Freighter, es que las wallets, por diseño, solo exponen firma de mensajes
de texto (SEP-0043/SEP-0053), que se calcula sobre un hash distinto del
que un JWS firma. Extender la verificación cerrada de la Fase 3 para que
aceptara las dos formas habría sido tocar en silencio una decisión ya
cerrada — en vez de eso, se avisó al usuario con esta evidencia y se
construyó un camino de verificación paralelo, nuevo, que nunca toca
`verifyMandate`. Detalle completo en `DECISIONES.md → C-13`.

**Cómo quedó construido.** Cinco piezas, de abajo hacia arriba:

1. `packages/core/src/sep53.ts` — `verifyStellarMessage`/`signStellarMessage`,
   promovido desde `apps/web` (T34) a `@agentpass/core` porque ahora lo usa
   también `@agentpay/mandate`.
2. `packages/mandate/src/wallet-sign.ts` — `verifyWalletSignedMandate`: dado
   un documento de Mandato en JSON y una firma SEP-0053, verifica que la
   firma corresponda al `principal` que el documento declara, valida su
   forma con el mismo esquema zod de siempre, y chequea la ventana de
   validez — sin tocar `verifyMandate` para nada.
3. `packages/mandate/src/anchor.ts` — `prepareWalletAnchor`/
   `prepareWalletRevoke`: arman y simulan la transacción de
   anclar/revocar contra `agent_registry`, pero se detienen antes de
   firmar — devuelven la transacción sin firmar para que la wallet la
   firme. `verifyWalletSignedMandateOnChain` hace el mismo chequeo on-chain
   que su versión JWS, compartiendo la parte que sí es idéntica entre las
   dos (`checkOnChainStatus`, extraída en este hito).
4. `packages/sdk/src/registry.ts` — el `Registry` de la Fase 1 gana
   `prepareAnchor`/`prepareRevoke`/`submitSigned`, usando
   `AssembledTransaction.toXdr()`/`.signAndSend({ signTransaction })` (ya
   parte de `@stellar/stellar-sdk/contract`) para el flujo de dos fases:
   preparar acá, firmar en la wallet, enviar acá. Detalle de por qué dos
   fases y no una en `DECISIONES.md → C-14`.
5. `apps/agent` — `MandateSource` pasa a ser `string | { mandate, signature }`;
   el agente y sus tools despachan según cuál llegó, sin que el resto del
   código que ya pasaba un JWS crudo tenga que cambiar (verificado sin
   ninguna regresión en los 421 tests existentes de `apps/agent`).

`apps/web/src/server.ts` cablea todo esto en tres peticiones nuevas —
`/api/session/wallet-consent` (firma del Mandato) y
`/api/session/wallet-anchor` (firma del anclaje) además de
`/api/session/start` ya existente, más `/api/session/wallet-revoke-submit`
para la revocación— y una wallet conectada se registra automáticamente
como issuer si hace falta (`DECISIONES.md → C-15`).

**Evidencia técnica.** 15 tests nuevos (`sep53.test.ts` promovido con 6,
`wallet-sign.test.ts` con 9), `anchor.test.ts` creció de 17 a 25 tests
cubriendo el camino de wallet, cero regresiones en los 421 tests
existentes de `apps/agent` — 515 tests en total en la suite rápida.
`pnpm typecheck`/`pnpm build` (monorepo completo) limpios.

**Verificado en vivo, de punta a punta contra testnet real — no un
mock.** Un script simula exactamente lo que hace Freighter (sin ningún
atajo del servidor): genera una wallet nueva, la fondea con Friendbot,
la conecta (T34), inicia sesión (queda "pendiente de firma"), firma el
mensaje-resumen del Mandato con esa misma primitiva SEP-0053 que usaría
una wallet real, lo manda al servidor y recibe de vuelta una transacción
sin firmar; la firma con `TransactionBuilder`/`.sign()` — igual que hace
Freighter internamente — y la reenvía. El servidor la ancló de verdad en
`agent_registry` (testnet), el reporte del vault mostró el Mandato con
`issuer` = la wallet (no la plataforma), y la revocación repitió el mismo
patrón de dos firmas hasta confirmar `mandateHash` revocado. Salida
completa en `evidencia/T35.md`. Además, se verificó en el navegador (Claude
Browser) que el camino clásico —sin conectar ninguna wallet— sigue
funcionando exactamente igual que antes, sin ninguna regresión visible ni
error de consola.

**Lo que esto NO hace todavía, dicho en voz alta.** El agente sigue
gastando desde la cuenta compartida `AGENT_SECRET_KEY`, no desde una
cuenta propia de cada tenant — ver `DECISIONES.md → C-16` para por qué
quedó fuera de este hito a propósito, aun cuando la precondición de USDC
que dio el usuario ya no lo bloquea como antes.

Documentación tocada: `docs/fase-6-agentguard-comercializacion/`
(`BITACORA.md`, `DECISIONES.md` `C-13` a `C-16`, `evidencia/T35.md`).
Archivos nuevos: `packages/core/src/sep53.ts` (+ test, movido de
`apps/web/src/wallet/verify-message.ts`), `packages/mandate/src/wallet-sign.ts`
(+ test). Archivos tocados: `packages/mandate/src/anchor.ts` (+ test),
`packages/mandate/src/testing.ts`, `packages/sdk/src/registry.ts`,
`packages/sdk/src/index.ts`, `apps/agent/src/mandate/verifier.ts`,
`apps/agent/src/agent.ts`, `apps/agent/src/tools/agent-tools.ts`,
`apps/agent/src/testing/mandates.ts`, `apps/agent/src/index.ts`,
`apps/web/src/server.ts`, `apps/web/public/index.html`.

**Addendum del mismo día — `ADMIN_SECRET_KEY` en el deploy real.** El
usuario probó T35 en Render y "Iniciar sesión" con wallet falló dos veces
seguidas. Primero: `ADMIN_SECRET_KEY is missing` — la variable estaba en
`.env.example` desde siempre pero nunca se había declarado en
`render.yaml`, así que Render nunca la pidió (mismo tipo de omisión que
`POLICY_RAIL_CONTRACT_ID` en T31 y `DATABASE_URL` en T33; ya declarada).
Segundo, al cargarla: `invalid version byte. expected 144, got 48` — un
error crudo de strkey del SDK de Stellar que no nombra ni la variable ni
el arreglo. 144 es el byte de versión de un secreto (`S...`) y 48 el de
una dirección pública (`G...`): se había pegado la clave pública donde va
el secreto. Se agregó `requireSecretKey`, por donde pasa ahora todo
secreto Stellar que este servidor lee del entorno, que falla con un
`ConfigError` tipado diciendo exactamente qué variable y qué poner — el
criterio no negociable de `CLAUDE.md` (errores tipados, nunca un `Error`
genérico) que este camino violaba al dejar escapar el error del SDK. De
paso, la clave de admin pasó a resolverse recién cuando hace falta
registrar una wallet nueva, no al iniciar la sesión: una wallet ya
registrada como issuer no depende de ella para nada.

Verificado reproduciendo el fallo exacto (`ADMIN_SECRET_KEY` apuntando a
la clave pública) contra el servidor real, confirmando el mensaje nuevo, y
después corriendo el flujo completo de wallet de punta a punta contra
testnet otra vez en verde.

**Tercer fallo, el que sí era un bug de diseño de T35: toda compra con
wallet fallaba.** Ya con la sesión iniciando bien (dos firmas de Freighter
más la de conectar), el botón "Comprar" devolvía
`MandatePrincipalMismatch: this mandate was not signed by the intent's
principal`. T35 había hecho que la wallet firmara el Mandato pero dejó la
credencial diciendo que el principal del agente seguía siendo la
plataforma — y `checkMandate` (T17) compara justamente esas dos cosas. Los
dos documentos firmados se contradecían y el chequeo los rechazó, que es
exactamente lo que tiene que hacer. Se corrigió del lado correcto: los dos
documentos derivan ahora el principal de un único valor, sin tocar
`checkMandate` (ver `DECISIONES.md → C-17`, incluida la razón por la que
aflojar el chequeo se descartó de inmediato). Verificado de punta a punta
contra testnet — compra real liquidada (`settled: true`) pagando por
`policy_rail`, con su anclaje en el vault — y confirmado después por el
usuario en el deploy real de Render: conectar wallet, iniciar sesión,
comprar y revocar, todo el ciclo funcionando en producción. Es la primera
vez en esta fase que un hito queda confirmado contra el Render real y no
solo en local.

Pendiente: mergear `cc/wallet-signs-mandate` a `main` y pushear (a
confirmar con el usuario). Siguiente decisión, sin resolver todavía:
cablear `@agentpay/tenancy` (T32) dentro de `apps/web` para que cada
tenant gaste desde su propia cuenta (`C-16`); y el rename completo a
"TirevPay" (`P-8`) sigue congelado a pedido explícito del usuario, que va
a traer nombres nuevos más adelante.


## T36 · Blindar `apps/web` — costuras testeables y cobertura real — cerrado 2026-09-10

**Qué quedó funcionando, en palabras llanas.** Los tres fallos que
aparecieron en producción al probar T35 tenían algo en común que no se
había dicho en voz alta: todos ocurrieron en el único archivo del proyecto
que no tenía ni un solo test. `apps/web/src/server.ts` eran ~1030 líneas
que hacían todo —leer configuración, armar los documentos firmados,
manejar cookies y nonces, rutear HTTP— y que no se podían testear porque
importarlo levanta un servidor. Ahora la lógica que de verdad falla vive en
tres módulos aparte que no tocan la red, y tiene 49 tests donde antes había
cero.

**Por qué estas tres costuras y no otras.** No se eligieron por prolijidad,
se eligieron mirando dónde falló: dos de los tres fallos de producción
fueron leyendo configuración (`ADMIN_SECRET_KEY` sin declarar en Render,
después cargada con una clave pública en vez del secreto) y el tercero
armando los documentos (`C-17`). Las tres costuras nuevas son exactamente
esas dos, más el ciclo de vida de nonces y sesiones de wallet, que carga
peso de seguridad real y hasta ahora sólo se verificaba a mano en el
navegador:

- `env.ts` — leer `.env.local` con `process.env` detrás, y rechazar
  configuración inválida nombrando la variable (19 tests).
- `session-documents.ts` — construir la credencial y el Mandato desde un
  único principal (9 tests).
- `wallet-session.ts` — cookies, nonces de un solo uso, y el estado
  efímero del flujo de wallet (21 tests).

**El test que más importa, y la prueba de que sirve.** El invariante que
rompió `C-17` —credencial y Mandato tienen que nombrar al mismo principal—
ahora es un test, y de hecho ahora es difícil de romper: los dos documentos
derivan el principal de un solo valor. Para confirmar que el test no es
decorativo se reintrodujo el bug a propósito y se corrió la suite: 3 tests
fallaron, y el camino clásico siguió pasando — exactamente el patrón que se
vio en producción, donde comprar sin wallet andaba y con wallet no. Después
se restauró el código correcto.

**Dos mejoras de comportamiento que salieron del camino.** Las sesiones de
wallet a medio terminar vivían en dos `Map` paralelos que había que
sincronizar a mano; ahora hay un solo store con vencimiento, compartido con
los nonces. Y el nonce del challenge se consume **antes** de verificar la
firma, no después: se gasta por ser presentado, así que una firma
incorrecta ya no se puede reintentar contra el mismo challenge. Detalle en
`DECISIONES.md → C-18`.

**Un hallazgo que conviene recordar.** El primer intento de estos tests
pasaba en verde con los tipos rotos: `vitest` no chequea tipos, y el
fixture del scope tenía una forma que no existe. Lo agarró `pnpm
typecheck`, no la suite. Vale para cualquier test que se escriba de acá en
adelante, propio o delegado: verde en `pnpm test` no quiere decir que
compile.

**Evidencia técnica.** 49 tests nuevos en `apps/web` (de 0), 734 en total
en la suite rápida, `pnpm typecheck`/`pnpm build` limpios. Sin regresión
verificada de dos formas: el flujo completo de wallet corrido de punta a
punta contra testnet después de la refactorización —incluida una compra
real liquidada por `policy_rail` con su anclaje— y el camino clásico
probado en el navegador. Ver `evidencia/T36.md`.

Documentación tocada: `docs/fase-6-agentguard-comercializacion/`
(`BITACORA.md`, `DECISIONES.md` `C-18`, `evidencia/T36.md`). Archivos
nuevos: `apps/web/src/env.ts`, `session-documents.ts`, `wallet-session.ts`,
y el test de cada uno. Archivos tocados: `apps/web/src/server.ts` (de 1030
a 991 líneas, ahora cableado y rutas).

Pendiente: es el primer hito que deja lista una superficie para delegarle
trabajo a Codex — costuras acotadas, sin red, donde ampliar cobertura no
toca ningún punto de autorización. Sigue sin resolver, a propósito:
cablear `@agentpay/tenancy` (T32) para que cada tenant gaste desde su
propia cuenta (`C-16`), y el rename completo a VynGent (`P-9`).

---

## T37 · Diseño de la plataforma para partners — cerrado 2026-09-10

**Qué quedó, en palabras llanas.** Nada que se pueda ejecutar: un plano y
seis decisiones tomadas. El usuario pidió diseñar, antes de construir, cómo
AgentPay deja de ser una demo de un visitante y pasa a ser algo que una
empresa como "CloudOps" pueda integrar para que los agentes de sus propios
usuarios compren cosas. El resultado es
[PLATAFORMA-PARTNERS.md](PLATAFORMA-PARTNERS.md) — modelo de entidades y su
ciclo de vida, separación de datos, onboarding, comparación de formas de
integración, contratos de API, brechas contra el repo real, y un plan de
diez fases con puertas de aprobación — más las decisiones `C-19` a `C-25`.

**La decisión de fondo.** De cuatro formas posibles de resolver "quién firma
el pago y quién tiene las llaves", el usuario eligió la que ya está escrita
en Rust en este repo: cada tenant fondea su propio `policy_rail`, y los
límites los aplica la red dentro de la misma transacción que mueve el dinero,
no el software antes de moverlo (`C-20`). Un tenant es la relación entre un
partner y **un usuario final suyo**, no el partner entero (`C-19`).

**Tres cosas que se encontraron leyendo el código y no la documentación, y
que ninguna decisión previa registraba.**

1. **`@agentpay/tenancy` (T32) no lo importa ningún archivo fuera de su
   propio paquete.** `C-16` decía que faltaba cablearlo; lo que no decía es
   que estuviera literalmente huérfano. La derivación de llaves por tenant
   existe como biblioteca, no como capacidad del producto.
2. **El vault responde `spentOn()` desde un caché en memoria** cargado al
   construirse (`packages/vault/src/postgres-vault.ts`). Con dos procesos
   sirviendo al mismo tenant, cada uno ve un gasto diario desactualizado y el
   camino de cuenta clásica podría exceder `perDay`. El camino `policy_rail`
   no, porque ahí el límite lo aplica el contrato. `C-7` documenta la
   serialización de **escrituras**; la lectura de totales no estaba anotada.
   Hoy está mitigado por correr una sola instancia, y eso ahora está escrito.
3. **`policy_rail` no tiene retiro, ni rotación de owner, ni revocación**
   (`contracts/policy-rail/src/lib.rs`). Con el modelo de fondos recién
   elegido, quien fondee un rail cuyo owner tenga AgentPay no puede recuperar
   su saldo. Tolerable en testnet con montos simbólicos; bloqueante para
   fondos reales. Es un cambio de contrato, área restringida — registrado en
   `C-20`, **no propuesto para construir**.

**Una consecuencia de escala que apareció al cruzar dos respuestas del
usuario.** Un tenant por usuario final, a ~500 partners con miles de usuarios
cada uno, es del orden de un millón de tenants; y un `policy_rail` por
tenant, creado por adelantado, sería del orden de un millón de XLM
inmovilizados solo para que las cuentas y los contratos existan. De ahí sale
`C-21`: derivar llaves es local y gratis, y la cuenta y el contrato se crean
recién cuando el tenant va a gastar de verdad.

**Evidencia técnica.** Ninguna corrida: este hito no produjo código. Lo que sí
se verificó, contra el repo y no contra la documentación, está en
[evidencia/T37.md](evidencia/T37.md) — los comandos exactos y sus salidas.

Documentación tocada: `docs/AGENT_LOG.md`, y en esta carpeta
`PLATAFORMA-PARTNERS.md` (nuevo), `BITACORA.md`, `DECISIONES.md` (`C-19` a
`C-25`), `CONTEXTO.md` §5, `evidencia/T37.md` (nuevo). Fuera de la carpeta,
`ROADMAP.md` §4.6. **Cero archivos de código tocados.**

Pendiente: el siguiente hito propuesto es **F2 = T38**, el modelo de datos de
partner y tenant como paquete nuevo — no toca ninguna área restringida y no
depende de nada que quede sin decidir. Sigue pendiente de antes: cablear
`@agentpay/tenancy` (`C-16`, ahora parte de F4) y el rename a VynGent
(`P-9`).

---

## T38 · `@agentpay/directory` — el registro durable de quién existe — cerrado 2026-09-10

**Qué quedó funcionando, en palabras llanas.** Hasta hoy, AgentPay no sabía
quién era nadie. Todo lo que el piloto conoce de un visitante vive en la
memoria del servidor y desaparece cuando el servidor se reinicia — por eso
apretar "Iniciar sesión" una segunda vez emite una credencial nueva y un
Mandato nuevo en vez de encontrar los que ya están firmados y anclados.

Este hito construye la libreta que faltaba: una empresa que integra
(**partner**), cada uno de sus usuarios (**tenant**), la wallet que consiente
(**principal**), el agente que actúa, y los documentos firmados que lo
autorizan. Todo en Postgres, todo sobrevive a un reinicio.

Lo que prueba que funciona es un caso concreto: **la misma persona, con la
misma wallet, y hasta con el mismo identificador de usuario, dándose de alta
en dos partners distintos, termina con dos espacios separados** — dos tenants,
dos agentes, dos cuentas Stellar distintas. Hoy eso no pasaba: el identificador
de tenant era el hash de la dirección de la wallet, así que esa persona caía
en un único espacio compartido entre los dos partners.

**Lo que este paquete deliberadamente no hace.** No deriva llaves: reparte el
índice y le pide a quien lo llama que derive, así el seed maestro nunca entra
en su alcance. No verifica firmas ni decide nada: guardar un documento firmado
y juzgarlo son trabajos distintos, y este hace solo el primero. Y no lee
variables de entorno.

**Cero cambios en ningún punto de autorización.** `git diff` contra `apps/` y
`contracts/` no devuelve nada: `checkMandate`, `checkScope`, `checkDailyLimit`,
`policy_rail` y `agent_registry` quedan byte por byte como estaban. Lo único
que cambió fuera del paquete nuevo son cinco códigos de error agregados a la
unión de `packages/core` —aditivo, el mismo patrón que T32— y tres archivos de
documentación.

**Tres decisiones que salieron de construirlo, no de planificarlo.**

1. **El índice de derivación es por agente, no por tenant** (`C-27`). El
   modelo objetivo pide que un tenant pueda tener varios agentes, y con un
   índice por tenant el segundo no tiene de dónde derivar llaves. `C-1` y
   `C-2` se escribieron en T32, antes de que ese modelo existiera. El esquema
   de derivación de T32 no se tocó: lo único que cambia es quién recibe un
   índice. Se confirmó leyendo el código que el owner del `policy_rail` es la
   llave del agente, así que "identidad derivada" y "cuenta que puede gastar"
   son la misma cosa.
2. **El índice sale de una secuencia de Postgres, no de `max + 1`** (`C-28`).
   Dos transacciones que leen el máximo antes de que la otra escriba obtienen
   el mismo número, y del otro lado de esa colisión no hay un id duplicado
   sino **dos agentes derivando el mismo par de llaves del seed maestro**. Una
   secuencia deja huecos y no colisiona; un hueco no le cuesta nada a nadie.
3. **La derivación entra como callback** (`C-29`). Con dos llamadas separadas
   —pedir el índice, después guardar el agente— es cuestión de tiempo que
   alguien guarde una fila cuya dirección no corresponde a su propio índice, y
   esa fila mentiría sin que nada lo note hasta que alguien intente firmar con
   ella.

**Un fallo real, y lo que enseñó.** La primera corrida del test de integración
murió después de 18 minutos con `EADDRNOTAVAIL`: agotamiento de puertos
efímeros locales, no del servidor. Ocho creaciones en paralelo, `pg` abriendo
una conexión por consulta hasta su máximo por omisión, y cada conexión nueva
contra el pooler de Supabase pagando un handshake TLS entero. Con el pool
acotado (`C-31`), la misma suite pasa entera en 71 segundos — quince veces más
rápido, además de estable.

Al diagnosticarlo apareció algo que vale más que el arreglo: **el volcado de
error de `pg` contiene la contraseña de la base en texto plano**, dentro de
`connectionParameters`. Se verificó que ni este paquete ni el vault filtran
—los dos registran `error.message`, nunca el objeto— pero queda anotado como
requisito para la superficie de API de F5: ningún log estructurado serializa
un error crudo (`C-32`).

**Evidencia técnica.** 25 tests nuevos sin red (759 en total, de 734) y 16
contra Postgres real, todos en verde; `pnpm typecheck` y `pnpm build`
limpios. Salidas crudas y el diagnóstico completo del fallo en
[evidencia/T38.md](evidencia/T38.md).

Documentación tocada: `README.md` (la tabla de piezas listaba cuatro de siete
paquetes), `CLAUDE.md` (índice), `docs/AGENT_LOG.md`, y en esta carpeta
`BITACORA.md`, `DECISIONES.md` (`C-26` a `C-32`) y `evidencia/T38.md`.
Archivos nuevos: `packages/directory/` completo. Archivos de código tocados
fuera del paquete: `packages/core/src/errors.ts` y `tsconfig.json`.

Pendiente: el siguiente hito propuesto es **F3 = T39** — persistir credencial
y mandato contra el tenant y rehidratar la sesión desde Postgres, para que
volver desde otro navegador encuentre lo ya firmado en vez de emitir de nuevo.
Es el primero que toca `apps/web`, así que conviene revisarlo con más cuidado
que este. Sigue pendiente de antes: cablear `@agentpay/tenancy` (`C-16`, F4) y
el rename a VynGent (`P-9`).

---

## Addendum (sin numerar): plan de delegación Claude Code / Codex por fase — 2026-09-10

No es un hito de código — es una extensión de `PLATAFORMA-PARTNERS.md` (T37),
a pedido del usuario, antes de arrancar T39. Mismo patrón que "Licencia del
repo" más arriba: housekeeping de proceso, no producto.

**Qué se agregó.** Una sección 6.1 con las reglas de coordinación que
aplican a esta fase, y al final de cada una de las diez fases (F1 a F10)
una tabla de delegación con ticket, dueño, dependencias, riesgo, archivos
permitidos y verificación requerida — lo que el usuario pidió para poder
usar a Codex como segunda línea de ejecución sin diluir quién es
responsable de cada pieza.

**El hallazgo real de este addendum, no en la lista original del
usuario.** Al escribir la sección se notó que `AGENTS.md` —lo que Codex lee
al arrancar— y `CLAUDE.md` § "Coordinación con Codex" tenían una lista de
áreas restringidas más corta que la que el usuario acababa de pedir: no
nombraban explícitamente custodia, gestión de claves, firma de wallet,
cuentas pagadoras ni flujo de fondos, ni regulación/estrategia comercial
más allá de la narrativa de SCF. Con `C-20` (un `policy_rail` por tenant)
ya decidido, F4 y F6 van a escribir código que controla dinero de un
tercero — exactamente el tipo de superficie que esa lista debía nombrar y
no nombraba. Se corrigieron los dos archivos y se registró
`docs/DECISIONES.md → P-10`.

Documentación tocada: `PLATAFORMA-PARTNERS.md` (§6.1 y las diez tablas de
delegación), `AGENTS.md`, `CLAUDE.md`, `docs/DECISIONES.md` (`P-10`),
`docs/AGENT_LOG.md`. Cero código.

---

## T39 · Persistencia de sesión: una wallet que vuelve encuentra lo que ya firmó — cerrado 2026-09-10

**Qué quedó funcionando, en palabras llanas.** Hasta ayer, conectar la misma
wallet una segunda vez —incluso en la misma pestaña, con solo recargar—
volvía a pedir una firma, volvía a emitir una credencial nueva y un Mandato
nuevo, y volvía a gastar una transacción de anclaje en testnet. Eso violaba
dos reglas del objetivo del producto: renovar un mandato no debe crear un
agente nuevo, y una sesión no debe crear identidad nueva. Ahora, cuando una
wallet ya tiene un Mandato vigente, "Iniciar sesión" lo encuentra en
Postgres y arma la sesión alrededor de él — sin pedir una firma más, sin
gastar una transacción más.

**La prueba, hecha de la forma más exigente posible.** No alcanzaba con un
test: se conectó una wallet real (la del emisor, ya fondeada), se firmó de
verdad un Mandato, se ancló de verdad en testnet. Después **se mató el
proceso del servidor y se levantó uno nuevo**, sin nada en memoria, y esa
misma wallet, al conectar de nuevo, encontró exactamente el mismo Mandato y
la misma credencial que antes de que el proceso muriera — los hashes
coinciden byte por byte. Con esa sesión reconstruida desde cero se hizo una
compra real, liquidada por `policy_rail`, y se le sumó el anclaje del vault.
Y al revocar el Mandato, la wallet volvió a pedir una firma nueva en vez de
seguir devolviendo el Mandato muerto — con el Mandato nuevo encadenado al
viejo (`supersedesId`), no como una identidad huérfana.

**Dónde queda la seguridad, y por qué esto no la toca.** Lo que decide si un
Mandato es genuinamente válido —no revocado, no expirado, firmado por quien
dice ser— sigue siendo exactamente lo mismo que antes: `checkMandate`,
`checkScope`, y el verificador on-chain, en el momento de la compra. Este
hito solo decide si iniciar sesión se ahorra una emisión redundante; nunca
decide si una compra se autoriza. Verificado con `git diff` contra
`apps/agent/` y `contracts/`: cero cambios.

**Una brecha del esquema, encontrada al construir y no al planificar.**
`@agentpay/directory` (T38) asumía el mundo de F4 —una identidad Stellar por
tenant— pero ese mundo todavía no llegó: todos los visitantes siguen
firmando con el mismo `AGENT_SECRET_KEY` (`C-16`, diferido a F4 a propósito).
Con un solo agente compartido por todos los tenants, la columna que
identificaba a una credencial (`agent_id`) dejó de alcanzar para responder
"¿cuál es la credencial de este tenant en particular?" — se agregó una
columna `tenant_id` a la tabla de credenciales (migración segura: la tabla
existía, vacía, desde los propios tests de T38). El agente compartido en sí
se modela como una fila real y etiquetada como transicional
(`ensureSharedAgentIdentity`), no como una excepción al esquema.

**Evidencia técnica.** `apps/web` pasa de 49 a 63 tests sin red (16
nuevos —ocho sobre la decisión pura de rehidratar, ocho sobre el bootstrap
idempotente del agente compartido y del tenant de cada visitante— menos dos
que quedaron sin sentido al retirar `walletTenantId`). Total del monorepo:
**773 tests offline en verde, de 759.** `@agentpay/directory` suma tres
tests de integración para los métodos nuevos (`findAgentByAddress`,
`findLatestCredential`, `findLatestMandate`), 19 en total ahí, todos en
verde contra Postgres real. `pnpm typecheck` y `pnpm build` limpios. Las
cinco corridas manuales contra testnet real, con transacciones y anclajes
de verdad, están en [evidencia/T39.md](evidencia/T39.md).

Documentación tocada: `docs/AGENT_LOG.md`, y en esta carpeta `BITACORA.md`,
`DECISIONES.md` (`C-33` a `C-38`), `evidencia/T39.md` (nuevo). Archivos de
código nuevos: `apps/web/src/session-rehydration.ts` (+test),
`apps/web/src/shared-identity.ts` (+test). Archivos de código tocados:
`apps/web/src/server.ts`, `apps/web/src/wallet-session.ts` (+test),
`apps/web/package.json`, `apps/web/tsconfig.json`,
`packages/directory/src/{schema-sql,entities,directory}.ts`,
`packages/directory/src/directory.integration.test.ts`. **Cero archivos de
`apps/agent/` o `contracts/` tocados.**

Pendiente: el siguiente hito propuesto es **T40** (F4 del plan) — cablear
`@agentpay/tenancy` para que cada tenant tenga su propia cuenta Stellar en
vez de compartir `AGENT_SECRET_KEY`. Es área restringida (custodia y
claves, `P-10`) y se queda enteramente en Claude Code. La tabla de
delegación de F3 (`PLATAFORMA-PARTNERS.md` § 6.1) señala tres tickets para
Codex que ahora ya se pueden abrir, detrás de la interfaz que este hito
estabilizó — ver la sección de instrucciones en el mensaje de cierre de
este hito. Sigue pendiente de antes: el rename a VynGent (`P-9`).

---

## T40 · Identidad técnica por tenant — cerrado 2026-09-10

**Qué quedó funcionando, en palabras llanas.** Hasta ayer, todos los
visitantes de `apps/web` firmaban su credencial y su Mandato con la misma
llave Stellar (`AGENT_SECRET_KEY`) — indistinguibles entre sí para
cualquiera que mirara la cadena desde afuera. Ahora, cada tenant que
conecta su wallet obtiene su **propia** identidad Stellar, derivada
matemáticamente de un único seed maestro, y firma su propia credencial y
su propio Mandato con ella. Dos tenants distintos ya no comparten quién
dice ser el agente que actúa en su nombre.

**Lo que este hito deliberadamente no resuelve, y por qué está bien así.**
El pago real —quién mueve la plata— sigue saliendo de la cuenta
compartida. Antes de escribir una línea se confirmó, leyendo el código del
motor de compra, que quién firma el Mandato y quién paga son dos cosas
separables sin romper nada — así que se le presentaron al usuario tres
caminos para el problema real (una cuenta recién derivada no tiene USDC, y
cargárselo es un trámite manual en un faucet web, el mismo bloqueante que
ya frenó esto una vez) y se eligió resolver solo la identidad ahora,
dejando la cuenta pagadora propia para F6, sin fondeo automático ni
pantallas de USDC que resultaron innecesarias.

**Un hallazgo real, encontrado contra testnet y no en el diseño.** La
primera corrida de verificación falló: un tenant que ya tenía una
credencial de antes de este hito —firmada por la cuenta compartida—
intentó "rehidratarse" (T39) usando su identidad nueva, y el propio sistema
lo frenó con un error de firma no coincidente. La lógica de T39 comparaba
que la credencial y el Mandato coincidieran entre sí, pero nunca preguntaba
si esa identidad seguía siendo la vigente. Se corrigió agregando esa
pregunta explícitamente, con dos tests nuevos que la cubren.

**Evidencia técnica.** 781 tests offline en verde (8 nuevos, de 773: seis
del bootstrap de la identidad derivada y dos de la migración de
rehidratación — el módulo del pagador compartido se renombró sin agregar
tests nuevos, los ocho que ya tenía siguen cubriendo la misma lógica).
`pnpm typecheck`/`pnpm build` limpios. Contra testnet real: dos wallets
distintas conectadas en la misma corrida terminaron con dos identidades
derivadas distintas (direcciones y `key_index` distintos, ninguna igual a
la cuenta compartida); una compra real de cada una liquidó correctamente,
pagada por la cuenta compartida vía `policy_rail`; y la identidad derivada
de un tenant sobrevivió, sin cambios, a matar y levantar el proceso del
servidor de nuevo — se re-deriva del seed y el índice, nunca se guarda.
Todo en [evidencia/T40.md](evidencia/T40.md).

Documentación tocada: `.env.example`, `render.yaml` (reserva
`MASTER_MNEMONIC`, sin valor), `docs/AGENT_LOG.md`, y en esta carpeta
`BITACORA.md`, `DECISIONES.md` (`C-39` a `C-42`),
`PLATAFORMA-PARTNERS.md` (F4 marcada resuelta, con su alcance real
documentado), `evidencia/T40.md` (nuevo). Archivos de código nuevos:
`apps/web/src/tenant-agent.ts` (+test). Archivos tocados:
`apps/web/src/server.ts`, `apps/web/src/shared-identity.ts` (+test, la
función que antes representaba "el" agente se renombró a lo que
realmente es desde este hito: el pagador compartido),
`apps/web/src/session-rehydration.ts` (+test). **Cero archivos de
`apps/agent/` o `contracts/` tocados.**

Pendiente: el siguiente hito propuesto es **T41** (F5 — API y SDK para
partners), la fase con más superficie delegable del plan. Su tabla en
`PLATAFORMA-PARTNERS.md` § 6.1 ya está lista. Sigue pendiente: el rename a
VynGent (`P-9`), y desplegar este hito a Render (deliberadamente fuera de
alcance — `C-42`).

---

## T45 · Contrato congelado de `/v1` — `@agentpay/partner-api` — cerrado 2026-09-10

**Qué quedó funcionando, en palabras llanas.** Antes de escribirse una sola
ruta de la API para partners, quedó decidido y probado el acuerdo completo
que esa API va a respetar: qué manda y recibe un partner por cada recurso
(tenants, agentes, mandatos de solo lectura, y `consent_sessions` — el
flujo hospedado donde un partner pide abrir un consentimiento y redirige a
su usuario), cómo se identifica una API key, qué puede y no puede pedir
cada permiso, y qué pasa exactamente si un partner repite la misma llamada
dos veces (no se cobra ni se crea nada dos veces). Es la diferencia entre
"la API va a funcionar así" dicho en un documento de diseño y lo mismo
dicho en código que ya falla si alguien lo rompe.

**Por qué esto primero, antes de abrir tickets para Codex.** La tabla de
delegación de F5 (`PLATAFORMA-PARTNERS.md` § 6.1) es explícita: ningún
ticket de Codex (T46 OpenAPI, T47 SDK, T48 webhooks, T50 documentación)
puede empezar contra un contrato que todavía se puede mover. Congelarlo
significa que ninguno de esos cuatro va a tener que rehacerse porque un
campo cambió de nombre a mitad de camino.

**Un hallazgo real, encontrado escribiendo el código, no planificando.**
`@agentpass/core` ya tenía un `Scope` — el scope de gasto de una credencial
o mandato — desde la Fase 2. El primer borrador de este hito iba a llamar
igual al permiso de una API key ("¿puede este key llamar esta ruta?"), lo
que habría dejado dos conceptos completamente distintos con el mismo
nombre, importables desde dos paquetes distintos del mismo proyecto.
Corregido antes de que ningún otro archivo dependiera del nombre viejo:
`ApiScope`, con la razón escrita en el propio código (`C-44`).

**Lo que T45 deliberadamente no construye.** Ninguna ruta HTTP. Ninguna
tabla nueva en Postgres — ni siquiera para `consent_sessions`, que hoy no
existe en ningún lado de `@agentpay/directory`. Y se encontró, escribiendo
esto, que **ningún ticket de la tabla de F5 nombra explícitamente
"conectar este contrato con rutas reales"** — T49 describe el middleware de
autenticación, T50 asume que la API "responde de verdad" para entonces, y
en el medio falta el ticket que arma los handlers. Anotado para el usuario
antes de abrir T49 (`C-47`), no resuelto acá porque no era el alcance de
este hito.

**Verificado:** `git diff --stat d493d63..HEAD -- apps contracts` no
devuelve nada — cero cambios en cualquier punto de autorización existente.
823 tests offline en verde (42 nuevos, de 781), todos puros —sin red, sin
base de datos—, más los que ya existían. `pnpm typecheck` y `pnpm build`
limpios en todo el monorepo.

Documentación tocada: `docs/AGENT_LOG.md`, y en esta carpeta: `BITACORA.md`,
`DECISIONES.md` (`C-43` a `C-47`). Paquete nuevo:
`packages/partner-api/` (`README.md`, esquemas, funciones puras, tests).
Cambios aditivos en paquetes existentes: `packages/core/src/errors.ts`
(siete códigos de error nuevos: `MissingApiKey`, `InvalidApiKey`,
`ScopeNotGranted`, `IdempotencyKeyRequired`, `IdempotencyKeyConflict`,
`MandateNotFound`, `ConsentSessionNotFound`), `packages/directory/src/index.ts`
(exporta los esquemas de id que ya existían en `entities.ts`, para que
`partner-api` no duplique el formato). **Cero archivos de `apps/` o
`contracts/` tocados.**

Pendiente: el siguiente hito, sujeto a revisión del usuario, es abrir T46
(OpenAPI), T47 (SDK) y T48 (webhooks) para Codex en paralelo —los tres
dependen solo de que T45 esté en `main`, no entre sí— y T49 (el middleware
de autenticación) en Claude Code, con la brecha de `C-47` resuelta primero
o nombrada explícitamente como parte de T49. Sigue pendiente de antes: el
rename a VynGent (`P-9`), desplegar T40 a Render, y resolver G10 (alta
automática de emisores) que F5's alcance nombra pero que ningún hito
todavía tocó.

---

## T46, T47, T48 · OpenAPI, SDK y webhooks — cerrados 2026-09-10 (Codex)

Los tres tickets que la tabla de F5 tenía listos para Codex una vez
congelado T45. Diseñados, revisados (diff completo + build/typecheck/test
en worktrees aislados) y mergeados por Claude Code — ninguno tocó un
archivo prohibido por su propio ticket ni ningún punto de autorización.

**T46** ([PR #6](https://github.com/vicentewolde/AgentPay/pull/6)):
`scripts/generate-openapi.ts` genera `docs/api/openapi.yaml` (OpenAPI 3.1)
usando `z.toJSONSchema` nativo de zod v4 — cero librerías nuevas de
conversión. Regenerar el archivo en un worktree limpio produjo el mismo
YAML, byte a byte, que el commiteado.

**T47** ([PR #7](https://github.com/vicentewolde/AgentPay/pull/7)):
`@agentpay/partner-sdk`, cliente delgado sobre `fetch` nativo, valida
toda respuesta con los esquemas de `@agentpay/partner-api`, mapea errores
a `AgentPassError` tipado. Sin `/v1` real todavía, se verificó contra un
servidor `node:http` de prueba en vez del criterio original de la tabla.

**T48** ([PR #8](https://github.com/vicentewolde/AgentPay/pull/8)):
`@agentpay/webhooks`, worker de entrega con backoff exponencial (base 1s,
tope 30s, jitter 0-250ms), corta en 4xx, reintenta en 5xx/red/timeout. La
cola de fallos no guarda el secreto del endpoint (verificado por test,
detalle que Codex agregó sin que se lo pidieran).

Verificado en conjunto: 841 tests offline en verde (10 nuevos entre T47 y
T48, sobre los 831 que ya existían tras T45), `pnpm typecheck`/`pnpm
build` limpios, `git diff --stat` contra `apps` y `contracts` en cero en
las tres fusiones.

Documentación tocada: `docs/AGENT_LOG.md`, `PLATAFORMA-PARTNERS.md` (tabla
de F5, T46-T48 marcados resueltos). Paquetes nuevos:
`packages/partner-sdk/`, `packages/webhooks/`. Archivo nuevo:
`docs/api/openapi.yaml`, `scripts/generate-openapi.ts`.

Pendiente: T49, el trabajo que no se delega — cablear `/v1` de verdad.

---

## T49 · `/v1` cableado de verdad contra `@agentpay/directory` — cerrado 2026-09-10

**Qué quedó funcionando, en palabras llanas.** Hasta este hito, `/v1`
existía solo en el papel: esquemas, un spec, un SDK — pero ninguna llamada
real tocaba una base de datos. Ahora un partner con su propia API key
(`pnpm run partner:create` se la emite) puede de verdad crear un tenant,
leerlo, listar sus agentes y consultar sus mandatos, contra Postgres —y
si dos partners distintos existen, ninguno puede leer los datos del otro,
ni siquiera adivinando el id (responde como si no existiera, no "no es
tuyo"). Repetir la misma creación con la misma `Idempotency-Key` no crea
un segundo tenant; repetirla con el mismo `external_ref` pero una key
distinta tampoco — encuentra el que ya existía.

**Alcance, decidido antes de escribir código (`C-49`).** Investigando
`apps/web` para diseñar esto aparecieron dos brechas sin ticket: no había
ninguna forma de crear un `Partner`/`ApiKey` (resuelto con
`scripts/create-partner.ts`, un script de operador, no una ruta —
`C-52`), y `consent_sessions` (tabla, rutas, página hospedada) es
demasiado grande para el mismo hito que el middleware de auth. Se partió:
este hito resuelve tenants/agentes/mandatos; `consent_sessions` queda
para **T51**, un hito nuevo. `T50` (la guía de Codex) pasa a depender de
ambos.

**Lo nuevo en `@agentpay/directory`, todo aditivo:** tabla
`directory_idempotency` (`C-50`, resuelve lo que `C-46` había dejado
pendiente en T45) y los métodos `findMandateById`/`listMandates` (`C-51`).
Cero cambios a una tabla o método existente.

**La pieza nueva en `apps/web`:** `partner-routes.ts` — un router puro
(nunca toca `req`/`res`) que hace, en orden, para cada ruta: autentica y
chequea el permiso (`authorizeRequest`, de T45), resuelve idempotencia
solo en el POST que la necesita, ejecuta contra `@agentpay/directory` con
aislamiento de tenant explícito, y mapea cualquier error a su código HTTP.
`server.ts` le delega todo `pathname` bajo `/v1/`.

**Una decisión de diseño encontrada construyendo, no planificada
(`C-53`):** un tenant o mandato que existe pero es de otro partner
responde `404`, nunca `403` — mismo criterio que ya separa "key inválida"
de "key revocada" (`C-44`), para no confirmarle a nadie que un id ajeno
existe.

**Verificado contra Postgres y un servidor real, no solo en tests:**
`pnpm run partner:create` dos veces (dos partners), servidor local
levantado, y con `curl` real: crear un tenant, leerlo, listar agentes
(vacío) y mandatos (vacío), repetir la creación con la misma
`Idempotency-Key` (misma respuesta, sin crear dos veces), con la misma
key pero body distinto (`409`), con `external_ref` repetido y key nueva
(`200` con el existente), un segundo partner leyendo el tenant del
primero (`404`), y la key del primero revocada perdiendo acceso de
inmediato (`401`). Los datos de prueba se limpiaron de la base real al
terminar.

Verificado offline: 28 tests nuevos (6 de integración de
`@agentpay/directory` contra Postgres real, 22 de `partner-routes.ts` con
un directorio falso, más los que ya existían). `pnpm typecheck`, `pnpm
build` y `pnpm test` limpios en todo el monorepo. `git diff --stat`
contra `apps/agent` y `contracts` en cero — cero cambios a
`checkMandate`, `policy_rail`, `agent_registry` o el flujo de pago.

Documentación tocada: `docs/AGENT_LOG.md`, y en esta carpeta:
`BITACORA.md`, `DECISIONES.md` (`C-49` a `C-54`),
`PLATAFORMA-PARTNERS.md` (F5, T49 marcado resuelto, T51 agregado).
Archivos nuevos: `apps/web/src/partner-routes.ts` (+test),
`scripts/create-partner.ts`. Archivos tocados (aditivo):
`packages/directory/src/{directory,entities,schema-sql,index}.ts` (+test
de integración), `apps/web/src/server.ts`, `apps/web/package.json`,
`apps/web/tsconfig.json`, `package.json` (root), `tsconfig.scripts.json`.

Pendiente: **T51** (`consent_sessions` — tabla, rutas, página hospedada
reutilizando el flujo de firma de wallet), sin empezar, esperando
revisión de este hito primero. Sigue pendiente de antes: el rename a
VynGent (`P-9`), desplegar T40/T49 a Render, y G10 (alta automática de
emisores).

---

## T51 · `consent_sessions` — el flujo hospedado de consentimiento — cerrado 2026-09-11

**Qué quedó funcionando, en palabras llanas.** Ya se puede recorrer la
cadena completa que F5 prometía: CloudOps crea un tenant, le propone un
grant de gasto —incluyendo a quién se le puede pagar (`payTo`), algo que
el proyecto soporta desde la Fase 3 pero que ningún flujo real usaba
todavía—, y le manda a Vinny un link. Vinny conecta su wallet en ese
link, ve exactamente lo que se le está pidiendo autorizar, y lo firma.
Del otro lado, CloudOps consulta el mandato resultante y confirma que
tiene el `payTo` que pidió, byte a byte. Todo esto ya funciona contra
Postgres y testnet reales — falta solo la página que Vinny efectivamente
ve en el navegador (**T52**, aparte, delegable).

**Por qué se partió en dos hitos.** Al diseñar esto (con `EnterPlanMode`,
dado el riesgo) aparecieron dos piezas: el backend completo
(tabla, rutas, la extensión al invariante `C-17` para que un Mandato
pueda llevar `payTo`) y la página HTML que un humano ve. La página no
decide nada — solo llama a endpoints que este hito deja ya estables — así
que separarla no perdía nada y evitaba un PR mucho más grande
(`C-49`, de T49, ya había anotado esta división).

**Lo nuevo en `@agentpay/directory`:** tabla `directory_consent_sessions`
y tres métodos (`createConsentSession`, `findConsentSession`,
`completeConsentSession`). Un detalle que solo apareció escribiendo el
SQL, no en el diseño: la columna no se puede llamar `grant` a secas
—es palabra reservada de SQL— así que quedó `proposed_grant` en la base,
`grant` en TypeScript (`C-55`).

**Lo nuevo en `@agentpay/partner-api`:** `computeConsentSessionStatus`/
`toConsentSessionResource`, exactamente lo que T45 había dejado
pendiente "para quien construya la ruta".

**El cambio más delicado: `session-documents.ts`.** Es el archivo que
protege el invariante más importante de la Fase 3 (`C-17`: la credencial
y el Mandato nunca pueden nombrar principals distintos). Ganó un `grant`
opcional que, si no se pasa, se comporta exactamente igual que antes —el
único call site que ya existía no cambió una línea, y los seis tests que
fijan el invariante tampoco. Cuando `consent_sessions` sí lo pasa, el
Mandato puede llevar `payTo` (algo que `@agentpay/mandate` soporta desde
`M-14` pero que nunca se había usado) mientras la credencial sigue
recibiendo solo el `Scope` plano, que nunca pudo expresarlo (`C-56`).

**Las rutas nuevas.** Dos en `/v1` (partner-facing, mismo patrón que T49):
`POST`/`GET /v1/consent_sessions`. Cinco públicas, sin API key, en
`apps/web` — el id de la invitación (un ULID de 128 bits) es la
capacidad que autoriza, el mismo modelo de confianza que un link de
DocuSign (`C-57`): `GET /api/consent/{id}` (lectura pública del grant),
`wallet-verify`, `start`, `wallet-consent`, `wallet-anchor` — estas
últimas cuatro repiten paso a paso el flujo de firma de wallet que T35
ya construyó, pero nunca llaman `finishSession`: un `consent_session` no
compra nada, solo emite y ancla documentos.

**Verificado contra Postgres y testnet reales, de punta a punta, sin
navegador.** Un script descartable (nunca commiteado, misma técnica que
T39/T40) hizo de wallet real —generó un `Keypair`, lo fondeó por
Friendbot, firmó los mensajes SEP-0053 y la transacción de anclaje
exactamente como lo haría Freighter— y recorrió las diez llamadas de la
cadena completa: crear tenant → crear consent_session con un `payTo` →
leer el grant públicamente → conectar wallet → iniciar → firmar el
mensaje del mandato → firmar la transacción de anclaje → confirmar en
`/v1/consent_sessions/{id}` que quedó `completed` con el `mandate_id`
correcto → confirmar en `/v1/mandates/{id}` que el Mandato quedó
`active` → y una lectura directa a Postgres confirmando que el `payTo`
propuesto llegó exactamente igual hasta el documento anclado. Los datos
de prueba se limpiaron de la base real al terminar.

Verificado offline: 19 tests nuevos (6 de
`computeConsentSessionStatus`/`toConsentSessionResource` en
`@agentpay/partner-api`, 4 de `session-documents.ts` con `grant`
explícito, 9 de las dos rutas nuevas de `partner-routes.ts` con un
directorio falso), **882 en total**. Más 5 tests de integración nuevos de
`@agentpay/directory` contra Postgres real (30 en total en esa suite,
aparte de los 882 — corre con `test:integration`, no con `pnpm test`).
`pnpm typecheck`, `pnpm build` y `pnpm test` limpios en todo el
monorepo. `git diff --stat` contra `apps/agent` y `contracts` en cero —
cero cambios a `checkMandate`, `policy_rail`, `agent_registry` o el
flujo de compra.

Documentación tocada: `docs/AGENT_LOG.md`, y en esta carpeta:
`BITACORA.md`, `DECISIONES.md` (`C-55` a `C-59`),
`PLATAFORMA-PARTNERS.md` (F5, T51 agregado a la tabla, T50 re-vinculado).
Archivos nuevos: `apps/web/src/partner-routes.ts` ya existía, se
extendió; nada nuevo del lado de archivos (solo ediciones aditivas a lo
que T49 dejó). `.env.example` documenta `PUBLIC_BASE_URL` (opcional, con
un fallback derivado del propio `Host` de la petición).

Pendiente: **T52** (la página `consent.html`, HTML/JS puro consumiendo
estos endpoints — delegable a Codex una vez que el usuario dé el visto
bueno de este hito). Sigue pendiente de antes: el rename a VynGent
(`P-9`), desplegar T40/T49/T51 a Render, y G10 (alta automática de
emisores).

---

## T52 · `consent.html` — la página que un humano ve — cerrado 2026-09-11

**Qué quedó funcionando, en palabras llanas.** Vinny ya no depende de un
`curl` para firmar: abre el link (`/consent/{id}`) que CloudOps le
manda, ve cada permiso propuesto —acciones, comercios, activos, límites
por transacción y por día, y a quién se le puede pagar si el partner lo
propuso— conecta Freighter, y firma. Si el link ya se usó, venció, o se
canceló, la página lo dice con un mensaje claro en vez de mostrar el
botón de firmar sobre una invitación muerta.

**Quién lo hizo y qué se revisó.** Codex, en su propio worktree,
delegado según el protocolo de `CLAUDE.md` § "Coordinación con Codex"
(PR [#13](https://github.com/vicentewolde/AgentPay/pull/13)). Antes de
mergear: diff completo (solo `apps/web/public/consent.html`, nuevo, y su
propia entrada de `docs/AGENT_LOG.md` — ningún `.ts` de `apps/web/src`
tocado, la única superficie prohibida para este hito), `pnpm build`/
`pnpm typecheck`/`pnpm test` corridos en un worktree aislado (882 tests,
todos en verde), y una verificación real contra Postgres y testnet:
un partner de prueba (`pnpm run partner:create`), un tenant y tres
`consent_sessions` reales creados vía `/v1`, la página cargada en un
navegador real mostrando el grant completo con `payTo`, los estados
`expired` (forzado editando `expires_at` en Postgres) y `completed`
verificados mostrando su mensaje y ocultando el botón de firmar, un id
inexistente mostrando "no existe esa invitación" en vez de pantalla en
blanco, y el flujo de firma de punta a punta contra los endpoints reales
—un script descartable haciendo de Freighter, misma técnica que T39/
T51— hasta un Mandato anclado de verdad en testnet. Todos los datos de
prueba (partner, tenant, consent_sessions, mandato, credencial,
principal) se borraron de Postgres al terminar.

**Qué no se pudo probar tal cual pedía el hito.** El criterio pedía
probar "con Freighter" en un navegador real; el navegador de este
entorno no puede instalar la extensión, así que la firma se verificó
contra los mismos endpoints con un script que firma exactamente igual
que Freighter (SEP-0053 + firma de la transacción de anclaje), no
clickeando la extensión de verdad. El HTML/JS que llama a esos
endpoints sí se verificó en el navegador real (carga, render del grant,
los tres estados terminales, y los errores).

Documentación tocada: `docs/AGENT_LOG.md`, y en esta carpeta:
`BITACORA.md`, `PLATAFORMA-PARTNERS.md` (F5, T52 marcado resuelto). Sin
decisión nueva en `DECISIONES.md` — T52 no tomó ninguna decisión de
diseño, solo construyó la página tal como T51 la dejó especificada.

Pendiente: el rename a VynGent (`P-9`), desplegar T40/T49/T51/T52 a
Render, y G10 (alta automática de emisores). **T50** (la guía de
integración de un partner) ya no depende de nada nuevo — T45, T49 y T51
alcanzan.

---

## T50 · guía de integración de partner — cerrado 2026-09-11

**Qué quedó funcionando, en palabras llanas.** F5 prometía que CloudOps
pudiera integrarse leyendo documentación, sin hablar con nosotros. Ahora
existe esa guía (`examples/cloudops-partner-integration.md`): comandos
`curl` exactos —no descripciones— para pedir una API key, crear un
tenant, abrir un consentimiento con `payTo`, entregarle el link al
principal, y consultar tanto el consentimiento como el Mandato
resultante. Cubre también qué hacer ante cada error documentado y cómo
reintentar sin duplicar nada (`Idempotency-Key`).

**Quién lo hizo y qué se revisó.** Codex, en su propio worktree, tarea
delegada con el nombre ya decidido (AgentPey, `P-11`) y el criterio de
`PLATAFORMA-PARTNERS.md` § F5 (PR
[#15](https://github.com/vicentewolde/AgentPay/pull/15)). Diff acotado
exactamente a lo permitido: `examples/cloudops-partner-integration.md`,
`docs/fase-6-agentguard-comercializacion/evidencia/T50.md` y su propia
entrada de `AGENT_LOG.md` — nada bajo `apps/`, `packages/` ni
`contracts/`. `pnpm build`/`typecheck`/`test` limpios en un worktree
aislado (882 tests). Esta revisión no se conformó con leer la guía:
copió sus comandos literalmente contra un servidor real (`pnpm run web`
+ Postgres real) — un tenant creado con la misma forma exacta que la
guía documenta, la lista de agentes vacía antes de firmar, un
`consent_session` con `payTo` devolviendo `pending`/`mandate_id: null`
tal cual se describe, y el conflicto de idempotencia (`409`,
`IdempotencyKeyConflict`) reproducido byte a byte contra la tabla de
errores de la guía. Codex ya había verificado, en su propia evidencia,
el tramo de firma real (mandato anclado en testnet,
`mdt_01M28BP9HY51F6N1GW1Q0AGA4A`) — no se repitió esa parte, ya probada
dos veces esta fase (T51, T52) con la misma técnica. Todos los datos de
prueba (partner, api key, tenants, consent_session) se borraron de
Postgres al terminar.

Documentación tocada: `docs/AGENT_LOG.md`, y en esta carpeta:
`BITACORA.md`, `PLATAFORMA-PARTNERS.md` (F5, T50 marcado resuelto — el
"listo cuando" de la fase completa se cumple). Sin decisión nueva en
`DECISIONES.md` — T50 no tomó ninguna decisión de diseño.

Pendiente: **F5 (API y SDK para partners) queda completa.** Sigue
pendiente de antes: el rename real a AgentPey (`P-11`, sesión propia),
desplegar T40/T49/T51/T52 a Render, y G10 (alta automática de
emisores).

---

## T53 · registro de venues/assets y adaptador x402 genérico — cerrado 2026-09-11

**Qué quedó funcionando, en palabras llanas.** F7 pedía que agregar un
comercio nuevo no tocara ningún archivo de código. Antes, el bazaar del
embajador tenía su lógica de conexión y su lista de monedas aceptadas
escritas directamente en un archivo (`bazaar.ts`) — sumar un segundo
comercio habría significado copiar ese archivo entero y adaptarlo a
mano. Ahora esa información —qué comercio es, dónde está, qué monedas
acepta y con qué emisor— vive en una sola tabla de datos
(`venues.json`), y el código que sabe hablar con cualquier comercio de
ese tipo (protocolo x402) es uno solo, reutilizable. Agregar el próximo
comercio es agregar una fila a esa tabla, no escribir un archivo nuevo.

**La regla de seguridad no se aflojó, se generalizó.** Si un comercio
cotiza en una moneda que su fila no menciona, la compra se rechaza —
igual que antes, cuando esa regla vivía hardcodeada solo para el bazaar
del embajador. Ahora protege a cualquier comercio que se agregue,
automáticamente, sin que quien agregue la fila tenga que acordarse de
escribir esa protección de nuevo.

**Quién lo hizo.** Claude Code — es la mitad de F7 que decide qué se
puede pagar, de la misma familia de riesgo que `checkScope`/
`checkMandate`, así que quedó fuera del perímetro delegable a Codex
(`P-10`). Archivos nuevos: `apps/agent/src/catalog/registry.ts` (el
validador e indexador de la tabla, con su propio código de error
tipado, `InvalidVenueRegistry`, nuevo en `packages/core/src/errors.ts`),
`venues.json` (la tabla real, hoy con una sola fila: el bazaar del
embajador), `default-registry.ts` (la carga la tabla real al arrancar),
y `x402-catalog.ts` (el adaptador HTTP genérico, extraído de la lógica
que `bazaar.ts` tenía hardcodeada). `bazaar.ts` quedó como una capa
delgada de compatibilidad — sus constantes y funciones exportadas
siguen llamándose igual, así que `scripts/demo.ts`, `payment/x402.ts` y
`apps/web/src/server.ts` no tuvieron que cambiar una línea.

**Un detalle técnico que costó dos vueltas: cómo cargar `venues.json`
sin romper el paquete compilado.** `apps/agent` se usa como una
dependencia compilada (`dist/`) desde `scripts/` y desde
`apps/web/src/server.ts`, no solo con `tsx` en desarrollo. Leer el JSON
a mano con `node:fs` (la técnica que `scripts/demo.ts` ya usa en otro
contexto) se habría roto ahí, porque nada en este repo copia archivos
sueltos a `dist/`. La solución fue activar `resolveJsonModule` en
`apps/agent/tsconfig.json` e importar `venues.json` como si fuera
código — así el propio compilador se encarga de llevarlo a `dist/` como
parte del build normal. Verificado importando el `dist/` compilado
directo, no solo corriendo los tests con `tsx`.

Verificado: 13 tests nuevos de `registry.ts` (carga válida, fila
duplicada, moneda duplicada dentro del mismo comercio, fallo cerrado
ante un comercio o moneda desconocidos). `bazaar.test.ts` sin cambiar
una línea, sus 16 tests siguen en verde — cero regresión de
comportamiento. 895 tests en total (882 + 13), `pnpm typecheck` y
`pnpm build` limpios en todo el monorepo.

Documentación tocada: `docs/fase-6-agentguard-comercializacion/`
(`BITACORA.md`, `PLATAFORMA-PARTNERS.md` — F7, T53 cerrado, y se
renumeraron T51–T54 del borrador original a T54–T56 para no chocar con
los números que F5 ya usó de verdad) y `DECISIONES.md` (`C-60`).

Pendiente: **T54** (comercio de referencia, delegable a Codex), **T55**
(script de alta de comercio, delegable a Codex) y **T56** (tests del
adaptador genérico sobre un segundo venue, delegable a Codex) quedan
listos para delegar — la tarea de esta sesión sigue con la preparación
de esos tres prompts. Sigue pendiente de antes: el rename real a
AgentPey (`P-11`), desplegar a Render, G10, y F6 (bloqueada por `G9`,
sin fecha).

---

## T57 · `withdraw` y `set_owner` en `policy_rail` — cerrado 2026-09-11

**Qué quedó funcionando, en palabras llanas.** Hasta hoy, el contrato que
guarda la plata de un pago tenía una sola llave con poder sobre ella: la
del agente. Eso alcanza mientras el dinero es nuestro, pero rompe apenas
un cliente pone el suyo — la única forma de sacar plata del contrato era
un pago firmado por una llave que no es del cliente, así que si nosotros
no colaborábamos, no la recuperaba nunca. Ese era `G9`, el problema que
mantenía bloqueada toda la fase de "cada cliente paga desde su propia
cuenta".

Ahora el contrato distingue **dos** figuras, y ninguna puede hacer el
trabajo de la otra:

- **La llave del agente** (lo que antes era la única) sigue autorizando
  las compras del día a día, dentro de sus límites por transacción y por
  día. No cambió nada de eso.
- **La wallet del cliente** —nueva, se fija al desplegar el contrato y no
  se puede cambiar después— puede hacer dos cosas que el agente no puede:
  **sacar el saldo** cuando quiera, y **cambiar cuál es la llave que
  gasta**, por ejemplo si esa llave se filtró o el cliente ya no quiere
  que ese agente gaste.

Dos detalles pensados a propósito, no olvidados:

1. **Sacar la plata no pasa por los límites de gasto.** Los límites acotan
   lo que la llave delegada puede gastar; recuperar tu propio dinero no es
   gastar. Probado en la red real retirando quince veces el límite por
   transacción del contrato.
2. **Sacar la plata funciona aunque el mandato haya vencido.** Un contrato
   vencido es justamente el que más necesita una salida. Bloquearlo ahí
   sería el mismo problema de `G9`, solo que con fecha en vez de para
   siempre.

**Lo que este hito no hizo, a propósito.** No redesplegó el contrato
compartido que el piloto usa hoy — ese sigue con la versión vieja hasta
que se decida migrarlo, que es una decisión aparte. Y no construyó el
cableado para desplegar un contrato por cliente: eso es infraestructura
de `apps/web`, y ahora tiene sobre qué apoyarse con seguridad.

**Evidencia técnica.** El detalle está en
[`evidencia/T57.md`](evidencia/T57.md); el resumen:

- `Config` gana `principal: Address`, fijado en el constructor.
  `withdraw(to, amount)` y `set_owner(new_owner)` exigen
  `principal.require_auth()` — el mecanismo nativo de Soroban, no el
  esquema custom de `owner`. **`__check_auth` no se tocó**, y los 21 tests
  que lo cubren siguen en verde sin cambiar una aserción.
- `withdraw` rechaza `amount <= 0` con `InvalidWithdrawAmount` (`#9`,
  nuevo). El `transfer` que hace no reentra a `__check_auth`: Soroban
  autoriza implícitamente un `from` igual al propio contrato cuando el
  contrato es quien inicia la llamada.
- 11 tests nuevos, 21 → 32 en `policy_rail`. Cuatro mutaciones dirigidas
  (quitar cada `require_auth`, invertir el chequeo de monto, omitir la
  reescritura del `Config`) matan al menos un test cada una.
- `pnpm typecheck`/`build` limpios, 897 tests en el monorepo (+2:
  `deployment.test.ts`, que verifica que un rail registrado antes de que
  existiera `principal` se siga leyendo).
- **Medición en testnet real** con un rail nuevo fondeado con 0.05 USDC:
  el retiro y la rotación firmados por el principal funcionan (13 295 y
  6 696 stroops de fee), y un firmante que no es el principal es
  rechazado **por la red** —no por el cliente— incluso forzando la
  transacción hasta el ledger con la entrada de autorización firmada con
  su propia llave: `require_auth` la hace trampear, con `signer does not
  belong to account` en los eventos de diagnóstico. El principal recuperó
  después los 0.05 USDC completos.

**Decisión nueva:** `C-61`. `G9` queda marcado resuelto en
`PLATAFORMA-PARTNERS.md`, y F6 pasa de "sin tickets" a tener el primero.

**Pendiente que este hito deja abierto.** Migrar (o no) el rail compartido
del piloto al constructor nuevo, y el cableado de un rail por tenant en
`apps/web` — el resto de F6.

---

## T55, T56 · script de alta de comercio y tests del adaptador genérico — cerrados 2026-09-11 (Codex, PR #16)

**Qué quedó funcionando, en palabras llanas.** T53 dejó la tabla de
comercios (`venues.json`) y el código que la lee, pero agregar una fila
ahí a mano seguía siendo trabajo manual, sin ninguna garantía de que la
tabla resultante siguiera siendo válida. Ahora hay un comando,
`scripts/register-venue.ts`, que agrega un comercio nuevo validando todo
antes de escribir: si el nombre ya existe, o si algo en la tabla completa
queda mal formado, el archivo no se toca ni un byte. Y el adaptador
genérico que lee esa tabla —el que reemplazó el código específico del
bazaar del embajador— tiene ahora una prueba real de que funciona con
*cualquier* comercio registrado, no solo con el único que existía hasta
hoy: nueve casos nuevos contra un segundo comercio inventado para el
test.

**Verificado por Claude Code antes de mergear** (PR #16), en un worktree
aislado: diff completo (362 líneas, tres archivos, ninguno toca
`contracts/`, `checkMandate` ni `scope.limits`/`perDay`), `pnpm
typecheck`/`build`/`test` en verde de forma independiente (443 tests en
`apps/agent`), y el script de alta ejecutado a mano contra una copia de
`venues.json`: alta exitosa, slug duplicado y asset malformado rechazados
sin escribir el archivo (confirmado por hash), flag desconocido
rechazado con `InvalidArguments`. Mergeado con merge commit (T57 se
había mergeado en paralelo), rama remota borrada.

Pendiente: T54, la otra pieza de F7 — un segundo comercio x402
*independiente*, no solo una fila fabricada en un test.

---

## T54 · comercio de referencia x402 independiente — cerrado 2026-09-11 (Codex, PR #17), F7 completa

**Qué quedó funcionando, en palabras llanas.** Hasta hoy, el único
comercio x402 real que el agente sabía comprarle era el bazaar del
embajador. Eso significaba que "el adaptador es genérico" era, en el
fondo, una afirmación probada contra un solo caso real. Ahora existe un
segundo comercio, completamente aparte del código del agente
(`examples/reference-merchant/**`, un servidor propio con sus propias
dependencias, ni una línea compartida con `apps/agent`), que habla el
mismo protocolo: publica su catálogo, cobra un `402` de verdad, y solo
entrega lo pagado después de verificar y liquidar el pago en Stellar
testnet real. Con esto, F7 queda completa: agregar un comercio al agente
—este o cualquier otro— es una fila en `venues.json`, nunca código.

**Verificado por Claude Code antes de mergear** (PR #17), sin quedarme
con lo que dice la descripción del PR:

- Levanté el servidor yo mismo en un worktree aislado y le pegué
  directamente: `GET /api/discovery/search` devuelve la forma exacta que
  el adaptador genérico espera, y la ruta pagada devuelve un `402` real
  con un `PaymentRequirements` bien formado (`scheme: "exact"`, la red de
  Stellar testnet, un contrato SAC real de USDC, `payTo`) — coincide
  campo por campo con lo que ya espera `apps/agent/src/payment/x402.ts`
  del lado cliente.
- Probé los caminos de rechazo a mano: una cuenta mal formada, un header
  `payment-signature` con basura — ambos responden con el código y el
  cuerpo esperados, nada se cae con un error genérico.
- El PR cita un hash de transacción de testnet como prueba de que la
  liquidación fue real. **Lo verifiqué yo mismo contra Horizon**, no di
  por buena la cita: la transacción existe, es exitosa, en el ledger que
  el PR dice, y sus efectos muestran exactamente `0.0025000 USDC`
  moviéndose de la cuenta pagadora a la cuenta del comercio — el mismo
  monto que el servidor cobra.
- Confirmé que el paquete vive fuera del workspace de pnpm (tiene su
  propio lockfile, `pnpm install --ignore-workspace`), así que no puede
  arrastrar una dependencia nueva al resto del repo.
- `pnpm typecheck`/`build`/`test` del monorepo en verde de forma
  independiente; ningún archivo fuera de `examples/reference-merchant/**`
  y `docs/AGENT_LOG.md` tocado, confirmado por el diff.

Mergeado por fast-forward (el commit anterior en `main` era ancestro
directo), rama remota borrada.

**Decisión nueva:** ninguna — T54 no necesitó ninguna que no estuviera
ya en `C-60`. **F7 (comercio x402 genérico) queda completa** — ver
`PLATAFORMA-PARTNERS.md` § F7, tabla de tickets actualizada.

Pendiente: el resto de F6 (rail por tenant en `apps/web`), el rename
real a AgentPey (`P-11`), desplegar T40/T49/T51/T52 a Render, y G10
(alta automática de emisores).

---

## T58 · rail `policy_rail` por tenant — cerrado 2026-09-11

**Qué quedó funcionando, en palabras llanas.** Hasta hoy, todos los
tenants pagaban desde una única cuenta y un único `policy_rail`
compartidos — `G9` (T57) ya había hecho seguro que un rail tuviera dueño
real, pero nada lo usaba todavía. Ahora, cuando un tenant que conectó una
wallet real llega a pagar por primera vez, el sistema le despliega **su
propio** `policy_rail` ahí mismo — no antes, no de oficio — con la llave
que ya firma su Mandato como quien autoriza el gasto día a día, y su
propia wallet como quien puede retirar todo o cambiar esa llave cuando
quiera. Las compras siguientes de ese mismo tenant reusan el mismo rail;
nunca se crea uno nuevo por sesión. El camino clásico, el que no pide
conectar wallet, sigue exactamente igual que siempre — no tiene una
identidad real detrás de la que colgar un rail propio, y no la necesita
para lo que demuestra.

**Un problema de diseño real, resuelto antes de escribir código.**
`scripts/deploy-policy-rail.ts` (el que despliega el rail compartido)
funciona invocando el binario `stellar` de línea de comandos — perfecto
para un humano corriéndolo una vez, inválido para el servidor en
producción, que no tiene ese binario instalado y no debería necesitarlo.
La solución no fue instalarlo: `@stellar/stellar-sdk` (ya usado en este
mismo repo para pagar desde un rail) sabe crear una instancia nueva de un
contrato **a partir de un wasm ya subido a la red**, sin CLI de por
medio — el mismo wasm que el rail compartido ya usa, subido una sola vez,
instanciado tantas veces como tenants paguen.

**Un ajuste de alcance frente al plan original, y por qué.** El plan
inicial hablaba de retirar `POLICY_RAIL_CONTRACT_ID` del todo. Al leer
`server.ts` de cerca apareció algo que no estaba anticipado: el camino
sin wallet ("clásico") también puede pedir pagar vía rail, pero no tiene
ninguna wallet real detrás — su "principal" es la propia plataforma
firmando por sí misma, una ficción de demo, no un cliente real. Desplegar
un contrato por cada visita sin wallet no tendría a quién pertenecerle.
Se mantuvo entonces `POLICY_RAIL_CONTRACT_ID` como lo que siempre fue —el
rail compartido— pero acotado a ese único camino; todo tenant con wallet
real usa el suyo propio desde este hito.

**Verificado en testnet real, no solo con tests.** Dos wallets frescas
conectaron, firmaron su propio Mandato de verdad, y compraron — cada una
desde un contrato `policy_rail` distinto, confirmado por dirección de
contrato y por el hash de cada pago liquidado. Un tercer tenant compró
diez veces seguidas hasta tocar su `per_day` (0.01 USDC, a 0.001 por
compra) y la compra número once fue rechazada por el contrato mismo
(`__check_auth`, `Error(Contract, #8)`) — la app nunca llegó a construir
una transacción para firmar, porque la red la rechazó antes.

**Evidencia técnica.** Detalle completo en
[`evidencia/T58.md`](evidencia/T58.md); el resumen:

- `packages/directory`: esquema versión 4 → 5, `directory_agents` gana
  `policy_rail_contract_id` (nullable). `setAgentPolicyRail` escribe una
  sola vez — una segunda llamada (dos pagos concurrentes desplegando a la
  vez) no pisa al que ganó la carrera, devuelve su fila. 33 tests de
  integración contra Postgres real, 3 nuevos.
- `apps/web/src/tenant-rail.ts` (nuevo): `ensureTenantPolicyRail` —
  despliegue perezoso vía `contract.Client.deploy` del SDK (sin CLI),
  fondeo inicial de XLM (Friendbot) y USDC (desde la misma reserva que
  hoy fondea el rail compartido), persistencia idempotente.
- `apps/web/src/server.ts`: `buy()` resuelve el pagador según el camino —
  rail propio para una sesión con wallet, rail compartido sin cambios
  para la clásica. Ningún llamado nuevo en el camino que no usa rail.
- `pnpm typecheck`/`build` limpios; 907 tests en el monorepo (+1).
- Medición real en testnet: dos rails distintos, dos pagos liquidados con
  hash verificable en Stellar Expert, y un rechazo por `per_day` que pasa
  por la red.

**Lo que este hito no hizo, a propósito.** No migró el rail compartido
del piloto al constructor nuevo de T57 — sigue con el viejo, y ahora solo
lo usa el camino clásico. No agregó monitoreo de saldo (ticket propio,
**T60** — el número original en este párrafo era `T59`, reasignado ese
mismo día a otra cosa; ver la nota de numeración en
`PLATAFORMA-PARTNERS.md` § F9). No hizo configurables `per_tx`/`per_day`
por tenant o partner — usa los mismos valores que el rail compartido
siempre tuvo.

**Decisión nueva:** ninguna en `DECISIONES.md` — el diseño (quién es
`owner`, quién es `principal`, cuándo se despliega) ya estaba resuelto
por `C-20`, `C-21` y `C-61`; este hito lo cablea, no lo redecide.

Pendiente: monitoreo de saldo (T60), migrar o no el rail compartido al
constructor nuevo, el rename real a AgentPey (`P-11`), desplegar
T40/T49/T51/T52 a Render, y G10 (alta automática de emisores).

---

## T60 · monitoreo de saldo de rails por tenant — cerrado 2026-09-11

**Qué quedó funcionando, en palabras llanas.** T58 le dio a cada tenant
su propia caja fuerte, pero nadie podía ver de afuera cuánta plata tenía
cada una sin entrar a mano a la blockchain. Ahora hay un comando
(`pnpm run check:rail-balances`) que lista, de una sola corrida, el saldo
real de cada rail que existe — y avisa si alguno está por quedarse sin
fondos, antes de que eso rompa una compra real. Con esto, F6 completa sus
tres entregables: desplegar, fondear y poder vigilar.

**Un cuidado real, no un detalle menor.** El primer borrador también
mostraba el saldo "XLM" de cada rail — siempre daba cero, porque nada en
este sistema le transfiere XLM al contrato por ese camino (`ensureTenantPolicyRail`
fondea la cuenta del **owner** para pagar el fee de desplegar, no el
contrato en sí). Mostrar ese cero habría sido una alarma falsa
permanente, así que se sacó antes de cerrar el hito — el número que
importa de verdad (si la entrada del contrato se queda sin espacio en la
red) es otra cosa completamente distinta, y sigue sin monitorearse.
Queda anotado en el propio script para quien lo retome.

**Evidencia técnica.** Detalle completo en
[`evidencia/T60.md`](evidencia/T60.md); el resumen:

- `Directory.listAgentsWithPolicyRail()` (nuevo): la primera lectura de
  `@agentpay/directory` que cruza tenants y partners a propósito — todo
  lo demás de este paquete está scoped a uno solo. 34 tests de
  integración contra Postgres real (+1).
- `scripts/check-rail-balances.ts` (nuevo, `pnpm run check:rail-balances`):
  script de operador, mismo criterio que `create-partner.ts` — nunca
  escribe nada, cada llamada a Stellar es un `balance()` simulado.
  Corrida real contra los tres rails que T58 dejó en testnet: el saldo de
  cada uno coincide exacto con lo esperado (`0.05 − 10 × 0.001 =
  0.0400000` para el que tocó su `per_day`).
- `pnpm typecheck`/`build` limpios; 907 tests unitarios sin cambios (el
  método nuevo es una query de una línea, cubierta por integración real).

**Decisión nueva:** ninguna — este hito implementa un entregable ya
decidido en `PLATAFORMA-PARTNERS.md` § F6, no abre una decisión nueva.

Pendiente: migrar o no el rail compartido al constructor de T57, el
rename real a AgentPey (`P-11`), desplegar T40/T49/T51/T52 a Render, y
G10 (alta automática de emisores). Sin tarea nueva delegada a Codex desde
acá — reservado a Claude Code por `P-10` (lee cuentas pagadoras).
