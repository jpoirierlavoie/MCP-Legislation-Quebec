import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";

import { registerTools } from "./tools";

/**
 * Serveur MCP « Lois du Québec » (qclaw-mcp).
 *
 * Expose les outils qclaw_* (PLAN §3), en lecture seule sur D1. Transport HTTP
 * streamable sur POST /mcp.
 */
export class QclawMCP extends McpAgent {
  server = new McpServer({ name: "qclaw-mcp", version: "0.1.0" });

  async init() {
    registerTools(this.server, this.env);
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
