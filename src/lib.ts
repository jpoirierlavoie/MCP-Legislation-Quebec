// Helpers et requêtes D1 (lecture seule) pour le serveur MCP « Lois du Québec ».
// Le schéma est décrit dans schema.sql / PLAN.md §2 et schema-decouverte.sql.

import type {
  DivisionLite, LawLite, RelationLite, SubjectLite, SubjectMapLite,
} from "./relevance";

export interface LawRow {
  id: string;
  name_fr: string;
  name_en: string;
  rlrq_cite: string;
  consol_date_fr: string | null;
  consol_date_en: string | null;
  // colonnes de la couche découverte (schema-decouverte.sql)
  fonction: string | null;
  forum: string | null;          // multi-valeurs jointes par ' ; '
  scope_fr: string | null;       // repli d'affichage : name_fr
  parent_law_id: string | null;  // loi habilitante d'un règlement
  name_norm: string | null;
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

export interface MappedDivision {
  division_path: string;
  heading: string | null;
  subject: string;
}

export interface LawSummary extends LawRow {
  langs: string[];
  article_count: number;
  /** Libellés des sujets rattachés (taxonomie). */
  subjects: string[];
  /** Divisions précises rattachées à un sujet (pour les grands codes : les Livres). */
  mapped_divisions: MappedDivision[];
}

export interface LawFilters {
  fonction?: string;
  forum?: string;
  subject?: string;
}

/**
 * Carte du corpus (§4.1) : lois enrichies (fonction, forum, sujets, portée, loi habilitante).
 * Trois requêtes agrégées au total — pas de N+1.
 */
export async function listLaws(db: D1Database, filters: LawFilters = {}): Promise<LawSummary[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filters.fonction) {
    where.push("l.fonction = ?");
    binds.push(filters.fonction);
  }
  if (filters.forum) {
    // forum est multi-valué (' ; ') : on cherche l'occurrence
    where.push("l.forum LIKE ?");
    binds.push(`%${filters.forum}%`);
  }
  if (filters.subject) {
    where.push("EXISTS (SELECT 1 FROM subject_map sm WHERE sm.law_id = l.id AND sm.subject_id = ?)");
    binds.push(filters.subject);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const laws = (await db.prepare(`SELECT l.* FROM laws l ${clause} ORDER BY l.id`)
    .bind(...binds).all<LawRow>()).results;

  const counts = (await db
    .prepare("SELECT law_id, lang, COUNT(*) AS n FROM articles GROUP BY law_id, lang")
    .all<{ law_id: string; lang: string; n: number }>()).results;
  const maps = (await db
    .prepare(
      `SELECT sm.law_id, sm.division_path, s.label_fr, d.heading
       FROM subject_map sm
       JOIN subjects s ON s.id = sm.subject_id
       LEFT JOIN divisions d ON d.law_id = sm.law_id AND d.path = sm.division_path AND d.lang = 'fr'
       ORDER BY sm.law_id, sm.division_path`,
    )
    .all<{ law_id: string; division_path: string; label_fr: string; heading: string | null }>()).results;

  return laws.map((law) => {
    const mine = counts.filter((c) => c.law_id === law.id);
    const mapped = maps.filter((m) => m.law_id === law.id);
    return {
      ...law,
      langs: mine.map((r) => r.lang).sort(),
      // par langue (fr et en ont le même décompte) — pas la somme des langues
      article_count: Math.max(0, ...mine.map((r) => r.n)),
      subjects: [...new Set(mapped.map((m) => m.label_fr))],
      mapped_divisions: mapped
        .filter((m) => m.division_path)
        .map((m) => ({ division_path: m.division_path, heading: m.heading, subject: m.label_fr })),
    };
  });
}

// --- taxonomie & graphe -------------------------------------------------------

export interface SubjectSummary {
  id: string;
  label_fr: string;
  label_en: string | null;
  kind: string;
  description_fr: string | null;
  laws_count: number;
  divisions_count: number;
}

export async function listSubjects(db: D1Database): Promise<SubjectSummary[]> {
  return (await db
    .prepare(
      `SELECT s.id, s.label_fr, s.label_en, s.kind, s.description_fr,
              COUNT(DISTINCT sm.law_id) AS laws_count,
              COALESCE(SUM(CASE WHEN sm.division_path <> '' THEN 1 ELSE 0 END), 0) AS divisions_count
       FROM subjects s
       LEFT JOIN subject_map sm ON sm.subject_id = s.id
       GROUP BY s.id, s.label_fr, s.label_en, s.kind, s.description_fr
       ORDER BY s.kind, s.id`,
    )
    .all<SubjectSummary>()).results;
}

export interface RelationRow {
  from_law_id: string;
  to_law_id: string;
  rel_type: string;
  source: string;
  weight: number;
  in_corpus: number;
  note: string | null;
}

export interface RelationEdge extends RelationRow {
  /** 'out' : law -> autre ; 'in' : autre -> law. */
  direction: "out" | "in";
  /** Id de l'autre extrémité. */
  other_id: string;
  /** Nom de l'autre extrémité si elle est au corpus. */
  other_name: string | null;
}

export async function relatedLaws(
  db: D1Database, lawId: string, relType: string | undefined, direction: "out" | "in" | "both",
): Promise<RelationEdge[]> {
  const typeClause = relType ? "AND rel_type = ?" : "";
  const edges: RelationEdge[] = [];
  if (direction === "out" || direction === "both") {
    const rows = (await db
      .prepare(`SELECT * FROM law_relations WHERE from_law_id = ? ${typeClause}`)
      .bind(...(relType ? [lawId, relType] : [lawId]))
      .all<RelationRow>()).results;
    edges.push(...rows.map((r) => ({ ...r, direction: "out" as const, other_id: r.to_law_id, other_name: null })));
  }
  if (direction === "in" || direction === "both") {
    const rows = (await db
      .prepare(`SELECT * FROM law_relations WHERE to_law_id = ? ${typeClause}`)
      .bind(...(relType ? [lawId, relType] : [lawId]))
      .all<RelationRow>()).results;
    edges.push(...rows.map((r) => ({ ...r, direction: "in" as const, other_id: r.from_law_id, other_name: null })));
  }
  // noms des extrémités présentes au corpus
  const ids = [...new Set(edges.filter((e) => e.in_corpus).map((e) => e.other_id))];
  if (ids.length) {
    const rows = (await db
      .prepare(`SELECT id, name_fr FROM laws WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ id: string; name_fr: string }>()).results;
    const byId = new Map(rows.map((r) => [r.id, r.name_fr]));
    for (const e of edges) e.other_name = byId.get(e.other_id) ?? null;
  }
  // les plus significatives d'abord : curées, puis poids décroissant
  return edges.sort((a, b) =>
    (a.source === "cure" ? 0 : 1) - (b.source === "cure" ? 0 : 1) ||
    b.weight - a.weight ||
    a.other_id.localeCompare(b.other_id));
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

// --- données de pertinence (qclaw_find_relevant) ------------------------------

/** Plafond de divisions préfiltrées ramenées du SQL (le tri fin se fait en mémoire). */
const DIVISION_PREFILTER_LIMIT = 2000;

export interface RelevanceData {
  subjects: SubjectLite[];
  subjectMap: SubjectMapLite[];
  laws: LawLite[];
  divisions: DivisionLite[];
  relations: RelationLite[];
  mappedHeadings: Map<string, string | null>;
}

/**
 * Charge le nécessaire au classement. Les tables de découverte sont petites (28 sujets,
 * 67 mappages, 38 lois) : on les lit en entier. Seules les divisions (5 000+) sont
 * PRÉFILTRÉES en SQL par sous-chaîne ; l'ancrage au début de mot se fait ensuite en mémoire.
 */
export async function loadRelevanceData(
  db: D1Database, tokens: string[], lang: Lang,
): Promise<RelevanceData> {
  const [subjects, subjectMap, laws, relations] = await Promise.all([
    db.prepare("SELECT id, label_fr, label_norm, description_fr FROM subjects").all<SubjectLite>(),
    db.prepare("SELECT subject_id, law_id, division_path FROM subject_map").all<SubjectMapLite>(),
    db.prepare("SELECT id, name_fr, name_norm FROM laws").all<LawLite>(),
    db.prepare(
      "SELECT from_law_id, to_law_id, rel_type, source, in_corpus, note FROM law_relations " +
      "WHERE source = 'cure' OR rel_type = 'reglement-de'",
    ).all<RelationLite>(),
  ]);

  let divisions: DivisionLite[] = [];
  if (tokens.length) {
    const ors = tokens.map(() => "heading_norm LIKE ?").join(" OR ");
    divisions = (await db
      .prepare(
        `SELECT law_id, path, heading, heading_norm FROM divisions
         WHERE lang = ? AND heading_norm IS NOT NULL AND (${ors}) LIMIT ?`,
      )
      .bind(lang, ...tokens.map((t) => `%${t}%`), DIVISION_PREFILTER_LIMIT)
      .all<DivisionLite>()).results;
  }

  // intitulés des divisions citées par subject_map (pour nommer les candidats S1)
  const paths = [...new Set(subjectMap.results.filter((m) => m.division_path).map((m) => m.division_path))];
  const mappedHeadings = new Map<string, string | null>();
  if (paths.length) {
    const rows = (await db
      .prepare(
        `SELECT law_id, path, heading FROM divisions
         WHERE lang = ? AND path IN (${paths.map(() => "?").join(",")})`,
      )
      .bind(lang, ...paths)
      .all<{ law_id: string; path: string; heading: string | null }>()).results;
    for (const r of rows) mappedHeadings.set(`${r.law_id}|${r.path}`, r.heading);
  }

  return {
    subjects: subjects.results,
    subjectMap: subjectMap.results,
    laws: laws.results,
    divisions,
    relations: relations.results,
    mappedHeadings,
  };
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
