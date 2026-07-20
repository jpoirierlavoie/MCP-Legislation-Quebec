// Enregistrement des outils MCP « Lois du Québec » (qclaw_*). Tous en lecture seule.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  ArticleJoined, ArticleRow, Lang, LawSummary, StructureNode,
  articlesByNumbers, articlesByRange, articlesInDivision, childDivisions,
  citationOf, consolOf, getArticle, getDivision, getLaw, getStructure,
  boundKey, listLaws, listSubjects, loadRelevanceData, logSearch, nearestArticles,
  paginate, parseCitation, relatedLaws, searchText, sortKeyOf,
} from "./lib";
import { WEIGHTS, rank, tokenize } from "./relevance";

/**
 * Garde-fou imposé par le plan (§4.4) — repris TEL QUEL, à ne pas reformuler.
 * Il rappelle que la découverte est heuristique et ne décide pas du droit applicable.
 */
const GARDE_FOU =
  "Aide heuristique au repérage de lois et de parties de lois candidates. " +
  "Ne détermine PAS le droit applicable : toujours vérifier en lisant le texte via " +
  "get_structure / get_division / get_article.";

/** Rappel du patron en deux temps sur les outils d'extraction (§6.4). */
const DEUX_TEMPS =
  " Si la loi pertinente est inconnue, commencer par qclaw_find_relevant.";

const READONLY = {
  readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false,
} as const;

const LANG = z.enum(["fr", "en"]).default("fr").describe("Langue : 'fr' (défaut) ou 'en'.");

// Libellés de type de division, par langue (l'anglais dit « Division » pour la « Section »).
const KIND_LABEL: Record<Lang, Record<string, string>> = {
  fr: {
    livre: "Livre", titre: "Titre", chapitre: "Chapitre", section: "Section",
    "sous-section": "Sous-section", niveau6: "Niveau", niveau7: "Niveau", niveau8: "Niveau",
    disposition: "Disposition", annexe: "Annexe",
  },
  en: {
    livre: "Book", titre: "Title", chapitre: "Chapter", section: "Division",
    "sous-section": "Subsection", niveau6: "Level", niveau7: "Level", niveau8: "Level",
    disposition: "Provision", annexe: "Schedule",
  },
};

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const err = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const ok = (text: string, structured?: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text }],
  ...(structured ? { structuredContent: structured } : {}),
});

function divisionLabel(kind: string, number: string | null, heading: string | null, lang: Lang): string {
  const label = (KIND_LABEL[lang] ?? KIND_LABEL.fr)[kind] ?? kind;
  const parts = [label, number ?? ""].filter(Boolean).join(" ");
  return heading ? `${parts} — ${heading}` : parts || (heading ?? "");
}

function renderArticle(a: ArticleJoined, consol: string | null, lang: Lang): string {
  const cite = citationOf(a.rlrq_cite, a.number);
  const loc = a.d_kind ? `\n${divisionLabel(a.d_kind, a.d_number, a.d_heading, lang)} [${a.division_path}]` : "";
  const head = `${cite}${consol ? ` (à jour au ${consol})` : ""}${a.repealed ? " — ABROGÉ" : ""}${loc}`;
  const hist = a.history ? `\n\nHistorique : ${a.history}` : "";
  return `${head}\n\n${a.text}${hist}`;
}

