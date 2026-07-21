// Rattrapage des vecteurs (plan v2, 2.2) — route d'administration HORS MCP.
//
// POST /admin/backfill-vectors, active SEULEMENT si le secret BACKFILL_TOKEN est posé et
// que l'Authorization Bearer concorde. Utilise les BINDINGS (AI + VECTORS) : mêmes chemins
// de code que la requête de production, aucun scope de jeton supplémentaire. Idempotent :
// upsert par id stable (art:{law}:{num} / div:{law}:{path}) — relançable sans doublons.

import { EMBED_MODEL, breadcrumbChains } from "./lib";

/** Textes par appel au modèle (bge-m3 accepte un tableau ; 50 = marge confortable). */
const EMBED_BATCH = 50;
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

export async function handleBackfill(request: Request, env: Env): Promise<Response> {
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
        id: `div:${law}:${r.path}`,
        text: `${lawRow.name_fr} — ${crumb}`.slice(0, MAX_CHARS),
        metadata: { law, path: r.path, heading: r.heading ?? "", type: "division" },
      });
    }
  }

  // --- embed (lots de 50) puis upsert -----------------------------------------
  let embedded = 0;
  for (let i = 0; i < items.length; i += EMBED_BATCH) {
    const batch = items.slice(i, i + EMBED_BATCH);
    const res = (await env.AI.run(EMBED_MODEL as Parameters<Ai["run"]>[0], {
      text: batch.map((b) => b.text),
    })) as { data?: number[][] };
    if (!res?.data || res.data.length !== batch.length) {
      return json({ error: `réponse d'embedding inattendue (data: ${res?.data?.length ?? "absent"})` }, 502);
    }
    await env.VECTORS.upsert(batch.map((b, j) => ({
      id: b.id, values: res.data![j], metadata: b.metadata,
    })));
    embedded += batch.length;
  }

  return json({
    kind, law, offset, embedded, overruns,
    done: items.length < count,
    next: offset + items.length,
  });
}
