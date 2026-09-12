/**
 * RealOps' HTTP surface.
 *
 * **RealOps asks; AgentPey decides.** Nothing in this file authorises a
 * payment, and nothing in it can: it holds no Stellar key, it never sees a
 * mandate, and the only thing it will ever be able to do (from T81) is call
 * `/v1` with an API key and be told yes or no. A compromised RealOps can
 * produce refusals and nothing else. That is the property the whole pilot
 * rests on, and it is worth restating in the file where a shortcut would be
 * most tempting.
 *
 * **The browser never sends a tenant id.** The session cookie resolves to an
 * account, the account resolves to its own agents, and an id in a query string
 * is never trusted to name whose data to show. `PILOTO-F9.md` § 3.4 requires
 * that; here it is structural, because no handler reads a tenant from input.
 *
 * **Magic links are redeemed by a write, not by a read.** `redeemMagicLink` is
 * the conditional update that marks the token used and reports whether *this*
 * caller was the one that marked it. Reading "is it used?" and then writing
 * "now it is" leaves a window where two requests both pass — the same class of
 * bug `C-82` closed on the funding path.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { AgentPassError, isAgentPassError } from "@agentpass/core";

import {
  agentKindSchema,
  agentPermissionsSchema,
  aliasSchema,
  checkMagicLink,
  emailSchema,
  hashToken,
  issueMagicLink,
  newAgent,
  newSession,
  sessionIsLive,
  type Account,
  type RealOpsStore,
} from "./accounts.js";
import { interpretInstruction } from "./instruction.js";
import {
  agentsPage,
  errorPage,
  homePage,
  linkSentPage,
  notRecognisedPage,
  reviewPage,
  servicesPage,
  signInPage,
} from "./pages.js";
import { translatePermissions, type PilotTargets } from "./permissions.js";

export const SESSION_COOKIE = "realops_session";

/** How the magic link reaches the person. */
export interface MagicLinkDelivery {
  /**
   * `"email"` sends it; `"onscreen"` shows it to the browser that asked.
   *
   * On-screen is a pilot fallback for before an email provider exists, and it
   * carries a real cost that the page states plainly: it does **not** verify
   * that the address belongs to whoever typed it. It is not a bypass for a
   * third party — only the browser that submitted the form sees the link — but
   * it is not proof of possession either, and pretending otherwise would be
   * the kind of quiet overstatement this project does not make.
   */
  readonly mode: "email" | "onscreen";
  readonly send?: (email: string, link: string) => Promise<void>;
}

export interface RealOpsConfig {
  readonly store: RealOpsStore;
  readonly targets: PilotTargets;
  readonly signalDeskUrl: string;
  /** This service's own origin, for building magic links. */
  readonly baseUrl: string;
  readonly delivery: MagicLinkDelivery;
  /** `Secure` on the cookie. Off only for a local http run. */
  readonly secureCookies?: boolean;
  readonly now?: () => Date;
}

function sendHtml(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  response.end(body);
}

