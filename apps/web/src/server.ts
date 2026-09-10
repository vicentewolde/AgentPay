#!/usr/bin/env node
/**
 * `pnpm run web` — T25, the simple frontend.
 *
 * A Node server (no framework — `node:http` is enough for five routes) that
 * wraps exactly what T9–T24 already built, and a static page with no build
 * step. Every secret (`ISSUER_SECRET_KEY`, `AGENT_SECRET_KEY`) stays here;
 * the browser only ever sees JSON responses.
 *
 * One demo session per browser, held in memory and keyed by a cookie — this
 * is still not a real multi-tenant app (every session signs with the same
 * `AGENT_SECRET_KEY`/`ISSUER_SECRET_KEY`, so two visitors share one Stellar
 * identity), but two people clicking through the demo at the same time no
 * longer stomp on each other's in-memory state or spend ledger. Clicking
 * "Iniciar" issues a fresh credential and Mandate, exactly like `pnpm demo`
 * does on every run.
 *
 * T34 adds real wallet-connect: a visitor who signs a one-time challenge
 * with Freighter (SEP-0053, verified server-side without ever seeing their
 * secret key) gets a cookie derived from their wallet address instead of a
 * random one, so the same wallet reconnecting lands on the same MandateVault
 * `tenant_id`. It does not yet change who signs the credential or the
 * Mandate — see `walletAddressBySession`'s docstring for why.
 *
 * The one product this can actually pay for is `swap-risk-quote` — the same
 * one `scripts/demo-real-payment.ts` (T24) proved end to end. The catalogue
 * shows the bazaar's other real products too, read-only, rather than
 * pretending every one of them is a verified payment path.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentPassCredential, CredentialRequest, Scope } from "@agentpass/core";
import {
  AGENTPASS_CREDENTIAL_TYPE,
  AGENTPASS_STATUS_TYPE,
  AgentPassError,
  VC_CONTEXT_V2,
  credentialRequestSchema,
  isAgentPassError,
  stellarAddressToDid,
  verifyStellarMessage,
} from "@agentpass/core";
import { createAgentPass, type AgentPass, type CredStatus } from "@agentpass/sdk";
import { Keypair, Networks } from "@stellar/stellar-sdk";

import {
  anchorMandate,
  createMandate,
  mandateChallengeMessage,
  prepareWalletAnchor,
  prepareWalletRevoke,
  revokeMandate,
  walletMandateHash,
  type AgentPayMandate,
} from "@agentpay/mandate";
import { createPostgresMandateVault, type MandateVault } from "@agentpay/vault";

import type { Agent, CatalogAdapter, CreatePurchaseIntentResult, MandateSource, VenueId } from "@agentpay/agent";
import {
  anchorPaymentDecision,
  createAgent,
  createBazaarCatalog,
  createLocalPolicyRail,
  createOnChainMandateVerifier,
  executeBazaarPayment,
  fillRouteTemplate,
  getBazaarServiceRoute,
  interpretPurchase,
  verifyIntent,
  withVault,
  type PolicyRail,
} from "@agentpay/agent";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ENV_PATH = resolve(REPO_ROOT, ".env.local");
const SCOPE_PATH = resolve(REPO_ROOT, "examples/scope-stellar-bazaar.json");
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

const DEFAULT_BAZAAR_BASE_URL = "https://stellar-bazaar-x402.vercel.app";
const CREDENTIAL_VALID_DAYS = 1;
const PAYABLE_PRODUCT_ID = "swap-risk-quote";
const ROUTE_PARAMS = { pair: "XLM/USDC", amount: 100, side: "buy" };
const PORT = Number(process.env.PORT ?? 8787);

const TESTNET = {
  network: "testnet",
  passphrase: Networks.TESTNET,
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
} as const;

/**
 * A read-only subset of `scripts/lib/env-file.ts`'s `.env` parser, duplicated
 * rather than imported: `apps/web` and `scripts/` sit in separate TypeScript
 * project-reference graphs (`tsc -b`'s composite build vs.
 * `tsconfig.scripts.json`'s standalone one), so a cross-import would put a
 * file outside this project's `rootDir`. The format (`KEY="value"`, `#`
 * comments) is small enough that copying it is cheaper than restructuring
 * either build.
 */
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquoteEnvValue(raw: string): string {
  const value = raw.trim();
  const first = value[0];
  const quoted = value.length >= 2 && (first === '"' || first === "'") && value[value.length - 1] === first;
  if (!quoted) return value;
  const inner = value.slice(1, -1);
  return first === '"' ? inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\") : inner;
}

async function readEnvFile(path: string): Promise<Map<string, string>> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw new AgentPassError("ConfigError", `could not read ${path}`, { cause: error, details: { path } });
  }
  const entries = new Map<string, string>();
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = ENV_LINE.exec(line);
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;
    entries.set(key, unquoteEnvValue(rawValue));
  }
  return entries;
}

/**
 * What the session needs of its own Mandate — deliberately without `.jws`,
 * unlike `AnchoredMandate` (`@agentpay/mandate`): a wallet-anchored mandate
 * has no JWS at all (T35), and everything here reads identically whichever
 * path produced it. `principalAddress` and `signature` are what a later
 * revoke needs to know whether it must go through the wallet-signed path
 * too — `signature` is `undefined` for a platform-signed mandate.
 */
