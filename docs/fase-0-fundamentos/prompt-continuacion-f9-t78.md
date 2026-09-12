# Prompt de continuación — F9, seguir en T78 (descubrimiento público)

> Generado el 2026-09-12, al cerrar T77, para pegar como primer mensaje en un
> chat nuevo de Claude Code dentro de esta misma carpeta (`AgentPay/`).

---

CONTEXTO

Este es AgentPey, pagos agénticos sobre Stellar testnet. Repo:
`github.com/vicentewolde/AgentPey`, rama `main`, al día y pusheada (commit
`0405da1`). Estamos en **F9, el piloto externo público**, dentro de la Fase 6.

**Antes de escribir una sola línea, leé en este orden:**

1. `docs/AGENT_LOG.md` — las últimas seis entradas del 2026-09-12 cuentan
   T72–T77 hito a hito, con el porqué de cada decisión.
2. `docs/fase-6-agentguard-comercializacion/PILOTO-F9.md` — **el plano de
   F9**: arquitectura, la regla que gobierna todo, los hitos, y las nueve
   decisiones del usuario ya respondidas en § 12.
3. `docs/fase-6-agentguard-comercializacion/BITACORA.md` y `DECISIONES.md`
   — estado técnico (`C-74` a `C-83` son de F9).
4. `CLAUDE.md` — reglas de trabajo, protocolo con Codex, criterios
   transversales no negociables.

## Qué se construyó en F9 hasta ahora (T72–T77, todo en `main`)

**La regla que gobierna el diseño entero: RealOps pide, AgentPey decide.** La
plataforma de agentes interpreta una instrucción y busca en un catálogo
público, pero no autoriza nada. AgentPey re-resuelve el comercio contra su
propio registro, pide él mismo la factura 402, y compara precio, activo y
`payTo` contra el Mandato firmado antes de pagar. Una plataforma comprometida
solo puede producir rechazos.

- **T72** — la propuesta (`PILOTO-F9.md`). Encontró cuatro supuestos rotos
  leyendo el código, no la documentación.
- **T73** — contrato de ejecución congelado. **El permiso por producto ahora
  se firma**: `grant.products`, opcional, verificado en `checkMandate` entre
  venue y asset (`C-75`). Tres scopes nuevos (`payments:authorize`,
  `payments:read`, `vault:read`) y tres rutas `/v1`.
- **T74** — el runner de compra sale de la sesión-cookie a
  `apps/web/src/tenant-purchase.ts`. Movió la cañería, no la decisión
  (`C-78`).
- **T75** — `POST /v1/purchases` y `GET /v1/purchases/{id}` cableados y
  persistidos. **Un rechazo es una fila, no una ausencia** (`C-79`).
- **T76** — `GET /v1/tenants/{id}/activity`. Nace `packages/activity`: el
  panel interno y la vista del usuario comparten el mismo cálculo, que es el
  mismo que la autorización usa (`C-81`).
- **T77** — controles del crédito patrocinado: arreglo del doble fondeo
  (`C-82`), pre-chequeo tipado de la reserva y su visibilidad en el panel
  (`C-83`), y los números de `C-80` en el rail.

**1010 tests verdes**, `typecheck` y `build` limpios. Ninguna ruta `/v1`
sigue congelada en `501`.

## Los números del piloto, ya decididos (`C-80`)

| | |
|---|---|
| Fondeo por tenant | 1 USDC |
| Rail: por transacción / por día | 0.30 / 0.60 USDC |
| Informe de mercado | 0.25 USDC |
| Créditos de IA | 0.10 USDC |
| Tope de tenants patrocinados | 20, aviso quedando 5 |
| Cuenta de reserva | `GAK6E5E7L63ZYFZZZFXDTYVG6MVAKILSHI5FITGH5U4ORACEZQ4GFP2K` |

Elegidos así para que **una segunda compra del informe supere el tope diario
dentro de la misma sesión** — el caso de aceptación 4 se vuelve alcanzable
por un tester externo sin esperar ni inventar nada. La reserva tenía
39.484 USDC testnet al cerrar T77 y el usuario puede fondearla con 20 USDC
una vez por día; el drenaje real del piloto entero es ~13 USDC, así que el
tope de 20 tenants se agota mucho antes que los fondos.

