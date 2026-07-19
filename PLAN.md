# Plan de réalisation — Serveur MCP « Lois du Québec » sur Cloudflare Workers

**Objet.** Un serveur MCP distant, hébergé sur Cloudflare Workers, qui met à la
disposition d'assistants IA le texte officiel de lois clés du Québec — d'abord le
Code civil du Québec (C.c.Q.) et le Code de procédure civile (C.p.c.), extensible
à d'autres — en français **et** en anglais, rafraîchi de façon semestrielle à
partir des EPUB de LégisQuébec.

**Destinataire.** Ce document est conçu pour servir à la fois de guide humain et
de cahier des charges à remettre à Claude Code (voir §10). Déposez-le à la racine
du dépôt sous le nom `PLAN.md`.

**Périmètre.** Le serveur sert le **texte littéral de la loi**, avec sa hiérarchie
et ses métadonnées. Il ne contient **ni jurisprudence ni annotations** — c'est un
problème distinct, tributaire de sources sous licence (SOQUIJ, etc.). Ne pas
mélanger.

---

## 1. Architecture

Deux composants dans un même dépôt, avec une frontière nette entre l'ingestion
(lourde, semestrielle) et le service (léger, en lecture seule).

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  A. Pipeline d'ingestion     │        │  B. Worker de service (MCP)   │
│  (script Python, batch)      │        │  (Cloudflare Worker)          │
│                              │        │                              │
│  fetch EPUB (FR+EN)          │        │  Agents SDK : McpAgent/       │
│   → dézippe                  │  écrit │   McpServer (HTTP streamable) │
│   → parse OPF + nav + XHTML  │ ─────▶ │  Outils en lecture seule sur  │
│   → normalise                │  D1    │   D1 : article, plage,        │
│   → charge dans D1           │        │   division, structure,        │
│  (GitHub Actions, cron 2×/an)│        │   recherche plein texte       │
└─────────────────────────────┘        └──────────────────────────────┘
          │                                        │
          ▼ (archive facultative)                  ▼
     R2 : EPUB bruts datés                    D1 : magasin interrogeable
```

**Pourquoi ce découpage.** Le dézippage et l'analyse d'un EPUB volumineux (le
C.c.Q. compte plus de 3 100 articles) est un traitement par lots mal adapté aux
limites CPU d'un Worker en contexte requête. On l'exécute donc hors ligne, de
façon planifiée, et le Worker ne fait que **servir** des lectures rapides sur D1.
Cela colle aussi à la nature « donnée de référence quasi statique » du corpus.

**Stockage.** D1 (SQLite serverless) est le magasin d'interrogation : il gère la
recherche exacte par numéro, les plages, la traversée de hiérarchie et la
recherche plein texte. R2 est facultatif, pour archiver les EPUB sources datés
(provenance/audit).

**Langages (polyglotte).** Le composant lourd — le pipeline (§4) — s'écrit en
**Python** (meilleur outillage EPUB/XHTML) et tourne hors de Workers. Le composant
mince — le Worker de service (§5) — reste en **TypeScript**, seule voie clé en main
de Cloudflare pour un serveur MCP. La frontière à deux composants ci-dessus rend ce
mélange naturel : chaque composant garde son langage optimal, sans que rien ne les
oblige à partager le même.

---

## 2. Modèle de données (schéma D1)

```sql
-- Une ligne par loi
CREATE TABLE laws (
  id            TEXT PRIMARY KEY,        -- 'ccq', 'cpc', ...
  name_fr       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  rlrq_cite     TEXT NOT NULL,           -- 'RLRQ, c. CCQ-1991'
  consol_date_fr TEXT,                   -- 'à jour au' (ISO 8601)
  consol_date_en TEXT
);

