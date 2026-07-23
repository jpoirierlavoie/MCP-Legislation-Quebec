// Veille de consolidation — DÉTECTEUR EN LECTURE SEULE. N'écrit RIEN en base.
//
// But : savoir quand LégisQuébec a consolidé une loi au-delà de ce qui est chargé en D1,
// c.-à-d. quand un rafraîchissement (procédure manuelle et supervisée, cf. CLAUDE.md
// « Rafraîchissement semestriel ») est dû. Ce script se contente de le CONSTATER ; la
// bascule reste humaine.
//
// Deux sources, aucune n'exige de secret :
//   • date STOCKÉE   ← qclaw_list_laws sur l'endpoint MCP public (= colonnes consol_date_*
//                       de D1, telles que servies aux usagers). Une seule session MCP.
//   • date LIVE      ← page LégisQuébec de chaque loi (« À jour au JJ mois AAAA »).
//
// extractConsolidation() est un MIROIR FIDÈLE de pipeline/ingest.py:fetch_consolidation :
// même portée (blocs class="text-end" uniquement), même regex, même table de mois, même
// « première date à mois valide ». Une page atteinte (2xx) dont la bannière devient
// illisible n'est PAS confondue avec une page injoignable : c'est une anomalie du
// détecteur (le miroir a peut-être cassé), donc un signal ACTIONNABLE — jamais un null
// silencieux. Contrat : ne JAMAIS produire de faux négatif silencieux.
//
// Sortie : consolidation-report.md (corps d'issue) + `drift=true|false` sur GITHUB_OUTPUT.
// Code de sortie : 0 même en cas de dérive (la dérive est le signal attendu, pas une
// erreur) ; ≠ 0 seulement si le détecteur lui-même n'a rien pu vérifier.

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createMcpClient } from "../eval/mcp-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const MCP_URL = process.env.MCP_URL || "https://legislation.poirierlavoie.ca/mcp";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"; // = pipeline/config.py:USER_AGENT
const CONCURRENCY = 8;
const TIMEOUT_MS = 20_000;
// Fraction de pages INJOIGNABLES (réseau/HTTP) au-delà de laquelle on ouvre une issue même
// sans autre dérive : un blocage massif (WAF, filtrage d'IP de centre de données) est en
// soi une information. Ne s'applique QU'aux injoignables réseau ; une page atteinte mais
// illisible est traitée à part (bucket `illisible`, toujours actionnable).
export const UNREACHABLE_ALERT_RATIO = 0.25;

// Miroir de _FR_MONTHS (pipeline/ingest.py).
export const FR_MONTHS = {
  janvier: 1, "février": 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, "août": 8, septembre: 9, octobre: 10, novembre: 11, "décembre": 12,
};

/**
 * Date « À jour au JJ mois AAAA » -> ISO (AAAA-MM-JJ), ou null si aucun bloc text-end n'en
 * porte. MIROIR FIDÈLE de fetch_consolidation() :
 *   - <script>/<style> retirés (leur contenu n'est pas du texte affiché) ;
 *   - on ne lit QUE les blocs class="text-end" (la bannière), comme find_all(class_=…) —
 *     ce qui exclut les fausses dates de l'historique d'articles ailleurs dans la page ;
 *   - première date à MOIS VALIDE, en poursuivant sur un bloc au mois invalide.
 */
export function extractConsolidation(html) {
  const cleaned = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const textEnd = /<div[^>]*class="[^"]*\btext-end\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let block;
  while ((block = textEnd.exec(cleaned)) !== null) {
    const text = block[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const m = text.match(/jour au\s*(\d{1,2})\s*(?:er)?\s*([A-Za-zÀ-ÿ]+)\s*(\d{4})/i);
    if (m && FR_MONTHS[m[2].toLowerCase()]) {
      const mm = String(FR_MONTHS[m[2].toLowerCase()]).padStart(2, "0");
      const dd = String(Number(m[1])).padStart(2, "0");
      return `${m[3]}-${mm}-${dd}`;
    }
  }
  return null;
}

/**
 * Trois issues distinctes, jamais confondues :
 *   { status: "ok", date }              page atteinte, date lue
 *   { status: "illisible", note }       page atteinte (2xx) mais date introuvable — le
 *                                        miroir a peut-être cassé : ACTIONNABLE
 *   { status: "injoignable", note }     réseau / HTTP >= 400 / délai / URL absente
 */
async function fetchLiveDate(url) {
  if (!url) return { status: "injoignable", note: "URL de consolidation absente de laws.config.json" };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: "injoignable", note: `HTTP ${res.status}` };
    const date = extractConsolidation(await res.text());
    if (date) return { status: "ok", date };
    return { status: "illisible", note: "page atteinte (200) mais date « À jour au » introuvable" };
  } catch (e) {
    return { status: "injoignable", note: e.name === "TimeoutError" ? "délai dépassé" : "réseau" };
  }
}