function redirect(response: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  response.writeHead(302, { location, ...headers });
  response.end();
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function cookieFor(value: string, maxAgeSeconds: number, secure: boolean): string {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (secure) flags.push("Secure");
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // A sign-in form is a few hundred bytes. Anything larger is not a form.
    if (size > 16_384) throw new AgentPassError("InvalidArguments", "el formulario es demasiado grande");
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export function createRealOpsServer(config: RealOpsConfig): Server {
  const now = config.now ?? (() => new Date());
  const secure = config.secureCookies ?? true;

  /** The signed-in account, or `undefined`. The only way a handler learns who is asking. */
  async function currentAccount(request: IncomingMessage): Promise<Account | undefined> {
    const sessionId = readCookie(request, SESSION_COOKIE);
    if (sessionId === undefined) return undefined;
    const session = await config.store.findSession(sessionId);
    if (!sessionIsLive(session, now())) return undefined;
    return config.store.findAccount(session!.accountId);
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", config.baseUrl);
    const { pathname } = url;
    const method = request.method ?? "GET";

    if (method === "GET" && pathname === "/") {
      sendHtml(response, 200, homePage(config.signalDeskUrl));
      return;
    }

    if (method === "GET" && pathname === "/entrar") {
      sendHtml(response, 200, signInPage());
      return;
    }

    if (method === "POST" && pathname === "/entrar") {
      const form = await readForm(request);
      const email = emailSchema.safeParse(form.get("email"));
      const alias = aliasSchema.safeParse(form.get("alias"));
      if (!email.success || !alias.success) {
        sendHtml(response, 400, signInPage({ error: "Revisá el correo y el alias." }));
        return;
      }

      const existing = await config.store.findAccountByEmail(email.data);
      const account = existing ?? (await config.store.createAccount(email.data, alias.data));
      const issued = issueMagicLink(account.id, now());
      await config.store.saveMagicLink(issued.link);

      const link = `${config.baseUrl.replace(/\/+$/, "")}/entrar/${issued.token}`;
      if (config.delivery.mode === "email" && config.delivery.send !== undefined) {
        await config.delivery.send(email.data, link);
        sendHtml(response, 200, linkSentPage({}));
        return;
      }
      sendHtml(response, 200, linkSentPage({ onScreenLink: link }));
      return;
    }

    if (method === "GET" && pathname.startsWith("/entrar/")) {
      const token = pathname.slice("/entrar/".length);
      const tokenHash = hashToken(token);
      const link = await config.store.findMagicLink(tokenHash);
      const check = checkMagicLink(link, now());
      if (!check.ok) {
        const reason =
          check.reason === "expired"
            ? "Ese enlace venció. Pedí uno nuevo."
            : check.reason === "already-used"
              ? "Ese enlace ya se usó. Los enlaces sirven una sola vez."
              : "Ese enlace no existe.";
        sendHtml(response, 400, signInPage({ error: reason }));
        return;
      }

      // The redemption *is* the write, so a replay loses the race instead of
      // tying it.
      const redeemed = await config.store.redeemMagicLink(tokenHash, now());
      if (!redeemed) {
        sendHtml(response, 400, signInPage({ error: "Ese enlace ya se usó. Los enlaces sirven una sola vez." }));
        return;
      }

      const session = newSession(link!.accountId, now());
      await config.store.saveSession(session);
      await config.store.touchAccount(link!.accountId, now());
      redirect(response, "/agentes", {
        "set-cookie": cookieFor(session.id, Math.floor((session.expiresAt.getTime() - now().getTime()) / 1000), secure),
      });
      return;
    }

    if (method === "GET" && pathname === "/salir") {
      const sessionId = readCookie(request, SESSION_COOKIE);
      if (sessionId !== undefined) await config.store.deleteSession(sessionId);
      redirect(response, "/", { "set-cookie": cookieFor("", 0, secure) });
      return;
    }

    // Everything below needs a session. Note what is *not* here: no handler
    // takes an account or tenant id from the request.
    const account = await currentAccount(request);
    if (account === undefined) {
      redirect(response, "/entrar");
      return;
    }

    if (method === "GET" && pathname === "/agentes") {
      sendHtml(response, 200, agentsPage(account, await config.store.listAgents(account.id)));
      return;
    }

    if (method === "POST" && pathname === "/agentes") {
      const form = await readForm(request);
      const kind = agentKindSchema.safeParse(form.get("kind"));
      const label = aliasSchema.safeParse(form.get("label"));
      const permissions = agentPermissionsSchema.safeParse({
        perTx: form.get("perTx") ?? "",
        perDay: form.get("perDay") ?? "",
        validForDays: Number(form.get("validForDays") ?? Number.NaN),
      });
      if (!kind.success || !label.success || !permissions.success) {
        sendHtml(response, 400, errorPage(400, "Revisá los límites: montos en USDC y vigencia en días."));
        return;
      }

      const agent = newAgent(account.id, kind.data, label.data, permissions.data, now());
      await config.store.saveAgent(agent);
      redirect(response, `/agentes/${agent.id}`);
      return;
    }

    if (method === "GET" && pathname.startsWith("/agentes/")) {
      const agentId = pathname.slice("/agentes/".length);
      // Scoped to this account: another person's agent is a 404, not a 403 —
      // the same posture `/v1` takes, so an id cannot be probed for existence.
      const agent = await config.store.findAgent(account.id, agentId);
      if (agent === undefined) {
        sendHtml(response, 404, errorPage(404, "No existe ese agente."));
        return;
      }
      const translated = translatePermissions(agent.kind, agent.permissions, config.targets, now());
      sendHtml(response, 200, reviewPage(agent, translated.grant, translated.controls));
      return;
    }

    if (method === "GET" && pathname === "/servicios") {
      sendHtml(response, 200, servicesPage(account));
      return;
    }

    if (method === "POST" && pathname === "/instruccion") {
      const form = await readForm(request);
      const chosen = agentKindSchema.safeParse(form.get("kind"));
      if (chosen.success) {
        // The fallback buttons: a kind chosen explicitly, with nothing guessed.
        redirect(response, "/servicios");
        return;
      }
      const instruction = form.get("instruction") ?? "";
      try {
        interpretInstruction(instruction);
        redirect(response, "/servicios");
      } catch (error) {
        if (isAgentPassError(error) && error.code === "InstructionNotUnderstood") {
          sendHtml(response, 200, notRecognisedPage(error.message, String(error.details.instruction ?? "")));
          return;
        }
        throw error;
      }
      return;
    }

    if (method === "POST" && pathname === "/cuenta/borrar") {
      await config.store.forgetAccount(account.id);
      await config.store.deleteSessionsFor(account.id);
      redirect(response, "/", { "set-cookie": cookieFor("", 0, secure) });
      return;
    }

    sendHtml(response, 404, errorPage(404, "No hay nada en esa dirección."));
  }

  return createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      const status = isAgentPassError(error) && error.code === "InvalidArguments" ? 400 : 500;
      sendHtml(response, status, errorPage(status, status === 400 ? "Petición inválida." : "Algo falló de nuestro lado."));
    });
  });
}
