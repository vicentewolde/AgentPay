# Prompt de continuación — F9, seguir en el despliegue público y la suite de aceptación

> Generado el 2026-09-12, al cerrar T83, para pegar como primer mensaje en un
> chat nuevo de Claude Code dentro de esta misma carpeta (`AgentPay/`).

---

CONTEXTO

Este es AgentPey, pagos agénticos sobre Stellar testnet. Repo:
`github.com/vicentewolde/AgentPey`, rama `main`, al día y pusheada (commit
`3e7f7ae`). Estamos en **F9, el piloto externo público**, dentro de la Fase 6.

**Antes de escribir una sola línea, leé en este orden:**

1. `docs/AGENT_LOG.md` — las últimas seis entradas del 2026-09-12 cuentan
   T78–T83 hito a hito, con el porqué de cada decisión.
2. `docs/fase-6-agentguard-comercializacion/PILOTO-F9.md` — **el plano de F9**:
   la arquitectura de tres servicios, la regla que gobierna todo, y los diez
   casos de aceptación (§ 10 y § 11, más el brief § 7).
3. `docs/fase-6-agentguard-comercializacion/BITACORA.md` y `DECISIONES.md` —
   estado técnico. `C-74` a `C-101` son de F9.
4. `CLAUDE.md` — reglas de trabajo, protocolo con Codex, criterios
   transversales no negociables.

## La regla que gobierna el diseño entero

**RealOps pide, AgentPey decide.** La plataforma de agentes interpreta una
instrucción y busca en un catálogo público, pero no autoriza nada. AgentPey
re-resuelve el comercio contra su propio registro, pide él mismo la factura
402, y compara precio, activo y `payTo` contra el Mandato firmado antes de
pagar. Una plataforma comprometida solo puede producir rechazos.

## Qué se construyó en F9 (T72–T83, todo en `main`)

| Hito | Qué quedó |
|---|---|
| **T72** | La propuesta (`PILOTO-F9.md`). Encontró cuatro supuestos rotos leyendo el código |
| **T73** | Contrato de ejecución congelado. **El permiso por producto se firma** (`grant.products`) |
| **T74** | El runner de compra sale de la sesión-cookie a `tenant-purchase.ts` |
| **T75** | `POST /v1/purchases` cableado. **Un rechazo es una fila, no una ausencia** |
| **T76** | `GET /v1/tenants/{id}/activity`. Nace `packages/activity`: panel y usuario comparten el cálculo de la autorización |
| **T77** | Controles del crédito patrocinado: arreglo del doble fondeo, pre-chequeo de la reserva |
| **T78** | Descubrimiento público: adaptador sobre Periplo + índice propio + fallback. El catálogo no es fuente de permiso |
| **T79** | **SignalDesk**, el comercio: dos productos, `402`, entrega tras liquidar, recibo firmado verificable sin AgentPey |
| **T80** | **RealOps**, la plataforma: enlace mágico, permisos, cinco pantallas, el grant literal con quién lo hace cumplir |
| **T81** | **Lista blanca de URLs de retorno** (la última brecha de seguridad del plan) + RealOps ↔ `/v1` hasta el Mandato firmado |
| **T82** | La compra desde RealOps y "Mis servicios": entregas con recibo y enlace al pago, rechazos traducidos sin inventar |
| **T83** | **Revocación hospedada** en `/revocar/{id}`, firmada con la wallet del principal |

**1225 tests verdes**, `typecheck` y `build` limpios, esquema de directorio en
versión 8.

## Los tres servicios

| Servicio | Qué es | Puede |
|---|---|---|
| `apps/web` (AgentPey) | La plataforma de pagos | **Decidir y ejecutar.** Tiene las llaves |
| `apps/realops` (RealOps) | La plataforma de agentes | **Solo pedir.** Ninguna llave Stellar; cinco llamadas a `/v1` |
| `apps/signaldesk` (SignalDesk) | El comercio x402 | Cobrar y entregar. Claves propias, tablas propias |

Probado con plata real de testnet en T79: 0.35 USDC llegaron a la cuenta de
SignalDesk (`GB4D4PLLFEIKZK6MDW42MZRQ5XMPC6QRJN4FFRODO6D3PRB3MDGGYOOF`), tx
`aaf0ea0d…fed4d` en el ledger 4644779.

## Lo que sigue: dos cosas

### 1. El despliegue público de los tres servicios

`render.yaml` ya declara `agentpey-web`, `agentpey-signaldesk` y
`agentpey-realops`. **Antes de que la firma funcione en producción hay tres
pasos que no son opcionales, y el tercero es el que sorprende si se olvida:**

```bash
pnpm run partner:create -- --name "RealOps"
```