## Lo que sigue: T78, descubrimiento público

Periplo **existe y está verificado contra el servicio vivo** (`C-77`):
`https://periplo-testnet.fly.dev`, solo testnet, facilitador x402 **más**
catálogo Bazaar. `GET /discovery/search?query=` y `GET /discovery/resources`
devuelven recursos reales con `payTo`, `asset` y `amount`, cotizando el mismo
SAC de USDC testnet que este proyecto usa. Cataloga automáticamente al
liquidar un pago que lleve la extensión `bazaar`.

**Ojo con dos cosas al implementarlo:**

1. **Su forma de respuesta NO es la que `createX402Catalog` ya lee.** El
   adaptador existente espera `ServiceCard` (`{ok, results:[{resource:{id,
   name, payment:{asset,amount,destination}, routeTemplate}}]}`); Periplo
   devuelve la forma Bazaar de x402 (`{x402Version, items|resources:
   [{resource, accepts:[{asset, payTo, amount, scheme, network}],
   description, extensions}]}`). Hace falta un adaptador nuevo, no un
   parámetro.
2. **El catálogo no es fuente de permiso, y eso ya está escrito en código.**
   `executeTenantPurchase` rechaza con `VenueNotRegistered` **antes de
   cualquier llamada de red** a un venue que `venues.json` no conozca, y
   descarta el precio que el catálogo declare. Cualquier cosa que T78
   construya tiene que preservar eso. El catálogo de Periplo hoy tiene tres
   entradas y una es una fila de prueba de integración con `accepts: []`: la
   basura en un catálogo público no es hipótesis.

T78 también debe construir `AgentPeyDiscovery` — `GET /discovery/search`
público servido por `apps/web` sobre `venues.json` — como fallback y como
camino principal si Periplo no responde. Con su limitación dicha en voz alta:
un índice propio prueba el mecanismo, no el descubrimiento abierto.

Después de T78 vienen **SignalDesk** (comercio, a partir de
`examples/reference-merchant/`, delegable a Codex) y **RealOps** (plataforma,
registro por enlace mágico), despliegue público, y la suite de los diez casos
de aceptación.

## Pendiente del usuario (no bloquea T78)

- Setear `RESERVE_ADDRESS` en el panel de Render. Ya está en `render.yaml`
  con el valor correcto; Render lo va a pedir igual porque es una variable
  nueva.
- Pagar la instancia Starter de `agentpey-web` (medido: 38.8 s de arranque en
  frío estando dormida). Los otros dos servicios pueden quedarse en el plan
  gratis y los despierta AgentPey con un ping.
- Comprar `agentpey.com` y conectarlo por Custom Domains.
- Anotado sin construir: un barrido que devuelva a la reserva el USDC que
  SignalDesk acumule — necesita que SignalDesk exista primero.
- Deuda registrada: la `AGENT_SECRET_KEY` pasó por un chat. Es testnet y no
  controla nada con valor; rotarla antes de cualquier cosa cercana a mainnet.

## Reglas de trabajo (recordatorio, sin cambios)

- Rama `cc/<feature>` por hito, nunca directo a `main`.
- `pnpm typecheck` / `pnpm build` / `pnpm test` limpios antes de cerrar
  cualquier hito.
- Al cerrar: `BITACORA.md` (progreso + bloque en lenguaje llano),
  `DECISIONES.md` (motivo y alternativa descartada), `docs/AGENT_LOG.md`
  (branch, qué, por qué, qué queda). No es opcional.
- **Mergear a `main` solo con confirmación explícita del usuario, para cada
  hito** — nunca asumida de una aprobación anterior.
- Codex no inicia nada de F9 por su cuenta. Ya se puede delegar: SignalDesk
  (`apps/signaldesk/**`), la UI de RealOps, fixtures y tests. Nunca:
  `checkMandate`, `scope.limits`/`perDay`, `tenant-rail.ts`, `venues.json`,
  los contratos, ni nada que mueva fondos.
