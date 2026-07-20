# Notes d'architecture — état réel du dépôt (Discovery v2, phase 0)

Constaté le 2026-07-20 contre la base D1 **distante** (`qclaw`,
b707af5a-8807-4a02-805d-13e5b0de033e) et le code en production
(legislation.poirierlavoie.ca). Référentiel : `qclaw-discovery-v2-implementation-plan.md`
(§0.1–0.3). Les écarts entre ce document et le plan v2 §2 sont récapitulés en fin de
document — **c'est ce document qui fait foi**.

---

## 1. Arborescence annotée

```
laws.config.json           Config UNIQUE des 38 lois (fusion faite ; l'ancien
                           laws.config.additions.json est supprimé).
                           ⚠️ L'ORDRE des lois est significatif : pipeline/ingest.py::_id_base()
                           dérive les plages d'id (divisions, articles) de la POSITION dans la
                           liste. Ordre épinglé par pipeline/tests/test_config.py. AJOUTER EN FIN.
taxonomy.json              28 matières bilingues (label/description fr+en) + 67 mappages
                           sujet -> loi ou division. Surface d'appariement du signal S1.
relations.json             7 relations curées (source='cure').
schema.sql                 Schéma de base (laws/divisions/articles + FTS5).
                           ⚠️ Commentaire sort_key périmé : dit « n*10^6 + d1*10^3 + d2 »,
                           réel = packing base 1000 sur 5 composantes (voir §3).
schema-decouverte.sql      Migration additive de la couche découverte (subjects, subject_map,
                           law_relations, colonnes laws/divisions).
wrangler.jsonc             (PAS wrangler.toml.) Worker « legislation », DO QclawMCP,
                           binding DB -> qclaw, cron semestriel 5 janv./5 juil.

src/
  index.ts                 McpAgent (Durable Object) + champ instructions (§6.2 plan v1).
  tools.ts                 Les 10 outils qclaw_*. Conventions de réponse : content[].text
                           lisible + structuredContent complet ; err() -> isError:true avec
                           message actionnable en français ; annotations lecture seule.
  lib.ts                   Requêtes D1. Points sensibles :
                           - sortKeyOf()   MIROIR EXACT de pipeline/model.py::sort_key —
                                           une divergence vide silencieusement le mode plage.
                           - boundKey()    borne de plage LUE en base (insensible à l'échelle).
                           - subtreeClause() intervalle lexicographique [path+'-', path+'.')
                                           — PAS de LIKE/GLOB (D1 plafonne la complexité des
                                           motifs : « pattern too complex » sur chemins longs).
                           - translatePaths() pont FR<->EN par numéros d'articles (les id
                                           Irosoft sont PROPRES À LA LANGUE).
                           - parseCitation() chapitre RLRQ en unité complète (B-1 ≠ B-1.1),
                                           marqueurs art./article/a./s., refus circonstancié.
  relevance.ts             Routeur find_relevant : signaux S1–S4, poids en constantes
                           (WEIGHTS), pondération de spécificité des tokens, ancrage début
                           de mot, stopwords FR.

pipeline/                  Ingestion Python (bs4 + lxml — PAS ebooklib).
  ingest.py                Orchestrateur (téléchargement EPUB, parse, validation, staging
                           -> bascule D1 locale/distante). --all = les 38 lois × 2 langues.
  parser.py                EPUB Irosoft (se:, sc-nb:, ga:-gg:) ; annexes/formulaires ;
                           tables rendues « cellule : cellule » ; moisson des renvois.
  model.py                 sort_key (base 1000 × 5), DISPOSITION_SORT_BASE = 9e15.
  load.py                  SQL staging -> bascule ; lots plafonnés en OCTETS UTF-8 (< 100 Ko
                           D1) ; lignes surdimensionnées via INSERT + UPDATE||chunks ;
                           UPSERT laws préservant les colonnes de L'AUTRE langue.
  discovery/               migrate.py (idempotent, PRAGMA avant ALTER), load.py (taxonomie,
                           validation stricte §3.4 v1), relations.py (reglement-de,
                           renvoie-a), backfill.py (name_norm/heading_norm).
  tests/                   23 tests unittest (corpus ccq/cpc 4 combos, config épinglée).

tests/evals.mjs            36 contrôles bout-en-bout contre le serveur réel (client MCP
                           maison, UNE session pour tous les appels). npm run evals.
docs/                      phase0-structure-epub.md (format Irosoft), reconnaissance-36.md.
```

