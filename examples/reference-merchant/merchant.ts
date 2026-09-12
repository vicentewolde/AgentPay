import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { x402Facilitator } from "@x402/core/facilitator";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { createEd25519Signer, STELLAR_TESTNET_CAIP2, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import { z } from "zod";

export const DISCOVERY_PATH = "/api/discovery/search";
export const PAID_PATH = "/api/x402/account-summary";
export const PRODUCT_ID = "account-summary";
export const PRICE_ATOMIC = "25000"; // 0.0025000 USDC

const accountSchema = z.string().regex(/^G[A-Z2-7]{55}$/, "expected a Stellar classic account");
const paymentHeaderSchema = z.string().min(1).max(32_768);
const paymentPayloadSchema = z.object({
  x402Version: z.number().int().positive(),
  resource: z
    .object({ url: z.url(), description: z.string().optional(), mimeType: z.string().optional() })
    .optional(),
  accepted: z.object({
    scheme: z.literal("exact"),
    network: z.literal(STELLAR_TESTNET_CAIP2),
    asset: z.string(),
    amount: z.string(),
    payTo: z.string(),
    maxTimeoutSeconds: z.number().int().positive(),
    extra: z.record(z.string(), z.unknown()),
  }),
  payload: z.record(z.string(), z.unknown()),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export const merchantConfigSchema = z.object({
  merchantPayTo: accountSchema,
  facilitatorSecret: z.string().regex(/^S[A-Z2-7]{55}$/, "expected a Stellar secret seed"),
  asset: z.string().regex(/^C[A-Z2-7]{55}$/, "expected a Stellar asset contract").default(USDC_TESTNET_ADDRESS),
  port: z.number().int().min(0).max(65_535).default(4020),
});

export type MerchantConfig = z.input<typeof merchantConfigSchema>;

class MerchantError extends Error {
  constructor(
    readonly code: "InvalidRequest" | "InvalidPayment" | "PaymentProcessingFailed",
    readonly status: number,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

function requirements(config: z.output<typeof merchantConfigSchema>): PaymentRequirements {
  return {
    scheme: "exact",
    network: STELLAR_TESTNET_CAIP2,
    asset: config.asset,
    amount: PRICE_ATOMIC,
    payTo: config.merchantPayTo,
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true },
  };
}

function paymentRequired(config: z.output<typeof merchantConfigSchema>, resourceUrl: string): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: resourceUrl,
      description: "A deterministic account summary from the AgentPey reference merchant.",
      mimeType: "application/json",
    },
    accepts: [requirements(config)],
  };
}

function sameRequirements(left: PaymentRequirements, right: PaymentRequirements): boolean {
  return (
    left.scheme === right.scheme &&
    left.network === right.network &&
    left.asset === right.asset &&
    left.amount === right.amount &&
    left.payTo === right.payTo &&
    left.maxTimeoutSeconds === right.maxTimeoutSeconds &&
    JSON.stringify(left.extra) === JSON.stringify(right.extra)
  );
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function sendPaymentRequired(response: ServerResponse, config: z.output<typeof merchantConfigSchema>, resourceUrl: string): void {
  const challenge = paymentRequired(config, resourceUrl);
  sendJson(response, 402, challenge, { "payment-required": encodePaymentRequiredHeader(challenge) });
}

function requestUrl(request: IncomingMessage): URL {
  const host = request.headers.host;
  if (host === undefined) throw new MerchantError("InvalidRequest", 400, "Host header is required");
  try {
    return new URL(request.url ?? "/", `http://${host}`);
  } catch (error) {
    throw new MerchantError("InvalidRequest", 400, "Request URL is invalid", error);
  }
}

function discovery(config: z.output<typeof merchantConfigSchema>) {
  return {
    ok: true,
    results: [
      {
        resource: {
          id: PRODUCT_ID,
          name: "Account Summary",
          description: "A paid deterministic account summary from the reference merchant.",
          payment: { asset: "USDC", amount: "0.0025", destination: config.merchantPayTo },
          routeTemplate: `${PAID_PATH}?account={account}`,
          input: [{ name: "account", type: "string", required: true }],
        },
      },
    ],
  };
}

function summary(account: string, settlement: SettleResponse) {
  return {
    ok: true,
    account,
    summary: "Reference-merchant delivery: the submitted account is valid Stellar syntax.",
    payment: {
      transaction: settlement.transaction,
      payer: settlement.payer,
      amount: settlement.amount,
      network: settlement.network,
    },
  };
}

async function handlePaidRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: z.output<typeof merchantConfigSchema>,
  facilitator: x402Facilitator,
  url: URL,
): Promise<void> {
  const account = accountSchema.safeParse(url.searchParams.get("account"));
  if (!account.success) throw new MerchantError("InvalidRequest", 400, "account must be a Stellar classic account");

  const signature = paymentHeaderSchema.safeParse(request.headers["payment-signature"]);
  if (!signature.success) {
    sendPaymentRequired(response, config, url.toString());
    return;
  }

  let payload: PaymentPayload;
  try {
    payload = paymentPayloadSchema.parse(decodePaymentSignatureHeader(signature.data)) as PaymentPayload;
  } catch (error) {
    throw new MerchantError("InvalidPayment", 402, "PAYMENT-SIGNATURE is not a valid x402 payment payload", error);
  }

  const expected = requirements(config);
  if (!sameRequirements(payload.accepted, expected) || payload.resource?.url !== url.toString()) {
    throw new MerchantError("InvalidPayment", 402, "payment payload does not match this resource's terms");
  }

  let verified;
  try {
    verified = await facilitator.verify(payload, expected);
  } catch (error) {
    throw new MerchantError("PaymentProcessingFailed", 502, "could not verify the payment against Stellar testnet", error);
  }
  if (!verified.isValid) {
    throw new MerchantError("InvalidPayment", 402, verified.invalidMessage ?? verified.invalidReason ?? "payment verification failed");
  }

  let settled: SettleResponse;
  try {
    settled = await facilitator.settle(payload, expected);
  } catch (error) {
    throw new MerchantError("PaymentProcessingFailed", 502, "could not settle the payment on Stellar testnet", error);
  }
  if (!settled.success) {
    throw new MerchantError("PaymentProcessingFailed", 502, settled.errorMessage ?? settled.errorReason ?? "payment settlement failed");
  }

  sendJson(response, 200, summary(account.data, settled), { "payment-response": encodePaymentResponseHeader(settled) });
}

export async function startReferenceMerchant(input: MerchantConfig): Promise<{ readonly server: Server; readonly port: number; readonly close: () => Promise<void> }> {
  const config = merchantConfigSchema.parse(input);
  const facilitator = new x402Facilitator().register(
    STELLAR_TESTNET_CAIP2,
    new ExactStellarScheme([createEd25519Signer(config.facilitatorSecret, STELLAR_TESTNET_CAIP2)]),
  );

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = requestUrl(request);
        if (request.method === "GET" && url.pathname === DISCOVERY_PATH) {
          sendJson(response, 200, discovery(config));
          return;
        }
        if (request.method === "GET" && url.pathname === PAID_PATH) {
          await handlePaidRoute(request, response, config, facilitator, url);
          return;
        }
        sendJson(response, 404, { ok: false, code: "NotFound" });
      } catch (error) {
        if (error instanceof MerchantError) {
          sendJson(response, error.status, { ok: false, code: error.code, error: error.message });
          return;
        }
        sendJson(response, 500, { ok: false, code: "InternalError", error: "unexpected merchant error" });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new MerchantError("PaymentProcessingFailed", 500, "merchant did not bind a TCP port");

  return {
    server,
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error)))),
  };
}
