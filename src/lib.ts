// Helpers et requêtes D1 (lecture seule) pour le serveur MCP « Lois du Québec ».
// Le schéma est décrit dans schema.sql / PLAN.md §2.

export interface LawRow {
  id: string;
  name_fr: string;
  name_en: string;
  rlrq_cite: string;
  consol_date_fr: string | null;
  consol_date_en: string | null;
}

export interface DivisionRow {
  id: number;
  law_id: string;
  lang: string;
  kind: string;
  number: string | null;
  heading: string | null;
  history: string | null;
  path: string;
  repealed: number;
  parent_id: number | null;
  sort_order: number;
}

export interface ArticleRow {
  id: number;
  law_id: string;
  lang: string;
  number: string;
  sort_key: number;
  division_id: number | null;
  division_path: string;
  text: string;
  html: string | null;
  history: string | null;
  repealed: number;
  consol_date: string | null;
}

export type Lang = "fr" | "en";

// --- clés & citations ---------------------------------------------------------

/** Clé de tri 64 bits (miroir de pipeline/model.py) : n*1e6 + d1*1e3 + d2. */
export function sortKeyOf(article: string): number {
  if (article === "préliminaire") return 0;
  if (article === "finales") return 9_000_000_000;
  const parts = article.split(".");
  const n = parseInt(parts[0], 10);
  if (Number.isNaN(n)) return -1;
  const d1 = parts[1] ? parseInt(parts[1], 10) || 0 : 0;
  const d2 = parts[2] ? parseInt(parts[2], 10) || 0 : 0;
  return n * 1_000_000 + d1 * 1_000 + d2;
}

export function citationOf(rlrqCite: string, article: string): string {
  if (article === "préliminaire") return `${rlrqCite}, disposition préliminaire`;
  if (article === "finales") return `${rlrqCite}, dispositions finales`;
  return `${rlrqCite}, art. ${article}`;
}

export function consolOf(law: LawRow | null, lang: Lang): string | null {
  if (!law) return null;
  return lang === "en" ? law.consol_date_en : law.consol_date_fr;
}

// --- pagination ---------------------------------------------------------------

export interface Page {
  limit: number;
  offset: number;
}

export function paginate(limit?: number, offset?: number, def = 50, max = 200): Page {
  const l = Math.min(Math.max(1, Math.trunc(limit ?? def)), max);
  const o = Math.max(0, Math.trunc(offset ?? 0));
  return { limit: l, offset: o };
}

// --- correspondance préfixe de chemin (sans piège LIKE : `_` est un joker) ----
// On utilise GLOB, où `_` est littéral et seuls `* ? [` sont spéciaux (absents des chemins).
function subtreeGlob(path: string): string {
  return `${path}-*`;
}

// --- requêtes -----------------------------------------------------------------

export async function getLaw(db: D1Database, lawId: string): Promise<LawRow | null> {
  return db.prepare("SELECT * FROM laws WHERE id = ?").bind(lawId).first<LawRow>();
}

export interface LawSummary extends LawRow {
  langs: string[];
  article_count: number;
}

export async function listLaws(db: D1Database): Promise<LawSummary[]> {
  const laws = (await db.prepare("SELECT * FROM laws ORDER BY id").all<LawRow>()).results;
  const out: LawSummary[] = [];
  for (const law of laws) {
    const rows = (await db
      .prepare("SELECT lang, COUNT(*) AS n FROM articles WHERE law_id = ? GROUP BY lang")
      .bind(law.id)
      .all<{ lang: string; n: number }>()).results;
    out.push({
      ...law,
      langs: rows.map((r) => r.lang),
      article_count: rows.reduce((a, r) => a + r.n, 0),
    });
  }
  return out;
}

export interface ArticleJoined extends ArticleRow {
  d_kind: string | null;
  d_number: string | null;
  d_heading: string | null;
  rlrq_cite: string;
}

