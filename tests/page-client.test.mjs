// Comportement du JavaScript CLIENT de la page publique — sans réseau, sans D1, en CI.
//
// POURQUOI CE FICHIER EXISTE. Les trois contrôles `page :` de tests/evals.mjs ne regardent
// que le HTML servi : statut, décompte de `data-law-id`, absence de jeton. Rien n'observait
// le comportement. Une refonte pouvait donc casser la bascule FR/EN, perdre le thème choisi
// ou laisser les deux langues visibles à la fois, et TOUT restait vert.
//
// Le défaut visé est précis et a failli passer : `BOOT` et le gestionnaire de langue
// affectaient `document.documentElement.className` EN BLOC. Poser une classe de thème sur
// le même élément la faisait effacer au premier clic sur la bascule de langue — silencieux,
// intermittent, et invisible à tout test de chaîne.
//
// Méthode : les deux blocs `String.raw` sont extraits de src/site.ts EN TANT QUE TEXTE
// (même approche que tests/catalogue.test.mjs sur src/tools.ts — ni compilation, ni
// navigateur) puis exécutés contre un DOM minimal. Ce qui est vérifié ici est le CONTRAT
// des deux classes sur <html> : elles se COMPOSENT, aucune n'écrase l'autre.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(RACINE, "src", "site.ts"), "utf8");

/** Extrait un littéral String.raw de src/site.ts. */
function bloc(nom) {
  const m = SRC.match(new RegExp(`const ${nom} = String\\.raw\`([\\s\\S]*?)\`;`));
  assert.ok(m, `bloc ${nom} introuvable dans src/site.ts`);
  return m[1];
}

const BOOT = bloc("BOOT");
const LARGE = (SRC.match(/const LARGE = "([^"]+)"/) ?? [])[1];

test("les blocs String.raw sont extractibles et sans backtick", () => {
  // Un backtick dans l'un de ces blocs FERME le littéral de gabarit : `tsc` le voit, mais
  // l'extraction ci-dessus deviendrait fausse en silence si le garde disparaissait.
  assert.ok(LARGE, "const LARGE introuvable");
  assert.ok(!BOOT.includes("`"), "BOOT contient un backtick");
  assert.ok(!bloc("JS").includes("`"), "JS contient un backtick");
});

test("le point de rupture n'est écrit qu'une fois (jeton LARGEUR)", () => {
  // Miroir de jsClient() : le JS client ne peut pas interpoler (String.raw), donc le
  // point de rupture y voyage sous forme de jeton. Sans jeton, matchMedia serait
  // éternellement faux et la barre latérale resterait repliée en grand écran, SANS erreur.
  assert.ok(bloc("JS").includes("LARGEUR"), "jeton LARGEUR absent du JS client");
  assert.ok(jsClient().includes(`min-width:${LARGE}`), "LARGEUR non substitué");
});

function jsClient() {
  return bloc("JS").replace("LARGEUR", LARGE);
}

// --- DOM minimal -------------------------------------------------------------
// Juste assez pour BOOT et les trois gestionnaires : classList réel (c'est LUI qu'on
// éprouve), localStorage, addEventListener, matchMedia, IntersectionObserver.

