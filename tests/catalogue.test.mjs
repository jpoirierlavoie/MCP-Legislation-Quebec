// Garde anti-dérive de la documentation (R10). node --test, SANS réseau, SANS D1, SANS
// serveur : une incohérence de documentation doit faire rougir une PR, pas exiger une
// infrastructure. Même précédent que scripts/check-consolidation.test.mjs, et tourne en CI.
//
// Ce que ce garde attrape : un outil ajouté, retiré ou renommé sans que la page suive ;
// une prose orpheline ; un titre qui diverge ; une prose unilingue ; une valeur de
// calibration RECOPIÉE dans la prose au lieu d'être importée ; un compteur périmé dans
// le README.
//
// Ce qu'il n'attrape PAS, et qu'aucun mécanisme n'attrapera : une description reformulée
// dont la prose de page devient fausse sans qu'aucune clé ne bouge. Seule la relecture
// humaine l'attrape — d'où la règle R10 dans CLAUDE.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (p) => readFileSync(join(ROOT, p), "utf-8");
const json = (p) => JSON.parse(lire(p));

const catalogue = json("catalogue.json");
const laws = json("laws.config.json").laws;
const taxonomy = json("taxonomy.json");
const toolsTs = lire("src/tools.ts");
const relevanceTs = lire("src/relevance.ts");
const readme = lire("README.md");

const RAPPEL =
  "Toute modification d'outil ou d'aide au repérage se fait à TROIS endroits : " +
  "src/tools.ts, catalogue.json (donc la page publique) et README.md. Voir R10 dans CLAUDE.md.";

