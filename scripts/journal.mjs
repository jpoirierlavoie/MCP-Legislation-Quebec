// Dépouillement du journal de recherche (search_log) — LECTURE SEULE, jamais d'écriture.
//
//   node scripts/journal.mjs                 # base distante (production)
//   node scripts/journal.mjs --local         # base D1 locale (wrangler dev)
//   node scripts/journal.mjs --jours 7       # fenêtre glissante
//   node scripts/journal.mjs --tout          # n'exclut pas le trafic d'éval
//
// POURQUOI CE SCRIPT EXISTE. La tâche 1.6 du plan Discovery v2 a créé `search_log` pour
// nourrir une « routine hebdomadaire » qui n'a jamais été livrée : le journal était écrit
// (src/lib.ts::logSearch) et lu par personne. Dix jours de données dormaient en base.
//
// ET IL NE COMPTE PAS LES ZÉROS. La migration 0001 indexe `result_count` en pariant que
// l'échec, c'est zéro résultat. Sous R7 (fail open), l'échelle de relaxation garantit qu'on
// ne rend quasiment jamais zéro : la métrique ne peut structurellement pas voir un échec.
// Ce script mesure les deux signaux qui, eux, disent quelque chose :
//   1. la PROFONDEUR DU REPLI — `or_relax` signifie que le ET lexical a complètement échoué ;
//   2. la REFORMULATION RAPPROCHÉE — plusieurs requêtes voisines en quelques minutes, c'est
//      quelqu'un qui n'a pas trouvé, quel que soit le nombre de résultats rendus.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, def) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : def;
};
const LOCAL = process.argv.includes("--local");
const TOUT = process.argv.includes("--tout");
const JOURS = Number(arg("--jours", "0")) || 0;
const CHAINE_MIN = 6 * 60_000; // deux requêtes à moins de 6 min = même session de recherche

// --- lecture ------------------------------------------------------------------

