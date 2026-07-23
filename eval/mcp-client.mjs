// Client MCP minimal (HTTP streamable) — extrait de tests/evals.mjs pour être partagé
// entre les contrôles de non-régression et le harnais d'évaluation (plan v2 §0.4).
//
// UNE session pour tous les appels : initialize -> notifications/initialized -> N tools/call.
// C'est important en volume — chaque session MCP coûte des écritures au Durable Object ;
// un processus par appel (patron Inspector CLI) a déjà épuisé un quota journalier.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Jeton d'accès (src/auth.ts) : résolu ICI plutôt que chez chaque appelant, pour qu'aucun
// des trois (tests/evals.mjs, eval/run.mjs, scripts/check-consolidation.mjs) ne puisse être
// oublié. Ordre : option explicite -> MCP_TOKEN (la CI n'a que ça) -> mcp.token à la racine
// (gitignoré, même convention que backfill.token). Absent = aucun en-tête, ce qui reste
// correct tant que le secret n'est pas posé côté Worker.
export function resolveMcpToken() {
  const fromEnv = process.env.MCP_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "mcp.token");
  return existsSync(file) ? readFileSync(file, "utf-8").trim() || null : null;
}

export function createMcpClient(url, { token } = {}) {
  const auth = token?.trim() || resolveMcpToken();
  let sessionId = null;
  let nextId = 1;

  /** Le transport peut répondre en JSON ou en SSE (`event: message\ndata: {…}`). */
  function parseBody(text, contentType) {
    if (contentType.includes("text/event-stream")) {
      const payloads = [];
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("data:")) payloads.push(line.slice(5).trim());
      }
      if (!payloads.length) throw new Error(`SSE sans data: ${text.slice(0, 200)}`);
      return JSON.parse(payloads[payloads.length - 1]);
    }
    return JSON.parse(text);
  }

  async function rpc(method, params, { notification = false } = {}) {
    const body = notification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id: nextId++, method, params };
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    if (auth) headers.Authorization = `Bearer ${auth}`;

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    if (notification) return null;
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${method} : ${text.slice(0, 300)}`);
    const msg = parseBody(text, res.headers.get("content-type") ?? "");
    if (msg.error) throw new Error(`${method} : ${msg.error.message}`);
    return msg.result;
  }

  async function connect() {
    await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "qclaw-eval-client", version: "1.0.0" },
    });
    await rpc("notifications/initialized", {}, { notification: true });
  }

  const callTool = (name, args) => rpc("tools/call", { name, arguments: args });

  return { connect, callTool, rpc };
}