-- Noeuds de hiérarchie (Livre/Titre/Chapitre/Section/Sous-section)
CREATE TABLE divisions (
  id         INTEGER PRIMARY KEY,
  law_id     TEXT NOT NULL REFERENCES laws(id),
  lang       TEXT NOT NULL,              -- 'fr' | 'en'
  kind       TEXT NOT NULL,              -- 'livre','titre','chapitre','section','sous-section','niveau6/7/8','disposition'
  number     TEXT,                       -- 'TROISIÈME', 'I', '§ 1', ...
  heading    TEXT,                       -- intitulé (peut manquer : divisions abrogées)
  history    TEXT,                       -- historique de division (89 cas), sinon NULL
  path       TEXT NOT NULL,              -- chemin = l'id Irosoft complet, ex. 'ga:l_premier-gb:l_troisieme-gc:l_premier'
  repealed   INTEGER NOT NULL DEFAULT 0, -- 1 si division abrogée (3 cas)
  parent_id  INTEGER REFERENCES divisions(id),
  sort_order INTEGER NOT NULL
);

-- Une ligne par article par langue
CREATE TABLE articles (
  id            INTEGER PRIMARY KEY,
  law_id        TEXT NOT NULL REFERENCES laws(id),
  lang          TEXT NOT NULL,
  number        TEXT NOT NULL,           -- '1457', '2926.1', '132.0.1' (chaîne : décimaux à 1-2 niveaux)
  sort_key      INTEGER NOT NULL,        -- clé 64 bits (voir note) : n×10^6 + d1×10^3 + d2
  division_id   INTEGER REFERENCES divisions(id),
  division_path TEXT NOT NULL,           -- id Irosoft de la division feuille (dénormalisé)
  text          TEXT NOT NULL,           -- verbatim (numéro, historique et notes A.M. EXCLUS)
  html          TEXT,                    -- HTML nettoyé (integrity:* retirés, liens en absolu)
  history       TEXT,                    -- ligne d'historique : '1991, c. 64, a. 1457; ...'
  repealed      INTEGER NOT NULL DEFAULT 0, -- 1 si '(Abrogé).' (68 cas)
  consol_date   TEXT
);

CREATE INDEX idx_art_lookup    ON articles(law_id, lang, number);
CREATE INDEX idx_art_division  ON articles(law_id, lang, division_path);
CREATE INDEX idx_art_sort      ON articles(law_id, lang, sort_key);
CREATE INDEX idx_div_parent    ON divisions(parent_id);
CREATE INDEX idx_div_path      ON divisions(law_id, lang, path);