function lire() {
  const where = JOURS ? `WHERE ts >= datetime('now', '-${JOURS} days')` : "";
  const sql = `SELECT ts, tool, query, law, lang, result_count, fallback FROM search_log ${where} ORDER BY ts`;
  // On appelle le binaire wrangler par Node, PAS `npx` : depuis un correctif de sécurité
  // Node, execFileSync refuse de lancer un `.cmd` sans shell (EINVAL sous Windows), et
  // passer par un shell exposerait le SQL à l'interprétation des quotes.
  const wrangler = join(RACINE, "node_modules", "wrangler", "bin", "wrangler.js");
  const out = execFileSync(
    process.execPath,
    [wrangler, "d1", "execute", "qclaw", LOCAL ? "--local" : "--remote", "--json", "--command", sql],
    { cwd: RACINE, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) throw new Error(`réponse D1 inattendue :\n${out.slice(0, 500)}`);
  return JSON.parse(m[0])[0].results;
}

/**
 * Sépare le trafic d'éval du trafic réel par correspondance de chaînes contre les fixtures.
 *
 * LIMITE ASSUMÉE, et dite plutôt que tue : un usager réel qui taperait mot pour mot une
 * requête d'éval serait classé « fixture ». L'alternative — marquer la source à l'écriture —
 * exigerait une migration et du plombage jusque dans le Durable Object, pour un gain nul sur
 * un serveur à un seul usager. Le tri est indicatif, pas une preuve.
 */
function fixtures() {
  const f = ["eval/cases.json", "tests/evals.mjs", "eval/run.mjs"];
  return f.map((p) => readFileSync(join(RACINE, p), "utf-8")).join("\n");
}

// --- présentation --------------------------------------------------------------

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)} %` : "—");
const titre = (s) => console.log(`\n${s}\n${"-".repeat(s.length)}`);
const ts = (s) => new Date(`${s.replace(" ", "T")}Z`).getTime();

function compter(rows, cle) {
  const m = new Map();
  for (const r of rows) {
    const k = cle(r) ?? "(aucun)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Requêtes successives rapprochées : la trace d'une recherche qui n'aboutit pas. */
function chaines(rows) {
  const out = [];
  let cur = rows.length ? [rows[0]] : [];
  for (let i = 1; i < rows.length; i++) {
    if (ts(rows[i].ts) - ts(rows[i - 1].ts) < CHAINE_MIN) cur.push(rows[i]);
    else { if (cur.length > 1) out.push(cur); cur = [rows[i]]; }
  }
  if (cur.length > 1) out.push(cur);
  return out.sort((a, b) => b.length - a.length);
}

/** Mots les plus fréquents du trafic réel — de quoi voir ce qu'on cherche vraiment. */
function vocabulaire(rows, n = 18) {
  const stop = new Set(["de", "du", "des", "la", "le", "les", "un", "une", "et", "ou", "en",
    "au", "aux", "par", "pour", "sur", "dans", "que", "qui", "ne", "pas", "se", "sa", "son",
    "ses", "d", "l", "the", "of", "to", "a", "in", "s", "est", "sans", "avec", "plus"]);
  const m = new Map();
  for (const r of rows) {
    const vus = new Set();
    for (const t of r.query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9']+/).filter((x) => x.length > 2 && !stop.has(x))) {
      if (!vus.has(t)) { vus.add(t); m.set(t, (m.get(t) ?? 0) + 1); }
    }
  }
  return [...m.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// --- rapport --------------------------------------------------------------------

function main() {
  const toutes = lire();
  if (!toutes.length) {
    console.log("Journal vide (migration 0001 appliquée ? aucune recherche depuis ?).");
    return;
  }
  const fx = fixtures();
  const evals = toutes.filter((r) => fx.includes(r.query));
  const rows = TOUT ? toutes : toutes.filter((r) => !fx.includes(r.query));

  console.log(`Journal ${LOCAL ? "LOCAL" : "PRODUCTION"}${JOURS ? ` — ${JOURS} derniers jours` : ""}`);
  console.log(`${toutes.length} appels du ${toutes[0].ts} au ${toutes[toutes.length - 1].ts}`);
  console.log(`  fixtures d'éval et de test : ${evals.length} (${pct(evals.length, toutes.length)}) ` +
    `— tri par correspondance de chaînes, donc indicatif`);
  console.log(`  trafic réel                : ${toutes.length - evals.length}` +
    `${TOUT ? "   [--tout : le rapport ci-dessous porte sur TOUT]" : ""}`);
  if (!rows.length) { console.log("\nAucun trafic réel sur la fenêtre."); return; }

  const distinctes = new Set(rows.map((r) => r.query)).size;
  titre(`Vue d'ensemble — ${rows.length} appels, ${distinctes} requêtes distinctes`);
  for (const [k, n] of compter(rows, (r) => r.tool)) console.log(`  outil ${k.padEnd(14)} ${n}`);
  const zeros = rows.filter((r) => r.result_count === 0).length;
  console.log(`  recherches vides         ${zeros}  (${pct(zeros, rows.length)})` +
    `${zeros === 0 ? "  ← attendu sous R7 : la métrique du journal ne voit pas les échecs" : ""}`);
  console.log(`  portée restreinte        ${rows.filter((r) => r.law).length}`);
  for (const [k, n] of compter(rows, (r) => r.lang)) console.log(`  langue ${String(k).padEnd(13)} ${n}`);

  titre("Signal nº 1 — profondeur du repli (R7 : chaque repli est étiqueté)");
  const avecRepli = rows.filter((r) => r.fallback);
  console.log(`  ${avecRepli.length} appels sur ${rows.length} (${pct(avecRepli.length, rows.length)}) ` +
    `ont eu besoin d'un barreau de l'échelle`);
  for (const [k, n] of compter(avecRepli, (r) => r.fallback.split(":")[0])) {
    const quoi = { or_relax: "le ET lexical a COMPLÈTEMENT échoué", widened: "portée élargie au corpus",
      semantic: "seul le vectoriel a répondu", loo: "un terme a dû être retiré" }[k] ?? "";
    console.log(`    ${k.padEnd(10)} ${String(n).padStart(4)}   ${quoi}`);
  }

  const ch = chaines(rows);
  titre(`Signal nº 2 — reformulation rapprochée (${ch.length} chaînes de ≥ 2 requêtes en < 6 min)`);
  console.log("  Une chaîne longue = quelqu'un qui n'a pas trouvé, QUEL QUE SOIT le nombre de résultats.\n");
  for (const c of ch.slice(0, 5)) {
    console.log(`  ${c[0].ts.slice(0, 16)} — ${c.length} requêtes`);
    for (const r of c) {
      console.log(`      ${String(r.result_count).padStart(3)} rés ` +
        `${(r.fallback ? `[${r.fallback}]` : "").padEnd(20)} ${r.query.slice(0, 62)}`);
    }
    console.log();
  }

  titre("Vocabulaire du trafic réel (termes vus dans ≥ 2 requêtes)");
  console.log("  " + vocabulaire(rows).map(([t, n]) => `${t} (${n})`).join(" · "));

  titre("Ce qu'on en fait");
  console.log("  • Les chaînes les plus longues sont les candidats nº 1 du gazetteer (phase 3.2).");
  console.log("  • Les requêtes en `or_relax` sont des écarts de vocabulaire entre la question et le texte.");
  console.log("  • Un cas d'éval tiré d'ici se PROPOSE : eval/cases.json est ⛔ (invariant 16).");
}

try {
  main();
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  console.error("Jeton Cloudflare chargé ? (export CLOUDFLARE_API_TOKEN=$(tr -d ' \\t\\r\\n' < cf.token))");
  process.exit(1);
}