/** Répartit les contrôles (déjà dotés de status/live/stored) en catégories. */
export function classify(checks) {
  const retard = [], anomalie = [], sansStockee = [], illisible = [], injoignable = [];
  for (const c of checks) {
    if (c.status === "injoignable") { injoignable.push(c); continue; }
    if (c.status === "illisible") { illisible.push(c); continue; }
    // status === "ok" : c.live est une date ISO. Comparaison lexicographique valide.
    if (c.stored == null) { sansStockee.push(c); continue; }
    if (c.live > c.stored) retard.push(c);
    else if (c.live < c.stored) anomalie.push(c);
    // c.live === c.stored : à jour, rien à signaler
  }
  return { retard, anomalie, sansStockee, illisible, injoignable };
}

/**
 * Dérive = ce qui est ACTIONNABLE côté corpus (retard, anomalie, date absente, page
 * illisible, loi sans langue). Le blocage réseau massif est un signal SÉPARÉ
 * (unreachableAlert) : une page injoignable est une loi NON VÉRIFIÉE — ni fraîche ni en
 * retard — et l'issue ne doit ni l'annoncer comme un « rafraîchissement dû » (le titre
 * mentait : constaté le 2026-07-23, dérive résolue mais issue tenue ouverte sous ce
 * titre par 33 % de 502), ni la laisser passer pour un corpus vérifié. Les deux drapeaux
 * sortent séparément sur GITHUB_OUTPUT ; le workflow ne clôt que si les DEUX sont éteints.
 */
export function computeDrift({ retard, anomalie, sansStockee, illisible, sansLangue, injoignable, total }) {
  const unreachableRatio = total ? injoignable.length / total : 0;
  const unreachableAlert = unreachableRatio >= UNREACHABLE_ALERT_RATIO;
  const actionable =
    retard.length + anomalie.length + sansStockee.length + illisible.length + sansLangue.length;
  return { drift: actionable > 0, unreachableRatio, unreachableAlert };
}

