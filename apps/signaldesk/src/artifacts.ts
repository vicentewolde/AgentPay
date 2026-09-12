/**
 * What SignalDesk actually delivers once a payment settles.
 *
 * **The market brief is synthetic and says so first, not last.** The numbers
 * come from a seeded generator in this file — no market data source is
 * consulted, none is imitated, and the artefact's opening line states that in
 * the same size type as everything else. A disclaimer in grey at the bottom is
 * how a demo becomes a misleading document, and this pilot is going to be shown
 * to people who did not write it.
 *
 * **Deterministic, from the delivery id.** The same delivery always renders the
 * same bytes, so `artifact_hash` is a property of the delivery rather than of
 * the moment it was re-rendered. That is what lets the receipt be checked later
 * by someone who fetches the artefact and hashes it themselves.
 */
import { createHash } from "node:crypto";

import { ARTIFACT_RETENTION_DAYS, SUPPORTED_PAIR } from "./catalog.js";

/** HTML-escapes third-party text. Everything variable in an artefact goes through here. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * A deterministic stream of numbers seeded by a string.
 *
 * Not cryptographic and not pretending to be: its only job is to make a demo
 * report look like a report while staying identical across re-renders.
 */
function seeded(seed: string): () => number {
  let state = Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 12), 16);
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

function money(value: number): string {
  return value.toFixed(4);
}

export interface MarketBriefInput {
  readonly deliveryId: string;
  readonly pair: string;
  readonly deliveredAt: Date;
}

/** The market brief, as a self-contained HTML document (decision D5). */
export function renderMarketBrief(input: MarketBriefInput): string {
  const next = seeded(input.deliveryId);
  const base = 0.09 + next() * 0.04;
  const rows = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(input.deliveredAt.getTime() - (6 - index) * 86_400_000);
    const close = base * (0.94 + next() * 0.12);
    const volume = Math.round(120_000 + next() * 380_000);
    return { day: day.toISOString().slice(0, 10), close, volume };
  });

  const first = rows[0]!.close;
  const last = rows.at(-1)!.close;
  const change = ((last - first) / first) * 100;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de mercado ${escapeHtml(input.pair)} · SignalDesk</title>
<style>
  :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  body { margin: 0; padding: 2rem 1.25rem; background: #fbfbf9; color: #1c1c1a; line-height: 1.55; }
  main { max-width: 46rem; margin: 0 auto; }
  .synthetic { background: #1c1c1a; color: #fbfbf9; padding: 1rem 1.25rem; border-radius: .5rem; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; }
  th, td { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid #e2e2dd; font-variant-numeric: tabular-nums; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #6b6b63; }
  footer { margin-top: 2.5rem; font-size: .85rem; color: #6b6b63; }
  code { background: #efefe9; padding: .1rem .35rem; border-radius: .25rem; }
</style>
</head>
<body>
<main>
  <p class="synthetic">Datos sinteticos generados por SignalDesk. Este informe no usa ni reproduce datos de mercado reales, y no es asesoramiento financiero.</p>

  <h1>Informe de mercado ${escapeHtml(input.pair)}</h1>
  <p>Entrega <code>${escapeHtml(input.deliveryId)}</code>, emitida el ${escapeHtml(input.deliveredAt.toISOString())}.</p>

  <h2>Serie de siete dias</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Cierre (USDC)</th><th>Volumen</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.day)}</td><td>${money(row.close)}</td><td>${row.volume.toLocaleString("es")}</td></tr>`,
        )
        .join("\n      ")}
    </tbody>
  </table>

  <h2>Resumen</h2>
  <p>Variacion de la serie: <strong>${change >= 0 ? "+" : ""}${change.toFixed(2)}%</strong>. Cierre mas reciente: <strong>${money(last)} USDC</strong>.</p>

  <footer>
    <p>SignalDesk conserva los artefactos ${ARTIFACT_RETENTION_DAYS} dias. Despues de eso quedan el recibo firmado y el hash, no el archivo.</p>
  </footer>
</main>
</body>
</html>
`;
}

export interface CreditsReceiptInput {
  readonly deliveryId: string;
  readonly account: string;
  readonly granted: number;
  readonly balance: number;
  readonly deliveredAt: Date;
}

/**
 * The credits artefact. It is a statement of an entitlement, and it says what
 * the entitlement is not: there is no transfer operation in this service, so
 * the balance cannot leave the account it was granted to.
 */
export function renderCreditsStatement(input: CreditsReceiptInput): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Creditos de IA · SignalDesk</title>
<style>
  :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  body { margin: 0; padding: 2rem 1.25rem; background: #fbfbf9; color: #1c1c1a; line-height: 1.55; }
  main { max-width: 46rem; margin: 0 auto; }
  .synthetic { background: #1c1c1a; color: #fbfbf9; padding: 1rem 1.25rem; border-radius: .5rem; font-weight: 600; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1.5rem; margin: 1.5rem 0; }
  dt { color: #6b6b63; font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; }
  dd { margin: 0; font-variant-numeric: tabular-nums; }
  code { background: #efefe9; padding: .1rem .35rem; border-radius: .25rem; word-break: break-all; }
  footer { margin-top: 2.5rem; font-size: .85rem; color: #6b6b63; }
</style>
</head>
<body>
<main>
  <p class="synthetic">Creditos de producto de demostracion. No son un token Stellar, no son transferibles, y solo existen dentro de SignalDesk.</p>

  <h1>Creditos acreditados</h1>
  <dl>
    <dt>Entrega</dt><dd><code>${escapeHtml(input.deliveryId)}</code></dd>
    <dt>Cuenta</dt><dd><code>${escapeHtml(input.account)}</code></dd>
    <dt>Acreditados</dt><dd>${input.granted}</dd>
    <dt>Saldo</dt><dd>${input.balance}</dd>
    <dt>Fecha</dt><dd>${escapeHtml(input.deliveredAt.toISOString())}</dd>
  </dl>

  <footer>
    <p>SignalDesk no expone ninguna operacion de transferencia sobre este saldo: no es una restriccion de politica, es que no existe el endpoint.</p>
  </footer>
</main>
</body>
</html>
`;
}

/** `sha256` of an artefact's exact bytes, hex — what the receipt commits to. */
export function artifactHash(artifact: string): string {
  return createHash("sha256").update(artifact, "utf8").digest("hex");
}
