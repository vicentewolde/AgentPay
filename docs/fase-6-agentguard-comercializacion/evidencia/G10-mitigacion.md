# G10 — mitigación (sin numerar)

Tope de gasto para `ensureWalletIsRegisteredIssuer`, a pedido explícito
del usuario. No resuelve `G10` del todo — sigue sin aprobación manual, a
propósito, `C-15` no se revirtió — pero acota el costo a un número
conocido. Rama `main` (commit directo).

---

## 1. El problema, medido

`ensureWalletIsRegisteredIssuer` paga, con `ADMIN_SECRET_KEY`, el
registro de cualquier wallet que pase `/api/wallet/verify` — una firma
SEP-0053 sobre una wallet que cualquiera puede generar gratis, tantas
veces como quiera. Sin este hito, nada limitaba cuántos de esos registros
reales (una escritura Soroban) el admin terminaba pagando en una ventana
de tiempo.

## 2. La mitigación

`apps/web/src/issuer-registration-limit.ts`: contador de ventana
deslizante, server-wide, 20 registros por hora. `ensureWalletIsRegisteredIssuer`
lo consulta **antes** de llamar a `registerIssuer` — un cupo se gasta al
intentar, no al confirmar, para que dos pedidos concurrentes no pasen
juntos el chequeo.

```
$ pnpm --filter @agentpay/web exec vitest run src/issuer-registration-limit.test.ts

 ✓ src/issuer-registration-limit.test.ts (4 tests)
   ✓ allows exactly maxPerWindow calls, then refuses the next one
   ✓ frees up a slot once the oldest consumption falls outside the window
   ✓ never counts a wallet that was already a registered issuer — checked at the call site, not here
   ✓ reports how many milliseconds until a slot frees up
```

## 3. Verificación de que el camino feliz sigue intacto

Corrida real contra testnet, servidor local (`pnpm --filter @agentpay/web
run dev`): una wallet fresca, fondeada por Friendbot, conecta y llega a
`pending: wallet-consent` sin ningún cambio de comportamiento — el
límite no se nota hasta que se supera.

```
verify { ok: true, address: 'GAYF57JHKCNSIBVWVKU2XDBI74QE3A42EJAYSUA57LTSC4SSSXHAI73H' }
start {
  ok: true,
  pending: 'wallet-consent',
  credentialHash: 'd55ae5975717db5a76d5b21b2a670a05786f2de0466581186a0557d9b8b87387',
  ...
}
```

Script descartable, no commiteado — mismo criterio que las sondas de
T22/T57/T58.

## 4. Verificación general

`pnpm typecheck`/`build` limpios; 911 tests unitarios en el monorepo
(+4, `issuer-registration-limit.test.ts`).

## 5. Qué queda fuera, a propósito

- No hay cola de aprobación manual — `C-15` sigue vigente, no se revirtió.
- El contador es en memoria, no en Postgres — se reinicia en cada
  redeploy, mismo criterio ya aceptado para `G12` (pendiente para F8).
- No distingue tráfico legítimo de abuso — es un tope de gasto, no un
  sistema de detección de fraude.