/** Exécute `worker` sur `items` avec un parallélisme borné (politesse envers LégisQuébec). */
async function pool(items, size, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const config = JSON.parse(readFileSync(join(ROOT, "laws.config.json"), "utf8"));
  const sources = new Map(config.laws.map((l) => [l.id, l.consolidation_source || {}]));

  // 1) Dates stockées, via l'endpoint MCP public (une seule session).
  const mcp = createMcpClient(MCP_URL);
  await mcp.connect();
  const res = await mcp.callTool("qclaw_list_laws", {});
  const laws = res?.structuredContent?.laws;
  if (!Array.isArray(laws) || laws.length === 0) {
    throw new Error(`qclaw_list_laws n'a renvoyé aucune loi (endpoint ${MCP_URL} injoignable ?)`);
  }

  // 2) Un contrôle par (loi, langue). Une loi sans langue déclarée (langs vide -> ligne
  // laws sans article, cf. invariant n° 1) serait sinon SILENCIEUSEMENT sautée : on la
  // range dans une catégorie actionnable au lieu de la perdre.
  const checks = [];
  const sansLangue = [];
  for (const law of laws) {
    const langs = Array.isArray(law.langs) ? law.langs : [];
    if (langs.length === 0) {
      sansLangue.push({ id: law.id, name: law.name_fr || law.name_en || law.id });
      continue;
    }
    for (const lang of langs) {
      checks.push({
        id: law.id,
        name: law.name_fr || law.name_en || law.id,
        lang,
        stored: law[`consol_date_${lang}`] ?? null,
        url: (sources.get(law.id) || {})[lang] ?? null,
      });
    }
  }
  // Garde : un détecteur qui n'a construit AUCUN contrôle ne doit pas rapporter « vert ».
  if (checks.length === 0 && sansLangue.length === 0) {
    throw new Error("aucun couple (loi, langue) construit — forme de qclaw_list_laws inattendue ?");
  }

  // 3) Date live pour chaque contrôle.
  await pool(checks, CONCURRENCY, async (c) => {
    const { status, date, note } = await fetchLiveDate(c.url);
    c.status = status;
    c.live = date ?? null;
    c.note = note ?? null;
  });

  // 4) Classement + calcul de dérive.
  const { retard, anomalie, sansStockee, illisible, injoignable } = classify(checks);
  const total = checks.length;
  const { drift, unreachableRatio, unreachableAlert } =
    computeDrift({ retard, anomalie, sansStockee, illisible, sansLangue, injoignable, total });

  // 5) Rapport.
  const report = buildReport({
    total, laws: laws.length, retard, anomalie, sansStockee, illisible, sansLangue,
    injoignable, unreachableRatio, unreachableAlert,
  });
  writeFileSync(join(ROOT, "consolidation-report.md"), report, "utf8");

  console.log(`Vérifié : ${laws.length} lois, ${total} couples (loi, langue).`);
  console.log(`  en retard          : ${retard.length}`);
  console.log(`  anomalies          : ${anomalie.length}`);
  console.log(`  sans date stockée  : ${sansStockee.length}`);
  console.log(`  page illisible     : ${illisible.length}`);
  console.log(`  loi sans langue    : ${sansLangue.length}`);
  console.log(`  injoignables réseau: ${injoignable.length} (${(unreachableRatio * 100).toFixed(0)} %)`);
  console.log(`  => dérive corpus   : ${drift ? "OUI" : "non"}`);
  console.log(`  => alerte réseau   : ${unreachableAlert ? "OUI" : "non"}`);
  for (const c of retard) console.log(`    RETARD ${c.id}/${c.lang} : D1 ${c.stored} < live ${c.live}`);
  for (const c of illisible) console.log(`    ILLISIBLE ${c.id}/${c.lang} : ${c.note}`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `drift=${drift}\nunreachable=${unreachableAlert}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
  }
}

function buildReport(d) {
  const { total, laws, retard, anomalie, sansStockee, illisible, sansLangue, injoignable, unreachableRatio, unreachableAlert } = d;
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const rows = (list) =>
    list
      .map((c) => `| ${c.id} | ${c.lang} | ${c.stored ?? "—"} | ${c.live ?? "—"} | ${(c.name || "").replace(/\|/g, "/")} |`)
      .join("\n");
  const dateTable = (title, list) =>
    list.length
      ? `\n### ${title}\n\n| Loi | Langue | D1 (chargé) | LégisQuébec (live) | Titre |\n|---|---|---|---|---|\n${rows(list)}\n`
      : "";

  let md = `# Veille de consolidation — ${stamp}\n\n`;
  md += `Détecteur **en lecture seule** : ${laws} lois, ${total} couples (loi, langue) comparés `;
  md += `entre les dates chargées en D1 (via \`qclaw_list_laws\`) et les dates « À jour au » `;
  md += `affichées par LégisQuébec.\n\n`;
  md += `- en retard (rafraîchissement dû) : **${retard.length}**\n`;
  md += `- en avance / anomalie : **${anomalie.length}**\n`;
  md += `- sans date stockée : **${sansStockee.length}**\n`;
  md += `- pages atteintes mais date illisible : **${illisible.length}**\n`;
  md += `- lois sans langue déclarée : **${sansLangue.length}**\n`;
  md += `- injoignables réseau : **${injoignable.length}** (${(unreachableRatio * 100).toFixed(0)} %)\n`;

  md += dateTable("Rafraîchissement dû — D1 en retard sur LégisQuébec", retard);
  md += dateTable("Anomalie — D1 EN AVANCE sur LégisQuébec (à investiguer)", anomalie);
  md += dateTable("Date de consolidation absente en D1", sansStockee);

  if (illisible.length) {
    md += `\n### Pages atteintes mais date « À jour au » introuvable\n\n`;
    md += `> ⚠️ Ces pages répondent (HTTP 200) mais le parseur n'y trouve pas la date. `;
    md += `Cause probable : LégisQuébec a changé le libellé/format de la bannière — le parseur `;
    md += `\`extractConsolidation\` (miroir de \`fetch_consolidation\`) est à mettre à jour. `;
    md += `Ce n'est PAS un problème réseau.\n\n`;
    md += `| Loi | Langue | Détail |\n|---|---|---|\n`;
    md += illisible.map((c) => `| ${c.id} | ${c.lang} | ${c.note ?? "?"} |`).join("\n") + "\n";
  }

  if (sansLangue.length) {
    md += `\n### Lois sans langue déclarée en D1\n\n`;
    md += `> ⚠️ Aucune langue servie par \`qclaw_list_laws\` : ligne \`laws\` sans article ? `;
    md += `(ingestion incomplète). À vérifier.\n\n`;
    md += `| Loi | Titre |\n|---|---|\n`;
    md += sansLangue.map((c) => `| ${c.id} | ${(c.name || "").replace(/\|/g, "/")} |`).join("\n") + "\n";
  }

  if (injoignable.length) {
    md += `\n### Pages injoignables (réseau)\n\n`;
    if (unreachableAlert) {
      md += `> ⚠️ ${(unreachableRatio * 100).toFixed(0)} % des pages sont injoignables depuis le runner. `;
      md += `Un blocage massif (WAF LégisQuébec, filtrage des IP de centre de données) est possible — `;
      md += `il conditionnerait aussi toute ingestion automatisée. À vérifier hors CI.\n\n`;
    }
    md += `| Loi | Langue | Motif |\n|---|---|---|\n`;
    md += injoignable.map((c) => `| ${c.id} | ${c.lang} | ${c.note ?? "?"} |`).join("\n") + "\n";
  }

  md += `\n---\n`;
  md += `Pour rafraîchir : suivre la procédure **« Rafraîchissement semestriel »** de `;
  md += `\`CLAUDE.md\` (ingestion staging→bascule, rechargement découverte, re-backfill des `;
  md += `vecteurs, éval de non-régression). Ce job ne fait que détecter ; il n'écrit jamais `;
  md += `en base. Rapport régénéré à chaque exécution.\n`;
  return md;
}

// N'exécute main() que si le script est lancé directement (pas à l'import par les tests).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error("Échec du détecteur :", e.message);
    process.exit(1);
  });
}