interface DemoSessionMandate {
  readonly hash: string;
  readonly mandate: AgentPayMandate;
  readonly transactionHash: string;
  readonly principalAddress: string;
  readonly signature: string | undefined;
}

interface DemoSession {
  readonly agentpass: AgentPass;
  readonly agent: Agent;
  readonly catalog: CatalogAdapter;
  readonly policyRail: PolicyRail;
  readonly vault: MandateVault;
  readonly scope: Scope;
  readonly mandate: DemoSessionMandate;
  readonly credentialHash: string;
  readonly agentSecret: string;
  readonly issuerSecret: string;
  readonly baseUrl: string;
  readonly venueId: VenueId;
  /** The connected wallet that is this session's mandate principal, if any (T35). Absent is the classic, platform-signed path. */
  readonly walletAddress: string | undefined;
  /**
   * The deployed `policy_rail` smart account, when there is one
   * (`POLICY_RAIL_CONTRACT_ID`, written by `pnpm run deploy:policy-rail`).
   * Absent is a normal state: the classic-account path (T24) does not need it.
   */
  readonly railContractId: string | undefined;
}

const sessions = new Map<string, DemoSession>();

const SESSION_COOKIE = "agentpay_sid";
// Only ever set by this server (see `randomUUID()` below) — validated on the
// way back in so a forged cookie can't be used as another visitor's
// `tenantId` when reading or writing their rows in `vault_records`.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Wallet connect (T34) -------------------------------------------------

/** Nonces this server issued and hasn't consumed yet, with when they expire. */
const walletChallenges = new Map<string, number>();
const WALLET_CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * The wallet address behind each session, once `/api/wallet/verify` accepts
 * its signature. Shown back to the visitor as proof of a real connection —
 * Since T35, a connected wallet also signs its own Mandate — see
 * `startWalletSession`/`pendingWalletSessions` below. The credential's
 * issuer stays the platform (`ISSUER_SECRET_KEY`): only the Mandate's
 * principal becomes the connected wallet (`docs/fase-6-agentguard-comercializacion/DECISIONES.md → C-8`).
 */
const walletAddressBySession = new Map<string, string>();

function challengeMessage(nonce: string): string {
  return `TirevPay quiere confirmar que controlás esta wallet.\nNonce: ${nonce}`;
}

/**
 * A stable, cookie-safe id derived from a wallet address, so the same wallet
 * reconnecting always lands on the same MandateVault `tenant_id` (T33)
 * instead of a fresh random one per visit. Not a real UUID v5 (no
 * namespace/version bits) — just `sha256(address)` reshaped to satisfy
 * `SESSION_ID_RE`, since nothing downstream needs RFC 4122 compliance, only
 * a stable, collision-resistant string shaped like the ones `randomUUID()`
 * already produces.
 */
