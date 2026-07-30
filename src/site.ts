// Page publique servie à la racine (R10).
//
// PRINCIPE : la page ne RECOPIE rien. Les décomptes (lois, matières, articles, dates de
// consolidation) sont lus en D1 au rendu ; les titres d'outils viennent de catalogue.json
// (la même valeur que celle servie par tools/list) ; les valeurs de calibration sont
// importées de src/relevance.ts. C'est la réponse structurelle à la dérive constatée dans
// ce dépôt : un chiffre recopié dans de la prose devient faux en silence, sans qu'aucun
// test n'échoue.
//
// Le jeton d'accès n'apparaît JAMAIS ici, sous aucune forme : la page décrit un endpoint
// privé, elle ne le déverrouille pas. Elle n'appelle pas /mcp non plus — elle ne le
// pourrait pas, src/auth.ts refusant en 404 sans porteur.
//
// PIÈGE D'ÉCRITURE (cousin de l'invariant 11) : dans un littéral de gabarit NON balisé,
// `\d` devient `d` en silence. Le JS client est donc écrit en String.raw — et ne doit
// contenir aucun `${`, puisque String.raw interpole quand même.

import catalogue from "../catalogue.json";
import config from "../laws.config.json";
import { LawSummary, SubjectSummary, listLaws, listSubjects } from "./lib";
import {
  MAX_PER_SUBJECT, MAX_SUFFIX, RRF_K, SEMANTIC_MIN_SCORE, SPECIFIC_TOKEN_FACTOR,
  SPECIFIC_TOKEN_MAX_REACH, VECTOR_TOP_K, WEIGHTS,
} from "./relevance";

const CONTACT = "jason@poirierlavoie.ca";
const DEPOT = "https://github.com/jpoirierlavoie/MCP-Legislation-Quebec";
const LEGISQUEBEC = "https://www.legisquebec.gouv.qc.ca";

/**
 * URL officielles par loi. Lecture SEULE de laws.config.json via une Map — invariant 1 :
 * l'ordre du tableau est porteur, on n'y touche pas (aucun tri, aucune mutation).
 * `consolidation_source` est l'URL réelle de la page LégisQuébec : on ne la reconstruit
 * PAS à partir de la citation, une URL devinée pouvant pointer vers un autre texte.
 */
const SOURCES = new Map(
  config.laws.map((l) => [l.id, l.consolidation_source as { fr: string; en: string }]),
);

/** Échappement HTML — obligatoire sur TOUT champ venu de D1 (intitulés à apostrophes). */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Bloc bilingue : les deux langues sont émises, le CSS n'en montre qu'une. */
function bi(fr: string, en: string): string {
  return `<span data-l="fr">${esc(fr)}</span><span data-l="en">${esc(en)}</span>`;
}

