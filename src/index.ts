import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";

/**
 * Serveur MCP « Lois du Québec » (qclaw-mcp).
 *
 * Phase 1 — échafaudage : aucun outil n'est encore enregistré. Le squelette prouve
 * seulement que le transport HTTP streamable et le handshake MCP fonctionnent.
 * Les outils qclaw_* (PLAN §3) et les requêtes D1 arrivent en phase 3.
 */
export class QclawMCP extends McpAgent {
  server = new McpServer({ name: "qclaw-mcp", version: "0.1.0" });

  async init() {
    // Aucun outil en phase 1.
    // `this.env.DB` (binding D1) est disponible ici pour les futurs handlers.
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response("qclaw-mcp — endpoint MCP : POST /mcp", { status: 200 });
    }
    if (url.pathname === "/mcp") {
      return QclawMCP.serve("/mcp").fetch(request, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },
};
