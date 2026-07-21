// Pilote du rattrapage des vecteurs (plan v2, 2.2).
//
//   node scripts/backfill-vectors.mjs                # tout le corpus (articles + divisions)
//   node scripts/backfill-vectors.mjs --kind articles --laws ccq,cpc
//   node scripts/backfill-vectors.mjs --resume       # reprend où le journal s'est arrêté
//
// Boucle sur POST /admin/backfill-vectors (Worker) avec le Bearer de backfill.token.
// Reprenable : journal local scripts/.backfill-progress.json ; les upserts étant
// idempotents, une reprise grossière ne crée aucun doublon.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BACKFILL_URL ?? "https://legislation.poirierlavoie.ca";
const PROGRESS = join(HERE, ".backfill-progress.json");

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const RESUME = process.argv.includes("--resume");

const token = readFileSync(join(HERE, "..", "backfill.token"), "utf-8").trim();
const config = JSON.parse(readFileSync(join(HERE, "..", "laws.config.json"), "utf-8"));
const allLaws = config.laws.map((l) => l.id);

const laws = (arg("laws", "") || allLaws.join(",")).split(",").filter(Boolean);
const kinds = (arg("kind", "") || "articles,divisions").split(",").filter(Boolean);

const progress = RESUME && existsSync(PROGRESS)
  ? JSON.parse(readFileSync(PROGRESS, "utf-8"))
  : {};

// Cadence : le WAF de la zone bloque les rafales de POST non-navigateur (constaté :
// page HTML de blocage après ~20 appels serrés). On espace les appels, on se présente
// avec un User-Agent de navigateur, et on recule LONGUEMENT en cas de blocage.
const PACE_MS = 500;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) qclaw-backfill";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(body, attempt = 1) {
  await sleep(PACE_MS);
  const res = await fetch(`${BASE}/admin/backfill-vectors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
    if (attempt < 7) {
      const wait = Math.min(60_000, 2000 * 2 ** (attempt - 1));
      console.log(`\n   retry ${attempt} dans ${wait / 1000}s (HTTP ${res.status}: ${text})`);
      await sleep(wait);
      return post(body, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

const t0 = Date.now();
let totalEmbedded = 0;
let totalOverruns = 0;

for (const kind of kinds) {
  for (const law of laws) {
    const key = `${kind}|${law}`;
    if (progress[key] === "done") { console.log(`— ${key} déjà fait —`); continue; }
    let offset = typeof progress[key] === "number" ? progress[key] : 0;
    for (;;) {
      const r = await post({ kind, law, offset });
      totalEmbedded += r.embedded;
      totalOverruns += r.overruns ?? 0;
      process.stdout.write(`\r${key}: ${r.next} embeddés (total ${totalEmbedded})   `);
      if (r.done) break;
      offset = r.next;
      progress[key] = offset;
      writeFileSync(PROGRESS, JSON.stringify(progress, null, 2));
    }
    progress[key] = "done";
    writeFileSync(PROGRESS, JSON.stringify(progress, null, 2));
    console.log("");
  }
}

const dt = Math.round((Date.now() - t0) / 1000);
console.log(`\nTerminé : ${totalEmbedded} vecteurs upsertés en ${dt}s ; ` +
  `${totalOverruns} texte(s) tronqué(s) à ~1500 tokens.`);
