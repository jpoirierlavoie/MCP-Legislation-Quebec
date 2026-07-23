import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";

import { gateMcp } from "./auth";
import { handleBackfill } from "./backfill";
import { registerTools } from "./tools";

/**
 * Serveur MCP « Lois du Québec » (qclaw-mcp).
 *
 * Expose les outils qclaw_* (PLAN §3), en lecture seule sur D1. Transport HTTP
 * streamable sur POST /mcp.
 */
/**
 * Orientation générale renvoyée à l'initialisation (plan-couche-decouverte §6.2).
 * Deuxième canal de fiabilité après les sorties d'outils : il énonce le patron en deux
 * temps (s'orienter, puis extraire) et le caractère heuristique du repérage.
 */
const INSTRUCTIONS =
  "Corpus large (lois, règlements de procédure, tarifs du Québec). Pour repérer les sources " +
  "pertinentes d'un problème, commencer par qclaw_find_relevant ou qclaw_list_laws, puis cibler " +
  "avec get_structure → get_division/get_article. L'aide au repérage est heuristique : toujours " +
  "vérifier le texte.";

export class QclawMCP extends McpAgent {
  server = new McpServer(
    { name: "qclaw-mcp", version: "0.2.0" },
    { instructions: INSTRUCTIONS },
  );

  async init() {
    registerTools(this.server, this.env);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      // Pas d'annonce du chemin MCP : une fois MCP_TOKEN posé, il répond 404 sans jeton.
      return new Response("qclaw-mcp", { status: 200 });
    }
    // Accès sous jeton partagé (src/auth.ts). Vérifié ICI, donc avant toute instanciation
    // du Durable Object : un appel non autorisé ne coûte ni session DO, ni D1, ni Workers AI.
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const authorized = gateMcp(request, url, env);
      if (!authorized) return new Response("Not found", { status: 404 });
      return QclawMCP.serve("/mcp").fetch(authorized, env, ctx);
    }
    // Administration (plan v2, 2.2) : rattrapage des vecteurs. HORS MCP ; inerte sans
    // le secret BACKFILL_TOKEN, et exige l'Authorization Bearer correspondante.
    if (url.pathname === "/admin/backfill-vectors") {
      return handleBackfill(request, env);
    }
    return new Response("Not found", { status: 404 });
  },
};
