// Contrôle d'accès de l'endpoint MCP — jeton partagé, vérifié AVANT le Durable Object.
//
// DEUX porteurs acceptés, parce qu'aucun ne couvre tous les clients :
//   - segment de chemin `/mcp/<jeton>` — le connecteur claude.ai ne prend qu'une URL,
//     son formulaire n'a pas de champ d'en-tête personnalisé ;
//   - `Authorization: Bearer <jeton>` — Claude Code, les évals, la veille CI.
// Le segment de chemin est retiré avant de servir : McpAgent.serve("/mcp") n'apparie
// que le chemin de montage exact.
//
// INERTE SANS SECRET (R8) : si `MCP_TOKEN` n'est pas posé, `/mcp` reste ouvert — c'est
// l'état d'avant. Le rollback est donc `wrangler secret delete MCP_TOKEN`, pas un revert,
// et `wrangler dev` reste utilisable sans rien configurer.
//
// UN REFUS RÉPOND 404, JAMAIS 401 : un 401 (a fortiori avec `WWW-Authenticate`) annonce
// un serveur MCP et déclenche la découverte OAuth côté client. Ici on veut que l'endpoint
// n'existe pas pour qui n'a pas le jeton. Même posture que /admin/backfill-vectors.
//
// La vérification est faite dans le handler de module, donc AVANT toute instanciation du
// Durable Object : un appel non autorisé ne coûte ni session DO, ni D1, ni Workers AI.

interface EnvWithMcpToken extends Env {
  MCP_TOKEN?: string;
}

const MOUNT = "/mcp";
const PREFIX = `${MOUNT}/`;

/**
 * Comparaison à temps constant. `===` sur des chaînes sort au premier octet différent,
 * ce qui laisse fuir le préfixe correct octet par octet. La longueur, elle, fuit —
 * c'est le compromis habituel et il est sans portée sur un jeton de longueur fixe.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Jeton porté par l'en-tête Authorization, ou null. */
function bearerOf(request: Request): string | null {
  const raw = request.headers.get("Authorization");
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/**
 * Autorise (ou non) un appel sous /mcp.
 *
 * Retourne la requête à servir — URL normalisée sur le chemin de montage, segment-jeton
 * retiré, chaîne de requête préservée — ou `null` si l'appel doit repartir en 404.
 */
export function gateMcp(request: Request, url: URL, env: Env): Request | null {
  const secret = (env as EnvWithMcpToken).MCP_TOKEN?.trim();
  const onMount = url.pathname === MOUNT;
  // Un SEUL segment après le point de montage : /mcp/<jeton>, rien de plus profond.
  const segment =
    url.pathname.startsWith(PREFIX) && !url.pathname.slice(PREFIX.length).includes("/")
      ? url.pathname.slice(PREFIX.length)
      : null;

  // Sans secret : comportement d'avant — ouvert, et sur le point de montage seul.
  if (!secret) return onMount ? request : null;

  const bearer = bearerOf(request);
  const authorized =
    (bearer !== null && safeEqual(bearer, secret)) ||
    (segment !== null && safeEqual(decodeURIComponent(segment), secret));
  if (!authorized) return null;

  if (onMount) return request;
  const normalized = new URL(url);
  normalized.pathname = MOUNT;
  return new Request(normalized.toString(), request);
}