function scene({ langStockee = null, themeStocke = null, langue = "fr-CA", large = true } = {}) {
  const store = new Map();
  if (langStockee) store.set("qclawLang", langStockee);
  if (themeStocke) store.set("qclawTheme", themeStocke);

  const noeud = (id) => {
    const e = { id, className: "", lang: "", open: undefined, _h: {} };
    e.classList = {
      contains: (c) => e.className.split(/\s+/).filter(Boolean).includes(c),
      add(c) { if (!this.contains(c)) e.className = `${e.className} ${c}`.trim(); },
      remove(c) { e.className = e.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
      toggle(c, on) { if (on) this.add(c); else this.remove(c); },
    };
    e.addEventListener = (t, f) => { (e._h[t] ??= []).push(f); };
    e.click = () => (e._h.click ?? []).forEach((f) => f());
    e.querySelectorAll = () => [];
    return e;
  };

  const html = noeud("html");
  const bascule = noeud("bascule");
  const theme = noeud("theme");
  const tdm = noeud("tdm");
  const requetes = [];

  const globaux = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    navigator: { language: langue },
    matchMedia: (q) => {
      requetes.push(q);
      return { matches: large, addEventListener() {}, addListener() {} };
    },
    IntersectionObserver: class { observe() {} },
    document: {
      documentElement: html,
      getElementById: (i) => ({ bascule, theme }[i] ?? null),
      querySelector: (s) => (s === ".tdm" ? tdm : null),
    },
  };

  // Exécution des deux blocs avec les globaux injectés en paramètres — pas de fuite dans
  // l'environnement du test, et aucune dépendance à un navigateur.
  const noms = Object.keys(globaux);
  const lancer = (code) =>
    new Function(...noms, code)(...noms.map((n) => globaux[n]));

  lancer(BOOT);
  const demarrerJs = () => lancer(jsClient());
  const classes = () => html.className.split(/\s+/).filter(Boolean).sort().join(" ");
  return { html, bascule, theme, tdm, store, requetes, demarrerJs, classes };
}

// --- amorçage ----------------------------------------------------------------

test("amorçage à froid : français, thème automatique (aucune classe de thème)", () => {
  const s = scene();
  assert.equal(s.classes(), "l-fr");
  assert.equal(s.html.lang, "fr");
});

test("amorçage : la langue du navigateur est respectée", () => {
  assert.equal(scene({ langue: "en-CA" }).classes(), "l-en");
});

test("amorçage : les deux préférences stockées sont posées ENSEMBLE", () => {
  // Le cœur du contrat : className porte les DEUX dimensions, pas la dernière écrite.
  const s = scene({ langStockee: "en", themeStocke: "dark" });
  assert.equal(s.classes(), "l-en t-dark");
  assert.equal(s.html.lang, "en");
});

test("amorçage : un thème stocké aberrant est ignoré (retour à l'automatique)", () => {
  assert.equal(scene({ themeStocke: "sombre" }).classes(), "l-fr");
});

// --- thème -------------------------------------------------------------------

test("thème : cycle auto -> clair -> sombre -> auto", () => {
  const s = scene();
  s.demarrerJs();
  s.theme.click();
  assert.equal(s.classes(), "l-fr t-light");
  assert.equal(s.store.get("qclawTheme"), "light");
  s.theme.click();
  assert.equal(s.classes(), "l-fr t-dark");
  assert.equal(s.store.get("qclawTheme"), "dark");
  s.theme.click();
  // « auto » est l'ABSENCE des deux classes : c'est ce qui rend la main à la media query.
  assert.equal(s.classes(), "l-fr");
  assert.equal(s.store.has("qclawTheme"), false, "la clé doit être RETIRÉE, pas mise à 'auto'");
});

// --- le défaut visé ----------------------------------------------------------

test("RÉGRESSION : basculer la langue ne doit PAS effacer le thème", () => {
  const s = scene({ themeStocke: "dark" });
  s.demarrerJs();
  s.bascule.click();
  assert.equal(s.classes(), "l-en t-dark", "le thème a été écrasé par la bascule de langue");
  assert.equal(s.html.lang, "en");
  s.bascule.click();
  assert.equal(s.classes(), "l-fr t-dark");
  assert.equal(s.html.lang, "fr");
});

test("RÉGRESSION : basculer le thème ne doit PAS effacer la langue", () => {
  const s = scene({ langStockee: "en" });
  s.demarrerJs();
  s.theme.click();
  assert.equal(s.classes(), "l-en t-light");
  assert.equal(s.html.lang, "en", "l'attribut lang doit survivre au changement de thème");
});