/** Noms réellement enregistrés auprès du serveur MCP. */
const enregistres = [...toolsTs.matchAll(/registerTool\(\s*"(qclaw_[a-z_]+)"/g)].map((m) => m[1]);

test("parité : outils enregistrés <-> catalogue (dans les DEUX sens)", () => {
  // Garde-fou de regex morte : R2 interdit d'ajouter un outil sans approbation, donc
  // l'ensemble ne rétrécit pas tout seul. Si la regex casse, elle rend [] et on tombe ici.
  assert.ok(enregistres.length >= 10,
    `seulement ${enregistres.length} outils extraits de src/tools.ts — la regex a-t-elle cassé ?`);

  const docs = Object.keys(catalogue.tools);
  const manquants = enregistres.filter((n) => !docs.includes(n));
  const orphelins = docs.filter((n) => !enregistres.includes(n));
  assert.deepEqual(manquants, [], `outils SANS documentation de page : ${manquants.join(", ")}. ${RAPPEL}`);
  assert.deepEqual(orphelins, [], `documentation SANS outil correspondant : ${orphelins.join(", ")}. ${RAPPEL}`);
});

test("chaque outil du catalogue est complet et bilingue", () => {
  for (const [nom, t] of Object.entries(catalogue.tools)) {
    for (const champ of ["title_fr", "title_en", "groupe"]) {
      assert.ok(t[champ] && typeof t[champ] === "string", `${nom} : ${champ} manquant. ${RAPPEL}`);
    }
    assert.ok(["orientation", "extraction"].includes(t.groupe),
      `${nom} : groupe inattendu « ${t.groupe} » (orientation | extraction).`);
    for (const champ of ["page_fr", "page_en"]) {
      assert.ok(Array.isArray(t[champ]) && t[champ].length >= 2,
        `${nom} : ${champ} doit compter AU MOINS DEUX paragraphes — la consigne est ` +
        `« décrit en plusieurs phrases, pas une ligne ». ${RAPPEL}`);
    }
    // Bilinguisme RÉEL : ni copie du français, ni traduction-croupion.
    const fr = t.page_fr.join(" "), en = t.page_en.join(" ");
    assert.notEqual(fr, en, `${nom} : page_en est identique au français (copier-coller ?).`);
    const ratio = en.length / fr.length;
    assert.ok(ratio > 0.5 && ratio < 2,
      `${nom} : page_en fait ${Math.round(ratio * 100)} % de la longueur du français — traduction incomplète ?`);
  }
});

test("les titres servis par MCP sont ceux du catalogue (source unique)", () => {
  // src/tools.ts doit appeler titre("qclaw_x") — jamais un littéral. Un littéral rétablirait
  // la copie que le catalogue existe précisément pour supprimer.
  const litteraux = [...toolsTs.matchAll(/title:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(litteraux, [],
    `titres écrits en dur dans src/tools.ts : ${litteraux.join(" | ")} — utiliser titre("qclaw_…"). ${RAPPEL}`);
  for (const nom of enregistres) {
    assert.ok(toolsTs.includes(`titre("${nom}")`), `${nom} : le titre n'est pas tiré du catalogue. ${RAPPEL}`);
  }
});

test("les constantes de calibration citées existent et ne sont PAS recopiées", () => {
  const cites = Object.values(catalogue.retrieval)
    .filter((s) => s && Array.isArray(s.constantes))
    .flatMap((s) => s.constantes);
  assert.ok(cites.length > 0, "aucune constante citée — la section des aides au repérage a-t-elle été vidée ?");

  for (const c of cites) {
    assert.ok(
      new RegExp(`(export const ${c}\\b|^\\s*${c}:)`, "m").test(relevanceTs),
      `${c} est citée dans catalogue.json mais introuvable dans src/relevance.ts — ` +
      "la page décrirait une calibration qui n'existe plus.",
    );
  }

  // R10 : la prose dit ce que la constante FAIT ; elle n'écrit jamais sa VALEUR — la page
  // l'importe de src/relevance.ts. Un nombre recopié ici deviendrait faux en silence.
  const prose = JSON.stringify(catalogue.retrieval);
  for (const interdit of ["0,40", "0.40", "k = 60", "k=60"]) {
    assert.ok(!prose.includes(interdit),
      `la prose contient la valeur « ${interdit} » : importer la constante depuis ` +
      "src/relevance.ts et la rendre, ne pas l'écrire à la main (R10).");
  }
});

test("le catalogue ne contient aucune chaîne en forme de jeton", () => {
  // Paranoïa à coût nul : la page publique ne doit jamais transporter de secret.
  const brut = lire("catalogue.json");
  assert.ok(!/[0-9a-f]{32,}/i.test(brut), "chaîne hexadécimale de 32+ caractères dans catalogue.json.");
  assert.ok(!/\bBearer\b|[?&]key=/.test(brut), "forme d'authentification écrite dans catalogue.json.");
});

test("README : les décomptes dérivables des JSON versionnés sont exacts", () => {
  // Faits VIVANTS mais dérivables hors D1 : on les épingle. Reformuler la phrase oblige à
  // toucher ce test — friction assumée, même convention qu'ORDRE_ATTENDU côté pipeline.
  const attendus = [
    [/\*\*(\d+) lois et règlements\*\*/, laws.length, "nombre de lois"],
    [/les (\d+) tarifs/, laws.filter((l) => l.fonction === "tarif").length, "nombre de tarifs"],
    [/Les (\d+) matières/, taxonomy.subjects.length, "nombre de matières"],
  ];
  for (const [re, valeur, quoi] of attendus) {
    const m = readme.match(re);
    assert.ok(m, `${quoi} : la phrase attendue est introuvable dans README.md (reformulée ? ` +
      `mettre à jour tests/catalogue.test.mjs). Motif : ${re}`);
    assert.equal(Number(m[1]), valeur, `${quoi} : le README dit ${m[1]}, les données versionnées disent ${valeur}. ${RAPPEL}`);
  }
});

test("l'obligation des cinq surfaces est toujours inscrite (CLAUDE.md + README)", () => {
  // Une règle qui gouverne CHAQUE modification doit être elle-même protégée : sans ce
  // contrôle, elle pourrait disparaître d'un commit de nettoyage sans que rien ne bronche.
  const claude = lire("CLAUDE.md");
  assert.ok(/OBLIGATION PRÉALABLE À TOUTE MODIFICATION/.test(claude),
    "l'obligation préalable a disparu de CLAUDE.md — c'est la règle qui gouverne toute " +
    "modification du dépôt, elle ne se retire pas sans décision explicite de Jason.");
  for (const surface of ["Outils MCP", "Descriptions", "Schéma", "README.md", "Page publique"]) {
    assert.ok(claude.includes(surface),
      `la surface « ${surface} » a disparu du tableau des cinq surfaces (CLAUDE.md).`);
  }
  assert.ok(/tokens n['’]est JAMAIS une raison|tokens n['’]exempte de rien/.test(claude),
    "la mention « le coût en tokens n'exempte de rien » a disparu — c'est une consigne " +
    "explicite de Jason, elle est le cœur de la règle.");
  assert.ok(/CINQ surfaces/.test(readme),
    "README.md ne rappelle plus l'obligation des cinq surfaces (section « Pour les développeurs »).");
});

test("README : aucun décompte qui ne vit qu'en D1", () => {
  // Les comptes d'articles ne sont pas dérivables du dépôt : le README n'a pas le droit de
  // les énoncer (c'est ainsi qu'il a annoncé « ~46 000 articles » alors qu'il y en a 49 255).
  // Ils vivent sur la page publique, qui les calcule.
  const fautifs = [...readme.matchAll(/([~\d][\d\s  ]{2,})\s*articles?\b/gi)].map((m) => m[0].trim());
  assert.deepEqual(fautifs, [],
    `décompte d'articles écrit à la main dans README.md : « ${fautifs.join(" | ")} ». ` +
    "Ces chiffres ne vivent qu'en D1 : renvoyer à la page publique, qui les calcule (R10).");
});
