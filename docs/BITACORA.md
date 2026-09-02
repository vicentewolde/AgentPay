# Bitácora

> Qué se hizo, qué falta, y qué significa cada cosa en lenguaje llano.
> Contexto: [CONTEXTO.md](CONTEXTO.md) · Decisiones: [DECISIONES.md](DECISIONES.md)
> Salidas crudas de cada hito: [evidencia/](evidencia/)

---

## Estado actual

**Fecha:** 2026-09-02 · **Último hito cerrado:** T6 · **Siguiente:** T7

**El contrato está vivo en Stellar testnet** y el ciclo completo —registrar
emisor, anclar, consultar, revocar— se ejecutó contra la red real. Las tres
piezas existen; falta la librería que las une en una sola llamada, que es T7.

| | |
|---|---|
| Tests TypeScript | **85** en verde (core 55 · sdk 2 · cli 3 · scripts 25) |
| Tests Rust | **22** en verde |
| Red | testnet, protocolo **28** |
| Contrato desplegado | `CARC2SIQ3GTL34LVHSTGFRKDNNBYUXCSMGAUGKWGMT6Z2SDY6FXPP2DT` |
| Commits | 7 |

### Progreso

| Hito | Qué es | Estado |
|---|---|---|
| T1 | Esqueleto del proyecto | ✅ cerrado |
| T2 | Cuentas de prueba en la red | ✅ cerrado |
| T3 | Identidad derivable sin red | ✅ cerrado |
| T4 | Firmar y verificar credenciales | ✅ cerrado |
| T5 | El contrato en la blockchain | ✅ cerrado |
| T6 | Publicar el contrato en testnet | ✅ cerrado |
| T7 | La librería que junta todo | ⬜ siguiente |
| T8 | La herramienta de línea de comandos | ⬜ |

---

## T6 · Publicar el contrato en testnet — cerrado 2026-09-02

**Qué significa.** El contrato ya no vive solo en el repositorio: **está corriendo
en Stellar testnet**, con tu cuenta como administrador, en la dirección
`CARC2SIQ3GTL34LVHSTGFRKDNNBYUXCSMGAUGKWGMT6Z2SDY6FXPP2DT`. Un comando lo
compila, lo sube, lo despliega y **comprueba que lo que quedó en la red es lo que
queríamos poner**.

**Lo que se verificó contra la red real.** Esto importa porque en T5 tuve que
borrar un test que decía probar algo que el entorno de pruebas no puede simular.
Ahora sí se probó de verdad: consultar un documento inexistente devuelve
"desconocido"; registrar un emisor funciona; anclar funciona; consultar devuelve
"activo"; **intentar volver a anclar el mismo documento falla**; **intentar
revocarlo desde una cuenta que no lo emitió falla**; revocarlo desde el emisor
legítimo funciona; y consultar devuelve "revocado".

Los dos rechazos son exactamente las dos protecciones que T5 había probado con
mutaciones. Se comportan igual en producción que en los tests.

**Se puede volver a correr sin romper nada.** Si el contrato ya está desplegado y
coincide con lo que compila el código, el comando lo verifica y no hace nada. Si
algo no cuadra —el código cambió, o el contrato no responde— **se detiene y pide
confirmación explícita**, porque volver a desplegar crea una dirección nueva y
todas las credenciales ancladas contra la anterior quedarían apuntando al lugar
equivocado.

**Un error mío, y por qué la verificación valió la pena.** El primer despliegue
funcionó pero mi comprobación falló: leí mal el valor que devuelve el contrato.
Si me hubiera fiado de lo que imprime la herramienta de Stellar en vez de
verificar por mi cuenta, el error habría pasado desapercibido. Quedó un contrato
huérfano de ese intento —inofensivo, en testnet, sin emisores— anotado en la
evidencia en vez de barrido bajo la alfombra.

📎 [evidencia/T6.md](evidencia/T6.md) · [deployments/testnet.json](../deployments/testnet.json)

---

## T5 · El contrato en la blockchain — cerrado 2026-09-01

**Qué significa.** Este es el que hace real la promesa del producto: **poder
cortar la autorización de un agente desde afuera**. El contrato guarda, por cada
credencial, solo su huella digital y su estado. El principal llama a `revoke`, y
desde ese momento toda verificación falla. El agente no puede impedirlo, no lo
ve en su propio estado, y ningún prompt lo revierte.