test("une seule classe de langue à la fois (sinon les DEUX langues s'affichent)", () => {
  const s = scene();
  s.demarrerJs();
  for (let i = 0; i < 3; i++) {
    s.bascule.click();
    const c = s.html.className.split(/\s+/).filter(Boolean);
    assert.equal(c.filter((x) => x === "l-fr" || x === "l-en").length, 1, `après ${i + 1} clic(s)`);
  }
});

test("une seule classe de thème à la fois", () => {
  const s = scene();
  s.demarrerJs();
  for (let i = 0; i < 4; i++) {
    s.theme.click();
    const c = s.html.className.split(/\s+/).filter(Boolean);
    assert.ok(c.filter((x) => x === "t-light" || x === "t-dark").length <= 1, `après ${i + 1} clic(s)`);
  }
});

test("la préférence de langue survit à un rechargement", () => {
  const s = scene();
  s.demarrerJs();
  s.theme.click();
  s.bascule.click();
  const attendu = s.classes();
  const s2 = scene({
    langStockee: s.store.get("qclawLang"), themeStocke: s.store.get("qclawTheme"),
  });
  assert.equal(s2.classes(), attendu, "l'état rechargé diffère de l'état quitté");
});

// --- table des matières ------------------------------------------------------

test("TDM : dépliée au-dessus du point de rupture, repliée en dessous", () => {
  const large = scene({ large: true });
  large.demarrerJs();
  assert.equal(large.tdm.open, true);
  assert.ok(large.requetes.some((q) => q.includes(`min-width:${LARGE}`)),
    `aucune requête média sur ${LARGE}`);

  const etroit = scene({ large: false });
  etroit.demarrerJs();
  assert.equal(etroit.tdm.open, false);
});

test("la TDM couvre exactement les sections de premier niveau", () => {
  // SECTIONS est la source unique du <h2> de chaque section ET de son entrée de TDM.
  // Un id ajouté ici sans ancre dans le corps donnerait un lien mort, sans erreur.
  const ids = [...SRC.matchAll(/\{ id: "([a-z]+)",/g)].map((m) => m[1]);
  assert.ok(ids.length >= 5, "SECTIONS semble vide");
  for (const id of ids) {
    assert.ok(SRC.includes(`<section id="${id}"`), `aucune <section id="${id}"> dans le corps`);
    assert.ok(SRC.includes(`h2("${id}")`), `le <h2> de ${id} n'est pas tiré de SECTIONS`);
  }
});

// --- thème : couverture CSS --------------------------------------------------

test("aucune couleur en dur hors des deux jeux de variables", () => {
  // Une couleur littérale dans une règle de mise en page ne bascule PAS : la page reste
  // lisible, mais une surface garde son teint clair en mode sombre. Personne ne le voit
  // avant d'y être. Les seules couleurs autorisées sont dans CLAIR et SOMBRE.
  const css = (SRC.match(/const CSS = `([\s\S]*?)`;/) ?? [])[1];
  assert.ok(css, "bloc CSS introuvable");
  const sansJeux = css.replace(/\$\{(CLAIR|SOMBRE)\}/g, "");
  const dures = [...sansJeux.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(dures, [], `couleurs hors variables : ${dures.join(", ")}`);
});

test("les deux jeux de thème déclarent exactement les mêmes variables", () => {
  // Une variable présente dans un seul jeu hérite de l'autre thème : contraste cassé,
  // texte clair sur fond clair. Silencieux, et seulement dans UN des deux modes.
  const vars = (nom) => {
    const m = SRC.match(new RegExp(`const ${nom} = ([\\s\\S]*?);\\n`));
    assert.ok(m, `jeu ${nom} introuvable`);
    return [...m[1].matchAll(/(--[a-z-]+):/g)].map((x) => x[1]).sort();
  };
  assert.deepEqual(vars("CLAIR"), vars("SOMBRE"));
});
