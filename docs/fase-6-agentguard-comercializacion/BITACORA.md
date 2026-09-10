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

**Fecha:** 2026-09-09 · **Último hito cerrado:** T34 · **Fase 6: en curso**

Un visitante ya puede conectar una wallet Stellar real (Freighter) y
probar criptográficamente que la controla, sin que su llave secreta salga
nunca de la wallet (T34) — la primera interacción Web3 genuina del
proyecto de cara al usuario, más allá de las transacciones que el agente
ya hacía en su nombre. Esa wallet le da a cada visitante un `tenant_id`
estable en el vault de Postgres (T33), así que su historial persiste entre
visitas, no solo entre reinicios del servidor. Lo que todavía falta,
anotado a propósito y no construido: que la wallet conectada firme de
verdad el Mandato (necesita extender la verificación de la Fase 3, `C-8`),
y que cada tenant tenga su propia cuenta Stellar fondeada en vez de
compartir `AGENT_SECRET_KEY` (bloqueado por el faucet manual de USDC de
Circle, `C-11`).

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T32 | `@agentpay/tenancy`: deriva un par de llaves Stellar (agente + issuer) por tenant desde un único seed maestro, vía SEP-0005/BIP-44 | ✅ cerrado 2026-09-09 |
| T33 | `MandateVault` sobre Postgres, reemplaza el JSONL en disco efímero de Render; cableado en `apps/web` | ✅ cerrado 2026-09-09 |
| T34 | Conectar wallet (Freighter) con verificación criptográfica real (SEP-0053); da a cada wallet un `tenant_id` estable en el vault | ✅ cerrado 2026-09-09 |

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

