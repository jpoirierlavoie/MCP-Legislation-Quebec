// Harnais d'évaluation du repérage (plan Discovery v2, §0.4).
//
//   node eval/run.mjs                          # tableau seulement (endpoint de production)
//   node eval/run.mjs --out eval/baselines/2026-07-20.json
//   MCP_URL=http://127.0.0.1:8787/mcp node eval/run.mjs   # contre wrangler dev
//
// Pour chaque cas de eval/cases.json (vérité terrain — Appendice A, ⛔ modification par
// Jason seulement) : appelle qclaw_search_text (portée du cas) et qclaw_find_relevant,
// puis calcule :
//   - recall@10 : fraction des must_include dans le top 10 de la recherche ;
//   - MRR       : 1/rang du premier must_include atteint (0 si aucun) ;
//   - FR        : couverture par find_relevant — un article est « couvert » si un candidat
//                 pointe sa loi et que son division_path tombe sous le chemin du candidat
//                 (chemins résolus une fois via qclaw_get_article, cache cases.resolved.json).
// UNE session MCP pour tous les appels (eval/mcp-client.mjs).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpClient } from "./mcp-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_URL = process.env.MCP_URL ?? "https://legislation.poirierlavoie.ca/mcp";
const RESOLVED_PATH = join(HERE, "cases.resolved.json");

const outIdx = process.argv.indexOf("--out");
const OUT = outIdx > -1 ? process.argv[outIdx + 1] : null;

const { cases } = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf-8"));
const { connect, callTool } = createMcpClient(MCP_URL);

const keyOf = (a) => `${a.law}|${a.article}`;

/** division_path de chaque article de la vérité terrain (résolu une fois, mis en cache). */
async function resolvePaths() {
  const cache = existsSync(RESOLVED_PATH)
    ? JSON.parse(readFileSync(RESOLVED_PATH, "utf-8"))
    : {};
  const wanted = new Map();
  for (const c of cases) {
    for (const a of [...c.must_include, ...(c.nice_to_have ?? [])]) wanted.set(keyOf(a), a);
  }
  let added = 0;
  for (const [k, a] of wanted) {
    if (cache[k]) continue;
    const res = await callTool("qclaw_get_article", { law: a.law, article: a.article });
    if (res.isError) throw new Error(`vérité terrain irrésoluble : ${k} — ${res.content?.[0]?.text}`);
    cache[k] = res.structuredContent.division_path;
    added++;
  }
  if (added) writeFileSync(RESOLVED_PATH, JSON.stringify(cache, null, 2) + "\n");
  return cache;
}

/** Le chemin d'un candidat couvre-t-il celui d'un article ? ('' / null = loi entière) */
const covers = (candPath, artPath) =>
  !candPath || artPath === candPath || artPath.startsWith(`${candPath}-`);

async function runCase(c, paths) {
  // --- qclaw_search_text (portée du cas, top 10) ---
  const sArgs = { query: c.query, limit: 10 };
  if (c.law_scope) sArgs.law = c.law_scope;
  const s = await callTool("qclaw_search_text", sArgs);
  const results = s.isError ? [] : (s.structuredContent?.results ?? []);
  const top = results.map((r) => `${r.law_id}|${r.number}`);

  const mustKeys = c.must_include.map(keyOf);
  const found = mustKeys.filter((k) => top.includes(k));
  const recall = mustKeys.length ? found.length / mustKeys.length : 1;
  const firstRank = Math.min(
    ...mustKeys.map((k) => {
      const i = top.indexOf(k);
      return i === -1 ? Infinity : i + 1;
    }),
  );
  const mrr = Number.isFinite(firstRank) ? 1 / firstRank : 0;
  const niceHits = (c.nice_to_have ?? []).map(keyOf).filter((k) => top.includes(k)).length;

  // --- qclaw_find_relevant (toujours corpus entier — c'est un routeur) ---
  const f = await callTool("qclaw_find_relevant", { query: c.query });
  const cands = f.isError ? [] : (f.structuredContent?.candidates ?? []);
  const frCovered = mustKeys.filter((k) => {
    const artPath = paths[k];
    const [law] = k.split("|");
    return cands.some((cd) => cd.law === law && covers(cd.division_path, artPath));
  });
  const frCoverage = mustKeys.length ? frCovered.length / mustKeys.length : 1;

  return {
    id: c.id,
    query: c.query,
    law_scope: c.law_scope,
    search: {
      recall_at_10: recall,
      mrr,
      first_rank: Number.isFinite(firstRank) ? firstRank : null,
      must_found: found,
      nice_hits: niceHits,
      result_count: results.length,
      top: top.slice(0, 10),
    },
    find_relevant: {
      coverage: frCoverage,
      covered: frCovered,
      candidate_count: cands.length,
    },
  };
}

function fmtPct(x) {
  return `${Math.round(x * 100)}%`.padStart(4);
}

async function main() {
  console.log(`MCP : ${MCP_URL}\n`);
  await connect();
  const paths = await resolvePaths();

  const rows = [];
  for (const c of cases) rows.push(await runCase(c, paths));

  console.log("cas  recall@10  MRR    rang  FR-couv  requête");
  console.log("---  ---------  -----  ----  -------  " + "-".repeat(50));
  for (const r of rows) {
    console.log(
      `${String(r.id).padStart(3)}  ${fmtPct(r.search.recall_at_10).padStart(9)}` +
      `  ${r.search.mrr.toFixed(3)}  ${String(r.search.first_rank ?? "—").padStart(4)}` +
      `  ${fmtPct(r.find_relevant.coverage).padStart(7)}  ${r.query.slice(0, 50)}` +
      `${r.law_scope ? `  [${r.law_scope}]` : ""}`,
    );
  }

  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const agg = {
    mean_recall_at_10: mean(rows.map((r) => r.search.recall_at_10)),
    mean_mrr: mean(rows.map((r) => r.search.mrr)),
    cases_fully_covered: rows.filter((r) => r.search.recall_at_10 === 1).length,
    cases_zero: rows.filter((r) => r.search.recall_at_10 === 0).length,
    mean_fr_coverage: mean(rows.map((r) => r.find_relevant.coverage)),
  };
  console.log(
    `\nAgrégats : recall@10 moyen ${fmtPct(agg.mean_recall_at_10).trim()}` +
    ` ; MRR moyen ${agg.mean_mrr.toFixed(3)}` +
    ` ; cas pleinement couverts ${agg.cases_fully_covered}/${rows.length}` +
    ` ; cas à zéro ${agg.cases_zero}` +
    ` ; couverture find_relevant ${fmtPct(agg.mean_fr_coverage).trim()}`,
  );

  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(
      { date: new Date().toISOString(), endpoint: MCP_URL, aggregates: agg, cases: rows },
      null, 2,
    ) + "\n");
    console.log(`\nÉcrit : ${OUT}`);
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  console.error("Le serveur est-il joignable ? (MCP_URL, wrangler dev, réseau)");
  process.exit(1);
});
