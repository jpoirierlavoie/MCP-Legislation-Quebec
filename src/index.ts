import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";

import { gateMcp } from "./auth";
import { handleBackfill } from "./backfill";
import { renderSite } from "./site";
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

/**
 * Sert la page publique, avec cache d'arête.
 *
 * La CLÉ DE CACHE EST FIXE ET SYNTHÉTIQUE : sans cela, `/?utm_source=…` ou tout autre
 * paramètre arbitraire créerait une entrée distincte — donc un rendu D1 de plus — pour
 * chaque variante d'URL croisée par un robot. Le corpus ne bouge que deux fois l'an ;
 * le cache n'est pas un confort mais la protection du coût de lecture (le décompte
 * d'articles balaie toute la table).
 *
 * EN DÉVELOPPEMENT LOCAL, C'EST UN PIÈGE : miniflare persiste `caches.default` dans
 * `.wrangler/state/v3/cache`, et la clé étant fixe, une page mise en cache SURVIT aux
 * rechargements à chaud ET aux redémarrages de `wrangler dev`. On modifie src/site.ts,
 * le serveur recharge, et la page servie reste l'ancienne — sans aucun signal. Pour
 * itérer sur la page : arrêter `wrangler dev`, supprimer `.wrangler/state/v3/cache`
 * (JAMAIS `.../d1`, qui porte le corpus local), redémarrer.
 */
const CACHE_KEY = "https://legislation.poirierlavoie.ca/__page";

async function servePage(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cached = await cache.match(CACHE_KEY);
  if (cached) {
    return request.method === "HEAD"
      ? new Response(null, { status: cached.status, headers: cached.headers })
      : cached;
  }
  const html = await renderSite(env.DB);
  const res = new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      // Rien n'est chargé depuis un tiers : CSS et JS sont en ligne, aucune police, aucun CDN.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
        "img-src data:; base-uri 'none'; form-action 'none'",
    },
  });
  ctx.waitUntil(cache.put(CACHE_KEY, res.clone()));
  return request.method === "HEAD"
    ? new Response(null, { status: res.status, headers: res.headers })
    : res;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      // Page publique (src/site.ts). Posture assumée : elle décrit le corpus, les outils
      // et les aides au repérage. Elle ne contient JAMAIS le jeton et n'appelle jamais
      // /mcp — elle ne le pourrait pas, src/auth.ts refusant en 404 sans porteur.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }
      return servePage(request, env, ctx);
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
