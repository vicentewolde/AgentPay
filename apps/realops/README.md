# RealOps

The pilot's agent platform: where a person signs up, configures an agent, sets
its limits, and later reads what it bought and what it was refused.

**RealOps asks; AgentPey decides.** This service holds no Stellar key, never
sees a mandate, and cannot authorise a payment. From T81 its only power will be
calling AgentPey's `/v1` with an API key and being told yes or no. A compromised
RealOps can produce refusals and nothing else — that is the property the whole
pilot rests on.

## The five screens

| | |
|---|---|
| `/` | What this is, that it is testnet, and a link to SignalDesk so both services can be checked separately |
| `/entrar` | Email + alias → a single-use link. No password |
| `/agentes` | The two agents, their limits, and the form to configure one |
| `/agentes/{id}` | The review screen: **the literal grant**, with a mark on each permission saying who enforces it |
| `/servicios` | Deliveries, receipts and refusals (filled in T81), plus account deletion |

## The privacy boundary

The email exists **only here**. AgentPey knows an account as a random
`rop_<ulid>` with no relationship to the address it stands for.

That is random and not a hash on purpose: a hash of an email is still an
identifier *of that person*, and a dictionary of common addresses reverses it in
seconds. A random id cannot be reversed because it never encoded anything.

Magic links are stored as a SHA-256, never as themselves, so reading the table
does not let anyone sign in. They last 15 minutes and are redeemed by a
conditional update — two clicks on one link cannot both win.

## The review screen, and why it shows raw JSON

The person is about to sign that exact object. A friendly summary could drift
from what is actually sent, and the drift would be invisible because both would
look right. So the screen renders the grant `translatePermissions` built, and
T81 will send that same object.

Each control is tagged with who makes it true:

- **firmado** — AgentPey verifies it against the signed Mandate.
- **on-chain** — the `policy_rail` contract revalidates it too, so the network
  refuses even if everything above it failed.
- **RealOps** — only this platform's business, and says so.

Showing all three identically would be claiming guarantees the system does not
make.

## Instructions are read deterministically

`interpretInstruction` recognises two families of sentence and **refuses rather
than guessing**. An agent holding spending permission that guesses buys the
wrong thing with real money. What it does not recognise comes back as
`InstructionNotUnderstood` and the page offers the two products as buttons.

A future LLM could replace that file entirely without changing any guarantee:
interpreting is on the side of the trust boundary that is allowed to be wrong.

## Running it

```bash
pnpm run realops
```

With no `DATABASE_URL` it runs on an in-memory store. With no `RESEND_API_KEY`
it shows the magic link on screen instead of emailing it — which the page states
plainly, because in that mode **the email address is not verified**.

```bash
pnpm --filter @agentpey/realops test
```

## Storage

`realops_accounts`, `realops_magic_links`, `realops_sessions` and
`realops_agents`, created on first use. An hourly sweep deletes expired links
and sessions, and erases the email of any account untouched for 90 days —
deleted, not merely ignored, which is the distinction T70 drew for AgentPey's
own ephemeral rows.

Deleting an account erases the email, the alias and every session. It does
**not** erase the Mandate or the vault records, and `/servicios` says so in
plain words: those are signed evidence anchored to a public chain, and removing
them would break the hash chain that is the product. That tension is real and
the page shows it rather than hiding it.