export async function getArticle(
  db: D1Database, lawId: string, lang: Lang, article: string,
): Promise<ArticleJoined | null> {
  return db
    .prepare(
      `SELECT a.*, d.kind AS d_kind, d.number AS d_number, d.heading AS d_heading, l.rlrq_cite
       FROM articles a
       LEFT JOIN divisions d ON a.division_id = d.id
       JOIN laws l ON a.law_id = l.id
       WHERE a.law_id = ? AND a.lang = ? AND a.number = ?`,
    )
    .bind(lawId, lang, article)
    .first<ArticleJoined>();
}

/** Numéros d'articles voisins (par clé de tri) — pour les erreurs actionnables. */
export async function nearestArticles(
  db: D1Database, lawId: string, lang: Lang, key: number, limit = 5,
): Promise<string[]> {
  const rows = (await db
    .prepare(
      `SELECT number FROM articles WHERE law_id = ? AND lang = ?
       ORDER BY ABS(sort_key - ?) LIMIT ?`,
    )
    .bind(lawId, lang, key, limit)
    .all<{ number: string }>()).results;
  return rows.map((r) => r.number);
}

export async function articlesByRange(
  db: D1Database, lawId: string, lang: Lang, fromKey: number, toKey: number, page: Page,
): Promise<{ rows: ArticleRow[]; total: number }> {
  const [lo, hi] = fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];
  const total = (await db
    .prepare("SELECT COUNT(*) AS n FROM articles WHERE law_id=? AND lang=? AND sort_key BETWEEN ? AND ?")
    .bind(lawId, lang, lo, hi)
    .first<{ n: number }>())!.n;
  const rows = (await db
    .prepare(
      `SELECT * FROM articles WHERE law_id=? AND lang=? AND sort_key BETWEEN ? AND ?
       ORDER BY sort_key LIMIT ? OFFSET ?`,
    )
    .bind(lawId, lang, lo, hi, page.limit, page.offset)
    .all<ArticleRow>()).results;
  return { rows, total };
}

export async function articlesByNumbers(
  db: D1Database, lawId: string, lang: Lang, numbers: string[],
): Promise<ArticleRow[]> {
  if (numbers.length === 0) return [];
  const placeholders = numbers.map(() => "?").join(",");
  const rows = (await db
    .prepare(
      `SELECT * FROM articles WHERE law_id=? AND lang=? AND number IN (${placeholders})
       ORDER BY sort_key`,
    )
    .bind(lawId, lang, ...numbers)
    .all<ArticleRow>()).results;
  return rows;
}

export async function getDivision(
  db: D1Database, lawId: string, lang: Lang, by: { path?: string; id?: number },
): Promise<DivisionRow | null> {
  if (by.id != null) {
    return db.prepare("SELECT * FROM divisions WHERE id=? AND law_id=? AND lang=?")
      .bind(by.id, lawId, lang).first<DivisionRow>();
  }
  return db.prepare("SELECT * FROM divisions WHERE law_id=? AND lang=? AND path=?")
    .bind(lawId, lang, by.path ?? "").first<DivisionRow>();
}

export async function childDivisions(db: D1Database, parentId: number): Promise<DivisionRow[]> {
  return (await db
    .prepare("SELECT * FROM divisions WHERE parent_id=? ORDER BY sort_order")
    .bind(parentId)
    .all<DivisionRow>()).results;
}

/** Articles d'une division ET de tout son sous-arbre (division_path = path ou descendant). */
export async function articlesInDivision(
  db: D1Database, lawId: string, lang: Lang, path: string, page: Page, includeText: boolean,
): Promise<{ rows: Partial<ArticleRow>[]; total: number }> {
  const glob = subtreeGlob(path);
  const total = (await db
    .prepare(
      "SELECT COUNT(*) AS n FROM articles WHERE law_id=? AND lang=? AND (division_path=? OR division_path GLOB ?)",
    )
    .bind(lawId, lang, path, glob)
    .first<{ n: number }>())!.n;
  const cols = includeText
    ? "number, division_path, text, history, repealed"
    : "number, division_path, repealed";
  const rows = (await db
    .prepare(
      `SELECT ${cols} FROM articles WHERE law_id=? AND lang=? AND (division_path=? OR division_path GLOB ?)
       ORDER BY sort_key LIMIT ? OFFSET ?`,
    )
    .bind(lawId, lang, path, glob, page.limit, page.offset)
    .all<Partial<ArticleRow>>()).results;
  return { rows, total };
}