/** Suite de paragraphes bilingues. */
function biP(fr: string[], en: string[]): string {
  return `<div data-l="fr">${fr.map((p) => `<p>${esc(p)}</p>`).join("")}</div>` +
    `<div data-l="en">${en.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
}

const FONCTION: Record<string, [string, string]> = {
  loi: ["Loi", "Statute"],
  reglement: ["Règlement", "Regulation"],
  "regles-procedure": ["Règles de procédure", "Rules of procedure"],
  tarif: ["Tarif", "Tariff"],
};

const nb = (n: number) => n.toLocaleString("fr-CA").replace(/ /g, " ");

// --- document ----------------------------------------------------------------

export async function renderSite(db: D1Database): Promise<string> {
  // lang="fr" DÉLIBÉRÉMENT : listLaws en "en" déclenche translatePaths par loi (N+1) pour
  // un bénéfice nul — la ligne `laws` porte déjà name_fr ET name_en, consol_date_fr ET _en.
  const [laws, subjects, map, counts] = await Promise.all([
    listLaws(db, {}, "fr"),
    listSubjects(db),
    db.prepare("SELECT subject_id, law_id FROM subject_map")
      .all<{ subject_id: string; law_id: string }>(),
    db.prepare("SELECT lang, COUNT(*) AS n FROM articles GROUP BY lang")
      .all<{ lang: string; n: number }>(),
  ]);

  const parMatiere = new Map<string, string[]>();
  for (const m of map.results) {
    const l = parMatiere.get(m.subject_id) ?? [];
    if (!l.includes(m.law_id)) l.push(m.law_id);
    parMatiere.set(m.subject_id, l);
  }
  const parId = new Map(laws.map((l) => [l.id, l]));
  const totalArticles = counts.results.reduce((n, r) => n + r.n, 0);
  const dates = laws.map((l) => l.consol_date_fr).filter(Boolean).sort();
  const consol = dates[dates.length - 1] ?? "—";

  const corps = [
    entete(),
    chiffres(laws.length, subjects.length, totalArticles, consol),
    corpus(laws, subjects, parMatiere, parId),
    outils(),
    reperage(),
    limites(),
    acces(),
    pied(consol),
  ].join("\n");

  return `<!doctype html>
<html lang="fr" class="l-fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lois du Québec — serveur MCP</title>
<meta name="description" content="Serveur MCP donnant un accès en lecture seule au texte officiel de la législation québécoise, en français et en anglais.">
<style>${CSS}</style>
<script>${BOOT}</script>
</head>
<body>
<main>
${corps}
</main>
<script>${JS}</script>
</body>
</html>`;
}

// --- sections ----------------------------------------------------------------

function entete(): string {
  return `<header>
  <div class="bar">
    <h1>${bi("Lois du Québec", "Laws of Québec")}</h1>
    <button id="bascule" type="button" title="Français / English">FR&nbsp;·&nbsp;EN</button>
  </div>
  ${biP(
    ["Serveur MCP donnant aux assistants IA un accès en lecture seule au texte officiel de la législation québécoise, en français et en anglais. Le texte des articles provient des EPUB officiels de LégisQuébec et est restitué verbatim : le serveur n'altère jamais le contenu officiel."],
    ["An MCP server giving AI assistants read-only access to the official text of Québec legislation, in French and English. Article text comes from the official LégisQuébec EPUBs and is returned verbatim: the server never alters official content."],
  )}
</header>`;
}

function chiffres(nLois: number, nMat: number, nArt: number, consol: string): string {
  return `<section class="chiffres">
  <div><b>${nb(nLois)}</b>${bi("lois et règlements", "statutes and regulations")}</div>
  <div><b>${nb(nMat)}</b>${bi("matières", "subjects")}</div>
  <div><b>${nb(nArt)}</b>${bi("articles (deux langues)", "articles (both languages)")}</div>
  <div><b>${esc(consol)}</b>${bi("consolidation la plus récente", "most recent consolidation")}</div>
</section>`;
}

function corpus(
  laws: LawSummary[], subjects: SubjectSummary[],
  parMatiere: Map<string, string[]>, parId: Map<string, LawSummary>,
): string {
  const lignes = laws.map((l) => {
    const [ffr, fen] = FONCTION[l.fonction ?? ""] ?? [l.fonction ?? "", l.fonction ?? ""];
    const src = SOURCES.get(l.id);
    const hay = `${l.rlrq_cite} ${l.name_fr} ${l.name_en} ${ffr} ${fen}`.toLowerCase();
    const lien = (u: string | undefined, t: string, lg: string) => u
      ? `<a data-l="${lg}" href="${esc(u)}" rel="noopener">${esc(t)}</a>`
      : `<span data-l="${lg}">${esc(t)}</span>`;
    return `<tr data-law-id="${esc(l.id)}" data-f="${esc(l.fonction)}" data-h="${esc(hay)}">
      <td class="cite">${esc(l.rlrq_cite)}</td>
      <td>${lien(src?.fr, l.name_fr, "fr")}${lien(src?.en, l.name_en, "en")}</td>
      <td>${bi(ffr, fen)}</td>
      <td class="n">${nb(l.article_count ?? 0)}</td>
      <td class="n">${esc(l.consol_date_fr ?? "—")}</td>
    </tr>`;
  }).join("\n");

  const groupe = (kind: string, tfr: string, ten: string) => {
    const items = subjects.filter((s) => s.kind === kind).map((s) => {
      const ids = parMatiere.get(s.id) ?? [];
      const lois = ids.map((id) => parId.get(id)).filter(Boolean).map((x) => {
        const l = x as LawSummary;
        return `<li>${bi(l.name_fr, l.name_en)} <span class="m">${esc(l.rlrq_cite)} · ${
          nb(l.article_count ?? 0)}&nbsp;art.</span></li>`;
      }).join("");
      return `<details>
        <summary>${bi(s.label_fr, s.label_en || s.label_fr)} <span class="m">(${ids.length})</span></summary>
        ${biP([s.description_fr ?? ""], [s.description_en ?? ""])}
        <ul class="lois">${lois}</ul>
      </details>`;
    }).join("\n");
    return `<h4>${bi(tfr, ten)}</h4>${items}`;
  };

  return `<section id="corpus">
  <h2>${bi("Le corpus", "The corpus")}</h2>
  ${biP(
    ["Tous les textes sont chargés dans les deux langues officielles, avec leur hiérarchie complète et leur date de consolidation. Les chiffres de cette page sont lus en base au moment du rendu : ils ne peuvent pas dériver de ce qui est réellement servi. Chaque titre renvoie au texte officiel sur LégisQuébec."],
    ["Every text is loaded in both official languages, with its full hierarchy and consolidation date. The figures on this page are read from the database at render time: they cannot drift from what is actually served. Each title links to the official text on LégisQuébec."],
  )}
  <div class="ctl">
    <input id="q" type="search" placeholder="Filtrer / Filter">
    <select id="f">
      <option value="">${"Toutes fonctions · All functions"}</option>
      <option value="loi">Loi · Statute</option>
      <option value="reglement">Règlement · Regulation</option>
      <option value="regles-procedure">Règles de procédure · Rules</option>
      <option value="tarif">Tarif · Tariff</option>
    </select>
    <span id="cpt" class="m"></span>
  </div>
  <div class="tw"><table id="t">
    <thead><tr>
      <th><button type="button" data-s="0">${bi("Citation", "Citation")}</button></th>
      <th><button type="button" data-s="1">${bi("Titre", "Title")}</button></th>
      <th><button type="button" data-s="2">${bi("Fonction", "Function")}</button></th>
      <th class="n"><button type="button" data-s="3">${bi("Articles", "Articles")}</button></th>
      <th class="n"><button type="button" data-s="4">${bi("À jour au", "As of")}</button></th>
    </tr></thead>
    <tbody>${lignes}</tbody>
  </table></div>

  <h3>${bi("Par matière", "By subject")}</h3>
  ${biP(
    ["La taxonomie range les textes en matières de droit privé, calquées sur les Livres du Code civil, et en matières spécialisées. Un même texte peut relever de plusieurs matières."],
    ["The taxonomy sorts texts into private-law subjects, mapped onto the Books of the Civil Code, and specialized subjects. A single text may belong to several subjects."],
  )}
  ${groupe("prive-ccq", "Droit privé (C.c.Q.)", "Private law (C.C.Q.)")}
  ${groupe("specialise", "Matières spécialisées", "Specialized subjects")}
</section>`;
}

function outils(): string {
  const bloc = (g: string) => Object.entries(catalogue.tools)
    .filter(([, t]) => t.groupe === g)
    .map(([nom, t]) => `<article>
      <h4><code>${esc(nom)}</code></h4>
      <p class="titre">${bi(t.title_fr, t.title_en)}</p>
      ${biP(t.page_fr, t.page_en)}
    </article>`).join("\n");

  return `<section id="outils">
  <h2>${bi("Les outils", "The tools")}</h2>
  ${biP(
    ["Le patron d'usage est en deux temps : s'orienter, puis extraire. Les premiers outils servent à trouver où regarder ; les suivants rendent le texte officiel. Tous sont en lecture seule — aucun n'écrit quoi que ce soit."],
    ["The usage pattern has two beats: orient yourself, then extract. The first tools find where to look; the rest return the official text. All are read-only — none writes anything."],
  )}
  <h3>${bi("S'orienter", "Orient")}</h3>
  ${bloc("orientation")}
  <h3>${bi("Extraire", "Extract")}</h3>
  ${bloc("extraction")}
</section>`;
}

function reperage(): string {
  const r = catalogue.retrieval;
  // Valeurs LUES dans src/relevance.ts — jamais recopiées (R10).
  const cal = `<ul class="cal">
    <li>${bi("matière", "subject")} <b>+${WEIGHTS.S1_SUBJECT}</b></li>
    <li>${bi("intitulé de division", "division heading")} <b>+${WEIGHTS.S2_DIVISION_HEADING}</b></li>
    <li>${bi("nom de loi", "statute name")} <b>+${WEIGHTS.S3_LAW_NAME}</b></li>
    <li>${bi("voisin de graphe", "graph neighbour")} <b>+${WEIGHTS.S4_GRAPH_NEIGHBOUR}</b></li>
    <li>${bi("candidats max par matière", "max candidates per subject")} <b>${MAX_PER_SUBJECT}</b></li>
    <li>${bi("suffixe max apparié", "max matched suffix")} <b>${MAX_SUFFIX}</b></li>
    <li>${bi("facteur de spécificité", "specificity factor")} <b>×${SPECIFIC_TOKEN_FACTOR}</b> ${
      bi(`jusqu'à ${SPECIFIC_TOKEN_MAX_REACH} textes`, `up to ${SPECIFIC_TOKEN_MAX_REACH} texts`)}</li>
    <li>${bi("plancher sémantique", "semantic floor")} <b>${SEMANTIC_MIN_SCORE}</b></li>
    <li>${bi("fusion RRF", "RRF fusion")} <b>k&nbsp;=&nbsp;${RRF_K}</b>, ${
      bi(`profondeur ${VECTOR_TOP_K}`, `depth ${VECTOR_TOP_K}`)}</li>
  </ul>`;

  const sec = (s: { titre_fr: string; titre_en: string; corps_fr: string[]; corps_en: string[] }) =>
    `<h3>${bi(s.titre_fr, s.titre_en)}</h3>${biP(s.corps_fr, s.corps_en)}`;

  return `<section id="reperage">
  <h2>${bi("Les aides au repérage", "Retrieval aids")}</h2>
  ${biP(r.intro_fr, r.intro_en)}
  ${sec(r.signaux)}
  ${cal}
  ${sec(r.echelle)}
  ${sec(r.hybride)}
</section>`;
}

function limites(): string {
  const a = catalogue.avertissement;
  return `<section id="limites" class="avert">
  <h2>${bi(a.titre_fr, a.titre_en)}</h2>
  ${biP(a.corps_fr, a.corps_en)}
</section>`;
}

function acces(): string {
  return `<section id="acces">
  <h2>${bi("Accès", "Access")}</h2>
  ${biP(
    [`Ce serveur est une instance privée. L'endpoint MCP exige un jeton d'accès : une requête sans jeton n'obtient rien. Pour en demander l'accès, écrire à ${CONTACT}.`,
      "Le code source est public et le corpus est reproductible : le pipeline d'ingestion, la taxonomie et les données de configuration sont tous versionnés."],
    [`This server is a private instance. The MCP endpoint requires an access token: a request without one gets nothing. To request access, write to ${CONTACT}.`,
      "The source code is public and the corpus is reproducible: the ingestion pipeline, the taxonomy and the configuration data are all version-controlled."],
  )}
  <p><a href="${DEPOT}" rel="noopener">${esc(DEPOT.replace("https://", ""))}</a></p>
</section>`;
}

function pied(consol: string): string {
  return `<footer>
  <p><b>Jason Poirier Lavoie</b>, ${bi("avocat", "attorney")} · <a href="mailto:${CONTACT}">${CONTACT}</a></p>
  ${biP(
    [`Données : EPUB officiels de LégisQuébec (Éditeur officiel du Québec) ; consolidation la plus récente chargée : ${consol}. La version officielle fait foi.`],
    [`Data: official LégisQuébec EPUBs (Québec Official Publisher); most recent consolidation loaded: ${consol}. The official version prevails.`],
  )}
  <p><a href="${LEGISQUEBEC}" rel="noopener">legisquebec.gouv.qc.ca</a> · <a href="${DEPOT}" rel="noopener">GitHub</a></p>
</footer>`;
}

// --- CSS / JS ----------------------------------------------------------------
// Autonomes : aucune police distante, aucun CDN. Sans JavaScript, le FRANÇAIS s'affiche
// et tout le contenu reste lisible (le filtre et le tri sont des agréments, pas le fond).

const CSS = `
:root{--f:#111;--m:#666;--b:#e2e0da;--a:#7a2e1d;--bg:#fdfcfa}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--f);font:16px/1.6 Georgia,'Times New Roman',serif}
main{max-width:60rem;margin:0 auto;padding:2rem 1.25rem 4rem}
h1{font-size:1.6rem;margin:0}
h2{font-size:1.35rem;margin:2.75rem 0 .75rem;padding-bottom:.3rem;border-bottom:2px solid var(--b)}
h3{font-size:1.1rem;margin:1.75rem 0 .5rem}
h4{font-size:1rem;margin:1.25rem 0 .25rem}
p{margin:.6rem 0}
a{color:var(--a)}
code{font:.9em ui-monospace,Menlo,Consolas,monospace;background:#f2efe9;padding:.1em .35em;border-radius:3px}
.bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
#bascule{font:inherit;font-size:.8rem;letter-spacing:.05em;background:none;border:1px solid var(--b);
  border-radius:999px;padding:.35rem .9rem;cursor:pointer;color:var(--m)}
#bascule:hover{border-color:var(--a);color:var(--a)}
.chiffres{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:1rem;
  margin:2rem 0;padding:1.25rem;background:#fff;border:1px solid var(--b);border-radius:6px}
.chiffres div{text-align:center}
.chiffres b{display:block;font-size:1.5rem;line-height:1.2}
.chiffres span{font-size:.8rem;color:var(--m)}
.ctl{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin:1rem 0}
.ctl input,.ctl select{font:inherit;font-size:.9rem;padding:.4rem .6rem;border:1px solid var(--b);
  border-radius:4px;background:#fff}
.ctl input{flex:1;min-width:10rem}
.m{color:var(--m);font-size:.85rem}
.tw{overflow-x:auto;border:1px solid var(--b);border-radius:6px;background:#fff}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{padding:.5rem .7rem;text-align:left;border-bottom:1px solid var(--b);vertical-align:top}
th{background:#f7f5f1;position:sticky;top:0}
th button{font:inherit;font-weight:700;background:none;border:0;padding:0;cursor:pointer;color:inherit}
td.n,th.n{text-align:right;white-space:nowrap}
td.cite{white-space:nowrap;font-size:.85em;color:var(--m)}
tbody tr:hover{background:#faf8f4}
details{border:1px solid var(--b);border-radius:6px;background:#fff;margin:.5rem 0;padding:.6rem .9rem}
summary{cursor:pointer;font-weight:700}
.lois{margin:.5rem 0 0;padding-left:1.2rem}
.lois li{margin:.2rem 0}
#outils article{border-left:3px solid var(--b);padding-left:1rem;margin:1.5rem 0}
#outils .titre{color:var(--m);font-style:italic;margin:.1rem 0 .5rem}
.cal{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));
  gap:.4rem;margin:1rem 0;font-size:.9rem}
.cal li{background:#fff;border:1px solid var(--b);border-radius:4px;padding:.4rem .7rem;
  display:flex;justify-content:space-between;gap:.5rem}
.avert{background:#fbf7f1;border:1px solid #e6d9c6;border-radius:6px;padding:.25rem 1.25rem 1rem}
footer{margin-top:3.5rem;padding-top:1.25rem;border-top:2px solid var(--b);font-size:.9rem;color:var(--m)}
html.l-fr [data-l=en],html.l-en [data-l=fr]{display:none}
@media(prefers-color-scheme:dark){
  :root{--f:#e8e6e1;--m:#a09a90;--b:#3a372f;--a:#e08b6a;--bg:#16150f}
  .chiffres,.tw,details,.cal li{background:#1e1c16}
  th{background:#252219}
  code{background:#252219}
  .ctl input,.ctl select{background:#1e1c16;color:var(--f)}
  tbody tr:hover{background:#242118}
  .avert{background:#211d15;border-color:#3d3527}
}
`;

// Amorçage synchrone : pose la langue AVANT le premier rendu (pas de scintillement).
const BOOT = String.raw`
try{var p=localStorage.getItem('qclawLang')||(navigator.language||'fr').slice(0,2);
document.documentElement.className=(p==='en'?'l-en':'l-fr');
document.documentElement.lang=(p==='en'?'en':'fr');}catch(e){}
`;

// AUCUN `${` ici (String.raw interpole quand même) et aucune regex (les antislashs d'un
// gabarit non balisé seraient mangés — d'où String.raw, et la prudence en prime).
const JS = String.raw`
(function(){
  var d=document, h=d.documentElement;
  var b=d.getElementById('bascule');
  if(b) b.addEventListener('click',function(){
    var en=h.classList.contains('l-en');
    h.className=en?'l-fr':'l-en'; h.lang=en?'fr':'en';
    try{localStorage.setItem('qclawLang',en?'fr':'en');}catch(e){}
  });

  var t=d.getElementById('t'); if(!t) return;
  var body=t.tBodies[0], rows=[].slice.call(body.rows);
  var q=d.getElementById('q'), f=d.getElementById('f'), cpt=d.getElementById('cpt');

  function fold(s){
    s=s.toLowerCase().normalize('NFD');
    var o='';
    for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);if(c<768||c>879)o+=s[i];}
    return o;
  }
  function filtre(){
    var needle=fold(q?q.value:''), fonction=f?f.value:'', n=0;
    for(var i=0;i<rows.length;i++){
      var r=rows[i];
      var ok=(!fonction||r.getAttribute('data-f')===fonction) &&
             (!needle||fold(r.getAttribute('data-h')).indexOf(needle)>-1);
      r.hidden=!ok; if(ok)n++;
    }
    if(cpt) cpt.textContent=n+' / '+rows.length;
  }
  if(q) q.addEventListener('input',filtre);
  if(f) f.addEventListener('change',filtre);
  filtre();

  var sens={};
  [].forEach.call(t.querySelectorAll('th button'),function(btn){
    btn.addEventListener('click',function(){
      var i=+btn.getAttribute('data-s'); sens[i]=!sens[i];
      var num=(i===3);
      rows.sort(function(a,c){
        var x=a.cells[i].textContent.trim(), y=c.cells[i].textContent.trim();
        var v=num?(parseInt(x.replace(/[^0-9]/g,''),10)||0)-(parseInt(y.replace(/[^0-9]/g,''),10)||0)
                 :x.localeCompare(y,'fr');
        return sens[i]?v:-v;
      });
      for(var k=0;k<rows.length;k++) body.appendChild(rows[k]);
    });
  });
})();
`;
