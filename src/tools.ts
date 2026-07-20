// Enregistrement des outils MCP « Lois du Québec » (qclaw_*). Tous en lecture seule.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  ArticleJoined, ArticleRow, Lang, StructureNode,
  articlesByNumbers, articlesByRange, articlesInDivision, childDivisions,
  citationOf, consolOf, getArticle, getDivision, getLaw, getStructure,
  listLaws, nearestArticles, paginate, searchText, sortKeyOf,
} from "./lib";

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
  server.registerTool(
    "qclaw_list_laws",
    {
      description:
        "Liste les lois disponibles : identifiant, noms FR/EN, citation RLRQ, langues chargées " +
        "et date de consolidation courante. Point de départ pour découvrir le corpus.",
      inputSchema: { lang: LANG.optional() },
      annotations: READONLY,
    },
    async () => {
      const laws = await listLaws(db);
      if (laws.length === 0) return err("Aucune loi chargée dans la base.");
      const lines = laws.map(
        (l) => `• ${l.id} — ${l.name_fr} / ${l.name_en} (${l.rlrq_cite}) ; ` +
          `langues: ${l.langs.join(", ") || "aucune"} ; ` +
          `à jour au ${l.consol_date_fr ?? "?"}${l.consol_date_en ? ` (en: ${l.consol_date_en})` : ""} ; ` +
          `${l.article_count} articles`,
      );
      return ok(`Lois disponibles :\n${lines.join("\n")}`, {
        laws: laws.map((l) => ({
          id: l.id, name_fr: l.name_fr, name_en: l.name_en, rlrq_cite: l.rlrq_cite,
          langs: l.langs, consol_date_fr: l.consol_date_fr, consol_date_en: l.consol_date_en,
          article_count: l.article_count,
        })),
      });
    },
  );

  // 2) qclaw_get_article -------------------------------------------------------
  server.registerTool(
    "qclaw_get_article",
    {
      description:
        "Retourne le texte officiel verbatim d'un article, avec citation, chemin hiérarchique, " +
        "date de consolidation et historique. Ex. : law='ccq', article='1457'. Les dispositions " +
        "se demandent avec article='préliminaire' ou 'finales'.",
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
        "Paginé. Ex. : law='ccq', from='1457', to='1460' ; ou numbers=['1457','1590'].",
      inputSchema: {
        law: z.string().describe("Identifiant de la loi, ex. 'ccq'."),
        from: z.coerce.string().optional().describe("Borne basse d'une plage, ex. '1457'."),
        to: z.coerce.string().optional().describe("Borne haute d'une plage, ex. '1460'."),
        numbers: z.array(z.coerce.string()).optional().describe("Liste de numéros, ex. ['1457','1590']."),
        lang: LANG,
        limit: z.number().int().optional().describe("Max d'articles (défaut 50, max 200)."),
        offset: z.number().int().optional().describe("Décalage de pagination."),
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
        const r = await articlesByRange(db, law, lang as Lang, sortKeyOf(from!), sortKeyOf(to!), page);
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
        "et depth pour limiter la profondeur (défaut 2 : livres et titres).",
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
        "que les numéros d'articles.",
      inputSchema: {
        law: z.string().describe("Identifiant de la loi, ex. 'ccq'."),
        path: z.string().optional().describe("Chemin de la division (ex. 'ga:l_cinquieme-gb:l_premier')."),
        division_id: z.number().int().optional().describe("Identifiant numérique de la division."),
        lang: LANG,
        include_text: z.boolean().default(true).describe("Inclure le texte des articles (défaut true)."),
        limit: z.number().int().optional().describe("Max d'articles (défaut 50, max 200)."),
        offset: z.number().int().optional().describe("Décalage de pagination."),
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
        "law='ccq' (défaut : toutes les lois).",
      inputSchema: {
        query: z.string().describe("Termes à rechercher, ex. 'responsabilité préjudice'."),
        law: z.string().optional().describe("Restreindre à une loi (défaut : toutes)."),
        lang: LANG,
        limit: z.number().int().optional().describe("Max de résultats (défaut 10, max 50)."),
        offset: z.number().int().optional().describe("Décalage de pagination."),
      },
      annotations: READONLY,
    },
    async ({ query, law, lang, limit, offset }) => {
      if (law && !(await getLaw(db, law))) return err(`Loi '${law}' inconnue.`);
      const page = paginate(limit, offset, 10, 50);
      let res;
      try {
        res = await searchText(db, query, lang as Lang, law, page);
      } catch (e) {
        return err(`Recherche invalide. Essayez des mots simples. (${(e as Error).message})`);
      }
      if (res.hits.length === 0) return err(`Aucun résultat pour « ${query} » (${lang}).`);
      const body = res.hits.map(
        (h) => `${h.law_id} art. ${h.number} — ${h.snippet}  [${h.division_path}]`,
      ).join("\n");
      return ok(`${res.total} résultat(s) pour « ${query} » :\n${body}`, {
        query, lang, law: law ?? null, total: res.total,
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
        "Résout une citation en texte libre (ex. « art. 1457 C.c.Q. ») vers l'article officiel. " +
        "Détecte le numéro d'article et la loi (C.c.Q.→ccq, C.p.c.→cpc ; défaut ccq).",
      inputSchema: {
        citation: z.string().describe("Citation libre, ex. « article 1457 C.c.Q. »."),
        lang: LANG,
      },
      annotations: READONLY,
    },
    async ({ citation, lang }) => {
      const numMatch = citation.match(/(\d+(?:\.\d+)*)/);
      if (!numMatch) return err(`Aucun numéro d'article détecté dans « ${citation} ».`);
      const article = numMatch[1];
      let law = "ccq";
      if (/c\.?\s*p\.?\s*c\.?|cpc/i.test(citation)) law = "cpc";
      else if (/c\.?\s*c\.?\s*q\.?|ccq/i.test(citation)) law = "ccq";
      const row = await getArticle(db, law, lang as Lang, article);
      if (!row) {
        const near = await nearestArticles(db, law, lang as Lang, sortKeyOf(article));
        return err(`Référence « ${citation} » non résolue (loi ${law}, art. ${article}). Proches : ${near.join(", ")}.`);
      }
      const lawRow = await getLaw(db, law);
      const consol = consolOf(lawRow, lang as Lang);
      return ok(renderArticle(row, consol, lang as Lang), {
        resolved: { law, number: row.number, lang },
        citation: citationOf(row.rlrq_cite, row.number),
        division_path: row.division_path, consolidation: consol,
        history: row.history, repealed: !!row.repealed, text: row.text,
      });
    },
  );
}