// --- arbre de structure -------------------------------------------------------

export interface StructureNode {
  path: string;
  division_id: number;
  kind: string;
  number: string | null;
  heading: string | null;
  repealed: number;
  children: StructureNode[];
}

export async function getStructure(
  db: D1Database, lawId: string, lang: Lang, rootPath?: string, depth?: number,
): Promise<StructureNode[]> {
  let rows: DivisionRow[];
  if (rootPath) {
    rows = (await db
      .prepare(
        "SELECT * FROM divisions WHERE law_id=? AND lang=? AND (path=? OR path GLOB ?) ORDER BY sort_order",
      )
      .bind(lawId, lang, rootPath, subtreeGlob(rootPath))
      .all<DivisionRow>()).results;
  } else {
    rows = (await db
      .prepare("SELECT * FROM divisions WHERE law_id=? AND lang=? ORDER BY sort_order")
      .bind(lawId, lang)
      .all<DivisionRow>()).results;
  }
  const byId = new Map<number, StructureNode>();
  for (const r of rows) {
    byId.set(r.id, {
      path: r.path, division_id: r.id, kind: r.kind, number: r.number,
      heading: r.heading, repealed: r.repealed, children: [],
    });
  }
  const roots: StructureNode[] = [];
  const inScope = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const node = byId.get(r.id)!;
    if (r.parent_id != null && inScope.has(r.parent_id)) {
      byId.get(r.parent_id)!.children.push(node);
    } else {
      roots.push(node); // racine réelle, ou racine du sous-arbre demandé
    }
  }
  if (depth != null && depth >= 0) pruneDepth(roots, depth);
  return roots;
}

function pruneDepth(nodes: StructureNode[], depth: number): void {
  for (const n of nodes) {
    if (depth <= 1) n.children = [];
    else pruneDepth(n.children, depth - 1);
  }
}

// --- recherche plein texte (FTS5) --------------------------------------------

export interface SearchHit {
  law_id: string;
  number: string;
  division_path: string;
  snippet: string;
}

/** Tokenise en requête FTS5 sûre : chaque mot en littéral quoté, combinés en ET. */
export function toFtsQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? [];
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

export async function searchText(
  db: D1Database, query: string, lang: Lang, lawId: string | undefined, page: Page,
): Promise<{ hits: SearchHit[]; total: number }> {
  const match = toFtsQuery(query);
  if (!match) return { hits: [], total: 0 };
  const lawFilter = lawId ? "AND articles_fts.law_id = ?" : "";
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM articles_fts WHERE articles_fts MATCH ? AND articles_fts.lang = ? ${lawFilter}`)
    .bind(...(lawId ? [match, lang, lawId] : [match, lang]))
    .first<{ n: number }>();
  const hits = (await db
    .prepare(
      `SELECT a.law_id, a.number, a.division_path,
              snippet(articles_fts, 0, '[', ']', '…', 12) AS snippet
       FROM articles_fts JOIN articles a ON a.id = articles_fts.rowid
       WHERE articles_fts MATCH ? AND articles_fts.lang = ? ${lawFilter}
       ORDER BY rank LIMIT ? OFFSET ?`,
    )
    .bind(...(lawId
      ? [match, lang, lawId, page.limit, page.offset]
      : [match, lang, page.limit, page.offset]))
    .all<SearchHit>()).results;
  return { hits, total: totalRow?.n ?? 0 };
}