**Qué se construyó.** El registro completo: alta y baja de emisores autorizados
(solo el administrador), anclaje de credenciales (solo un emisor activo),
revocación (solo el emisor que la creó) y consulta de estado.

**Las decisiones que evitan agujeros.** Tres que vale la pena entender:

- **Una credencial revocada no se puede "resucitar".** Si volver a anclar el
  mismo documento lo reactivara, cualquier emisor podría deshacer su propia
  revocación. Se rechaza.
- **Un emisor al que le quitaron el permiso igual puede revocar.** Suena
  contradictorio, pero es lo correcto: si le quitaras esa capacidad, sus
  credenciales quedarían vivas sin nadie que pueda cortarlas.
- **El administrador se fija en el mismo momento del despliegue**, no en un paso
  aparte. Un paso aparte dejaría una ventana en la que cualquiera podría
  reclamar el control del contrato.

**Cómo se comprobó.** 22 tests, incluidos los seis que pediste. Y cinco
mutaciones deliberadas —quitar la verificación de firma del emisor, ignorar si
el emisor está desactivado, no extender el vencimiento del almacenamiento,
permitir re-anclar, dejar que cualquiera revoque— y **las cinco ponen tests en
rojo**.

**Un test mío que borré.** Tenía uno que decía comprobar que una credencial
sigue viva 60 días después. Al desactivar por completo el mecanismo que debía
probar, **el test seguía pasando**: el entorno de pruebas de Soroban no simula
el archivado. Daba confianza falsa, así que lo eliminé y dejé escrito el porqué.
Lo real se verifica contra la red en T6.

📎 [evidencia/T5.md](evidencia/T5.md) · [contracts/README.md](../contracts/README.md)

---

## T4 · Firmar y verificar credenciales — cerrado 2026-09-01

**Qué significa.** Este es el corazón del producto. Ahora un principal puede
**firmar un documento** que dice "este agente es mío, puede leer catálogo y crear
intenciones de compra, con un tope de 50 USDC por transacción". Y cualquier
tercero puede **comprobar que esa firma es auténtica** y que el documento no
está vencido, sin llamar a nadie.

Lo importante es qué pasa cuando alguien intenta hacer trampa. Si un atacante
toma una credencial legítima y le sube el tope de 50 a 5.000, la verificación
falla. Si le agrega un permiso que no tenía, falla. Si la firma con su propia
llave y luego reescribe todos los campos para hacerse pasar por el emisor real,
también falla — lo único que no puede falsificar es la firma. Cada uno de esos
ataques tiene su test.

Y un detalle que suena menor pero no lo es: **la firma se comprueba antes que la
fecha.** Si fuera al revés, una credencial falsificada y además vencida se
reportaría como "vencida", y nadie se enteraría de la falsificación.

**Qué se construyó.** La conversión de una llave de Stellar al formato que usa
la firma, el esquema completo de la credencial validado campo por campo, y las
funciones de firmar y verificar. Todo en `packages/core`, sin red.

**Cómo se comprobó.** El brief advertía que la conversión de llaves era el punto
más probable de fallo silencioso del proyecto: si se hace mal, todo *parece*
funcionar pero las firmas no valen nada. Así que ese test se escribió **antes**
que la implementación, y está anclado a un vector de prueba de un estándar
internacional (RFC 8032) y contrastado contra una librería criptográfica
independiente. Tres derivaciones distintas dan el mismo resultado byte a byte.

Además se rompió la implementación a propósito tres veces para verificar que los
tests sirvieran. Intercambiar las dos mitades de la llave pone **19 tests en
rojo**.

**Un problema del brief que hubo que resolver.** El esquema original pedía que
la credencial llevara dentro el hash de sí misma. Eso es imposible —firmarla
cambia el hash, lo que cambiaría lo que hay que firmar— y además sería inseguro,
porque un atacante podría apuntar ese campo al hash de otra credencial que siga
activa. El verificador ahora calcula el hash del documento que recibió. Está
explicado en detalle en [DECISIONES.md](DECISIONES.md) como `I-16`, y revertirlo
es barato si prefieres otra salida.

📎 [evidencia/T4.md](evidencia/T4.md) · [credential-schema.md](credential-schema.md)

---

## T3 · Identidad derivable sin red — cerrado 2026-09-01

