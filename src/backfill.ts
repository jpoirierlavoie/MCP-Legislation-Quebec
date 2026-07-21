// Rattrapage des vecteurs (plan v2, 2.2) — route d'administration HORS MCP.
//
// POST /admin/backfill-vectors, active SEULEMENT si le secret BACKFILL_TOKEN est posé et
// que l'Authorization Bearer concorde. Utilise les BINDINGS (AI + VECTORS) : mêmes chemins
// de code que la requête de production, aucun scope de jeton supplémentaire. Idempotent :
// upsert par id stable (art:{law}:{num} / div:{law}:{path}) — relançable sans doublons.

import { EMBED_MODEL, breadcrumbChains } from "./lib";

/** Fenêtre bge-m3 : 60 K tokens PAR REQUÊTE, consommés comme lot × (texte le plus
 * long) — le moteur REMBOURRE tous les textes à la longueur du plus long (constaté :
 * « Max context reached 60850 » pour 50 textes de 1 217 tokens max). Contrainte réelle :
 * n × tokens(max) <= 60 000. Estimation prudente : 3,5 caractères/token (réel ~4,9). */
const EMBED_BATCH = 50;
const EMBED_TOKEN_BUDGET = 55_000;
/** Estimation d'empaquetage seulement : la vérité vient du modèle (scission sur 3030).
 * 2,0 car./token — des textes denses (énumérations d'i-16) descendent à ~2,4 réels. */
const estTokens = (chars: number) => Math.ceil(chars / 2.0);
/** Plafond du texte embeddé (~1 500 tokens — plan 2.2) ; dépassements comptés. */
const MAX_CHARS = 6000;
/** Plafond d'éléments par invocation de la route (borne le temps par requête). */
const MAX_COUNT = 250;

interface BackfillBody {
  kind: "articles" | "divisions";
  law: string;
  offset?: number;
  count?: number;
}

