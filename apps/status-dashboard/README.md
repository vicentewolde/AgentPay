# AgentPay status dashboard

Internal, read-only operational view for one tenant at a time. It shows the
tenant's Mandate history and the durable vault chain, including the result of
the vault's hash-chain verification. It cannot create payments, revoke
mandates, or append vault records.

Run it with the repository's `DATABASE_URL` from `.env.local`:

```bash
pnpm --filter @agentpay/status-dashboard run dev
```

Open `http://localhost:8790`, enter a tenant ID, or use the read-only JSON
routes directly:

```text
GET /api/status/mandates?tenantId=<tenant-id>
GET /api/status/vault/<tenant-id>
```

The ordinary test suite checks every known route rejects `POST`, `PUT`,
`PATCH`, and `DELETE` with `405 Method Not Allowed`:

```bash
pnpm --filter @agentpay/status-dashboard test
```

The separate integration suite seeds an isolated Postgres fixture through the
existing directory and vault APIs, then confirms the dashboard reads the
seeded mandate and reports a healthy chain. It requires `DATABASE_URL` in
`.env.local` and cleans its random fixture rows afterward:

```bash
pnpm --filter @agentpay/status-dashboard run test:integration
```
