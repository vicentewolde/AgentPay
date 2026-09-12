# Reference x402 merchant

This is a deliberately small `node:http` server that implements a second,
independent x402 merchant for AgentPey's generic catalogue adapter. It has one
discoverable product and one paid resource:

- `GET /api/discovery/search?query=*` returns the `ServiceCard` shape consumed
  by `createX402Catalog`.
- `GET /api/x402/account-summary?account=G...` first returns an x402 v2 `402`
  challenge (`exact`, `stellar:testnet`, real testnet USDC SAC). A valid
  `PAYMENT-SIGNATURE` is verified and settled by a local Stellar facilitator;
  the response body is released only after the network settlement succeeds.

The merchant and facilitator secrets are disposable testnet keys held only in
this directory's ignored `.env.local`. The facilitator sponsors settlement
fees; the payer and merchant have their own USDC trustlines.

## Run the real end-to-end proof

Use Node 22+ and run these commands from this directory:

```sh
pnpm install --ignore-workspace
pnpm run generate-env
pnpm run fund
```

`fund` uses Friendbot for XLM and opens the required USDC trustlines. It prints
the new `PAYER_ADDRESS`; fund that address with testnet USDC through Circle's
testnet faucet. Then run:

```sh
pnpm run pay
```

`pay` starts the merchant on an ephemeral local port, calls the discovery API,
checks the genuine `402`, creates a signed x402 Stellar payment, and prints
`TESTNET_TRANSACTION_HASH` only after the server's facilitator settles it.
It also prints a Stellar Expert testnet transaction URL and the delivered
resource. This makes the complete proof reproducible without changing
`apps/agent` or any contract.

To run only the server for manual inspection:

```sh
pnpm run start
curl -i 'http://127.0.0.1:4020/api/discovery/search?query=account'
curl -i 'http://127.0.0.1:4020/api/x402/account-summary?account=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
```
