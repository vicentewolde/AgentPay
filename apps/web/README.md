# @agentpay/web

The simple frontend from T25 (Phase 4, MandateGate): a Node server
(`node:http`, no framework) plus a build-step-free static page that drives
the agent against the real bazaar on Stellar testnet — a live session, a
real x402 payment, a real Mandate revocation. See
[`docs/fase-4-mandategate/`](../../docs/fase-4-mandategate/) for the design
and evidence.

## Run it locally

From the repo root:

```bash
pnpm run web
```

Needs `.env.local` at the repo root (`pnpm run bootstrap` + `pnpm run
deploy:registry` set it up) and the agent's account funded with USDC (`pnpm
run fund:usdc`, then fund the printed address at Circle's testnet USDC
faucet). Opens on `http://localhost:8787` (override with `PORT=...`).

## Deploy it somewhere public (Render)

This is a stateful, long-running Node process (an in-memory demo session),
not a serverless function — it needs a platform that keeps one process
alive, not one that spins up isolated invocations per request. Render's
free web-service tier fits.

**What's already prepared in this repo:**
- `render.yaml` at the repo root — a Render Blueprint. Build command
  (`corepack enable && corepack prepare pnpm@11.24.0 --activate && pnpm
  install --frozen-lockfile && pnpm build`) and start command (`pnpm
  --filter @agentpay/web run start`) are both verified locally against the
  exact commands Render will run.
- `apps/web/package.json`'s `start` script (identical to `dev` — this app
  has no separate production build; `tsx` runs the TypeScript directly).

**What you have to do yourself — deliberately not automated:**

1. Push this repo (or your fork) to GitHub if it isn't already.
2. In the Render dashboard: **New → Blueprint**, connect the repo. Render
   reads `render.yaml` and proposes the `agentpay-web` service.
3. Before the first deploy finishes settling, or right after, open the
   service's **Environment** tab and set these — Render never asks for them
   during the Blueprint step because `render.yaml` marks them `sync: false`:
   - `ISSUER_SECRET_KEY` — from your local `.env.local`.
   - `AGENT_SECRET_KEY` — from your local `.env.local`.
   - `AGENT_REGISTRY_CONTRACT_ID` — from your local `.env.local`.

   Copy these from your own `.env.local`, paste them into Render's own form
   yourself. Nothing in this repo, and nothing Claude Code does, ever
   transmits them anywhere.
4. Deploy. Render gives you a public URL
   (`https://agentpay-web-xxxx.onrender.com` by default, or whatever name
   you pick) — that's what you hand out.

**No access control, on purpose.** Anyone with the link can click every
button, including "Comprar" — each click is a real (if tiny, ~0.001 USDC)
testnet transaction. That's the intended shape of a public demo of this
project; it is not a mistake to fix later.

**Operational note.** The agent's account needs to stay funded — both the
native XLM for fees (Friendbot-funded, effectively free to refill) and the
USDC each real purchase spends. A public demo that gets real traffic will
eventually need a top-up at Circle's testnet faucet; there's no
auto-refill, and a purchase past the balance will surface as an
`AgentPassError` in the UI, not a crash.

Render's free tier spins the service down after idle periods and takes a
few seconds to wake on the next request — normal for a demo, worth knowing
before someone clicks "Iniciar sesión" and waits.
