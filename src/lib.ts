// Helpers et requêtes D1 (lecture seule) pour le serveur MCP « Lois du Québec ».
// Le schéma est décrit dans schema.sql / PLAN.md §2 et schema-decouverte.sql.

import { normalize } from "./relevance";
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

/**
 * Base de tri des pseudo-articles de disposition — miroir de DISPOSITION_SORT_BASE
 * (pipeline/model.py) : ils se rangent APRÈS tout le corpus.
 */
export const DISPOSITION_SORT_BASE = 9_000_000_000_000_000;

/**
 * Clé de tri — MIROIR EXACT de sort_key() dans pipeline/model.py : packing en base 1000
 * de l'entier et de jusqu'à 4 niveaux décimaux, normalisé à 5 composantes
 * (132 < 132.0.1 < 133, et gère 350.52.0.1).
 *
 * ⚠️ Cette fonction et sa jumelle Python DOIVENT rester alignées : elles indexent la même
 * colonne `articles.sort_key`. Une divergence d'échelle rend les plages silencieusement
 * vides (le mode from/to ne trouve plus rien).
 * Max ≈ 3168 * 1000^4 ≈ 3.17e15 < 2^53 : exact en nombre JS.
 */
export function sortKeyOf(article: string): number {
  if (article === "préliminaire") return 0;
  const parts = article.split(".");
  if (!/^\d+$/.test(parts[0])) return DISPOSITION_SORT_BASE;
  const comps = parts.slice(0, 5);
  let key = 0;
  for (const p of comps) key = key * 1000 + (/^\d+$/.test(p) ? parseInt(p, 10) : 0);
  for (let i = comps.length; i < 5; i++) key *= 1000;
  return key;
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

// --- correspondance « ce chemin ou tout son sous-arbre » ----------------------
//
// Ni LIKE (où `_` est un joker, présent dans nos chemins) ni GLOB : D1 plafonne la
// COMPLEXITÉ des motifs LIKE/GLOB (« LIKE or GLOB pattern too complex »), seuil qu'un
// chemin profond du C.c.Q. dépasse (ex. `ga:l_cinquieme-gb:l_premier-gc:l_troisieme-gd:l_i-ge:l_1`).
// On passe donc par un INTERVALLE LEXICOGRAPHIQUE, sans motif, et indexable :
// les descendants d'un chemin sont exactement ceux de [path+'-', path+'.'),
// car '.' (0x2E) suit immédiatement '-' (0x2D).
function subtreeClause(col: string): string {
  return `(${col} = ? OR (${col} >= ? || '-' AND ${col} < ? || '.'))`;
}

/** Les 3 liaisons attendues par subtreeClause (le chemin, trois fois). */
function subtreeBinds(path: string): [string, string, string] {
  return [path, path, path];
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
export async function listLaws(
  db: D1Database, filters: LawFilters = {}, lang: Lang = "fr",
): Promise<LawSummary[]> {
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

  // subject_map ne contient que des chemins FR : on les traduit si une autre langue est demandée
  const traduits = new Map<string, Map<string, TranslatedPath>>();
  if (lang !== "fr") {
    for (const law of laws) {
      const paths = maps.filter((m) => m.law_id === law.id && m.division_path)
        .map((m) => m.division_path);
      if (paths.length) traduits.set(law.id, await translatePaths(db, law.id, lang, paths));
    }
  }

  return laws.map((law) => {
    const mine = counts.filter((c) => c.law_id === law.id);
    const mapped = maps.filter((m) => m.law_id === law.id);
    return {
      ...law,
      langs: mine.map((r) => r.lang).sort(),
      // décompte de la LANGUE DEMANDÉE (jamais la somme, ni le maximum des deux : quelques
      // textes ont une division de plus d'un côté, ce qui surévaluait l'autre langue).
      article_count: mine.find((r) => r.lang === lang)?.n ?? Math.max(0, ...mine.map((r) => r.n)),
      subjects: [...new Set(mapped.map((m) => m.label_fr))],
      mapped_divisions: mapped
        .filter((m) => m.division_path)
        .map((m) => {
          const t = traduits.get(law.id)?.get(m.division_path);
          return {
            division_path: t?.path ?? m.division_path,
            heading: t ? t.heading : m.heading,
            subject: m.label_fr,
          };
        }),
    };
  });
}

// --- pont entre les chemins de divisions FR et EN -----------------------------

/** Profondeur d'un chemin Irosoft (`ga:l_cinquieme-gb:l_deuxieme` -> 2). */
const depthOf = (path: string) => path.split("-").length;
const truncate = (path: string, d: number) => path.split("-").slice(0, d).join("-");

export interface TranslatedPath {
  path: string;
  heading: string | null;
}

/**
 * Traduit des chemins de divisions FRANÇAIS vers la langue demandée.
 *
 * Les identifiants Irosoft sont PROPRES À LA LANGUE (`ga:l_cinquieme` / `ga:l_five`), or
 * `subject_map` ne stocke que des chemins français. Sans traduction, une réponse en anglais
 * renvoie des chemins que get_division(lang='en') refuse — la piste est alors inexploitable.
 *
 * Le pont se fait par les NUMÉROS D'ARTICLES, invariants d'une langue à l'autre : on relie
 * les divisions par un article qu'elles partagent, puis on tronque le chemin cible à la même
 * profondeur (un Livre est à la profondeur 1, un Titre à 2, etc.).
 */
export async function translatePaths(
  db: D1Database, lawId: string, lang: Lang, frPaths: string[],
): Promise<Map<string, TranslatedPath>> {
  const out = new Map<string, TranslatedPath>();
  if (lang === "fr" || frPaths.length === 0) return out;

  const pairs = (await db
    .prepare(
      `SELECT afr.division_path AS fr_path, MIN(aen.division_path) AS other_path
       FROM articles afr
       JOIN articles aen ON aen.law_id = afr.law_id AND aen.number = afr.number AND aen.lang = ?
       WHERE afr.law_id = ? AND afr.lang = 'fr'
       GROUP BY afr.division_path`,
    )
    .bind(lang, lawId)
    .all<{ fr_path: string; other_path: string }>()).results;

  const wanted = new Map<string, string>(); // chemin traduit -> chemin FR d'origine
  for (const p of frPaths) {
    const hit = pairs.find((x) => x.fr_path === p || x.fr_path.startsWith(`${p}-`));
    if (!hit?.other_path) continue;
    const translated = truncate(hit.other_path, depthOf(p));
    if (translated) wanted.set(translated, p);
  }
  if (wanted.size === 0) return out;

  const keys = [...wanted.keys()];
  const rows = (await db
    .prepare(
      `SELECT path, heading FROM divisions
       WHERE law_id = ? AND lang = ? AND path IN (${keys.map(() => "?").join(",")})`,
    )
    .bind(lawId, lang, ...keys)
    .all<{ path: string; heading: string | null }>()).results;
  for (const r of rows) {
    const fr = wanted.get(r.path);
    if (fr) out.set(fr, { path: r.path, heading: r.heading });
  }
  return out;
}

// --- taxonomie & graphe -------------------------------------------------------

export interface SubjectSummary {
  id: string;
  label_fr: string;
  label_en: string | null;
  kind: string;
  description_fr: string | null;
  description_en: string | null;
  laws_count: number;
  divisions_count: number;
}

export async function listSubjects(db: D1Database): Promise<SubjectSummary[]> {
  return (await db
    .prepare(
      `SELECT s.id, s.label_fr, s.label_en, s.kind, s.description_fr, s.description_en,
              COUNT(DISTINCT sm.law_id) AS laws_count,
              COALESCE(SUM(CASE WHEN sm.division_path <> '' THEN 1 ELSE 0 END), 0) AS divisions_count
       FROM subjects s
       LEFT JOIN subject_map sm ON sm.subject_id = s.id
       GROUP BY s.id, s.label_fr, s.label_en, s.kind, s.description_fr, s.description_en
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

/**
 * Clé de tri d'une borne de plage : on la LIT en base quand l'article existe, au lieu de la
 * recalculer. C'est la seule façon d'être insensible à un changement d'échelle de sort_key
 * (une divergence entre le pipeline et le serveur vidait silencieusement toutes les plages).
 * Repli sur le calcul si le numéro n'existe pas (borne ouverte, ex. to='9999').
 */
export async function boundKey(
  db: D1Database, lawId: string, lang: Lang, number: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT sort_key FROM articles WHERE law_id=? AND lang=? AND number=?")
    .bind(lawId, lang, number)
    .first<{ sort_key: number }>();
  return row ? row.sort_key : sortKeyOf(number);
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
  const sub = subtreeClause("division_path");
  const subBinds = subtreeBinds(path);
  const total = (await db
    .prepare(`SELECT COUNT(*) AS n FROM articles WHERE law_id=? AND lang=? AND ${sub}`)
    .bind(lawId, lang, ...subBinds)
    .first<{ n: number }>())!.n;
  const cols = includeText
    ? "number, division_path, text, history, repealed"
    : "number, division_path, repealed";
  const rows = (await db
    .prepare(
      `SELECT ${cols} FROM articles WHERE law_id=? AND lang=? AND ${sub}
       ORDER BY sort_key LIMIT ? OFFSET ?`,
    )
    .bind(lawId, lang, ...subBinds, page.limit, page.offset)
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
        `SELECT * FROM divisions WHERE law_id=? AND lang=? AND ${subtreeClause("path")} ORDER BY sort_order`,
      )
      .bind(lawId, lang, ...subtreeBinds(rootPath))
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

// --- analyse d'une citation libre (qclaw_resolve_reference) -------------------

export interface ParsedCitation {
  law: string | null;
  article: string | null;
  /** Comment la loi a été reconnue, pour l'expliquer dans la réponse. */
  law_source: "chapitre" | "abreviation" | "defaut" | null;
  /** Chapitre RLRQ cité explicitement mais absent du corpus (pour un refus circonstancié). */
  chapitre_inconnu: string | null;
}

/**
 * Motif reconnaissant un chapitre RLRQ comme UNE UNITÉ COMPLÈTE dans une citation.
 *
 * Un simple `includes` est faux et dangereux : « B-1 » est contenu dans « B-1.1 », si bien
 * qu'une citation de la Loi sur le bâtiment (c. B-1.1, hors corpus) se résolvait
 * silencieusement en Loi sur le Barreau (c. B-1). D'où les garde-fous :
 *  - rien qui prolonge le chapitre avant ni après (lettre, chiffre, trait d'union) ;
 *  - ni un « . » SUIVI D'UN CHIFFRE après (c'est ce qui distingue B-1.1 de « c. B-1. ») ;
 *  - espaces libres à l'intérieur, pour accepter « C-25.01, r. 9 » comme « C-25.01,r.9 ».
 */
function chapterRegex(chapter: string): RegExp {
  const esc = [...chapter]
    .filter((c) => !/\s/.test(c))
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  return new RegExp(`(?<![A-Za-z0-9-])${esc}(?![A-Za-z0-9-])(?!\\.\\d)`, "i");
}

/** Mention explicite de chapitre (« c. B-1.1 », « chapitre T-16 »), pour refuser en le nommant. */
const CHAPITRE_EXPLICITE = /\b(?:c\.|chapitres?|chapters?)\s*([A-Za-z]{1,6}-[0-9][0-9.]*(?:\s*,\s*r\.\s*[0-9][0-9.]*)?)/i;

/**
 * Numéro d'article, introduit par un marqueur. « a. » est la forme courante au Québec, et
 « s. » la forme anglaise — leur absence faisait reprendre le NUMÉRO DU CHAPITRE comme
 * numéro d'article (« (chapitre T-16), a. 12 » rendait l'article 16).
 */
const MARQUEUR_ARTICLE = /(?:\barticles?\b|\barts?\.|\ba\.|\bs\.)\s*(\d+(?:\.\d+)*)/i;

/**
 * Analyse « art. 1457 C.c.Q. », « RLRQ, c. T-16, art. 12 », « article 25 C.p.c. »…
 *
 * Deux pièges que la version naïve (« premier nombre trouvé », « défaut ccq ») ne gérait
 * pas, et qui faisaient rendre SILENCIEUSEMENT le mauvais article de la mauvaise loi :
 *  1. le chapitre contient des chiffres (« c. T-16 » -> article « 16 ») : on retire donc
 *     d'abord le chapitre reconnu, puis on privilégie un numéro introduit par « art. » ;
 *  2. toute citation non reconnue retombait sur le C.c.Q. : on préfère ne rien affirmer.
 */
export function parseCitation(citation: string, laws: { id: string; rlrq_cite: string }[]): ParsedCitation {
  // chapitre RLRQ le PLUS LONG présent comme unité complète (« C-25.01, r. 9 » avant « C-25.01 »)
  let law: string | null = null;
  let lawSource: ParsedCitation["law_source"] = null;
  let bestLen = 0;
  let motif: RegExp | null = null;
  for (const l of laws) {
    const chap = l.rlrq_cite.replace(/^RLRQ,\s*c\.\s*/i, "").trim();
    if (!chap || chap.length <= bestLen) continue;
    const re = chapterRegex(chap);
    if (re.test(citation)) {
      bestLen = chap.length;
      law = l.id;
      lawSource = "chapitre";
      motif = re;
    }
  }
  // abréviations usuelles, seulement si aucun chapitre du corpus n'a été reconnu
  if (!law) {
    if (/c\.?\s*p\.?\s*c\.?|cpc/i.test(citation)) { law = "cpc"; lawSource = "abreviation"; }
    else if (/c\.?\s*c\.?\s*q\.?|ccq/i.test(citation)) { law = "ccq"; lawSource = "abreviation"; }
  }

  // On retire le chapitre reconnu AVANT de chercher le numéro d'article : sans quoi les
  // chiffres du chapitre (« T-16 ») sont pris pour l'article.
  const rest = motif ? citation.replace(motif, " ") : citation;
  const article = rest.match(MARQUEUR_ARTICLE)?.[1]
    ?? rest.match(/(\d+(?:\.\d+)*)/)?.[1]
    ?? null;

  // Chapitre explicitement cité mais inconnu du corpus : on le NOMME au lieu de retomber
  // sur une loi voisine (« c. B-1.1 » n'est pas « c. B-1 »).
  const explicite = law ? null : citation.match(CHAPITRE_EXPLICITE)?.[1]?.trim() ?? null;

  return { law, article, law_source: law ? lawSource : null, chapitre_inconnu: explicite };
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
  /** Clé `law_id|path_FR` -> cible (chemin + intitulé) dans la langue demandée. */
  mappedHeadings: Map<string, { path: string; heading: string | null }>;
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
    db.prepare("SELECT id, label_fr, label_en, label_norm, description_fr, description_en FROM subjects")
      .all<{ id: string; label_fr: string; label_en: string | null; label_norm: string;
             description_fr: string | null; description_en: string | null }>(),
    db.prepare("SELECT subject_id, law_id, division_path FROM subject_map").all<SubjectMapLite>(),
    db.prepare("SELECT id, name_fr, name_en, name_norm FROM laws")
      .all<{ id: string; name_fr: string; name_en: string; name_norm: string | null }>(),
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

  // Cibles des divisions citées par subject_map (pour nommer et ADRESSER les candidats S1).
  // Les chemins de subject_map sont français ; en anglais il faut les traduire, sinon la
  // piste renvoyée n'est pas ouvrable avec get_division(lang='en').
  const mappedHeadings = new Map<string, { path: string; heading: string | null }>();
  const parLoi = new Map<string, string[]>();
  for (const m of subjectMap.results) {
    if (!m.division_path) continue;
    const arr = parLoi.get(m.law_id);
    if (arr) { if (!arr.includes(m.division_path)) arr.push(m.division_path); }
    else parLoi.set(m.law_id, [m.division_path]);
  }
  if (lang === "fr") {
    const paths = [...new Set([...parLoi.values()].flat())];
    if (paths.length) {
      const rows = (await db
        .prepare(
          `SELECT law_id, path, heading FROM divisions
           WHERE lang = 'fr' AND path IN (${paths.map(() => "?").join(",")})`,
        )
        .bind(...paths)
        .all<{ law_id: string; path: string; heading: string | null }>()).results;
      for (const r of rows) mappedHeadings.set(`${r.law_id}|${r.path}`, { path: r.path, heading: r.heading });
    }
  } else {
    for (const [lawId, paths] of parLoi) {
      const t = await translatePaths(db, lawId, lang, paths);
      for (const [fr, cible] of t) mappedHeadings.set(`${lawId}|${fr}`, cible);
    }
  }

  // En anglais, on apparie le NOM ANGLAIS (présent en base pour les 38) : sinon le signal S3
  // était muet dès qu'une requête anglaise nommait la loi en anglais.
  const lawsLite: LawLite[] = laws.results.map((l) => ({
    id: l.id,
    name_fr: lang === "en" ? (l.name_en || l.name_fr) : l.name_fr,
    name_norm: lang === "en" ? normalize(l.name_en || l.name_fr) : l.name_norm,
  }));

  // S1 apparie le libellé ET la description : sans leur version anglaise, le signal le plus
  // lourd du routeur (+3) ne se déclenchait jamais sur une requête anglaise.
  const subjectsLite: SubjectLite[] = subjects.results.map((s) => ({
    id: s.id,
    label_fr: lang === "en" ? (s.label_en || s.label_fr) : s.label_fr,
    label_norm: lang === "en" ? normalize(s.label_en || s.label_fr) : s.label_norm,
    description_fr: lang === "en" ? (s.description_en || s.description_fr) : s.description_fr,
  }));

  return {
    subjects: subjectsLite,
    subjectMap: subjectMap.results,
    laws: lawsLite,
    divisions,
    relations: relations.results,
    mappedHeadings,
  };
}

// --- journal des recherches (plan v2, 1.6) ------------------------------------

export interface SearchLogEntry {
  tool: "search_text" | "find_relevant";
  query: string;
  law?: string | null;
  lang?: string | null;
  result_count: number;
  /** null | 'widened' | 'loo:<terme>' | 'or_relax' | 'semantic' */
  fallback?: string | null;
}

/**
 * Journalise CHAQUE appel de recherche/orientation (pas seulement les échecs :
 * result_count permet de filtrer). Échec d'insertion SILENCIEUX — un journal ne doit
 * jamais casser une recherche.
 */
export async function logSearch(db: D1Database, e: SearchLogEntry): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO search_log (tool, query, law, lang, result_count, fallback) VALUES (?,?,?,?,?,?)",
      )
      .bind(e.tool, e.query, e.law ?? null, e.lang ?? null, e.result_count, e.fallback ?? null)
      .run();
  } catch {
    // table absente (migration non appliquée) ou write refusé : on n'échoue jamais.
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
