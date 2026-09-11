#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentPassError, isAgentPassError } from "@agentpass/core";
import { createDirectory, type Directory } from "@agentpay/directory";
import { createPostgresMandateVault, type VaultRecord } from "@agentpay/vault";
import { z } from "zod";

import {
  readMandatesStatus,
  readVaultStatus,
  type StatusDirectory,
  type VaultReaderFactory,
} from "./status.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ENV_PATH = fileURLToPath(new URL("../../../.env.local", import.meta.url));
const PORT = Number(process.env.PORT ?? 8790);
const tenantIdSchema = z.string().trim().min(1).max(200);

export interface StatusDashboardDependencies {
  readonly directory: StatusDirectory;
  readonly vaultFactory: VaultReaderFactory;
}

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };

function sendJson(response: ServerResponse, status: number, body: Json): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

function methodNotAllowed(response: ServerResponse): void {
  response.writeHead(405, { allow: "GET", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify({ error: "method_not_allowed", message: "This dashboard is read-only. Use GET." }));
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function displayRecord(record: VaultRecord): { readonly at: string; readonly kind: string; readonly amount: string; readonly detail: string } {
  const { entry } = record;
  if (entry.kind === "granted") {
    return { at: entry.at, kind: entry.kind, amount: `${entry.amount} ${entry.currency}`, detail: entry.intentId };
  }
  if (entry.kind === "refused") {
    return { at: entry.at, kind: entry.kind, amount: "—", detail: `${entry.code}: ${entry.reason}` };
  }
  return { at: entry.at, kind: entry.kind, amount: "—", detail: entry.intentId };
}

function vaultJson(records: readonly VaultRecord[]): Json[] {
  return records.map((record) => {
    const { at, kind, amount, detail } = displayRecord(record);
    return { seq: record.seq, at, kind, amount, detail, subject: record.entry.subject, hash: record.hash };
  });
}

function renderPage(tenantId: string | undefined, mandates: Awaited<ReturnType<typeof readMandatesStatus>> | undefined, vault: Awaited<ReturnType<typeof readVaultStatus>> | undefined): string {
  const mandateRows = mandates?.mandates
    .map(
      (mandate) => `<tr><td>${escapeHtml(mandate.createdAt.toISOString())}</td><td>${escapeHtml(mandate.id)}</td><td>${escapeHtml(mandate.mandateHash)}</td><td>${mandate.revokedAt === null ? "active" : "revoked"}</td></tr>`,
    )
    .join("") ?? "";
  const vaultRows = vault?.records
    .map((record) => {
      const display = displayRecord(record);
      return `<tr><td>${record.seq}</td><td>${escapeHtml(display.at)}</td><td>${escapeHtml(display.kind)}</td><td>${escapeHtml(display.amount)}</td><td>${escapeHtml(display.detail)}</td></tr>`;
    })
    .join("") ?? "";
  const health = vault === undefined ? "—" : vault.verification.ok ? "healthy" : `broken at sequence ${vault.verification.brokenAtSeq}`;
  const tenant = tenantId === undefined ? "" : escapeHtml(tenantId);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentPay status</title>
<style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#18212f}input,button{font:inherit;padding:.5rem}table{border-collapse:collapse;width:100%;margin:1rem 0 2rem}th,td{border:1px solid #c9d2dc;padding:.55rem;text-align:left;vertical-align:top;word-break:break-word}th{background:#edf2f7}.ok{color:#08783f;font-weight:700}</style>
</head><body><h1>AgentPay internal status</h1><p>Read-only operational view. It cannot start payments, revoke mandates, or write records.</p>
<form method="get"><label for="tenantId">Tenant ID</label> <input id="tenantId" name="tenantId" value="${tenant}" required> <button type="submit">Load status</button></form>
${tenantId === undefined ? "<p>Enter a tenant ID to inspect its mandate history and vault chain.</p>" : `<h2>Tenant ${tenant}</h2><h3>Vault chain: <span class="${vault?.verification.ok ? "ok" : ""}">${escapeHtml(health)}</span></h3><h3>Recent mandates</h3><table><thead><tr><th>Created</th><th>ID</th><th>Hash</th><th>Status</th></tr></thead><tbody>${mandateRows || "<tr><td colspan=\"4\">No mandates.</td></tr>"}</tbody></table><h3>Recent vault records</h3><table><thead><tr><th>Seq</th><th>At</th><th>Kind</th><th>Amount</th><th>Detail</th></tr></thead><tbody>${vaultRows || "<tr><td colspan=\"5\">No vault records.</td></tr>"}</tbody></table>`}
</body></html>`;
}

function parseTenantId(value: string | null): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AgentPassError("InvalidArguments", "tenantId query parameter is required", {
      details: { field: "tenantId" },
    });
  }
  return parsed.data;
}

function tenantIdFromPath(segment: string): string {
  try {
    return parseTenantId(decodeURIComponent(segment));
  } catch (error) {
    if (isAgentPassError(error)) throw error;
    throw new AgentPassError("InvalidArguments", "tenantId path parameter is malformed", {
      cause: error,
      details: { field: "tenantId" },
    });
  }
}

function errorResponse(response: ServerResponse, error: unknown): void {
  if (isAgentPassError(error) && error.code === "TenantNotFound") {
    sendJson(response, 404, { error: error.code, message: error.message });
    return;
  }
  if (isAgentPassError(error) && error.code === "InvalidArguments") {
    sendJson(response, 400, { error: "invalid_request", message: error.message });
    return;
  }
  console.error("[status-dashboard] unable to read status", error);
  sendJson(response, 500, { error: "status_unavailable", message: "Unable to read dashboard status." });
}

/**
 * Creates the dashboard HTTP server. Every known route is GET-only; the
 * injected dependencies expose no write operations to the route handlers.
 */
export function createStatusServer(dependencies: StatusDashboardDependencies): Server {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const vaultMatch = /^\/api\/status\/vault\/([^/]+)$/.exec(url.pathname);
    const knownRoute = url.pathname === "/" || url.pathname === "/api/status/mandates" || vaultMatch !== null;

    if (knownRoute && request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }
    if (!knownRoute) {
      sendJson(response, 404, { error: "not_found", message: "No status route matches this path." });
      return;
    }

    try {
      if (url.pathname === "/api/status/mandates") {
        const status = await readMandatesStatus(dependencies.directory, parseTenantId(url.searchParams.get("tenantId")));
        sendJson(response, 200, {
          tenant: { id: status.tenant.id, label: status.tenant.label ?? null, status: status.tenant.status },
          mandates: status.mandates.map((mandate) => ({
            id: mandate.id,
            hash: mandate.mandateHash,
            createdAt: mandate.createdAt.toISOString(),
            validFrom: mandate.validFrom.toISOString(),
            validUntil: mandate.validUntil.toISOString(),
            revokedAt: mandate.revokedAt?.toISOString() ?? null,
          })),
        });
        return;
      }
      if (vaultMatch !== null) {
        const tenantId = tenantIdFromPath(vaultMatch[1] ?? "");
        const status = await readVaultStatus(dependencies.directory, dependencies.vaultFactory, tenantId);
        sendJson(response, 200, {
          tenant: { id: status.tenant.id, label: status.tenant.label ?? null, status: status.tenant.status },
          verification: { ok: status.verification.ok, brokenAtSeq: status.verification.brokenAtSeq ?? null },
          records: vaultJson(status.records),
        });
        return;
      }

      const tenantId = url.searchParams.get("tenantId");
      if (tenantId === null) {
        sendHtml(response, 200, renderPage(undefined, undefined, undefined));
        return;
      }
      const parsedTenantId = parseTenantId(tenantId);
      const [mandates, vault] = await Promise.all([
        readMandatesStatus(dependencies.directory, parsedTenantId),
        readVaultStatus(dependencies.directory, dependencies.vaultFactory, parsedTenantId),
      ]);
      sendHtml(response, 200, renderPage(parsedTenantId, mandates, vault));
    } catch (error) {
      errorResponse(response, error);
    }
  });
}

async function databaseUrl(): Promise<string> {
  const fromProcess = process.env.DATABASE_URL;
  if (fromProcess !== undefined && fromProcess !== "") return fromProcess;
  const contents = await readFile(ENV_PATH, "utf8").catch(() => "");
  const match = /^\s*DATABASE_URL\s*=\s*"?(.*?)"?\s*$/m.exec(contents);
  if (match?.[1] === undefined || match[1] === "") {
    throw new AgentPassError("ConfigError", "DATABASE_URL is missing from .env.local and process.env", {
      details: { envPath: ENV_PATH, key: "DATABASE_URL" },
    });
  }
  return match[1];
}

async function main(): Promise<void> {
  const connectionString = await databaseUrl();
  const directory: Directory = await createDirectory({ connectionString });
  const server = createStatusServer({
    directory,
    vaultFactory: (tenantId) => createPostgresMandateVault({ connectionString, tenantId }),
  });
  server.listen(PORT, () => console.log(`Status dashboard listening on http://localhost:${PORT} (repo: ${REPO_ROOT})`));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error: unknown) => {
    console.error("[status-dashboard] failed to start", error);
    process.exitCode = 1;
  });
}