function walletTenantId(address: string): string {
  const hex = createHash("sha256").update(address, "utf8").digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ---- Wallet-signed Mandate (T35) ------------------------------------------

/**
 * A session mid-way through starting with a connected wallet as its
 * principal — the credential is already issued, the Mandate is built but
 * unsigned, and everything is waiting on the wallet to sign the consent
 * message and then the anchor transaction, in that order, across three
 * separate requests (a wallet interaction cannot happen inside one HTTP
 * request/response — the browser has to be asked, twice).
 */
interface PendingWalletSession {
  readonly agentpass: AgentPass;
  readonly issuedCredentialJws: string;
  readonly credentialHash: string;
  readonly issuerSecret: string;
  readonly mandate: AgentPayMandate;
  readonly walletAddress: string;
  readonly agentKeypair: Keypair;
  readonly demoScope: CredentialRequest;
  readonly baseUrl: string;
  /** Set once `/api/session/wallet-consent` verifies the SEP-0053 signature. */
  signature?: string;
  /** Set once the anchor transaction is prepared — names which one `wallet-anchor` finishes. */
  requestId?: string;
}
const pendingWalletSessions = new Map<string, PendingWalletSession>();
const PENDING_WALLET_SESSION_TTL_MS = 10 * 60_000;
const pendingWalletSessionExpiry = new Map<string, number>();

function stashPendingWalletSession(sessionId: string, pending: PendingWalletSession): void {
  pendingWalletSessions.set(sessionId, pending);
  pendingWalletSessionExpiry.set(sessionId, Date.now() + PENDING_WALLET_SESSION_TTL_MS);
}

/** Reads the pending session without ending it — steps 2 and 3 of the wallet flow both need to see it. */
function peekPendingWalletSession(sessionId: string): PendingWalletSession | undefined {
  const expiresAt = pendingWalletSessionExpiry.get(sessionId);
  if (expiresAt === undefined || Date.now() > expiresAt) {
    pendingWalletSessions.delete(sessionId);
    pendingWalletSessionExpiry.delete(sessionId);
    return undefined;
  }
  return pendingWalletSessions.get(sessionId);
}

function clearPendingWalletSession(sessionId: string): void {
  pendingWalletSessions.delete(sessionId);
  pendingWalletSessionExpiry.delete(sessionId);
}

/**
 * Anchoring a mandate under a wallet's address needs that address to be a
 * registered, active issuer first — the contract's own rule (`M-17`),
 * unchanged since T20. A wallet that just proved it controls its address
 * (T34) gets registered automatically, no manual approval step: this pilot
 * treats "connected and verified" as sufficient trust, a deliberate choice
 * for a testnet demo, not a production policy (`docs/fase-6-agentguard-comercializacion/DECISIONES.md`).
 */
async function ensureWalletIsRegisteredIssuer(
  agentpass: AgentPass,
  admin: Keypair,
  walletAddress: string,
): Promise<void> {
  const existing = await agentpass.issuerStatus(walletAddress);
  if (existing.registered && existing.active) return;
  const metaHash = createHash("sha256").update(walletAddress, "utf8").digest("hex");
  await agentpass.registerIssuer({ admin, issuer: walletAddress, metaHash });
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === "") continue;
    cookies.set(key, decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return cookies;
}

function readSessionId(req: IncomingMessage): string | undefined {
  const raw = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  return raw !== undefined && SESSION_ID_RE.test(raw) ? raw : undefined;
}

function getSession(req: IncomingMessage): DemoSession | undefined {
  const sessionId = readSessionId(req);
  return sessionId === undefined ? undefined : sessions.get(sessionId);
}

function withSessionCookie(res: ServerResponse, sessionId: string): void {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
}

function requireEnv(env: ReadonlyMap<string, string>, key: string): string {
  const value = env.get(key);
  if (value === undefined || value === "") {
    throw new AgentPassError("ConfigError", `${key} is missing from .env.local and process.env`, {
      details: { fix: "run `pnpm run bootstrap` and `pnpm run deploy:registry` first, or set it as an env var", key },
    });
  }
  return value;
}

async function readScope(): Promise<CredentialRequest> {
  const raw = await readFile(SCOPE_PATH, "utf8").catch((error: unknown) => {
    throw new AgentPassError("ConfigError", `could not read ${SCOPE_PATH}`, { cause: error });
  });
  const parsed = credentialRequestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new AgentPassError("ConfigError", `${SCOPE_PATH} does not match the expected shape`, {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
    });
  }
  return parsed.data;
}

/**
 * `.env.local` is how local dev sets secrets (per the project's own
 * convention — see CLAUDE.md). Render, and any other host that injects
 * config straight into the process, has no such file on disk: it sets
 * `process.env` instead. Fall back to it for any key the file doesn't
 * have, so the same code works in both places.
 */
async function readEnv(): Promise<Map<string, string>> {
  const fromFile = await readEnvFile(ENV_PATH);
  const env = new Map(fromFile);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !env.has(key)) env.set(key, value);
  }
  return env;
}

interface FinishSessionParams {
  readonly sessionId: string;
  readonly env: ReadonlyMap<string, string>;
  readonly agentpass: AgentPass;
  readonly agentKeypair: Keypair;
  readonly demoScope: CredentialRequest;
  readonly baseUrl: string;
  readonly issuedCredentialJws: string;
  readonly credentialHash: string;
  readonly issuerSecret: string;
  readonly mandate: DemoSessionMandate;
  readonly mandateSource: MandateSource;
  readonly walletAddress: string | undefined;
}

/**
 * The part of starting a session that never differs between a classic
 * (platform-signed) Mandate and a wallet-signed one (T35): the catalogue,
 * the vault, `PolicyRail`, and the agent itself only ever need a
 * `MandateSource` the agent's own `MandateVerifier` can re-check — they do
 * not know or care which kind produced it.
 */
async function finishSession(params: FinishSessionParams): Promise<DemoSession> {
  const catalog = createBazaarCatalog({ baseUrl: params.baseUrl });
  // Same vault backs both PolicyRail instances (G-5, T24) — the two
  // authorise() calls a purchase makes (structural, then against the real
  // 402) record the same intentId once, not twice. A MandateVault satisfies
  // SpendLedger structurally (T27), so it drops in wherever the ledger did;
  // withVault additionally keeps every refusal, not just every grant.
  const vault = await createPostgresMandateVault({
    connectionString: requireEnv(params.env, "DATABASE_URL"),
    tenantId: params.sessionId,
  });
  const policyRail = withVault(createLocalPolicyRail({ ledger: vault }), vault);

  const agent = await createAgent({
    credential: params.issuedCredentialJws,
    mandate: params.mandateSource,
    catalog,
    verifier: params.agentpass,
    mandateVerifier: createOnChainMandateVerifier(params.agentpass),
    signer: params.agentKeypair,
    ledger: vault,
    policyRail,
  });

  return {
    agentpass: params.agentpass,
    agent,
    catalog,
    policyRail,
    vault,
    scope: params.demoScope.scope,
    mandate: params.mandate,
    credentialHash: params.credentialHash,
    agentSecret: params.agentKeypair.secret(),
    issuerSecret: params.issuerSecret,
    baseUrl: params.baseUrl,
    venueId: catalog.venueId,
    walletAddress: params.walletAddress,
    railContractId: params.env.get("POLICY_RAIL_CONTRACT_ID"),
  };
}

