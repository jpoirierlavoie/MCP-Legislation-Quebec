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
  const res = await callTool("qclaw_find_relevant", { query: e.query });
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

  // 6 règlements de cour sous le chapitre C-25.01 (sur les 13 arêtes 'reglement-de' du corpus)
  const rel = await callTool("qclaw_related_laws", { law: "cpc", rel_type: "reglement-de" });
  add("related_laws : cpc a 6 règlements", rel.structuredContent?.total === 6,
    `total=${rel.structuredContent?.total}`);

  const bad = await callTool("qclaw_related_laws", { law: "inexistante" });
  add("related_laws : erreur actionnable si loi inconnue",
    bad.isError === true && /Lois disponibles/.test(bad.content?.[0]?.text ?? ""));

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