**Qué significa.** Ahora el sistema puede tomar la dirección Stellar de un
agente y sacar de ahí su llave pública, sin preguntarle a nadie. Eso importa
porque verificar la firma de una credencial va a funcionar aunque la red esté
caída, aunque no haya internet, aunque el nodo no responda. Y si alguien pasa
una dirección falsa —o una **llave secreta** donde debería ir una pública— el
sistema revienta con un error claro en vez de seguir de largo con datos basura.

**Qué se construyó.** Las funciones que convierten una dirección Stellar en un
identificador `did:stellar:testnet:G...` y viceversa, dentro de `packages/core`.

**Cómo se comprobó.** El ida y vuelta se probó sobre 100 pares de llaves
aleatorios, por dos caminos independientes. Trece formas distintas de escribir
mal un identificador se rechazan con un error tipado. Y —esto importa— se
verificó que los tests *sirvan*: se rompió la implementación a propósito dos
veces y los tests se pusieron rojos las dos veces.

📎 [evidencia/T3.md](evidencia/T3.md) · commit `2d9ec65`

---

## T2 · Cuentas de prueba en la red — cerrado 2026-09-01

**Qué significa.** Para probar cualquier cosa hacen falta identidades reales en
la red de pruebas de Stellar: una que administra el registro, una que emite
credenciales y una que representa al agente. Ahora se crean solas con un
comando, se les regala saldo de prueba, y **se pueden volver a correr sin romper
nada**: si ya existen, las reutiliza en vez de crear otras nuevas.

Eso último no es un detalle. Sin esa garantía, cada vez que alguien corriera el
comando perdería las identidades anteriores y todo lo firmado con ellas.

**Qué se construyó.** `pnpm run bootstrap`, más el reporte de qué versión de la
red está viva en este momento.

**Cómo se comprobó.** Se corrió dos veces y el archivo de configuración quedó
idéntico byte a byte. Se simuló que un hito posterior ya había escrito datos ahí
y sobrevivieron intactos. Se corrompió una llave a propósito y el error salió
claro, con código de salida 1.

**Cuentas creadas en testnet:**

| rol | dirección |
|---|---|
| admin | `GARBTKFQEX325HDOWL3KQT7PDCENLOYMXF7D6B6SB54LDKCHCRYFUY2K` |
| issuer | `GCTTRJIYYRHAOYTEG2YWKYSBKIQOMX7RX7SAJXQAM3QY2J7J453BOZD6` |
| agent | `GAK6E5E7L63ZYFZZZFXDTYVG6MVAKILSHI5FITGH5U4ORACEZQ4GFP2K` |

Las llaves secretas viven solo en `.env.local`, con permisos `600`, fuera del
control de versiones. Nunca se imprimen en pantalla.

📎 [evidencia/T2.md](evidencia/T2.md) · commit `222bc15`

---

## T1 · Esqueleto del proyecto — cerrado 2026-09-01

**Qué significa.** Se armó la estructura donde va a vivir todo: tres módulos de
TypeScript (el núcleo, la librería y la herramienta de comandos) y, por
separado, el contrato en Rust que va a la blockchain. Todo compila, todo se
testea, y hay un comando exacto para cada cosa.

La parte que importa a futuro: las dos mitades del proyecto —TypeScript y
Rust— **se tocan en un solo archivo**. Si mañana algo se rompe entre ellas, hay
un solo lugar donde mirar.

**Qué se construyó.** El monorepo completo, la infraestructura de errores
tipados, y un contrato mínimo que compila a WebAssembly.

**Cómo se comprobó.** Los tests "triviales" de cada módulo no son de relleno:
comprueban que un error creado en el núcleo cruza hasta la herramienta de
comandos con su tipo intacto. El contrato compila a un `.wasm` de 367 bytes.

**Herramientas instaladas en la máquina:** pnpm 11.24, Rust 1.98 con el target
`wasm32v1-none`, stellar-cli 28.0.0.

📎 [evidencia/T1.md](evidencia/T1.md) · commit `9bc7776`

---

## Cómo se mantiene este archivo

Al cerrar cada hito:

1. Se actualiza **Estado actual** y la tabla de **Progreso** (se sobrescriben).
2. Se agrega un bloque nuevo arriba de los anteriores, en lenguaje llano.
3. Las salidas crudas van a `evidencia/T<n>.md`, no aquí.
4. Toda decisión nueva va a [DECISIONES.md](DECISIONES.md).