export type StartSessionResult =
  | { readonly kind: "ready"; readonly session: DemoSession }
  | { readonly kind: "pending-wallet-consent"; readonly credentialHash: string; readonly challengeMessage: string };

/**
 * Mirrors `pnpm demo`'s step 2: issue a credential, then a Mandate with its
 * own (tighter) perDay. The credential's issuer is always the platform
 * (`ISSUER_SECRET_KEY`) — but if this session has a wallet connected and
 * verified (T34), the Mandate's principal becomes that wallet instead of the
 * platform, and this returns `"pending-wallet-consent"` rather than a
 * finished session: only the wallet itself can sign its own consent and its
 * own anchor transaction, which cannot happen inside this one request.
 * `/api/session/wallet-consent` and `/api/session/wallet-anchor` finish it.
 */
async function startSession(sessionId: string): Promise<StartSessionResult> {
  const env = await readEnv();
  const issuerSecret = requireEnv(env, "ISSUER_SECRET_KEY");
  const issuer = Keypair.fromSecret(issuerSecret);
  const agentKeypair = Keypair.fromSecret(requireEnv(env, "AGENT_SECRET_KEY"));
  const contractId = requireEnv(env, "AGENT_REGISTRY_CONTRACT_ID");
  const baseUrl = env.get("BAZAAR_BASE_URL") ?? DEFAULT_BAZAAR_BASE_URL;

  const [agentpass, demoScope] = await Promise.all([
    createAgentPass({
      contractId,
      rpcUrl: TESTNET.rpcUrl,
      networkPassphrase: TESTNET.passphrase,
      network: TESTNET.network,
    }),
    readScope(),
  ]);

  const issuerDid = stellarAddressToDid(issuer.publicKey(), "testnet");
  const agentDid = stellarAddressToDid(agentKeypair.publicKey(), "testnet");
  const now = new Date();
  const validUntil = new Date(now.getTime() + CREDENTIAL_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const credential: AgentPassCredential = {
    "@context": [VC_CONTEXT_V2],
    type: ["VerifiableCredential", AGENTPASS_CREDENTIAL_TYPE],
    issuer: issuerDid,
    validFrom: now.toISOString(),
    validUntil,
    credentialSubject: { id: agentDid, agent: demoScope.agent, principal: issuerDid, scope: demoScope.scope },
    credentialStatus: { type: AGENTPASS_STATUS_TYPE, registry: agentpass.config.contractId },
  };
  const issued = await agentpass.issue({ credential, issuer });

  const walletAddress = walletAddressBySession.get(sessionId);

  // Same limits as the scope, not narrower (contrast `pnpm demo`, `G-8`): a
  // real purchase authorises twice — once structurally in
  // `create_purchase_intent`, once against the real 402 in
  // `executeBazaarPayment` — and `checkDailyLimit` has no notion of
  // `intentId`, so the second call's `spentToday` already includes the
  // first call's recorded amount. A `perDay` tight enough to demonstrate a
  // rejection here would reject the very first purchase.
  const mandateDocument = createMandate({
    principal: walletAddress === undefined ? issuerDid : stellarAddressToDid(walletAddress, "testnet"),
    agent: agentDid,
    grant: demoScope.scope,
    registry: agentpass.config.contractId,
    validFrom: now.toISOString(),
    validUntil,
  });

  if (walletAddress === undefined) {
    const anchoredMandate = await anchorMandate(agentpass, { mandate: mandateDocument, principal: issuer });
    const session = await finishSession({
      sessionId,
      env,
      agentpass,
      agentKeypair,
      demoScope,
      baseUrl,
      issuedCredentialJws: issued.jws,
      credentialHash: issued.hash,
      issuerSecret,
      mandate: {
        hash: anchoredMandate.hash,
        mandate: anchoredMandate.mandate,
        transactionHash: anchoredMandate.transactionHash,
        principalAddress: issuer.publicKey(),
        signature: undefined,
      },
      mandateSource: anchoredMandate.jws,
      walletAddress: undefined,
    });
    return { kind: "ready", session };
  }

  // A wallet is connected — it must anchor its own Mandate as issuer, which
  // needs it registered first (`M-17`, automated here — `C-8`).
  await ensureWalletIsRegisteredIssuer(agentpass, Keypair.fromSecret(requireEnv(env, "ADMIN_SECRET_KEY")), walletAddress);

  stashPendingWalletSession(sessionId, {
    agentpass,
    issuedCredentialJws: issued.jws,
    credentialHash: issued.hash,
    issuerSecret,
    mandate: mandateDocument,
    walletAddress,
    agentKeypair,
    demoScope,
    baseUrl,
  });

  return { kind: "pending-wallet-consent", credentialHash: issued.hash, challengeMessage: mandateChallengeMessage(mandateDocument) };
}

interface Step {
  readonly label: string;
  readonly value: string;
}

/**
 * Mirrors `pnpm run demo:pay-real`'s steps 3-5: sign the intent, then pay for
 * real. With `viaRail`, the `policy_rail` smart account pays instead of the
 * agent's classic account (T31) — same intent, same authorisation, same
 * challenge, and one more gate: the contract re-checks `perTx`/`perDay` inside
 * the transfer itself.
 */
async function buy(
  current: DemoSession,
  instruction: string,
  viaRail: boolean,
): Promise<readonly Step[]> {
  const steps: Step[] = [];

  const products = await current.catalog.listProducts();
  const { productId, productName, quantity } = interpretPurchase(instruction, products);
  steps.push({ label: "entendido", value: `${quantity} x ${productName} (${productId})` });

  if (productId !== PAYABLE_PRODUCT_ID) {
    throw new AgentPassError(
      "NotImplemented",
      `"${productName}" está en el catálogo pero esta demo solo puede pagar "Swap Risk Quote" de verdad`,
      { details: { productId, payable: PAYABLE_PRODUCT_ID } },
    );
  }

  const intentResult = (await current.agent.tools.invoke("create_purchase_intent", {
    product_id: productId,
    quantity,
  })) as CreatePurchaseIntentResult;
  steps.push({ label: "intent_id", value: intentResult.intent_id });
  steps.push({
    label: "total",
    value: `${intentResult.total_amount} ${intentResult.asset.split(":")[0] ?? ""}`,
  });

  const verified = await verifyIntent(intentResult.jws);
  const route = await getBazaarServiceRoute({ baseUrl: current.baseUrl }, PAYABLE_PRODUCT_ID);
  const resourceUrl = fillRouteTemplate(current.baseUrl, route, ROUTE_PARAMS);
  steps.push({ label: "recurso", value: resourceUrl });

  if (viaRail && current.railContractId === undefined) {
    throw new AgentPassError(
      "ConfigError",
      "no hay ningún policy_rail desplegado — corré `pnpm run deploy:policy-rail` primero",
      { details: { missing: "POLICY_RAIL_CONTRACT_ID" } },
    );
  }
  const payer =
    viaRail && current.railContractId !== undefined
      ? { contractId: current.railContractId, ownerSecret: current.agentSecret }
      : undefined;
  steps.push({
    label: "pagador",
    value:
      payer === undefined
        ? `${Keypair.fromSecret(current.agentSecret).publicKey()} (cuenta clásica)`
        : `${payer.contractId} (policy_rail, límites on-chain)`,
  });

  const receipt = await executeBazaarPayment(
    { policyRail: current.policyRail, signerSecret: current.agentSecret, payer },
    {
      resourceUrl,
      intent: verified.intent,
      scope: current.scope,
      mandate: current.mandate.mandate,
      venueId: current.venueId,
    },
  );

  steps.push({ label: "settled", value: String(receipt.settled) });
  if (receipt.transaction !== undefined) {
    steps.push({ label: "tx", value: receipt.transaction });
    steps.push({
      label: "explorer",
      value: `https://stellar.expert/explorer/testnet/tx/${receipt.transaction}`,
    });
    await anchorSettledPayment(current, intentResult.intent_id, receipt.transaction, steps);
  }
  return steps;
}

/**
 * T28: anchors `paymentLinkHash(record, paymentTx)` against `agent_registry`
 * — the companion transaction `V-3` describes, closing the loop T27 could
 * not (`@x402/stellar` exposes no memo on the payment transaction itself).
 *
 * Best-effort, on purpose: the real payment already settled by the time this
 * runs. A failure here (network, a registry hiccup) must never unwind or
 * hide that — it is reported as its own step, not thrown, so `buy()`'s
 * caller still sees the payment succeeded even if the anchor did not.
 */
async function anchorSettledPayment(
  current: DemoSession,
  intentId: string,
  paymentTx: string,
  steps: Step[],
): Promise<void> {
  const agentKeypair = Keypair.fromSecret(current.agentSecret);
  const agentAddress = agentKeypair.publicKey();
  // The vault stores `intent.agent`, a DID (`stellarDidSchema`) — not the raw
  // address `anchorPaymentDecision`'s `subject` needs for the on-chain call.
  const agentDid = stellarAddressToDid(agentAddress, "testnet");
  const record = current.vault
    .list(agentDid)
    .find((r) => r.entry.kind === "granted" && r.entry.intentId === intentId);
  if (record === undefined) {
    // Fail-closed-by-construction (T24) guarantees `authorise()` — and so
    // `vault.record()` — ran before any payment was signed; reaching this
    // means something about that guarantee broke, worth surfacing loudly.
    steps.push({ label: "vault_anchor", value: "sin registro en el vault para este intent" });
    return;
  }

  try {
    const anchored = await anchorPaymentDecision(current.agentpass, {
      record,
      paymentTx,
      subject: agentAddress,
      expiresAt: new Date(current.mandate.mandate.validUntil),
      issuer: Keypair.fromSecret(current.issuerSecret),
    });
    await current.vault.recordAnchor({
      subject: agentDid,
      intentId,
      paymentTx,
      linkHash: anchored.linkHash,
      anchorTx: anchored.transactionHash,
    });
    steps.push({ label: "vault_anchor_hash", value: anchored.linkHash });
    steps.push({ label: "vault_anchor_tx", value: anchored.transactionHash });
  } catch (error) {
    const message = isAgentPassError(error) ? `${error.code}: ${error.message}` : String(error);
    steps.push({ label: "vault_anchor", value: `no se pudo anclar: ${message}` });
  }
}

interface RevokeResult {
  readonly mandateHash: string;
  readonly revokeTx: string;
  readonly credentialStatus: string;
}

type RevokeOutcome =
  | { readonly kind: "done"; readonly result: RevokeResult }
  | { readonly kind: "pending-wallet-signature"; readonly requestId: string; readonly xdr: string };

/**
 * The platform can revoke its own Mandate outright — it holds
 * `ISSUER_SECRET_KEY`, the key that signed it. A wallet-anchored Mandate
 * (T35) has no such key on this server: only the wallet itself, as the
 * registered issuer, can sign the revoke transaction, so this returns the
 * same "prepare, don't finish" shape `startSession`'s wallet branch does —
 * `/api/session/wallet-revoke-submit` finishes it once the wallet signs.
 */
async function revoke(current: DemoSession): Promise<RevokeOutcome> {
  if (current.walletAddress === undefined) {
    const revokeTx = await revokeMandate(current.agentpass, {
      mandateHash: current.mandate.hash,
      principal: Keypair.fromSecret(current.issuerSecret),
    });
    const credentialStatus = await current.agentpass.status(current.credentialHash);
    return { kind: "done", result: { mandateHash: current.mandate.hash, revokeTx, credentialStatus } };
  }
  const prepared = await prepareWalletRevoke(current.agentpass, {
    mandateHash: current.mandate.hash,
    principalAddress: current.walletAddress,
  });
  return { kind: "pending-wallet-signature", requestId: prepared.requestId, xdr: prepared.xdr };
}

interface WireVaultRecord {
  readonly seq: number;
  readonly kind: "granted" | "refused" | "anchored";
  readonly hash: string;
  readonly at: string;
  readonly intentId: string;
  readonly detail: string;
  /** Only for `kind: "anchored"` — a live read from the registry, not just what the vault file says. */
  readonly onChainStatus?: CredStatus;
}

interface WireIdentityRecord {
  readonly kind: "credential" | "mandate";
  readonly hash: string;
  readonly issuer: string;
  readonly subject: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
}

interface VaultReport {
  readonly chain: { readonly ok: boolean; readonly brokenAtSeq?: number };
  /**
   * What `agent_registry` itself says about the credential and the Mandato
   * — T30, indexed from the same on-chain source the vault's anchors already
   * read, not from anything this server remembers locally.
   */
  readonly identity: readonly WireIdentityRecord[];
  readonly records: readonly WireVaultRecord[];
}

/**
 * T29: turns the vault's own chain (T27) plus its anchors (T28) into
 * something a human can read — the "evidencia consultable" §4.5 asks for.
 * The anchored entries' `onChainStatus` is a live call to the registry, not
 * a cached value, so the page proves the anchor still holds rather than
 * repeating what the vault file merely claims. T30 adds the credential's
 * and the Mandato's own anchored records, from the same registry — the
 * "eventos on-chain que PolicyRail/Mandato/MandateGate ya producen" the
 * phase's own spec (`ROADMAP.md §4.5`) named as this fase's raw material.
 */
async function vaultReport(current: DemoSession): Promise<VaultReport> {
  const agentDid = stellarAddressToDid(Keypair.fromSecret(current.agentSecret).publicKey(), "testnet");
  const records = current.vault.list(agentDid);
  const chain = current.vault.verify();

  const identitySources: readonly ["credential" | "mandate", string][] = [
    ["credential", current.credentialHash],
    ["mandate", current.mandate.hash],
  ];
  const identity = (
    await Promise.all(
      identitySources.map(async ([kind, hash]): Promise<WireIdentityRecord | undefined> => {
        const record = await current.agentpass.getRecord(hash);
        if (record === undefined) return undefined;
        return {
          kind,
          hash,
          issuer: record.issuer,
          subject: record.subject,
          issuedAt: record.issuedAt.toISOString(),
          expiresAt: record.expiresAt.toISOString(),
          revoked: record.revoked,
        };
      }),
    )
  ).filter((r): r is WireIdentityRecord => r !== undefined);

  const wireRecords = await Promise.all(
    records.map(async (record): Promise<WireVaultRecord> => {
      const { entry } = record;
      const base = { seq: record.seq, hash: record.hash, kind: entry.kind, at: entry.at, intentId: entry.intentId };
      if (entry.kind === "granted") {
        return { ...base, detail: `${entry.amount} ${entry.currency}` };
      }
      if (entry.kind === "refused") {
        return { ...base, detail: `${entry.code}: ${entry.reason}` };
      }
      const onChainStatus = await current.agentpass.status(entry.linkHash).catch(() => "Unknown" as const);
      return {
        ...base,
        detail: `pago ${entry.paymentTx} · ancla ${entry.anchorTx}`,
        onChainStatus,
      };
    }),
  );

  return { chain, identity, records: wireRecords };
}

// ---- HTTP plumbing -------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

function errorBody(error: unknown): { readonly code: string; readonly message: string; readonly details: unknown } {
  if (isAgentPassError(error)) {
    return { code: error.code, message: error.message, details: error.details };
  }
  return { code: "unknown", message: String(error), details: {} };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "/index.html" : pathname === "/landing" ? "/landing.html" : pathname;
  const filePath = join(PUBLIC_DIR, relative);
  // No user input reaches this join beyond the URL pathname of a same-origin
  // GET, and every route below is fixed — but refuse a path that escapes
  // PUBLIC_DIR outright rather than trust that.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 400, { code: "InvalidArguments", message: "bad path" });
    return;
  }
  try {
    await stat(filePath);
  } catch {
    sendJson(res, 404, { code: "NotFound", message: `no route for ${pathname}` });
    return;
  }
  res.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  void handle(req, res).catch((error: unknown) => {
    sendJson(res, 500, { ok: false, ...errorBody(error) });
  });
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const { pathname } = url;

  if (req.method === "GET" && !pathname.startsWith("/api/")) {
    await serveStatic(pathname, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/products") {
    const env = await readEnv();
    const baseUrl = env.get("BAZAAR_BASE_URL") ?? DEFAULT_BAZAAR_BASE_URL;
    const products = await createBazaarCatalog({ baseUrl }).listProducts();
    sendJson(res, 200, { ok: true, products, payableProductId: PAYABLE_PRODUCT_ID });
    return;
  }

  if (req.method === "POST" && pathname === "/api/wallet/challenge") {
    const nonce = randomUUID();
    walletChallenges.set(nonce, Date.now() + WALLET_CHALLENGE_TTL_MS);
    sendJson(res, 200, { ok: true, nonce, message: challengeMessage(nonce) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/wallet/verify") {
    const body = await readJsonBody(req);
    const address = typeof body.address === "string" ? body.address : undefined;
    const nonce = typeof body.nonce === "string" ? body.nonce : undefined;
    const signature = typeof body.signature === "string" ? body.signature : undefined;
    const expiresAt = nonce === undefined ? undefined : walletChallenges.get(nonce);

    if (address === undefined || nonce === undefined || signature === undefined || expiresAt === undefined) {
      sendJson(res, 400, {
        ok: false,
        code: "InvalidArguments",
        message: "falta address, nonce o signature, o el nonce ya se usó",
      });
      return;
    }
    walletChallenges.delete(nonce); // single-use, whether or not it verifies below

    if (Date.now() > expiresAt) {
      sendJson(res, 400, { ok: false, code: "InvalidArguments", message: "el challenge venció — pedí uno nuevo" });
      return;
    }
    if (!verifyStellarMessage(address, challengeMessage(nonce), signature)) {
      sendJson(res, 400, { ok: false, code: "InvalidSignature", message: "la firma no corresponde a esa wallet" });
      return;
    }

    const sessionId = walletTenantId(address);
    walletAddressBySession.set(sessionId, address);
    withSessionCookie(res, sessionId);
    sendJson(res, 200, { ok: true, address });
    return;
  }

  if (req.method === "POST" && pathname === "/api/session/start") {
    try {
      const sessionId = readSessionId(req) ?? randomUUID();
      withSessionCookie(res, sessionId);
      const started = await startSession(sessionId);

      if (started.kind === "pending-wallet-consent") {
        sendJson(res, 200, {
          ok: true,
          pending: "wallet-consent",
          credentialHash: started.credentialHash,
          challengeMessage: started.challengeMessage,
        });
        return;
      }

      sessions.set(sessionId, started.session);
      sendJson(res, 200, {
        ok: true,
        credentialHash: started.session.credentialHash,
        mandateHash: started.session.mandate.hash,
        agentStatus: started.session.agent.credential.usable ? "Active" : "unusable",
        tools: started.session.agent.tools.list().map((tool) => tool.name),
        venue: started.session.venueId,
        perTx: `${started.session.scope.limits.perTx} ${started.session.scope.limits.currency}`,
        perDay: `${started.session.scope.limits.perDay} ${started.session.scope.limits.currency}`,
        policyRail: started.session.railContractId ?? null,
        walletAddress: walletAddressBySession.get(sessionId) ?? null,
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, ...errorBody(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/session/wallet-consent") {
    const sessionId = readSessionId(req);
    const pending = sessionId === undefined ? undefined : peekPendingWalletSession(sessionId);
    if (sessionId === undefined || pending === undefined) {
      sendJson(res, 400, {
        ok: false,
        code: "ConfigError",
        message: "no hay ninguna sesión esperando la firma de la wallet — iniciá primero",
      });
      return;
    }
    const body = await readJsonBody(req);
    const signature = typeof body.signature === "string" ? body.signature : undefined;
    if (signature === undefined) {
      sendJson(res, 400, { ok: false, code: "InvalidArguments", message: "falta signature" });
      return;
    }
    try {
      const prepared = await prepareWalletAnchor(pending.agentpass, {
        mandate: pending.mandate,
        signature,
      });
      pending.signature = signature;
      pending.requestId = prepared.requestId;
      sendJson(res, 200, { ok: true, requestId: prepared.requestId, xdr: prepared.xdr });
    } catch (error) {
      sendJson(res, 400, { ok: false, ...errorBody(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/session/wallet-anchor") {
    const sessionId = readSessionId(req);
    const pending = sessionId === undefined ? undefined : peekPendingWalletSession(sessionId);
    if (sessionId === undefined || pending === undefined || pending.signature === undefined) {
      sendJson(res, 400, {
        ok: false,
        code: "ConfigError",
        message: "no hay ninguna sesión esperando el anclaje — empezá el flujo de nuevo",
      });
      return;
    }
    const body = await readJsonBody(req);
    const requestId = typeof body.requestId === "string" ? body.requestId : undefined;
    const signedXdr = typeof body.signedXdr === "string" ? body.signedXdr : undefined;
    if (requestId === undefined || signedXdr === undefined || requestId !== pending.requestId) {
      sendJson(res, 400, { ok: false, code: "InvalidArguments", message: "falta requestId o signedXdr, o no coincide" });
      return;
    }
    try {
      const transactionHash = await pending.agentpass.submitSigned(requestId, signedXdr);
      const env = await readEnv();
      const session = await finishSession({
        sessionId,
        env,
        agentpass: pending.agentpass,
        agentKeypair: pending.agentKeypair,
        demoScope: pending.demoScope,
        baseUrl: pending.baseUrl,
        issuedCredentialJws: pending.issuedCredentialJws,
        credentialHash: pending.credentialHash,
        issuerSecret: pending.issuerSecret,
        mandate: {
          hash: walletMandateHash(pending.mandate),
          mandate: pending.mandate,
          transactionHash,
          principalAddress: pending.walletAddress,
          signature: pending.signature,
        },
        mandateSource: { mandate: pending.mandate, signature: pending.signature },
        walletAddress: pending.walletAddress,
      });
      sessions.set(sessionId, session);
      clearPendingWalletSession(sessionId);
      sendJson(res, 200, {
        ok: true,
        credentialHash: session.credentialHash,
        mandateHash: session.mandate.hash,
        agentStatus: session.agent.credential.usable ? "Active" : "unusable",
        tools: session.agent.tools.list().map((tool) => tool.name),
        venue: session.venueId,
        perTx: `${session.scope.limits.perTx} ${session.scope.limits.currency}`,
        perDay: `${session.scope.limits.perDay} ${session.scope.limits.currency}`,
        policyRail: session.railContractId ?? null,
        walletAddress: session.walletAddress ?? null,
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, ...errorBody(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/session/buy") {
    const current = getSession(req);
    if (current === undefined) {
      sendJson(res, 400, { ok: false, code: "ConfigError", message: "no active session — iniciá primero" });
      return;
    }
    const body = await readJsonBody(req);
    const instruction =
      typeof body.instruction === "string" && body.instruction.trim() !== ""
        ? body.instruction
        : "Comprame un Swap Risk Quote, por favor.";
    try {
      const steps = await buy(current, instruction, body.payer === "policy-rail");
      sendJson(res, 200, { ok: true, steps });
    } catch (error) {
      sendJson(res, 200, { ok: false, ...errorBody(error) });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/session/vault") {
    const current = getSession(req);
    if (current === undefined) {
      sendJson(res, 400, { ok: false, code: "ConfigError", message: "no active session — iniciá primero" });
      return;
    }
    try {
      const report = await vaultReport(current);
      sendJson(res, 200, { ok: true, ...report });
    } catch (error) {
      sendJson(res, 400, { ok: false, ...errorBody(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/session/revoke") {
    const current = getSession(req);
    if (current === undefined) {
      sendJson(res, 400, { ok: false, code: "ConfigError", message: "no active session — iniciá primero" });
      return;
    }
    try {
      const outcome = await revoke(current);
      if (outcome.kind === "pending-wallet-signature") {
        sendJson(res, 200, { ok: true, pending: "wallet-signature", requestId: outcome.requestId, xdr: outcome.xdr });
        return;
      }
      sendJson(res, 200, { ok: true, ...outcome.result });
    } catch (error) {
      sendJson(res, 200, { ok: false, ...errorBody(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/session/wallet-revoke-submit") {
    const current = getSession(req);
    if (current === undefined) {
      sendJson(res, 400, { ok: false, code: "ConfigError", message: "no active session — iniciá primero" });
      return;
    }
    const body = await readJsonBody(req);
    const requestId = typeof body.requestId === "string" ? body.requestId : undefined;
    const signedXdr = typeof body.signedXdr === "string" ? body.signedXdr : undefined;
    if (requestId === undefined || signedXdr === undefined) {
      sendJson(res, 400, { ok: false, code: "InvalidArguments", message: "falta requestId o signedXdr" });
      return;
    }
    try {
      const revokeTx = await current.agentpass.submitSigned(requestId, signedXdr);
      const credentialStatus = await current.agentpass.status(current.credentialHash);
      sendJson(res, 200, { ok: true, mandateHash: current.mandate.hash, revokeTx, credentialStatus });
    } catch (error) {
      sendJson(res, 200, { ok: false, ...errorBody(error) });
    }
    return;
  }

  sendJson(res, 404, { ok: false, code: "NotFound", message: `no route for ${req.method} ${pathname}` });
}

server.listen(PORT, () => {
  process.stdout.write(`\nAgentPay web · Fase 4 (T25) · http://localhost:${PORT}\n\n`);
});