-- Recherche plein texte (voir §12 : confirmer le support FTS5 de D1)
CREATE VIRTUAL TABLE articles_fts USING fts5(
  text,
  law_id UNINDEXED, lang UNINDEXED, number UNINDEXED,
  content='articles', content_rowid='id'
);
```

**Note sur `sort_key` (révisée en phase 0).** Le corpus contient des décimaux à
**deux** niveaux (p. ex. `132.0.1`), donc une clé à 2 composantes est insuffisante.
Formule retenue : `n×10^6 + d1×10^3 + d2` (ex. `1457` → 1 457 000 000 ;
`2926.1` → 2 926 001 000 ; `132.0.1` → 132 000 001). Entier **64 bits** (le maximum
~3,17×10⁹ dépasse int32) — `INTEGER` SQLite/D1 le gère nativement. Préserve l'ordre
au passage d'un Livre à l'autre (898 < 898.1 < 899).

---

## 3. Surface d'outils MCP (le schéma « clair et accessible »)

Convention : préfixe cohérent `qclaw_`, noms orientés action, schémas Zod avec
descriptions et exemples, **tous en lecture seule** (`readOnlyHint: true`,
`idempotentHint: true`, `destructiveHint: false`, `openWorldHint: false`). Chaque
outil renvoie du texte **et** un `structuredContent` (métadonnées), et des erreurs
**actionnables**.

| Outil | Paramètres | Retour | Couvre |
|---|---|---|---|
| `qclaw_list_laws` | `lang?` | Catalogue : id, noms FR/EN, langues dispo, date de consolidation courante | Découverte |
| `qclaw_get_article` | `law`, `article`, `lang='fr'` | Texte verbatim + citation RLRQ + chemin hiérarchique + date de consolidation + historique | Article individuel |
| `qclaw_get_articles` | `law`, (`from`,`to`) **ou** `numbers[]`, `lang='fr'`, `limit?`, `offset?` | Tableau d'articles (paginé) | Plages / listes |
| `qclaw_get_division` | `law`, `path` **ou** `division_id`, `lang='fr'`, `include_text=true`, `limit?`, `offset?` | La division (Livre/Titre/Chapitre/Section) : intitulé, sous-structure, articles (paginés) | Parties entières |
| `qclaw_get_structure` | `law`, `lang='fr'`, `root_path?`, `depth?` | **Arbre hiérarchique** des divisions (Livre → Titre → Chapitre → Section → Sous-section) : intitulé, numéro, type et le `path`/`division_id` de chaque nœud — **sans** texte d'article | **Énumération / navigation** : l'IA explore l'arbre, puis cible une partie |
| `qclaw_search_text` | `query`, `law?` (déf. toutes), `lang='fr'`, `limit=10`, `offset?` | Correspondances classées : loi, article, extrait, chemin | Recherche plein texte |
| `qclaw_resolve_reference` *(phase 2)* | `citation` (texte libre, ex. « art. 1457 C.c.Q. »), `lang='fr'` | L'article résolu (comme `get_article`) | Aide au flux Athéna |

`qclaw_resolve_reference` est le pont direct vers votre cas d'usage : on lui passe
une chaîne de citation extraite d'un dossier Pallas Athéna, il rend le texte
officiel exact.

**Parcours d'exploration prévu (énumérer → choisir → extraire).**
`qclaw_get_structure` est l'outil qui permet à l'IA de **s'informer avant
d'extraire**. Elle appelle d'abord `get_structure` pour parcourir l'arborescence
(titres, chapitres, sections, sous-sections) **sans charger de texte**, repère la
partie pertinente d'après les intitulés, récupère son `path` ou `division_id`, puis
appelle `qclaw_get_division` sur ce nœud pour en extraire le texte. Le paramètre
`depth` permet de commencer par une vue de surface (livres et titres) puis de
descendre progressivement; `root_path` restreint l'affichage à un sous-arbre. C'est
le mécanisme qui évite d'extraire une partie de loi au hasard : on **navigue**
d'abord, on extrait **ensuite** le bon morceau. `get_structure` (énumération) et
`get_division` (extraction) forment donc une paire — l'un pour choisir, l'autre
pour obtenir.

Exemple de définition (Agents SDK + Zod) :

```ts
this.server.registerTool(
  "qclaw_get_article",
  {
    description:
      "Retourne le texte officiel verbatim d'un article d'une loi du Québec, " +
      "avec sa citation, son chemin hiérarchique et sa date de consolidation. " +
      "Exemple : law='ccq', article='1457', lang='fr'.",
    inputSchema: {
      law: z.string().describe("Identifiant de la loi, ex. 'ccq', 'cpc'"),
      article: z.string().describe("Numéro d'article, ex. '1457', '2926.1' ; ou 'préliminaire'/'finales' pour les dispositions"),
      lang: z.enum(["fr", "en"]).default("fr"),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ law, article, lang }) => {
    const row = await env.DB.prepare(
      "SELECT * FROM articles WHERE law_id=? AND lang=? AND number=?"
    ).bind(law, lang, article).first();

    if (!row) {
      // Erreur actionnable : proposer les voisins
      const near = await env.DB.prepare(
        "SELECT number FROM articles WHERE law_id=? AND lang=? ORDER BY ABS(sort_key - ?) LIMIT 5"
      ).bind(law, lang, sortKeyOf(article)).all();
      return {
        content: [{ type: "text", text:
          `Article ${article} introuvable dans ${law} (${lang}). ` +
          `Vérifiez le numéro et la loi. Articles proches : ${near.results.map(r=>r.number).join(", ")}.` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: row.text }],
      structuredContent: {
        law: law, number: row.number, citation: `${row.rlrq_cite ?? ""}, art. ${row.number}`,
        path: row.division_path, consolidation: row.consol_date, history: row.history,
      },
    };
  }
);
```

---

## 4. Composant A — Pipeline d'ingestion

Un script **Python** (`pipeline/`), exécutable localement ou en CI — c'est le
composant « lourd », qui tourne hors de Workers en CPython complet. Bibliothèques
suggérées : `httpx` (téléchargement), `ebooklib` (lecture EPUB : conteneur, OPF,
navigation), `lxml` ou `BeautifulSoup` (parcours XHTML). Étapes :

1. Lire `laws.config.json` (§8) : la liste des lois avec leurs URL d'EPUB
   LégisQuébec (FR + EN) et métadonnées.
2. Pour chaque loi × langue : **télécharger l'EPUB** (une archive ZIP).
3. **Dézipper.** Lire `META-INF/container.xml` → localiser le fichier `.opf`.
4. **Parser l'OPF** : ordre du `spine` + métadonnées (dont la date « à jour au »
   si présente, sinon la capturer depuis la page de la loi).
5. **Lire le document de navigation** (`nav.xhtml` ou `toc.ncx`) pour l'arbre
   hiérarchique.
6. **Parcourir les XHTML** dans l'ordre du spine, en maintenant une **pile de
   divisions courantes** : détecter les intitulés de division et les bornes
   d'articles; extraire numéro, texte, HTML, ligne d'historique; attribuer à
   chaque article son chemin de division.
7. **Normaliser** en lignes; calculer `sort_key`.
8. **Charger dans D1** via l'**API HTTP de D1** (ou en générant un fichier `.sql`
   passé à `wrangler d1 execute`) — depuis Python, l'API HTTP est le chemin direct.
   Écrire d'abord dans des tables de **staging**, **valider les compteurs** (voir
   garde-fous §10), puis basculer — afin qu'un parse raté ne corrompe jamais le
   magasin en service.
9. *(Facultatif)* Archiver l'EPUB brut dans R2, daté.
10. Émettre un **résumé** (nombre d'articles par loi/langue) pour vérification.

> ⚠️ **Étape 0, préalable et non négociable.** La structure XHTML interne exacte
> (éléments/classes marquant divisions et articles) **doit être constatée sur un
> vrai EPUB** avant d'écrire le parseur. Ne présumez pas des sélecteurs. Voir la
> phase 0 du §10.

**Particularités à gérer :** décimaux du C.c.Q. (`2926.1`, et à deux niveaux
`132.0.1`); **recodification 2016
du C.p.c.** (la nouvelle numérotation ne correspond pas à l'ancienne — décider si
l'on couvre l'ancien C.p.c. et stocker le schéma de numérotation); dispositions
préliminaires et transitoires.

---

## 5. Composant B — Worker de service (le MCP)

Stack : **TypeScript**, **Cloudflare Agents SDK** (`McpAgent` / `McpServer`),
transport **HTTP streamable** en JSON sans état. Le Worker déclare un binding D1
et n'expose que les outils du §3.

Ce composant **reste en TypeScript par choix** : c'est la voie clé en main de
Cloudflare pour un serveur MCP (l'Agents SDK n'existe qu'en TS/JS), et il est mince
— de simples handlers en lecture sur D1. Le dépôt est donc **polyglotte** : pipeline
Python (§4) + Worker TypeScript.

`wrangler.jsonc` (extrait) :

```jsonc
{
  "name": "qclaw-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    { "binding": "DB", "database_name": "qclaw", "database_id": "<D1_ID>" }
  ],
  // Rafraîchissement côté Cloudflare (option native — voir §6)
  "triggers": { "crons": ["0 9 5 1,7 *"] }  // 5 janv. et 5 juil., 09:00 UTC
}
```

Bonnes pratiques MCP appliquées : descriptions concises avec exemples;
`structuredContent` en sortie; **pagination** partout où un résultat peut être
volumineux (une division « Livre » entière, une recherche); messages d'erreur qui
orientent (numéro voisin, loi inexistante → lister les `id` disponibles).

---

## 6. Rafraîchissement semestriel

Trois options, par ordre de préférence :

**(a) GitHub Actions, cron 2×/an — recommandé.** Le pipeline (§4) tourne en CI,
parse hors des contraintes Workers, puis pousse vers D1. Vous utilisez déjà
GitHub (commits signés). Fichier `.github/workflows/refresh.yml` :

```yaml
name: refresh-statutes
on:
  schedule:
    - cron: "0 9 5 1,7 *"      # 5 janvier et 5 juillet, 09:00 UTC
  workflow_dispatch: {}         # déclenchement manuel à la demande
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r pipeline/requirements.txt
      - run: python -m pipeline.ingest     # exécute le pipeline, charge D1
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