Esa key va como `REALOPS_AGENTPEY_API_KEY` en el panel de `agentpey-realops`.
Y después:

```bash
pnpm run partner:return-origins -- --partner ptn_… --origins https://agentpey-realops.onrender.com
```

**Sin ese último paso la firma se refuza con `ReturnUrlNotAllowed`** — que es
la lista blanca funcionando, no un bug. Una lista vacía no permite nada, por
`B-1`.

`agentpey-signaldesk` necesita `SIGNALDESK_SECRET_KEY` y
`SIGNALDESK_FACILITATOR_SECRET` (ya cargadas por el usuario) y `DATABASE_URL`.
`agentpey-realops` necesita `DATABASE_URL`; sin `RESEND_API_KEY` el enlace
mágico se muestra en pantalla y **la página dice que en ese modo no se verifica
el correo**.

**Ojo con `venues.json`:** la fila de `signaldesk` tiene
`baseUrl: https://agentpey-signaldesk.onrender.com`. Un venue se resuelve por
**origen exacto**, así que si el host desplegado no coincide, el pago se
rechaza con `VenueNotRegistered` antes de cualquier llamada de red.

### 2. La suite de los diez casos de aceptación

Los diez casos están en el brief § 7 y en `PILOTO-F9.md` § 10. El estado por
caso, hasta donde el mecanismo existe:

| # | Caso | Mecanismo |
|---|---|---|
| 1 | Compra del informe + entrega visible | ✅ T79/T82 |
| 2 | Compra de créditos + entrega visible | ✅ T79/T82 |
| 3 | Comercio, activo o `payTo` no permitido | ✅ `checkMandate` + `reconcileTerms` |
| 4 | Sobre máximo por transacción y por día | ✅ `C-80` eligió los números para que el caso sea alcanzable en una sesión |
| 5 | Factura con precio distinto | ✅ `reconcileTerms` |
| 6 | Mandato vencido, revocado, credencial revocada | ✅ T83 cerró la revocación |
| 7 | Wallet firmante distinta | ✅ `checkMandate` + T83 |
| 8 | Rail sin saldo; idempotencia sin doble pago | ✅ T77 + `C-79` |
| 9 | Catálogo caído o producto ausente, sin intento de pago | ✅ T78 |
| 10 | Regreso tras firmar con estado durable | ✅ T81 |

**Lo que falta es ejercitarlos de punta a punta contra testnet real**, no
construir mecanismo nuevo. Falta decidir con el usuario si la suite corre
contra los servicios desplegados o contra local.

## Pendiente del usuario

- Desplegar los tres servicios en Render y hacer los tres pasos de arriba.
- Comprar `agentpey.com` y conectarlo por Custom Domains (habilita Resend y,
  con eso, la verificación real del correo).
- Pagar la instancia Starter de `agentpey-web` (38.8 s de arranque en frío
  medidos estando dormida).
- Deuda registrada: la `AGENT_SECRET_KEY` pasó por un chat. Es testnet y no
  controla nada con valor; rotarla antes de cualquier cosa cercana a mainnet.

## Deuda técnica anotada, sin construir

- `createX402Catalog` **no tiene timeout** y está en el camino de pago. T78 le
  puso timeout al camino de descubrimiento solamente, a propósito: cambiar
  cuándo se rinde una llamada en el camino de pago cambia comportamiento de
  pago.
- Los rails de prueba anteriores a T77 no cuentan contra el tope de 20
  (columna en `null`). No se hace backfill a propósito — ver `C-82`.
- `buy()` sigue existiendo para el camino clásico sin wallet (`C-34`). Dos
  cañerías hacia el mismo pago, una sola capa de enforcement; retirar la demo
  cuando F9 funcione queda anotado.
- Un barrido que devuelva a la reserva el USDC que SignalDesk acumule.

## Reglas de trabajo (recordatorio, sin cambios)

- Rama `cc/<feature>` por hito, nunca directo a `main`.
- `pnpm typecheck` / `pnpm build` / `pnpm test` limpios antes de cerrar
  cualquier hito.
- Al cerrar: `BITACORA.md` (progreso + bloque en lenguaje llano),
  `DECISIONES.md` (motivo y alternativa descartada), `evidencia/T<n>.md`,
  `docs/AGENT_LOG.md`. No es opcional.
- **Mergear a `main` solo con confirmación explícita del usuario, para cada
  hito** — nunca asumida de una aprobación anterior.
- El usuario pidió explícitamente en esta sesión **no delegar nada a Codex**:
  T79–T83 los hizo Claude Code enteros aunque el plan marcaba algunos como
  delegables. Confirmar antes de cambiar eso.
