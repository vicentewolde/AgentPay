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