**Il n'existe PAS de répertoire `migrations/`** : les migrations passées sont
`schema.sql` (initial) + `schema-decouverte.sql` appliqué par
`pipeline/discovery/migrate.py` (idempotent par PRAGMA). La convention
`wrangler d1 migrations` (R11 du plan v2) sera introduite à la première migration de la
phase 1 (`search_log`, tâche 1.6).

---

## 2. Schéma D1 réel (relevé sur la base distante)

Tables : `laws`, `divisions`, `articles`, `articles_fts` (+ ombres `articles_fts_*`),
`subjects`, `subject_map`, `law_relations`.
Index : `idx_art_lookup(law_id,lang,number)`, `idx_art_division`, `idx_art_sort`,
`idx_div_parent`, `idx_div_path`, `idx_div_heading_norm`, `idx_rel_from/to`,
`idx_smap_law/subject`.

Colonnes au-delà de `schema.sql` (couche découverte) :
- `laws` : `fonction`, `forum`, `scope_fr` (NULL partout — passe éditoriale à venir),
  `parent_law_id`, `name_norm`.
- `divisions` : `heading_norm` (minuscules sans accents, calculé AU CHARGEMENT par le
  pipeline — ne plus utiliser le backfill sauf rattrapage).
- `subjects` : `label_en`, `description_en` (28/28 remplies ; validation stricte au
  chargement — une matière non traduite bloque).
- `subject_map` : **`division_path` existe déjà et fait partie de la PK**
  (subject_id, law_id, division_path).

Volumes : **28 276 articles** (14 136 FR / 14 140 EN), **5 476 divisions** (2 736 FR),
38 lois, 28 matières, 67 mappages, 772 relations (7 curées + 765 auto).

### FTS5 (DDL réel, identique local/distant)

```sql
CREATE VIRTUAL TABLE articles_fts USING fts5(
  text,
  law_id UNINDEXED, lang UNINDEXED, number UNINDEXED,
  content='articles', content_rowid='id'
);
```

- **Tokenizer : défaut** (`unicode61`), **remove_diacritics actif** — vérifié à distance :
  `MATCH 'extranéité'` ≡ `MATCH 'extraneite'` (3 = 3). Pas de stemming français
  (*signification* ≠ *signifiée* : 94 vs 74 documents distincts au vocab).
- Contenu externe adossé à `articles` ; reconstruit par
  `INSERT INTO articles_fts(articles_fts) VALUES('rebuild')` à chaque bascule d'ingestion.
- **Une seule colonne indexée (`text`)** : la colonne headnotes pondérée (plan v2 §3.3)
  exigera de recréer la table FTS avec une 2e colonne — à traiter comme migration.

### Construction actuelle de MATCH (`src/lib.ts::toFtsQuery`)

```ts
const tokens = query.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? [];
return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
```

Chaque mot en littéral quoté, joints par espace = **ET implicite** (cause n° 1 de l'échec
fondateur). Extraits : `snippet(articles_fts, 0, '[', ']', '…', 12)` — ~12 tokens (cause
n° 3). Filtre `law` optionnel, tri `ORDER BY rank`, pagination (défaut 10, max 50).

---

## 3. Sondes FTS5 sur D1 distant (§0.3 — résultats empiriques)

