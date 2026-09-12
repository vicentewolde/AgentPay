/**
 * The human-facing catalogue.
 *
 * The brief asks for a merchant with a visible catalogue, not just a machine
 * feed, and the reason is worth stating: a person about to authorise an agent
 * to spend money at SignalDesk should be able to open SignalDesk and read what
 * it sells, at what price, before anything signs anything.
 *
 * It renders from the same `PRODUCTS` table the `ServiceCard` feed and the
 * `402` challenge read, so the page cannot quote a price the network would not
 * charge.
 */
import { ARTIFACT_RETENTION_DAYS, PRODUCTS, SIGNALDESK_SLUG } from "./catalog.js";

export interface PageInput {
  /** The account SignalDesk is paid at — published, because it is also its venue identity. */
  readonly payTo: string;
  readonly discoveryPath: string;
}

export function renderCatalogPage(input: PageInput): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SignalDesk</title>
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
          --bg: #fbfbf9; --fg: #1c1c1a; --muted: #6b6b63; --line: #e2e2dd; --card: #ffffff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16161a; --fg: #f2f2ef; --muted: #a3a39b; --line: #2e2e34; --card: #1e1e23; }
  }
  body { margin: 0; padding: 2.5rem 1.25rem; background: var(--bg); color: var(--fg); line-height: 1.6; }
  main { max-width: 48rem; margin: 0 auto; }
  h1 { margin: 0 0 .25rem; font-size: 1.9rem; letter-spacing: -.01em; }
  .lede { color: var(--muted); margin: 0 0 2rem; }
  .product { background: var(--card); border: 1px solid var(--line); border-radius: .75rem;
             padding: 1.25rem 1.35rem; margin-bottom: 1rem; }
  .product h2 { margin: 0 0 .35rem; font-size: 1.1rem; }
  .price { float: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .product p { margin: 0 0 .75rem; color: var(--muted); }
  code { background: color-mix(in srgb, var(--line) 60%, transparent); padding: .12rem .4rem;
         border-radius: .3rem; font-size: .85em; word-break: break-all; }
  .meta { font-size: .85rem; color: var(--muted); }
  footer { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--line);
           font-size: .88rem; color: var(--muted); }
  footer p { margin: 0 0 .6rem; }
</style>
</head>
<body>
<main>
  <h1>SignalDesk</h1>
  <p class="lede">Un comercio x402 sobre Stellar testnet. Cobra en USDC de prueba y entrega al liquidar, no antes.</p>

  ${PRODUCTS.map(
    (product) => `<article class="product">
    <span class="price">${product.price} USDC</span>
    <h2>${product.name}</h2>
    <p>${product.description}</p>
    <p class="meta">
      <code>${product.id}</code><br>
      Ruta paga: <code>${product.routeTemplate}</code>
    </p>
  </article>`,
  ).join("\n  ")}

  <footer>
    <p><strong>Datos sinteticos.</strong> El informe de mercado lo genera SignalDesk. No usa ni reproduce datos de mercado reales, y no es asesoramiento financiero.</p>
    <p><strong>Los creditos no son transferibles.</strong> Son un saldo ligado a una direccion dentro de SignalDesk, no un token Stellar. Este servicio no expone ninguna operacion para moverlos.</p>
    <p><strong>Retencion.</strong> Los artefactos entregados se conservan ${ARTIFACT_RETENTION_DAYS} dias. Despues quedan el recibo firmado y su hash, no el archivo.</p>
    <p><strong>Cada entrega lleva recibo firmado por SignalDesk</strong>, verificable con su clave publica <code>${input.payTo}</code> sin intervencion de nadie mas. Identidad de comercio: <code>${SIGNALDESK_SLUG}:${input.payTo}</code>.</p>
    <p>Catalogo para agentes: <code>${input.discoveryPath}</code></p>
  </footer>
</main>
</body>
</html>
`;
}
