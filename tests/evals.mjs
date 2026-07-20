// Évals du routeur qclaw_find_relevant (plan-couche-decouverte §8) + fumée des outils
// de découverte. Tests de bout en bout : parlent MCP (HTTP streamable) au serveur réel.
//
//   npx wrangler dev            # dans un autre terminal (D1 local)
//   npm run evals               # ou : MCP_URL=https://…/mcp node tests/evals.mjs
//
// Sortie : une ligne par éval, code de sortie 1 si l'une échoue.

const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:8787/mcp";

// --- client MCP minimal (initialize -> initialized -> tools/call) --------------

let sessionId = null;
let nextId = 1;

/** Le transport peut répondre en JSON ou en SSE (`event: message\ndata: {…}`). */
function parseBody(text, contentType) {
  if (contentType.includes("text/event-stream")) {
    const payloads = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) payloads.push(line.slice(5).trim());
    }
    if (!payloads.length) throw new Error(`SSE sans data: ${text.slice(0, 200)}`);
    return JSON.parse(payloads[payloads.length - 1]);
  }
  return JSON.parse(text);
}

async function rpc(method, params, { notification = false } = {}) {
  const body = notification
    ? { jsonrpc: "2.0", method, params }
    : { jsonrpc: "2.0", id: nextId++, method, params };
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (notification) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${method} : ${text.slice(0, 300)}`);
  const msg = parseBody(text, res.headers.get("content-type") ?? "");
  if (msg.error) throw new Error(`${method} : ${msg.error.message}`);
  return msg.result;
}

async function connect() {
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "qclaw-evals", version: "1.0.0" },
  });
  await rpc("notifications/initialized", {}, { notification: true });
}

const callTool = (name, args) => rpc("tools/call", { name, arguments: args });

// --- évals du §8 --------------------------------------------------------------
//
// `top`     : le 1er candidat doit correspondre.
// `present` : chacun doit figurer dans les candidats retournés.
// `none`    : aucun rapprochement (message d'aide attendu).
// Une attente { law, pathPrefix? } matche un candidat de cette loi dont le
// division_path commence par pathPrefix (absent = n'importe quelle cible de la loi).

const EVALS = [
  {
    query: "vice caché",
    attendu: "ccq / obligations (Livre 5) en tête",
    top: { law: "ccq", pathPrefix: "ga:l_cinquieme" },
  },
  {
    query: "bail de logement",
    attendu: "bloc TAL + chapitre du louage du C.c.Q.",
    present: [
      { law: "ccq", pathPrefix: "ga:l_cinquieme-gb:l_deuxieme-gc:l_quatrieme" },
      { law: "t-15.01" },
    ],
  },
  {
    query: "congédiement",
    attendu: "n-1.1 + contrat de travail du C.c.Q.",
    present: [
      { law: "n-1.1" },
      { law: "ccq", pathPrefix: "ga:l_cinquieme-gb:l_deuxieme-gc:l_septieme" },
    ],
  },
  {
    query: "appel civil",
    attendu: "c-25.01-r.0.2.01 + cpc",
    present: [{ law: "c-25.01-r.0.2.01" }, { law: "cpc" }],
  },
  {
    query: "hypothèque légale construction",
    attendu: "ccq / sûretés (Livre 6)",
    present: [{ law: "ccq", pathPrefix: "ga:l_sixieme" }],
  },
  {
    query: "assurance responsabilité",
    attendu: "chapitre des assurances du C.c.Q. + d-9.2",
    present: [
      { law: "ccq", pathPrefix: "ga:l_cinquieme-gb:l_deuxieme-gc:l_quinzieme" },
      { law: "d-9.2" },
    ],
  },
  {
    query: "renseignements personnels fuite",
    attendu: "p-39.1",
    present: [{ law: "p-39.1" }],
  },
  {
    query: "procédure TAQ",
    attendu: "j-3 + j-3-r.3.01",
    present: [{ law: "j-3" }, { law: "j-3-r.3.01" }],
  },
  {
    query: "courtage immobilier",
    attendu: "c-73.2",
    present: [{ law: "c-73.2" }],
  },
  {
    query: "déontologie avocat",
    attendu: "b-1-r.3.1 (Code de déontologie) + droit professionnel",
    present: [{ law: "b-1-r.3.1" }],
  },
  // Miroirs ANGLAIS des évals françaises : le signal S1 (matière, +3) doit se déclencher
  // aussi en anglais. Sans label_en/description_en, il restait muet et le routeur anglais
  // perdait sa couche la plus utile — celle qui réunit un chapitre du C.c.Q. et les lois
  // spécialisées d'une même matière.
  {
    query: "residential lease",
    lang: "en",
    attendu: "miroir de « bail de logement » : bloc TAL + chapitre LEASE du C.c.Q.",
    present: [
      { law: "ccq", pathPrefix: "ga:l_five-gb:l_two-gc:l_iv" },
      { law: "t-15.01" },
    ],
  },
  {
    query: "latent defect",
    lang: "en",
    attendu: "miroir de « vice caché » : ccq / OBLIGATIONS (Book Five) en tête",
    top: { law: "ccq", pathPrefix: "ga:l_five" },
  },
  {
    query: "unfair dismissal",
    lang: "en",
    attendu: "miroir de « congédiement » : n-1.1 + contract of employment du C.c.Q.",
    present: [
      { law: "n-1.1" },
      { law: "ccq", pathPrefix: "ga:l_five-gb:l_two-gc:l_vii" },
    ],
  },
  {
    query: "zzzzq wxyv",
    attendu: "aucun rapprochement, message d'aide",
    none: true,
  },
];

const matches = (cand, exp) =>
  cand.law === exp.law &&
  (!exp.pathPrefix || (cand.division_path ?? "").startsWith(exp.pathPrefix));

const fmt = (c) => `${c.law}${c.division_path ? `›${c.division_path}` : ""}(${c.score})`;

async function runEval(e) {
  const res = await callTool("qclaw_find_relevant",
    e.lang ? { query: e.query, lang: e.lang } : { query: e.query });
  const cands = res.structuredContent?.candidates ?? [];
  const failures = [];

  if (e.none) {
    if (!res.isError) failures.push(`attendu aucun rapprochement, obtenu ${cands.length} candidat(s)`);
    const txt = res.content?.[0]?.text ?? "";
    if (!/list_subjects/.test(txt)) failures.push("le message n'oriente pas vers qclaw_list_subjects");
    return { failures, cands };
  }

  if (res.isError) {
    failures.push(`erreur inattendue : ${res.content?.[0]?.text ?? "?"}`);
    return { failures, cands };
  }
  if (e.top && !matches(cands[0] ?? {}, e.top)) {
    failures.push(`en tête : attendu ${e.top.law}${e.top.pathPrefix ? `›${e.top.pathPrefix}…` : ""}, obtenu ${cands[0] ? fmt(cands[0]) : "rien"}`);
  }
  for (const exp of e.present ?? []) {
    if (!cands.some((c) => matches(c, exp))) {
      failures.push(`absent : ${exp.law}${exp.pathPrefix ? `›${exp.pathPrefix}…` : ""}`);
    }
  }
  return { failures, cands };
}

// --- fumée des autres outils de découverte ------------------------------------

async function smokeTests() {
  const checks = [];
  const add = (nom, ok, detail = "") => checks.push({ nom, ok, detail });

  const laws = await callTool("qclaw_list_laws", {});
  add("list_laws : 38 lois", laws.structuredContent?.count === 38,
    `count=${laws.structuredContent?.count}`);
  const ccq = laws.structuredContent?.laws?.find((l) => l.id === "ccq");
  add("list_laws : ccq porte ses Livres (matières)", (ccq?.mapped_divisions?.length ?? 0) >= 10,
    `${ccq?.mapped_divisions?.length ?? 0} division(s) mappée(s)`);

  const filtered = await callTool("qclaw_list_laws", { fonction: "tarif" });
  add("list_laws : filtre fonction='tarif'", filtered.structuredContent?.count === 3,
    `count=${filtered.structuredContent?.count}`);

  const bySubject = await callTool("qclaw_list_laws", { subject: "louage-residentiel" });
  add("list_laws : filtre subject='louage-residentiel'",
    (bySubject.structuredContent?.count ?? 0) >= 3,
    `count=${bySubject.structuredContent?.count}`);

  const subs = await callTool("qclaw_list_subjects", {});
  add("list_subjects : 28 matières", subs.structuredContent?.count === 28,
    `count=${subs.structuredContent?.count}`);

  // Les 28 matières doivent être traduites : c'est la surface d'appariement du signal S1,
  // sans quoi le routeur reste muet en anglais.
  const subsEn = await callTool("qclaw_list_subjects", { lang: "en" });
  const sansEn = (subsEn.structuredContent?.subjects ?? [])
    .filter((s) => !s.label_en || !s.description_en).map((s) => s.id);
  add("list_subjects (lang=en) : les 28 matières traduites", sansEn.length === 0,
    sansEn.length ? `sans traduction : ${sansEn.slice(0, 5).join(", ")}…` : "");
  // Contrôler les ENTRÉES, pas seulement les en-têtes de groupe : une première version
  // traduisait « Private law (C.C.Q.) » tout en listant « biens — Biens » et sa description
  // française, et l'éval passait quand même.
  const texteEn = subsEn.content?.[0]?.text ?? "";
  // Marqueurs choisis parmi les libellés qui DIFFÈRENT réellement d'une langue à l'autre :
  // « Successions » et « Prescription » s'écrivent pareil en anglais et donneraient un faux positif.
  const ligneFr = texteEn.split("\n").find((l) =>
    /^\s+•/.test(l) && /— (Biens|Personnes|Famille|Preuve|Assurances)\b/.test(l));
  add("list_subjects (lang=en) : les ENTRÉES rendues en anglais",
    !ligneFr && /— Property\b/.test(texteEn) && /law\(s\)|law\(s\)/.test(texteEn.replace(/ law\(s\)/g, " law(s)")),
    ligneFr ? `entrée restée en français : ${ligneFr.trim().slice(0, 60)}` : "");
  add("list_subjects (lang=en) : descriptions rendues en anglais",
    /Ownership, co-ownership/.test(texteEn) && !/Propriété, copropriété/.test(texteEn));
  add("list_subjects (lang=en) : en-têtes de groupe en anglais",
    /Private law|Specialized areas/.test(texteEn) && !/Matières spécialisées/.test(texteEn));

  // Non-régression FR : la version française ne doit pas avoir basculé en anglais.
  const texteFr = subs.content?.[0]?.text ?? "";
  add("list_subjects (lang=fr) : rendu toujours en français",
    /— Biens\b/.test(texteFr) && /Matières spécialisées/.test(texteFr) && !/— Property\b/.test(texteFr));

  // 6 règlements de cour sous le chapitre C-25.01 (sur les 13 arêtes 'reglement-de' du corpus)
  const rel = await callTool("qclaw_related_laws", { law: "cpc", rel_type: "reglement-de" });
  add("related_laws : cpc a 6 règlements", rel.structuredContent?.total === 6,
    `total=${rel.structuredContent?.total}`);

  const bad = await callTool("qclaw_related_laws", { law: "inexistante" });
  add("related_laws : erreur actionnable si loi inconnue",
    bad.isError === true && /Lois disponibles/.test(bad.content?.[0]?.text ?? ""));

  // --- extraction : garde-fous contre les régressions trouvées en phase E ---

  // Le mode plage (from/to) dépend de l'échelle de articles.sort_key. Une divergence entre
  // le pipeline (Python) et le serveur (TS) l'avait vidé silencieusement sur 36 lois / 38.
  // On l'exerce donc sur TOUTES les lois, pas seulement sur ccq.
  const toutes = laws.structuredContent?.laws ?? [];
  const cassees = [];
  for (const l of toutes) {
    const r = await callTool("qclaw_get_articles", { law: l.id, from: "1", to: "3" });
    if (r.isError) cassees.push(l.id);
  }
  add("get_articles : mode plage opérant sur les 38 lois", cassees.length === 0,
    cassees.length ? `échec sur ${cassees.length} : ${cassees.slice(0, 6).join(", ")}…` : "");

  // D1 plafonne la complexité des motifs LIKE/GLOB : les chemins profonds du C.c.Q. le
  // dépassaient et faisaient échouer get_division / get_structure(root_path).
  const profond = "ga:l_cinquieme-gb:l_premier-gc:l_troisieme-gd:l_i-ge:l_1";
  const div = await callTool("qclaw_get_division", { law: "ccq", path: profond });
  add("get_division : chemin profond (55 car.) sans erreur D1", div.isError !== true,
    div.isError ? (div.content?.[0]?.text ?? "").slice(0, 90) : "");
  const stru = await callTool("qclaw_get_structure", { law: "ccq", root_path: profond });
  add("get_structure : root_path profond sans erreur D1", stru.isError !== true,
    stru.isError ? (stru.content?.[0]?.text ?? "").slice(0, 90) : "");

  // resolve_reference rendait silencieusement le MAUVAIS article de la MAUVAISE loi :
  // « c. T-16 » lui donnait l'article 16 du C.c.Q.
  const t16 = await callTool("qclaw_resolve_reference", { citation: "RLRQ, c. T-16, art. 12" });
  add("resolve_reference : chapitre RLRQ correctement reconnu",
    t16.structuredContent?.resolved?.law === "t-16" &&
    t16.structuredContent?.resolved?.number === "12",
    `obtenu ${t16.structuredContent?.resolved?.law}/${t16.structuredContent?.resolved?.number}`);
  const ccqRef = await callTool("qclaw_resolve_reference", { citation: "art. 1457 C.c.Q." });
  add("resolve_reference : abréviation C.c.Q. toujours reconnue",
    ccqRef.structuredContent?.resolved?.law === "ccq" &&
    ccqRef.structuredContent?.resolved?.number === "1457",
    `obtenu ${ccqRef.structuredContent?.resolved?.law}/${ccqRef.structuredContent?.resolved?.number}`);

  // Une source juridique sans date de consolidation n'est pas citable : les 38 doivent l'avoir.
  const sansDate = toutes.filter((l) => !l.consol_date_fr).map((l) => l.id);
  add("list_laws : date de consolidation sur les 38 lois", sansDate.length === 0,
    sansDate.length ? `manquante sur ${sansDate.length} : ${sansDate.slice(0, 5).join(", ")}…` : "");

  // Les identifiants Irosoft sont propres à la langue : une piste rendue en anglais doit
  // porter un chemin ANGLAIS, sinon get_division(lang='en') la refuse.
  const enLaws = await callTool("qclaw_list_laws", { lang: "en" });
  const ccqEn = enLaws.structuredContent?.laws?.find((l) => l.id === "ccq");
  const premier = ccqEn?.mapped_divisions?.[0];
  const ouvrable = premier
    ? await callTool("qclaw_get_division",
        { law: "ccq", lang: "en", path: premier.division_path, include_text: false })
    : { isError: true };
  add("list_laws (lang=en) : chemins de divisions ouvrables en anglais",
    ouvrable.isError !== true && !!premier?.heading,
    premier ? `${premier.division_path} / ${premier.heading}` : "aucune division mappée");

  // Un chapitre HORS corpus dont un chapitre du corpus est préfixe ne doit pas être avalé :
  // « c. B-1.1 » (Loi sur le bâtiment) rendait du b-1 (Loi sur le Barreau), en silence.
  const horsCorpus = await callTool("qclaw_resolve_reference", { citation: "RLRQ, c. B-1.1, art. 5" });
  add("resolve_reference : chapitre hors corpus refusé, pas rabattu sur un voisin",
    horsCorpus.isError === true,
    horsCorpus.isError ? "" : `résolu à tort en ${horsCorpus.structuredContent?.resolved?.law}`);

  // Marqueur « a. » (forme québécoise usuelle) : sans lui, le numéro du CHAPITRE était pris
  // pour l'article — « (chapitre T-16), a. 12 » rendait l'article 16.
  const marqueurA = await callTool("qclaw_resolve_reference",
    { citation: "Loi sur les tribunaux judiciaires (chapitre T-16), a. 12" });
  add("resolve_reference : marqueur « a. » et chapitre non confondu avec l'article",
    marqueurA.structuredContent?.resolved?.law === "t-16" &&
    marqueurA.structuredContent?.resolved?.number === "12",
    `obtenu ${marqueurA.structuredContent?.resolved?.law}/${marqueurA.structuredContent?.resolved?.number}`);

  const frEn = await callTool("qclaw_find_relevant", { query: "residential lease", lang: "en" });
  const s1 = (frEn.structuredContent?.candidates ?? []).find((c) => c.division_path);
  add("find_relevant (lang=en) : pas de chemin français dans une réponse anglaise",
    !s1 || !/l_(premier|deuxieme|troisieme|quatrieme|cinquieme|sixieme)/.test(s1.division_path),
    s1 ? s1.division_path : "aucun candidat de division");

  return checks;
}

// --- exécution ----------------------------------------------------------------

async function main() {
  console.log(`MCP : ${MCP_URL}\n`);
  await connect();

  let failed = 0;

  console.log("— Fumée des outils de découverte —");
  for (const c of await smokeTests()) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.nom}${c.ok || !c.detail ? "" : `  (${c.detail})`}`);
    if (!c.ok) failed++;
  }

  console.log(`\n— Évals du routeur (${EVALS.length}) —`);
  for (const e of EVALS) {
    const { failures, cands } = await runEval(e);
    if (failures.length) {
      failed++;
      console.log(`  ✗ « ${e.query} » — ${e.attendu}`);
      for (const f of failures) console.log(`      ${f}`);
      console.log(`      obtenu : ${cands.map(fmt).join(", ") || "(aucun)"}`);
    } else {
      console.log(`  ✓ « ${e.query} » — ${e.attendu}`);
      if (cands.length) console.log(`      ${cands.slice(0, 4).map(fmt).join(", ")}`);
    }
  }

  console.log(failed ? `\n❌ ${failed} échec(s).` : "\n✅ Tout passe.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  console.error("Le serveur est-il démarré ? (npx wrangler dev)");
  process.exit(1);
});