| Capacité | D1 distant | Détail |
|---|---|---|
| `bm25()` | ✅ | `MATCH 'extranéité'` -> ccq 3111 (-11,449), cpc 490 (-7,707), cpc 622 (-5,087) |
| `snippet(…, 30)` | ✅ | extrait de ~30 tokens rendu correctement |
| `highlight()` | ✅ | texte complet surligné (486 caractères sur l'art. testé) |
| `fts5vocab` | ✅ | `CREATE VIRTUAL TABLE … USING fts5vocab('articles_fts','row')` accepté ; `term LIKE 'signif%'` -> signification (94 docs), signifiee (74), signifie (54)… ; table sonde supprimée après essai (0 trace) |

Conséquences : la tâche 1.2 peut s'appuyer sur `bm25()` pour l'étape OU et proposer les
« termes voisins » (optionnel confirmé faisable) ; la 1.3 peut passer `snippet` à ~30 tokens
sans risque.

### Reproduction du cas fondateur (art. 490 C.p.c.)

| Requête | Résultat FTS actuel |
|---|---|
| `signification hors du Québec délai` | **0 résultat** (« hors » absent du texte tue le ET) |
| `signification Québec délai` (leave-one-out de « hors ») | **cpc 490 en 1re position** |
| `extranéité` (corpus entier) | ccq 3111, cpc 490, cpc 622 |

L'échelle de relaxation (1.2) et l'élargissement corpus (1.1) auraient chacun suffi.
Le Livre V C.p.c. s'intitule « LES RÈGLES APPLICABLES À CERTAINES MATIÈRES CIVILES »
(aucun signal) ; le signal est au Titre IV « LES DEMANDES INTÉRESSANT LE DROIT
INTERNATIONAL PRIVÉ » — d'où l'index profondeur 2 (1.4).

---

## 4. Sauvegardes et migrations

- **`wrangler d1 export` est INUTILISABLE** sur cette base : l'export D1 échoue en
  présence d'une table virtuelle (`articles_fts`). Limite connue depuis la phase 1 du
  projet v1.
- **Stratégie retenue : D1 Time Travel** (plan Workers payant actif depuis le
  2026-07-20). Vérifié : `wrangler d1 time-travel info qclaw` rend un bookmark
  restaurable (fenêtre 30 jours). Avant chaque migration de phase : consigner le
  bookmark courant dans le rapport de phase (équivalent de la sauvegarde exigée par R11).
- Migrations à venir (phase 1+) : répertoire `migrations/NNN_description.sql` +
  `wrangler d1 migrations apply`, en cohabitation avec l'existant (schema.sql +
  migrate.py restent la référence de l'état initial).

---

## 5. Écarts entre le plan v2 (§2) et la réalité

| Hypothèse du plan v2 | Réalité constatée |
|---|---|
| « ~36 textes en stubs (0 article) » | **38 lois entièrement ingérées** (28 276 articles), datées 2026-04-01 (p-40.1 : 04-02). Redimensionne la phase 2 : ~14,1 K vecteurs d'articles FR + ~2,7 K de divisions ≈ **17 K vecteurs**, pas 4,4 K. |
| « couche découverte v1 en cours » | **Terminée** (phases A–E + correctifs) : taxonomie bilingue, graphe, routeur S1–S4 pondéré par spécificité, 36 contrôles d'éval bout-en-bout. |
| Ingestion « ebooklib/lxml » | beautifulsoup4 + lxml. |
| 3.1 : `ALTER subject_map ADD division_path` | **Colonne déjà présente, dans la PK.** Seule la table `division_links` sera nouvelle. |
| R6 : « chemins neutres quant à la langue » | **Faux.** Les id Irosoft sont propres à la langue (`ga:l_cinquieme` FR / `ga:l_five` EN). Pont existant : `translatePaths()` (src/lib.ts), par numéros d'articles invariants. La tâche 1.5 = appliquer ce pont dans `get_division`/`get_structure` avec repli `[fr]`, PAS « canoniser » les chemins. |
| `wrangler.toml` | `wrangler.jsonc`. |
| R11 `wrangler d1 migrations` + `d1 export` | Pas de répertoire migrations (à introduire) ; export bloqué par la table virtuelle -> **Time Travel** (§4). |
| Harnais d'éval à créer de zéro | Client MCP maison réutilisable dans `tests/evals.mjs` (une session pour N appels — leçon opérationnelle : chaque invocation de l'Inspector CLI ouvre une session DO neuve ; en volume, cela a épuisé le quota gratuit le 2026-07-20). |
| 3.3 : modèle `claude-sonnet-4-6` | Modèle courant : `claude-sonnet-5` (règle §0.6 du plan v2 : revérifier au moment de l'implémentation). |
| 1.5 : bogue `lang=en` | **Toujours réel pour un chemin FR passé explicitement** (`get_division(law='ccq', path='ga:l_cinquieme-…', lang='en')` -> « Division introuvable »). Les SORTIES de découverte (list_laws, find_relevant) rendent déjà des chemins traduits ; c'est l'ENTRÉE de get_division/get_structure qui ne traduit pas encore. |

Divers : le commentaire `sort_key` de `schema.sql` est périmé (échelle réelle : base 1000
× 5 composantes, dispositions à 9e15) ; `scope_fr` est NULL sur les 38 lois (repli
`name_fr` en place, passe éditoriale §10.1 v1 toujours ouverte).