interface EnvWithSecrets extends Env {
  BACKFILL_TOKEN?: string;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/**
 * Id Vectorize d'une division : les ids sont plafonnés à 64 OCTETS, or un chemin Irosoft
 * profond dépasse largement (div:ccq:ga:l_cinquieme-gb:…). On hache le chemin (SHA-256,
 * 24 hex = 96 bits — collision impensable sur ~2,7 K divisions) ; le chemin complet vit
 * dans metadata.path. Stable -> upserts idempotents.
 */
async function divVectorId(law: string, path: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${law}|${path}`));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `div:${law}:${hex.slice(0, 24)}`;
}

export async function handleBackfill(request: Request, env: Env): Promise<Response> {
  try {
    return await handleBackfillInner(request, env);
  } catch (e) {
    return json({ error: `exception: ${(e as Error).message?.slice(0, 300)}` }, 500);
  }
}

async function handleBackfillInner(request: Request, env: Env): Promise<Response> {
  const secret = (env as EnvWithSecrets).BACKFILL_TOKEN;
  if (!secret) return new Response("Not found", { status: 404 }); // route inerte sans secret
  if ((request.headers.get("Authorization") ?? "") !== `Bearer ${secret}`) {
    return new Response("Non autorisé.", { status: 401 });
  }
  if (request.method !== "POST") return new Response("POST attendu.", { status: 405 });

  let body: BackfillBody;
  try {
    body = await request.json<BackfillBody>();
  } catch {
    return json({ error: "corps JSON invalide" }, 400);
  }
  const { kind, law } = body;
  if (!law || (kind !== "articles" && kind !== "divisions")) {
    return json({ error: "kind ('articles'|'divisions') et law requis" }, 400);
  }
  const offset = Math.max(0, body.offset ?? 0);
  const count = Math.min(MAX_COUNT, Math.max(1, body.count ?? MAX_COUNT));

  const db = env.DB;
  const lawRow = await db.prepare("SELECT id, name_fr FROM laws WHERE id = ?")
    .bind(law).first<{ id: string; name_fr: string }>();
  if (!lawRow) return json({ error: `loi inconnue : ${law}` }, 404);

  // --- construire les textes canoniques FR ------------------------------------
  const items: { id: string; text: string; metadata: Record<string, VectorizeVectorMetadataValue> }[] = [];
  let overruns = 0;

  if (kind === "articles") {
    const rows = (await db
      .prepare(
        `SELECT number, division_path, text FROM articles
         WHERE law_id = ? AND lang = 'fr' ORDER BY sort_key LIMIT ? OFFSET ?`,
      )
      .bind(law, count, offset)
      .all<{ number: string; division_path: string; text: string }>()).results;
    const chains = await breadcrumbChains(db, "fr",
      rows.map((r) => ({ law_id: law, division_path: r.division_path })));
    for (const r of rows) {
      const chain = chains.get(`${law}|${r.division_path}`) ?? [];
      const crumb = chain
        .map((n) => [n.kind, n.number, n.heading].filter(Boolean).join(" "))
        .join(" › ");
      let text = `${lawRow.name_fr} — ${crumb} — art. ${r.number}. ${r.text}`;
      if (text.length > MAX_CHARS) { text = text.slice(0, MAX_CHARS); overruns++; }
      const heading = [...chain].reverse().find((n) => n.heading)?.heading ?? "";
      items.push({
        id: `art:${law}:${r.number}`,
        text,
        metadata: { law, article: r.number, path: r.division_path, heading, type: "article" },
      });
    }
  } else {
    const rows = (await db
      .prepare(
        `SELECT path, heading FROM divisions
         WHERE law_id = ? AND lang = 'fr' ORDER BY sort_order LIMIT ? OFFSET ?`,
      )
      .bind(law, count, offset)
      .all<{ path: string; heading: string | null }>()).results;
    const chains = await breadcrumbChains(db, "fr",
      rows.map((r) => ({ law_id: law, division_path: r.path })));
    for (const r of rows) {
      const chain = chains.get(`${law}|${r.path}`) ?? [];
      const crumb = chain
        .map((n) => [n.kind, n.number, n.heading].filter(Boolean).join(" "))
        .join(" › ");
      items.push({
        id: await divVectorId(law, r.path),
        text: `${lawRow.name_fr} — ${crumb}`.slice(0, MAX_CHARS),
        metadata: { law, path: r.path, heading: r.heading ?? "", type: "division" },
      });
    }
  }

  // --- embed (lots bornés en items ET en caractères) puis upsert ---------------
  const batches: typeof items[] = [];
  let cur: typeof items = [];
  let curMaxChars = 0;
  for (const it of items) {
    const nextMax = Math.max(curMaxChars, it.text.length);
    const cost = (cur.length + 1) * estTokens(nextMax); // rembourrage au plus long
    if (cur.length && (cur.length >= EMBED_BATCH || cost > EMBED_TOKEN_BUDGET)) {
      batches.push(cur);
      cur = []; curMaxChars = 0;
    }
    cur.push(it);
    curMaxChars = Math.max(curMaxChars, it.text.length);
  }
  if (cur.length) batches.push(cur);

  // Embed AUTO-ADAPTATIF : l'estimation ne fait que pré-empaqueter ; si le modèle
  // répond « Max context reached » (3030), on scinde le lot en deux et on recommence —
  // jusqu'au texte seul, qui tient toujours (6 000 car. « 2 car./token = 3 000 tokens).
  async function embedSplit(texts: string[]): Promise<number[][]> {
    try {
      const res = (await env.AI.run(EMBED_MODEL as Parameters<Ai["run"]>[0], {
        text: texts,
      })) as { data?: number[][] };
      if (!res?.data || res.data.length !== texts.length) {
        throw new Error(`réponse d'embedding inattendue (data: ${res?.data?.length ?? "absent"})`);
      }
      return res.data;
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (texts.length > 1 && /3030|Max context/i.test(msg)) {
        const mid = Math.ceil(texts.length / 2);
        const [a, b] = await Promise.all([
          embedSplit(texts.slice(0, mid)),
          embedSplit(texts.slice(mid)),
        ]);
        return [...a, ...b];
      }
      throw e;
    }
  }

  let embedded = 0;
  for (const batch of batches) {
    let data: number[][];
    try {
      data = await embedSplit(batch.map((b) => b.text));
    } catch (e) {
      // JAMAIS de page HTML : le pilote a besoin d'un JSON actionnable.
      return json({
        error: `AI.run a échoué (${(e as Error).message?.slice(0, 200)})`,
        law, kind, offset, batch_size: batch.length,
        batch_chars: batch.reduce((a, b) => a + b.text.length, 0),
      }, 502);
    }
    await env.VECTORS.upsert(batch.map((b, j) => ({
      id: b.id, values: data[j], metadata: b.metadata,
    })));
    embedded += batch.length;
  }

  return json({
    kind, law, offset, embedded, overruns,
    done: items.length < count,
    next: offset + items.length,
  });
}