**(b) Cloudflare Cron Trigger + Workflow — tout sur Cloudflare.** Le `scheduled()`
handler déclenche un **Cloudflare Workflow** (durable, multi-étapes, avec reprise)
qui fait fetch → parse → charge. Plus « intégré », mais il faut gérer le poids du
parse (Workflows conviennent mieux qu'un Worker simple pour ça).

**(c) Manuel.** À une fréquence semestrielle, une commande documentée
(`python -m pipeline.ingest`) lancée quand vous constatez une nouvelle consolidation
est parfaitement défendable et la plus simple. Gardez-la de toute façon comme filet.

> LégisQuébec ne publie pas à date fixe; le semestriel est une cadence
> raisonnable, mais prévoyez le déclenchement manuel (`workflow_dispatch`) pour
> réagir à une consolidation hors calendrier.

---

## 7. Contrôle d'accès

Le corpus est du droit public (faible sensibilité), mais on ne veut pas d'un point
d'accès ouvert à tous vents. Recommandation : **Cloudflare Access (Zero Trust)**
devant le Worker — Cloudflare documente explicitement la sécurisation des serveurs
MCP par Access, avec obtention d'un jeton à la connexion. Alternative légère : un
jeton porteur. Dans les deux cas, le serveur reste **entièrement séparé** du
périmètre Firebase qui héberge Pallas Athéna et vos données clients.

---

## 8. Configuration extensible

Ajouter une loi = ajouter une entrée et relancer le pipeline. `laws.config.json` :

```jsonc
{
  "laws": [
    {
      "id": "ccq",
      "name_fr": "Code civil du Québec",
      "name_en": "Civil Code of Québec",
      "rlrq_cite": "RLRQ, c. CCQ-1991",
      "epub": {
        "fr": "https://www.legisquebec.gouv.qc.ca/fr/epub/cs/CCQ-1991.epub",
        "en": "https://www.legisquebec.gouv.qc.ca/en/epub/cs/CCQ-1991.epub"
      },
      "numbering": "decimal"     // gère '2926.1', '132.0.1'
    },
    {
      "id": "cpc",
      "name_fr": "Code de procédure civile",
      "name_en": "Code of Civil Procedure",
      "rlrq_cite": "RLRQ, c. C-25.01",
      "epub": { "fr": "...", "en": "..." },
      "numbering": "recodified-2016"
    }
    // autres lois à venir
  ]
}
```

> **Confirmé en phase 0 :** l'URL EPUB suit le patron
> `https://www.legisquebec.gouv.qc.ca/{fr|en}/epub/cs/{ID}.epub` (C.c.Q. FR et EN
> validés, HTTP 200). Le **fichier réel doit être du JSON strict** (aucun commentaire
> `//` — l'exemple ci-dessus est illustratif). Un **User-Agent navigateur** est
> requis (le serveur renvoie 403 aux clients de centre de données), et la date
> « à jour au » **n'est pas dans l'EPUB** : la récupérer sur la page HTML de la loi.

---

## 9. Mise en place — commandes, dans l'ordre

Dépôt polyglotte : les étapes 1–4, 6 et 7 concernent le **Worker TypeScript**;
l'étape 5 concerne le **pipeline Python** (dans `pipeline/`). Adaptez les chemins
selon la disposition retenue (Worker à la racine, pipeline dans un sous-dossier).

```bash
# 1. Échafauder le Worker MCP à partir du gabarit Cloudflare
npm create cloudflare@latest -- qclaw-mcp --template=cloudflare/ai/demos/remote-mcp-authless
cd qclaw-mcp

# 2. Créer la base D1 et récupérer son id (à coller dans wrangler.jsonc)
npx wrangler d1 create qclaw

# 3. Appliquer le schéma (§2)
npx wrangler d1 execute qclaw --file=./schema.sql

# 4. Développer/tester le Worker localement
npx wrangler dev
#    Tester les crons localement :
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+9+5+1,7+*"

# 5. Pipeline d'ingestion (Python) — charge D1 via l'API HTTP D1
python -m venv .venv && source .venv/bin/activate
pip install -r pipeline/requirements.txt
python -m pipeline.ingest

# 6. Déployer
npx wrangler deploy

# 7. Inspecter les outils MCP
npx @modelcontextprotocol/inspector
```

Puis, dans Claude : ajouter le serveur comme **connecteur personnalisé** (l'URL
`*.workers.dev` ou un domaine perso), et l'activer par conversation — comme pour
Athéna. Les deux connecteurs se composent alors dans une même conversation.

---

## 10. Déléguer l'essentiel à Claude Code

Principe : donnez ce `PLAN.md` à Claude Code comme cahier des charges, puis
avancez **par phases avec des points de contrôle**. Ne le laissez pas tout coder à
l'aveugle — surtout pas le parseur avant l'inspection d'un vrai EPUB.

**Préparation.**
- Créez le dépôt sur votre GitHub (votre signature de commits Ed25519 est déjà en
  place). Placez-y `PLAN.md` et `laws.config.json`.
- Annoncez la **structure polyglotte** à Claude Code : `pipeline/` en **Python**
  (ingestion) et le **Worker TypeScript** (serveur MCP) — deux composants, deux
  langages, un seul dépôt.
- Ouvrez Claude Code dans ce dépôt.

**Phase 0 — Reconnaissance (bloquante).**
> Prompt : « Télécharge l'EPUB français du Code civil du Québec depuis [URL],
> dézippe-le et rapporte sa structure interne : le `container.xml`, le fichier
> `.opf` (spine + métadonnées), le document de navigation, et **les motifs de
> balisage XHTML** qui marquent (a) les intitulés de Livre/Titre/Chapitre/Section
> et (b) le début et le corps d'un article. Montre-moi des extraits représentatifs
> et propose une stratégie de parseur adaptée à ces motifs réels. N'écris pas
> encore le parseur. »

**Phase 1 — Échafaudage.**
> « Échafaude le Worker MCP (Agents SDK, TypeScript, HTTP streamable), le
> `wrangler.jsonc` avec le binding D1, et applique le schéma de §2 de PLAN.md.
> Vérifie que `wrangler dev` démarre et que `wrangler d1 execute` crée les
> tables. »

**Phase 2 — Pipeline sur le C.c.Q. FR.**
> « Écris le pipeline d'ingestion **en Python** selon §4 (`ebooklib`/`lxml`,
> chargement de D1 via l'API HTTP), calé sur la structure constatée en phase 0, et
> exécute-le sur le C.c.Q. français. Charge d'abord en tables de
> staging. **Vérification :** le C.c.Q. va jusqu'à l'article 3168; confirme que le
> nombre d'articles capturés correspond à l'intervalle attendu et **signale toute
> lacune** (numéros manquants). Montre-moi le décompte et l'article 1457 en entier
> pour contrôle. »

*(Point de contrôle humain : vérifiez le décompte et le verbatim de l'art. 1457
avant d'aller plus loin.)*

**Phase 3 — Outils MCP + tests.**
> « Implémente les outils de §3 (Zod, `structuredContent`, annotations en lecture
> seule, pagination, erreurs actionnables). Teste chaque outil avec le MCP
> Inspector et montre-moi les appels : `get_article` (1457), `get_structure`
> (racine), `get_division` (un chapitre), `search_text` (un terme). »

**Phase 4 — Bilingue + C.p.c. + recherche + cron.**
> « Ajoute la version anglaise du C.c.Q., puis le C.p.c. FR/EN (gère la
> numérotation recodifiée de 2016). Active `qclaw_search_text` (FTS5 si D1 le
> supporte, sinon repli LIKE — voir §12). Ajoute le workflow GitHub Actions de §6
> (cron semestriel + `workflow_dispatch`). »

**Phase 5 — Déploiement + accès + connexion.**
> « Déploie via `wrangler deploy`, place le Worker derrière Cloudflare Access, et
> donne-moi l'URL et la marche à suivre pour l'ajouter comme connecteur dans
> Claude. »

**Garde-fous à imposer à Claude Code :**
- Inspecter avant de parser (phase 0 d'abord).
- Écrire en **staging**, valider les compteurs, puis basculer — jamais d'écriture
  directe destructive sur le magasin en service.
- Commits **signés**, par phase, avec messages clairs.
- Écrire des tests de non-régression sur le parseur (décomptes, articles témoins).

---

## 11. Tests et évaluation

- **MCP Inspector** pour valider manuellement chaque outil.
- **Invariants du corpus C.c.Q. FR** (constatés en phase 0 — tests de
  non-régression du parseur) : **3 523 articles** au total ; entiers **1 à 3168
  complets** (zéro lacune, zéro doublon) ; **800 divisions** réparties
  10/45/160/270/213/86/13/3 (livre/titre/chapitre/section/sous-section/niv.6/7/8) ;
  **68 articles abrogés** ; bornes par Livre conformes à la cartographie du rapport
  de phase 0 ; **3 614** blocs `class="ligne"` ; **0** caractère de texte résiduel
  hors modèle sur les pages 1–10 ; verbatim exact des témoins (disposition
  préliminaire, art. 1, 1457, 2926.1, 106).
- **Jeu d'évaluations** (bonne pratique MCP) : ~10 questions réalistes que seul
  l'accès au serveur permet de résoudre (« Quel est le texte exact de l'art. X ? »,
  « Quels articles composent le chapitre Y ? », « Quelle est la date de
  consolidation courante ? »), avec réponses vérifiables.

---

## 12. Résolutions de la phase 0 et points encore ouverts

Voir le rapport détaillé `docs/phase0-structure-epub.md` (constats exhaustifs +
stratégie de parseur, §8 du rapport). La structure XHTML réelle est établie : les
EPUB sont du **EPUB 2.0 Irosoft CYBERLEX** dont les `id` encodent le chemin
hiérarchique complet.

**Décisions arrêtées (à appliquer en phases 1–2) :**

- **`sort_key`** : formule à 3 composantes `n×10^6 + d1×10^3 + d2`, entier 64 bits
  (remplace la note initiale du §2).
- **`path` des divisions** : on retient **l'`id` Irosoft complet** comme chemin
  canonique (p. ex. `ga:l_premier-gb:l_troisieme-gc:l_premier`), et non un schéma
  numérique `/L5/T1/…`. L'id est déjà unique, stable et autoporteur, et survit aux
  cas durs (ordinaux à trait d'union, `s_898_1`, `s_1119`) où une conversion
  ordinal→nombre échouerait. L'affichage humain passe par les intitulés.
- **Disposition préliminaire / dispositions finales** : servies comme
  **pseudo-articles** (`number='préliminaire'`/`'finales'`, division
  `kind='disposition'`), joignables par `qclaw_get_article` et `qclaw_get_structure`.
  Justifié : la disposition préliminaire est interprétativement centrale et
  abondamment citée.
- **Historique de division** (89 cas) : colonne `history` ajoutée à `divisions`.
- **Notes ministérielles « Voir A.M./Décret »** (5 art.) : **exclues du `text`**
  (verbatim de la loi seulement), conservées dans `html`.
- **Abrogés** : colonne `repealed` (68 articles ; 3 divisions), le verbatim
  « (Abrogé). » restant intact.
- **`laws.config.json`** : **JSON strict** (aucun commentaire).
- **Nettoyage obligatoire du parseur** (rapport §7) : retirer les sous-arbres cachés
  (`class` contenant `Hidden` **ou** style `display:none`) avant toute extraction ;
  retirer les attributs `integrity:*` du HTML stocké ; réécrire les liens en absolu.
  User-Agent navigateur au téléchargement ; date « à jour au » prise sur la page HTML.

**Points encore ouverts :**

1. **Support de FTS5 dans D1** — à vérifier tôt (phase 4) ; repli documenté :
   recherche `LIKE` ou index inversé pré-calculé (corpus assez petit).
2. **Version EN** — URL validée, mais **symétrie de structure à confirmer sur le
   fichier réel** et **capture de la date « à jour au » EN à corriger** (la page EN
   ne matche pas encore le motif). Avant la phase 4.
3. **C.p.c.** — reconnaissance dédiée avant ingestion (présence d'**annexes**,
   numérotation **recodifiée 2016**) : refaire une mini-phase 0.
4. **Profondeur de versionnement** — remplacer à chaque consolidation, ou conserver
   l'historique des versions ?
5. **Choix d'accès** — Cloudflare Access vs jeton porteur.
6. **Droit d'auteur** — usage interne = voie normale et défendable ; toute
   rediffusion/produit exigerait une licence de Publications du Québec. (Non un avis
   juridique ferme ; à valider selon l'usage exact.)

---

*Fin du plan. Prochaine action suggérée : exécuter la phase 0 avec Claude Code
pour figer la structure réelle des EPUB, puis remonter les résultats.*