export function registerTools(server: McpServer, env: Env): void {
  const db = env.DB;

  // 1) qclaw_list_laws ---------------------------------------------------------
  const renderLaw = (l: LawSummary): string => {
    const attrs = [
      l.fonction ? `fonction: ${l.fonction}` : null,
      l.forum ? `forum: ${l.forum}` : null,
      l.parent_law_id ? `loi habilitante: ${l.parent_law_id}` : null,
      l.subjects.length ? `matières: ${l.subjects.join(", ")}` : null,
    ].filter(Boolean).join(" ; ");
    const head =
      `• ${l.id} — ${l.name_fr} / ${l.name_en} (${l.rlrq_cite}) ; ` +
      `langues: ${l.langs.join(", ") || "aucune"} ; ` +
      `à jour au ${l.consol_date_fr ?? "?"}${l.consol_date_en ? ` (en: ${l.consol_date_en})` : ""} ; ` +
      `${l.article_count} articles`;
    // portée : repli sur name_fr tant que la passe éditoriale scope_fr n'est pas faite (§5)
    const scope = l.scope_fr ? `\n    portée: ${l.scope_fr}` : "";
    // pour les grands codes : les divisions rattachées à une matière (les Livres du C.c.Q.)
    const divs = l.mapped_divisions.length
      ? "\n" + l.mapped_divisions
        .map((d) => `    ◦ ${d.heading ?? d.division_path} [${d.division_path}] — ${d.subject}`)
        .join("\n")
      : "";
    return `${head}${attrs ? `\n    ${attrs}` : ""}${scope}${divs}`;
  };

  server.registerTool(
    "qclaw_list_laws",
    {
      description:
        "Carte du corpus : toutes les lois avec identifiant, noms FR/EN, citation RLRQ, langues, " +
        "date de consolidation, nombre d'articles, et les attributs de découverte (fonction, forum, " +
        "matières, loi habilitante ; pour les grands codes, les Livres avec leur matière). " +
        "Filtres optionnels : fonction, forum, subject. Point de départ pour explorer le corpus ; " +
        "pour partir d'un problème concret, préférer qclaw_find_relevant.",
      inputSchema: {
        fonction: z.string().optional()
          .describe("Filtrer par fonction : 'loi', 'regles-procedure', 'tarif', 'reglement'."),
        forum: z.string().optional()
          .describe("Filtrer par forum, ex. 'Tribunal administratif du logement', 'Cour d'appel'."),
        subject: z.string().optional()
          .describe("Filtrer par identifiant de matière, ex. 'louage-residentiel' (cf. qclaw_list_subjects)."),
        lang: LANG.optional(),
      },
      annotations: READONLY,
    },
    async ({ fonction, forum, subject, lang }) => {
      const laws = await listLaws(db, { fonction, forum, subject }, lang as Lang);
      if (laws.length === 0) {
        const applied = [
          fonction ? `fonction='${fonction}'` : null,
          forum ? `forum='${forum}'` : null,
          subject ? `subject='${subject}'` : null,
        ].filter(Boolean).join(", ");
        return err(
          applied
            ? `Aucune loi pour ${applied}. Vérifiez les valeurs (qclaw_list_subjects pour les matières) ` +
              "ou appelez qclaw_list_laws sans filtre."
            : "Aucune loi chargée dans la base.",
        );
      }
      const header = `${laws.length} loi(s) au corpus :`;
      return ok(`${header}\n${laws.map(renderLaw).join("\n")}`, {
        filters: { fonction: fonction ?? null, forum: forum ?? null, subject: subject ?? null },
        count: laws.length,
        laws: laws.map((l) => ({
          id: l.id, name_fr: l.name_fr, name_en: l.name_en, rlrq_cite: l.rlrq_cite,
          langs: l.langs, consol_date_fr: l.consol_date_fr, consol_date_en: l.consol_date_en,
          article_count: l.article_count,
          fonction: l.fonction, forum: l.forum,
          scope: l.scope_fr ?? l.name_fr, parent_law_id: l.parent_law_id,
          subjects: l.subjects, mapped_divisions: l.mapped_divisions,
        })),
      });
    },
  );

  // 1b) qclaw_list_subjects ----------------------------------------------------
  server.registerTool(
    "qclaw_list_subjects",
    {
      description:
        "Liste les matières de la taxonomie (droit privé du C.c.Q. et matières spécialisées) : " +
        "identifiant, libellé, description, et nombre de lois / divisions rattachées. " +
        "Sert à choisir un domaine, puis à filtrer qclaw_list_laws (subject=…).",
      inputSchema: { lang: LANG.optional() },
      annotations: READONLY,
    },
    async ({ lang }) => {
      const en = lang === "en";
      const subs = await listSubjects(db);
      if (subs.length === 0) return err("Aucune matière chargée (taxonomie absente).");
      const KIND: Record<string, string> = en
        ? { "prive-ccq": "Private law (C.C.Q.)", specialise: "Specialized areas" }
        : { "prive-ccq": "Droit privé (C.c.Q.)", specialise: "Matières spécialisées" };
      const libelle = (s: typeof subs[number]) => (en ? s.label_en || s.label_fr : s.label_fr);
      const descr = (s: typeof subs[number]) => (en ? s.description_en || s.description_fr : s.description_fr);
      const groups = new Map<string, typeof subs>();
      for (const s of subs) {
        const g = groups.get(s.kind);
        if (g) g.push(s); else groups.set(s.kind, [s]);
      }
      const body = [...groups.entries()].map(([kind, items]) =>
        `\n${KIND[kind] ?? kind} :\n` + items.map((s) =>
          `  • ${s.id} — ${libelle(s)} (${s.laws_count} ${en ? "law(s)" : "loi(s)"}` +
          `${s.divisions_count ? `, ${s.divisions_count} division(s)` : ""})` +
          `${descr(s) ? `\n      ${descr(s)}` : ""}`,
        ).join("\n"),
      ).join("\n");
      return ok(`${subs.length} ${en ? "subject areas" : "matières"} :${body}`, {
        count: subs.length,
        subjects: subs.map((s) => ({
          id: s.id, label_fr: s.label_fr, label_en: s.label_en, kind: s.kind,
          label: libelle(s), description: descr(s),
          description_fr: s.description_fr, description_en: s.description_en,
          laws_count: s.laws_count, divisions_count: s.divisions_count,
        })),
      });
    },
  );

  // 1c) qclaw_related_laws -----------------------------------------------------
  server.registerTool(
    "qclaw_related_laws",
    {
      description:
        "Graphe d'interconnexion d'une loi : règlements pris sous son autorité, loi habilitante, " +
        "renvois vers d'autres textes, et relations curées (met-en-oeuvre, applique, complète…). " +
        "Signale les cibles NON disponibles au corpus. Ex. : law='cpc' pour voir ses règlements de cour.",
      inputSchema: {
        law: z.string().describe("Identifiant de la loi, ex. 'cpc'."),
        rel_type: z.string().optional()
          .describe("Filtrer par type : 'reglement-de', 'renvoie-a', 'met-en-oeuvre', 'applique', 'complete', 'encadre-par', 'connexe'."),
        direction: z.enum(["out", "in", "both"]).default("both")
          .describe("'out' : depuis la loi ; 'in' : vers la loi ; 'both' (défaut)."),
        limit: z.number().int().min(1).max(200).optional().describe("Max d'arêtes (défaut 50, max 200)."),
        lang: LANG.optional(),
      },
      annotations: READONLY,
    },
    async ({ law, rel_type, direction, limit }) => {
      if (!(await getLaw(db, law))) {
        const all = (await listLaws(db)).map((l) => l.id).join(", ");
        return err(`Loi '${law}' inconnue. Lois disponibles : ${all || "aucune"}.`);
      }
      const all = await relatedLaws(db, law, rel_type, direction);
      if (all.length === 0) {
        return err(
          `Aucune relation pour '${law}'` +
          `${rel_type ? ` de type '${rel_type}'` : ""}` +
          `${direction !== "both" ? ` en direction '${direction}'` : ""}. ` +
          "Essayez sans filtre, ou qclaw_list_laws pour la carte du corpus.",
        );
      }
      const page = paginate(limit, 0, 50, 200);
      const edges = all.slice(0, page.limit);
      const lines = edges.map((e) => {
        const arrow = e.direction === "out" ? "→" : "←";
        const dispo = e.in_corpus
          ? (e.other_name ? ` — ${e.other_name}` : "")
          : " — NON disponible au corpus (candidat d'acquisition)";
        const w = e.rel_type === "renvoie-a" ? ` ; ${e.weight} renvoi(s)` : "";
        return `  ${arrow} ${e.other_id} [${e.rel_type}, ${e.source}${w}]${dispo}` +
          `${e.note ? `\n      ${e.note}` : ""}`;
      });
      const hors = edges.filter((e) => !e.in_corpus).length;
      const head = `${all.length} relation(s) pour '${law}'` +
        `${edges.length < all.length ? ` (${edges.length} affichées)` : ""}` +
        `${hors ? ` — dont ${hors} hors corpus` : ""} :`;
      return ok(`${head}\n${lines.join("\n")}`, {
        law, rel_type: rel_type ?? null, direction, total: all.length, count: edges.length,
        relations: edges.map((e) => ({
          direction: e.direction, other_id: e.other_id, other_name: e.other_name,
          rel_type: e.rel_type, source: e.source, weight: e.weight,
          in_corpus: !!e.in_corpus, note: e.note,
        })),
      });
    },
  );

  // 1d) qclaw_find_relevant ----------------------------------------------------
  server.registerTool(
    "qclaw_find_relevant",
    {
      description: GARDE_FOU +
        " Classement déterministe sur la matière (taxonomie), les intitulés de divisions, " +
        "les noms de lois et le graphe d'interconnexion. Ex. : query='vice caché maison', " +
        "'congédiement', 'bail commercial'. Enchaîner ensuite avec get_structure / get_division.",
      inputSchema: {
        query: z.string().describe("Thème ou description libre du problème, ex. « bail de logement »."),
        limit: z.number().int().min(1).max(50).optional().describe("Nombre de candidats (défaut 8, max 50)."),
        lang: LANG,
      },
      annotations: READONLY,
    },
    async ({ query, limit, lang }) => {
      const tokens = tokenize(query);
      const page = paginate(limit, 0, 8, 50);
      if (tokens.length === 0) {
        return err(
          `Aucun terme exploitable dans « ${query} ». Reformulez avec des mots porteurs ` +
          "(ex. « bail de logement », « congédiement »), ou consultez qclaw_list_subjects.",
        );
      }
      const data = await loadRelevanceData(db, tokens, lang as Lang);
      const cands = rank({ tokens, ...data }, page.limit);
      await logSearch(db, {
        tool: "find_relevant", query, lang, result_count: cands.length,
      });
      if (cands.length === 0) {
        return err(
          `Aucun rapprochement pour « ${query} » (termes retenus : ${tokens.join(", ")}). ` +
          "Voir les domaines avec qclaw_list_subjects, ou chercher dans le texte avec qclaw_search_text.",
        );
      }
      const lines = cands.map((c, i) => {
        const cible = c.division_path
          ? `${c.law_id} › ${c.heading ?? c.division_path} [${c.division_path}]`
          : `${c.law_id} (loi entière)`;
        return `${i + 1}. ${cible}  — score ${c.score}\n     pourquoi : ${c.pourquoi.join(" ; ")}`;
      });
      return ok(
        `${cands.length} piste(s) pour « ${query} » (termes : ${tokens.join(", ")}) :\n` +
        `${lines.join("\n")}\n\n${GARDE_FOU}`,
        {
          query, lang, tokens, weights: WEIGHTS, count: cands.length,
          avertissement: GARDE_FOU,
          candidates: cands.map((c) => ({
            law: c.law_id,
            division_path: c.division_path || null,
            heading: c.heading,
            score: c.score,
            pourquoi: c.pourquoi,
          })),
        },
      );
    },
  );

  // 2) qclaw_get_article -------------------------------------------------------
  server.registerTool(
    "qclaw_get_article",
    {
      description:
        "Retourne le texte officiel verbatim d'un article, avec citation, chemin hiérarchique, " +
        "date de consolidation et historique. Ex. : law='ccq', article='1457'. Les dispositions " +
        "se demandent avec article='préliminaire' ou 'finales'." + DEUX_TEMPS,
      inputSchema: {
        law: z.string().describe("Identifiant de la loi, ex. 'ccq'."),
        article: z.coerce.string().describe("Numéro d'article, ex. '1457', '2926.1', '132.0.1'."),
        lang: LANG,
      },
      annotations: READONLY,
    },
    async ({ law, article, lang }) => {
      const lawRow = await getLaw(db, law);
      if (!lawRow) {
        const all = (await listLaws(db)).map((l) => l.id).join(", ");
        return err(`Loi '${law}' inconnue. Lois disponibles : ${all || "aucune"}.`);
      }
      const row = await getArticle(db, law, lang as Lang, article);
      if (!row) {
        const near = await nearestArticles(db, law, lang as Lang, sortKeyOf(article));
        return err(
          `Article ${article} introuvable dans ${law} (${lang}). ` +
          `Vérifiez le numéro et la langue. Articles proches : ${near.join(", ") || "aucun"}.`,
        );
      }
      const consol = consolOf(lawRow, lang as Lang);
      return ok(renderArticle(row, consol, lang as Lang), {
        law, number: row.number, lang,
        citation: citationOf(row.rlrq_cite, row.number),
        division_path: row.division_path,
        division: row.d_kind ? { kind: row.d_kind, number: row.d_number, heading: row.d_heading } : null,
        consolidation: consol, history: row.history, repealed: !!row.repealed,
        text: row.text,
      });
    },
  );

  // 3) qclaw_get_articles ------------------------------------------------------
  server.registerTool(
    "qclaw_get_articles",
    {
      description:
        "Retourne plusieurs articles : soit une plage (from..to), soit une liste explicite (numbers). " +
        "Paginé. Ex. : law='ccq', from='1457', to='1460' ; ou numbers=['1457','1590']." + DEUX_TEMPS,
      inputSchema: {
        law: z.string().describe("Identifiant de la loi, ex. 'ccq'."),
        from: z.coerce.string().optional().describe("Borne basse d'une plage, ex. '1457'."),
        to: z.coerce.string().optional().describe("Borne haute d'une plage, ex. '1460'."),
        numbers: z.array(z.coerce.string()).optional().describe("Liste de numéros, ex. ['1457','1590']."),
        lang: LANG,
        limit: z.number().int().min(1).max(200).optional().describe("Max d'articles (défaut 50, max 200)."),
        offset: z.number().int().min(0).optional().describe("Décalage de pagination (≥ 0)."),
      },
      annotations: READONLY,
    },
    async ({ law, from, to, numbers, lang, limit, offset }) => {
      if (!(await getLaw(db, law))) return err(`Loi '${law}' inconnue.`);
      const useRange = from != null && to != null;
      if (!useRange && !(numbers && numbers.length)) {
        return err("Fournir soit (from ET to), soit numbers[].");
      }
      const page = paginate(limit, offset);
      let rows: Partial<ArticleRow>[];
      let total: number;
      if (useRange) {
        // bornes LUES en base (insensible à l'échelle de sort_key) — cf. boundKey
        const [k1, k2] = await Promise.all([
          boundKey(db, law, lang as Lang, from!),
          boundKey(db, law, lang as Lang, to!),
        ]);
        const r = await articlesByRange(db, law, lang as Lang, k1, k2, page);
        rows = r.rows; total = r.total;
      } else {
        rows = await articlesByNumbers(db, law, lang as Lang, numbers!);
        total = rows.length;
      }
      if (rows.length === 0) return err("Aucun article dans cette plage/liste.");
      const body = rows.map((a) => `— art. ${a.number}${a.repealed ? " (abrogé)" : ""} —\n${a.text}`).join("\n\n");
      return ok(body, {
        law, lang, count: rows.length, total,
        pagination: useRange ? { limit: page.limit, offset: page.offset } : null,
        articles: rows.map((a) => ({
          number: a.number, text: a.text, history: a.history,
          division_path: a.division_path, repealed: !!a.repealed,
        })),
      });
    },
  );

  // 4) qclaw_get_structure -----------------------------------------------------
  server.registerTool(
    "qclaw_get_structure",
    {
      description:
        "Arbre hiérarchique des divisions (Livre → Titre → Chapitre → Section → Sous-section), " +
        "SANS texte d'article — pour explorer avant d'extraire. Chaque nœud donne kind, number, " +
        "heading et son 'path' (à passer à qclaw_get_division). Utiliser root_path pour un sous-arbre " +
        "et depth pour limiter la profondeur (défaut 2 : livres et titres)." + DEUX_TEMPS,
      inputSchema: {
        law: z.string().describe("Identifiant de la loi, ex. 'ccq'."),
        lang: LANG,
        root_path: z.string().optional().describe("Restreindre à ce sous-arbre (path d'une division)."),
        depth: z.number().int().min(1).max(9).optional().describe("Profondeur affichée (défaut 2)."),
      },
      annotations: READONLY,
    },
    async ({ law, lang, root_path, depth }) => {
      if (!(await getLaw(db, law))) return err(`Loi '${law}' inconnue.`);
      const d = depth ?? 2;
      const tree = await getStructure(db, law, lang as Lang, root_path, d);
      if (tree.length === 0) return err(`Aucune division${root_path ? ` sous '${root_path}'` : ""}.`);
      const render = (nodes: StructureNode[], level: number): string =>
        nodes.map((n) =>
          `${"  ".repeat(level)}${divisionLabel(n.kind, n.number, n.heading, lang as Lang)}` +
          `${n.repealed ? " (abrogé)" : ""}  [${n.path}]` +
          (n.children.length ? "\n" + render(n.children, level + 1) : ""),
        ).join("\n");
      return ok(render(tree, 0), { law, lang, root_path: root_path ?? null, depth: d, tree });
    },
  );

  // 5) qclaw_get_division ------------------------------------------------------
  server.registerTool(
    "qclaw_get_division",
    {
      description:
        "Retourne une division (Livre/Titre/Chapitre/Section/…) : son intitulé, ses sous-divisions " +
        "immédiates, et les articles qu'elle contient (tout le sous-arbre, paginés). Identifier par " +
        "path (recommandé, via qclaw_get_structure) ou division_id. include_text=false pour n'avoir " +
        "que les numéros d'articles." + DEUX_TEMPS,
      inputSchema: {
        law: z.string().describe("Identifiant de la loi, ex. 'ccq'."),
        path: z.string().optional().describe("Chemin de la division (ex. 'ga:l_cinquieme-gb:l_premier')."),
        division_id: z.number().int().optional().describe("Identifiant numérique de la division."),
        lang: LANG,
        include_text: z.boolean().default(true).describe("Inclure le texte des articles (défaut true)."),
        limit: z.number().int().min(1).max(200).optional().describe("Max d'articles (défaut 50, max 200)."),
        offset: z.number().int().min(0).optional().describe("Décalage de pagination (≥ 0)."),
      },
      annotations: READONLY,
    },
    async ({ law, path, division_id, lang, include_text, limit, offset }) => {
      if (!(await getLaw(db, law))) return err(`Loi '${law}' inconnue.`);
      if (path == null && division_id == null) return err("Fournir path ou division_id.");
      const div = await getDivision(db, law, lang as Lang, { path, id: division_id });
      if (!div) return err(`Division introuvable (${path ?? division_id}).`);
      const kids = await childDivisions(db, div.id);
      const page = paginate(limit, offset);
      const { rows, total } = await articlesInDivision(db, law, lang as Lang, div.path, page, include_text);
      const header = `${divisionLabel(div.kind, div.number, div.heading, lang as Lang)}${div.repealed ? " (abrogé)" : ""} [${div.path}]`;
      const subs = kids.length
        ? `\n\nSous-divisions :\n` + kids.map((k) => `  • ${divisionLabel(k.kind, k.number, k.heading, lang as Lang)} [${k.path}]`).join("\n")
        : "";
      const arts = rows.length
        ? `\n\nArticles (${page.offset + 1}–${page.offset + rows.length} / ${total}) :\n` +
          rows.map((a) => include_text ? `\n— art. ${a.number} —\n${a.text}` : `art. ${a.number}`).join(include_text ? "\n" : ", ")
        : "\n\n(aucun article)";
      return ok(`${header}${subs}${arts}`, {
        law, lang,
        division: {
          division_id: div.id, path: div.path, kind: div.kind, number: div.number,
          heading: div.heading, history: div.history, repealed: !!div.repealed,
        },
        children: kids.map((k) => ({
          division_id: k.id, path: k.path, kind: k.kind, number: k.number,
          heading: k.heading, repealed: !!k.repealed,
        })),
        articles: rows.map((a) => ({
          number: a.number, division_path: a.division_path, repealed: !!a.repealed,
          ...(include_text ? { text: a.text, history: a.history } : {}),
        })),
        pagination: { limit: page.limit, offset: page.offset, total },
      });
    },
  );

  // 6) qclaw_search_text -------------------------------------------------------
  server.registerTool(
    "qclaw_search_text",
    {
      description:
        "Recherche plein texte (FTS5) dans le texte des articles. Retourne les correspondances " +
        "classées par pertinence avec un extrait surligné. Ex. : query='prescription action', " +
        "law='ccq' (défaut : toutes les lois)." + DEUX_TEMPS +
        // +1 phrase (plan v2, 1.1 — delta consigné au rapport de phase)
        " Omettre `law` sauf raison précise de restreindre ; une recherche restreinte sans " +
        "résultat est automatiquement élargie au corpus.",
      inputSchema: {
        query: z.string().describe("Termes à rechercher, ex. 'responsabilité préjudice'."),
        law: z.string().optional().describe("Restreindre à une loi (défaut : toutes)."),
        lang: LANG,
        limit: z.number().int().min(1).max(50).optional().describe("Max de résultats (défaut 10, max 50)."),
        offset: z.number().int().min(0).optional().describe("Décalage de pagination (≥ 0)."),
      },
      annotations: READONLY,
    },
    async ({ query, law, lang, limit, offset }) => {
      if (law && !(await getLaw(db, law))) return err(`Loi '${law}' inconnue.`);
      const page = paginate(limit, offset, 10, 50);
      let res;
      try {
        // RELAX_SEARCH (R8) : échelle de relaxation débrayable sans redéploiement
        res = await searchText(db, query, lang as Lang, law, page,
          { relax: (env as { RELAX_SEARCH?: string }).RELAX_SEARCH !== "0" });
      } catch (e) {
        await logSearch(db, { tool: "search_text", query, law, lang, result_count: 0 });
        return err(`Recherche invalide. Essayez des mots simples. (${(e as Error).message})`);
      }
      const fallbackLog = res.fallback === null
        ? null
        : typeof res.fallback === "object" ? `loo:${res.fallback.loo}` : res.fallback;
      await logSearch(db, {
        tool: "search_text", query, law, lang, result_count: res.hits.length,
        fallback: fallbackLog,
      });
      if (res.hits.length === 0) return err(`Aucun résultat pour « ${query} » (${lang}).`);

      const line = (h: typeof res.hits[number]) =>
        `${h.law_id} art. ${h.number} — ${h.snippet}  [${h.division_path}]`;
      const body = res.hits.map(line).join("\n");
      // En-tête étiqueté selon le chemin qui a produit les résultats (R7 : fail open, dit)
      const nTerms = query.trim().split(/\s+/).length;
      const header =
        res.fallback === "widened"
          ? `Aucun résultat dans ${law} ; ${res.total} résultat(s) ailleurs dans le corpus :`
          : res.fallback !== null && typeof res.fallback === "object"
            ? `Correspondance exacte introuvable ; résultats approchés (terme ignoré : « ${res.fallback.loo} ») :`
            : res.fallback === "or_relax"
              ? `Résultats partiels (au moins un terme sur ${nTerms}) :`
              : `${res.total} résultat(s) pour « ${query} » :`;
      // Recherche restreinte avec résultats : signaler ce que la restriction cache (post-mortem)
      const elsewhere = res.elsewhere
        ? `\n\nAilleurs au corpus (${res.elsewhere.total} résultat(s) hors ${law}) — aperçu :\n` +
          res.elsewhere.hits.map(line).join("\n") +
          "\nRelancer sans `law` pour la vue complète."
        : "";
      return ok(`${header}\n${body}${elsewhere}`, {
        query, lang, law: law ?? null, total: res.total,
        fallback: fallbackLog,
        elsewhere: res.elsewhere
          ? { total: res.elsewhere.total, results: res.elsewhere.hits }
          : null,
        pagination: { limit: page.limit, offset: page.offset },
        results: res.hits,
      });
    },
  );

  // 7) qclaw_resolve_reference -------------------------------------------------
  server.registerTool(
    "qclaw_resolve_reference",
    {
      description:
        "Résout une citation en texte libre (ex. « art. 1457 C.c.Q. », « RLRQ, c. T-16, art. 12 ») " +
        "vers l'article officiel. Reconnaît le chapitre RLRQ de n'importe quelle loi du corpus, " +
        "ainsi que les abréviations C.c.Q. et C.p.c." + DEUX_TEMPS,
      inputSchema: {
        citation: z.string().describe("Citation libre, ex. « article 1457 C.c.Q. »."),
        lang: LANG,
      },
      annotations: READONLY,
    },
    async ({ citation, lang }) => {
      const all = await listLaws(db);
      const parsed = parseCitation(citation, all);
      if (!parsed.article) return err(`Aucun numéro d'article détecté dans « ${citation} ».`);
      if (!parsed.law) {
        return err(
          parsed.chapitre_inconnu
            ? `Le chapitre « ${parsed.chapitre_inconnu} » n'est pas au corpus — aucune loi n'a été ` +
              "résolue (il n'est PAS rabattu sur un chapitre voisin). Voir les 38 textes " +
              `disponibles avec qclaw_list_laws. Article détecté : ${parsed.article ?? "aucun"}.`
            : `Loi non reconnue dans « ${citation} ». Précisez le chapitre RLRQ (ex. « RLRQ, c. T-16 ») ` +
              "ou une abréviation connue (C.c.Q., C.p.c.), ou utilisez qclaw_get_article avec law=… " +
              `(voir qclaw_list_laws). Article détecté : ${parsed.article ?? "aucun"}.`,
        );
      }
      const law = parsed.law;
      const article = parsed.article;
      const row = await getArticle(db, law, lang as Lang, article);
      if (!row) {
        const near = await nearestArticles(db, law, lang as Lang, sortKeyOf(article));
        return err(`Référence « ${citation} » non résolue (loi ${law}, art. ${article}). Proches : ${near.join(", ")}.`);
      }
      const lawRow = await getLaw(db, law);
      const consol = consolOf(lawRow, lang as Lang);
      return ok(renderArticle(row, consol, lang as Lang), {
        resolved: { law, number: row.number, lang, reconnue_par: parsed.law_source },
        citation: citationOf(row.rlrq_cite, row.number),
        division_path: row.division_path, consolidation: consol,
        history: row.history, repealed: !!row.repealed, text: row.text,
      });
    },
  );
}
