# Discovery Layer v2 — Implementation Plan
## MCP « Législation du Québec » — legislation.poirierlavoie.ca

**Audience :** Claude Code (exécution autonome, avec portes de validation humaine marquées ⛔)
**Owner :** Jason (Poirier Lavoie avocat)
**Date :** 2026-07-20
**Origine :** post-mortem d'un échec de repérage — l'art. 490 C.p.c. (délai de réponse du défendeur sans domicile, résidence ni établissement au Québec, litige comportant un élément d'extranéité) n'a pas été trouvé par l'agent malgré 4 recherches et 5 consultations de structure.

---

## 0. Mode d'emploi de ce document

1. **Lire le document en entier avant d'écrire du code.** Exécuter les phases dans l'ordre. À l'intérieur d'une phase, les sous-tâches sont ordonnées mais certaines sont indépendantes (indiqué).
2. **Phase 0 vérifie toutes les hypothèses architecturales.** Là où la réalité diffère du plan, adapter l'implémentation et consigner l'écart dans le rapport de phase — ne pas forcer le plan sur un code qui ne lui correspond pas.
3. **⛔ PORTE HUMAINE :** toute tâche ainsi marquée produit un *brouillon* (fichier dans `curation/drafts/`) destiné à la validation de Jason. **Ne jamais charger ces contenus dans les tables de production ni les exposer dans les réponses des outils avant validation** (`validated = 1`).
4. **Définition de « terminé » par tâche :** les tests d'acceptation passent + la suite d'évaluation (Appendice A) ne régresse pas.
5. **Un commit par sous-tâche.** Déploiement via `wrangler`. Les nouveaux chemins de récupération risqués sont derrière des variables d'environnement (feature flags) pour rollback immédiat.
6. **Faits externes à revérifier au moment de l'implémentation** (noms de modèles Workers AI, dimensions, quotas Vectorize, formes d'API) : les valeurs de ce document sont des estimations de planification, pas des données de référence. Utiliser la documentation Cloudflare courante.
7. **Rapport de phase :** à la fin de chaque phase, produire `docs/reports/phase-N.md` — écarts d'hypothèses, delta de tokens des schémas d'outils, tableau d'évaluation avant/après, décisions prises.

---

## 1. Contexte — l'échec que ce plan corrige

Requêtes de l'agent (toutes raisonnables) : `signification hors du Québec délai`, `notifié hors du Québec`, `défendeur domicilié hors Québec jugement défaut`, puis `extranéité` (limitée à `ccq`). Résultat : art. 490 C.p.c. jamais trouvé. Quatre causes racines :

| # | Cause | Correctif |
|---|---|---|
| 1 | `MATCH` FTS5 = ET implicite ; un seul terme absent (« hors ») tue une requête dont 3 des 4 termes figurent dans l'art. 490 (*signification*, *Québec*, *délai*) | Phase 1.2 (échelle de relaxation) |
| 2 | Recherches restreintes à une loi ; la requête gagnante (`extranéité`) n'a jamais été relancée sur tout le corpus | Phase 1.1 (défaut corpus + élargissement auto) |
| 3 | Résultats de recherche illisibles : chemin opaque (`[ga:l_v-gb:l_iv-gc:l_i]`), extrait de ~10 tokens — impossible de *reconnaître* la pertinence | Phase 1.3 (fils d'Ariane + extraits élargis) |
| 4 | Aucun pont sémantique : « hors du Québec » ≠ lexicalement « n'a ni domicile, ni résidence, ni établissement au Québec » ; de plus, l'intitulé du Livre V C.p.c. (« Les règles applicables à certaines matières civiles ») est un piège — le signal est au niveau du Titre | Phases 2 (embeddings), 1.4 (index profondeur 2), 3 (curation) |

**Philosophie des correctifs :** *fail open* (restreint → corpus ; exact → relaxé ; lexical → sémantique), résultats auto-explicatifs, journalisation des échecs, curation validée par l'avocat.

---

## 2. Rappel d'architecture — hypothèses à vérifier en Phase 0

- **Worker Cloudflare (TypeScript)** servant le MCP en HTTP à `legislation.poirierlavoie.ca/mcp`.
- **D1 (SQLite)** : tables approx. `laws`, `divisions`, `articles`, index FTS5 (nom, colonnes et tokenizer exacts à découvrir).
- **Pipeline d'ingestion Python** (ebooklib/lxml) à partir des EPUB officiels LégisQuébec, FR + EN, chargement D1 via l'API HTTP ; rafraîchissement semestriel prévu.
- **Couche de découverte v1** (en cours) : tables `subjects`, `subject_map`, `law_relations` ; `taxonomy.json` ; classification 3 axes (Fonction / Forum / Matière) issue de `Lois.xlsx`.
- **Corpus** : `ccq` (3 525 art.) et `cpc` (878 art.) ingérés, consolidés 2026-04-01 ; ~36 textes enregistrés en stubs (0 article).
- **10 outils existants** : `qclaw_list_laws`, `qclaw_list_subjects`, `qclaw_find_relevant`, `qclaw_get_structure`, `qclaw_get_division`, `qclaw_get_article`, `qclaw_get_articles`, `qclaw_search_text`, `qclaw_resolve_reference`, `qclaw_related_laws`.

---

## 3. Règles de conception globales (s'appliquent à chaque tâche)

- **R1 — Trois surfaces de tokens.** (a) Schémas/descriptions d'outils : coût permanent, payé à chaque tour de chaque conversation — n'y ajouter que des phrases qui orientent le *premier* appel. (b) Charges utiles de réponse : payées à l'appel — l'endroit le moins cher pour enrichir. (c) Allers-retours : une recherche échouée coûte un tour agentique complet — les éliminer vaut plus que toute économie de réponse.
- **R2 — Aucun nouvel outil MCP** sans approbation explicite de Jason. Enrichir les 10 outils existants (nouveaux paramètres et réponses enrichies permis).
- **R3 — Delta de description ≤ 2 phrases par outil.** Consigner le delta total de tokens des schémas dans le rapport de phase.
- **R4 — Intégrité du texte officiel.** Ne jamais altérer le texte des articles ni le rendu de `get_article`/`get_articles`/`get_division` (hors ajouts clairement séparés, p. ex. « Voir aussi »). Toute aide éditoriale générée par IA est visiblement étiquetée non officielle.
- **R5 — Chaînes destinées à l'utilisateur en français** (respecter le paramètre `lang` là où il existe pour le contenu ; les étiquettes systèmes des réponses restent FR par défaut, EN si `lang=en`).
- **R6 — Chemins de divisions neutres quant à la langue.** Les identifiants `ga:…` sont canoniques ; `lang` ne gouverne que la langue de sortie.
- **R7 — Fail open, toujours étiqueté.** Quand un chemin de repli produit les résultats, la réponse le dit (p. ex. « Aucun résultat exact ; résultats approchés (terme ignoré : “hors”) : »).
- **R8 — Réversibilité.** Nouveaux chemins de récupération derrière des variables d'env (`HYBRID_SEARCH`, `RELAX_SEARCH`) ; rollback = flip de variable, pas revert de code.
- **R9 — Budget de réponse.** Une réponse de `qclaw_search_text` vise ≤ ~800 tokens en régime normal.
- **R10 — Vie privée.** Instance mono-utilisateur : journalisation D1 acceptable ; aucune télémétrie externe.
- **R11 — Migrations disciplinées.** Tout changement de schéma passe par des fichiers de migration versionnés (`migrations/NNN_description.sql`) appliqués via `wrangler d1 migrations` ; faire `wrangler d1 export` (sauvegarde) avant toute migration.

---

## Phase 0 — Reconnaissance et base de référence (aucun changement de comportement)

### 0.1 Cartographier le dépôt
Localiser : source du Worker, pipeline d'ingestion, `wrangler.toml` (bindings, nom de la base D1), migrations existantes, conventions de formatage des réponses d'outils. Produire `docs/ARCHITECTURE-NOTES.md` (arborescence annotée, schéma D1 réel, config FTS constatée).

### 0.2 Relever le schéma D1 réel
`wrangler d1 execute <db> --command "SELECT name, sql FROM sqlite_master"` (ou équivalent via binding). Identifier : nom de la table FTS, colonnes indexées, tokenizer (`unicode61` ? `remove_diacritics` ?), comment `qclaw_search_text` construit la chaîne `MATCH` (échappement, guillemets, préfixes).

### 0.3 Sonder les capacités FTS5 sur D1
Tester et consigner : `bm25()`, `snippet()`, `highlight()` ; tenter `CREATE VIRTUAL TABLE vocab_probe USING fts5vocab(<fts_table>, 'row')` — **fts5vocab fait partie du cœur FTS5 mais sa disponibilité sur D1 doit être confirmée empiriquement.** S'il est absent : la tâche 1.2 fonctionne sans lui (le « termes voisins » devient optionnel).

### 0.4 Monter le squelette du harnais d'évaluation
Créer `eval/cases.json` à partir de l'Appendice A et `eval/run.ts` (ou `.py`) qui appelle l'endpoint MCP déployé (JSON-RPC `tools/call` sur `qclaw_search_text` et `qclaw_find_relevant`) et calcule **recall@10** (couverture des articles « must-include ») et **MRR** par cas. Exécuter la base de référence sur le code actuel ; committer `eval/baselines/2026-07-20.json`.
*(Le harnais est construit maintenant ; seule la **modification** de la vérité terrain est soumise à porte humaine — voir 3.4.)*

### 0.5 Rapport de phase 0
Écarts d'hypothèses + tableau de référence.

**Acceptation :** `ARCHITECTURE-NOTES.md` et la base de référence existent et sont committés.

---

## Phase 1 — Gains rapides côté Worker (aucun changement d'ingestion)

> Tâches 1.1–1.3 forment une séquence sur `qclaw_search_text` ; 1.4, 1.5, 1.6 sont indépendantes.

### 1.1 Recherche corpus par défaut + élargissement automatique
**Spéc.** Le paramètre `law` est conservé. Quand `law` est fourni **et** que la recherche primaire retourne 0 ligne : relancer la même requête sans restriction. Si des résultats existent, les retourner avec l'en-tête : `Aucun résultat dans <law> ; N résultat(s) ailleurs dans le corpus :`. Journaliser `fallback='widened'` (voir 1.6).
**Description d'outil (+1 phrase) :** « Omettre `law` sauf raison précise de restreindre ; une recherche restreinte sans résultat est automatiquement élargie au corpus. »
**Tests d'acceptation :**
- `qclaw_search_text(query='extranéité', law='ccq')` → contient ccq 3111 **et** une section élargie contenant cpc 490.
- Une requête restreinte avec résultats ne déclenche pas d'élargissement.

### 1.2 Échelle de relaxation sur zéro résultat
**Spéc.** Ordre d'exécution dans `qclaw_search_text` :
1. Requête exacte (portée demandée) ;
2. Élargissement corpus (1.1) ;
3. **Leave-one-out** : si la requête a 2–6 termes, relancer en omettant chaque terme à tour de rôle (≤ 6 SELECT supplémentaires) ; retenir le meilleur ensemble non vide (somme des scores `bm25`) ; étiqueter `Correspondance exacte introuvable ; résultats approchés (terme ignoré : « X ») :` ;
4. **OU + bm25** : si tout leave-one-out échoue, joindre tous les termes par `OR`, classer par `bm25()`, retourner le top 10 ; étiqueter `Résultats partiels (au moins un terme sur N) :`.
Garde-fous : uniquement pour requêtes multi-termes ; réutiliser la même sanitisation `MATCH` que le chemin principal ; > 6 termes → sauter l'étape 3, aller à 4. Flag `RELAX_SEARCH` (défaut activé après tests). Journaliser le chemin utilisé.
**Optionnel (si fts5vocab confirmé en 0.3) :** en tout dernier recours, proposer « Termes voisins dans l'index : … » (3–5 termes par fréquence documentaire).
**Tests d'acceptation :**
- `qclaw_search_text(query='signification hors du Québec délai', law='cpc')` → cpc 490 dans le top 5, avec étiquette de relaxation.
- Une requête absurde (`zzz qqq`) retourne un message d'échec propre, sans erreur.

### 1.3 Rendu des résultats : fils d'Ariane, extraits élargis, regroupement par loi
**Spéc.**
- Chaque résultat : `«{loi_abrégée}», {fil d'Ariane lisible} › art. {n}` + extrait. Ex. : `C.p.c. — Livre V, Titre IV : Les demandes intéressant le droit international privé › art. 490`. Construire le fil en joignant la table `divisions` sur le chemin (mettre en cache par chemin durant la requête).
- `snippet()` élargi à ~30 tokens (paramètre 4 de `snippet()` ; garder `…` comme ellipse).
- Recherche non restreinte : regrouper par loi, **max 6 résultats par loi, 12–15 au total**, chaque groupe précédé du nom de la loi.
- Conserver l'ID de chemin machine entre crochets en fin de ligne (utile pour `get_division`).
**Budget :** réponse type ~600–800 tokens (vs ~300 actuels) — conforme R9, rentabilisé par les allers-retours évités.
**Tests d'acceptation :** un appel de recherche montre le fil lisible ET l'ID machine ; extraits ≥ 25 tokens ; recherche corpus sur `prescription` montre des groupes ccq et cpc distincts.

### 1.4 Exposition de la structure profondeur 2 dans `qclaw_list_laws`
**Justification :** l'intitulé du Livre V C.p.c. ne porte aucun signal ; le signal est au Titre. Un index Livres-seuls n'aurait **pas** attrapé l'art. 490.
**Spéc.** Pour chaque loi dont les divisions comportent le kind « livre », inclure dans `list_laws` un plan profondeur 2 (livres + titres, intitulés + chemins). Nouveau paramètre `structure` (booléen, **défaut `true`**) pour le supprimer au besoin. Les 36 lois plates ne sont pas affectées.
**Budget :** +~1,2–1,5 K tokens par appel `list_laws` (appel rare, ≤ 1 fois par session).
**Test d'acceptation :** `list_laws()` montre pour `cpc` : Livre V et ses 4 titres, dont « Titre IV — Les demandes intéressant le droit international privé ».

### 1.5 Correctif de bogue : résolution des chemins sous `lang=en`
**Constat (reproduit en conversation) :** `qclaw_get_division(law='ccq', path='ga:l_cinquieme-…', lang='en')` → « Division introuvable ».
**Spéc.** Les chemins sont canoniques et neutres ; `lang` ne doit filtrer que la langue des intitulés/textes de sortie. Si un intitulé EN manque, retomber sur le FR avec marqueur `[fr]`.
**Test d'acceptation :** l'appel ci-dessus retourne le chapitre « Contract of employment » en anglais.

### 1.6 Journal des recherches (`search_log`)
**Spéc.** Migration :
```sql
CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  tool TEXT NOT NULL,              -- 'search_text' | 'find_relevant'
  query TEXT NOT NULL,
  law TEXT, lang TEXT,
  result_count INTEGER NOT NULL,
  fallback TEXT                    -- NULL|'widened'|'loo:<terme>'|'or_relax'|'semantic'
);
CREATE INDEX IF NOT EXISTS idx_search_log_misses ON search_log(result_count, ts);
```
Insérer à **chaque** appel de `qclaw_search_text` et `qclaw_find_relevant` (pas seulement les échecs — `result_count` permet de filtrer). Échec d'insertion silencieux (ne jamais casser une recherche pour un log).
**Note d'exploitation :** Jason peut revoir les échecs directement depuis Claude via le connecteur Cloudflare D1 (`d1_database_query`) — fournir dans le rapport la requête type :
```sql
SELECT ts, tool, query, law, fallback FROM search_log
WHERE result_count = 0 AND ts > datetime('now','-7 days') ORDER BY ts DESC;
```
**Test d'acceptation :** après les tests 1.1–1.3, `search_log` contient les lignes attendues avec les bons `fallback`.

### Porte de fin de Phase 1
Relancer l'évaluation. Attente : les cas lexicalement atteignables (Appendice A, cas 1–3 et 6–18) s'améliorent nettement ; aucun cas ne régresse. Committer `docs/reports/phase-1.md`.

---

## Phase 2 — Couche sémantique (récupération hybride)

### 2.1 Infrastructure
- **Modèle d'embedding :** cible `@cf/baai/bge-m3` sur Workers AI (multilingue FR/EN, ~1 024 dimensions). **Vérifier disponibilité et dimensions au moment de l'implémentation** ; à défaut, choisir le meilleur modèle multilingue Workers AI courant et consigner le choix.
- **Index Vectorize :**
```bash
npx wrangler vectorize create qclaw-articles --dimensions=<dims> --metric=cosine
npx wrangler vectorize create-metadata-index qclaw-articles --property-name=law  --type=string
npx wrangler vectorize create-metadata-index qclaw-articles --property-name=type --type=string
```
- **Bindings (`wrangler.toml`) :** `[ai] binding = "AI"` ; `[[vectorize]] binding = "VECTORS", index_name = "qclaw-articles"`.
- **Quotas :** ~4,4 K articles aujourd'hui ; ~15–20 K après les 36 lois. À 1 024 dims, cela peut dépasser le palier gratuit de Vectorize — vérifier les quotas courants ; le palier payant se chiffre en cents/mois (acceptable, mais le confirmer à Jason dans le rapport).

### 2.2 Backfill des vecteurs (idempotent, reprenable)
- Script d'administration (route temporaire protégée par jeton `/admin/backfill-vectors`, **ou** script `wrangler` local) qui : lit les articles FR de D1 par lots de 25–50 → embed via `env.AI.run` → `upsert` Vectorize avec `id = art:{law}:{num}` et `metadata = {law, article, path, heading, type:'article'}`.
- **Texte embeddé (canonique FR) :** `"{nom de la loi} — {fil d'Ariane} — art. {n}. {texte de l'article}"`, plafonné (~1 500 tokens ; consigner les dépassements — rares, les articles québécois sont courts). *Le modèle multilingue permet aux requêtes EN d'atteindre les vecteurs FR ; ne pas embedder l'EN pour l'instant (moitié du stockage) — réévaluer si l'éval 19 échoue.*
- **Vecteurs de divisions :** embedder aussi chaque intitulé de division avec son fil (`id = div:{law}:{path}`, `type:'division'`) pour la récupération au niveau structure.
- Reprise sur erreur : journal de progression (table `vector_backfill_log` ou curseur simple) ; relançable sans doublons (upsert).

### 2.3 Chemin de requête hybride
- Flag `HYBRID_SEARCH=1`. Dans `qclaw_search_text` : exécuter en parallèle (`Promise.all`) la recherche FTS (chemin Phase 1) et la recherche vectorielle (embed de la requête via `AI.run` ; `VECTORS.query` topK=20 ; filtre `metadata.law` si portée demandée).
- **Fusion RRF** : `score(d) = Σ_listes 1/(k + rang_liste(d))`, k = 60. Retourner le top 10–12 fusionné, rendu selon 1.3.
- Étiqueter `(repérage sémantique)` les résultats issus du seul chemin vectoriel. Journaliser `fallback='semantic'` quand le FTS seul était vide.
- **Latence cible :** ≤ ~1,5 s p50 par recherche (un embed + une requête Vectorize + FTS en parallèle).

### 2.4 Réordonner l'échelle de repli
Avec l'hybride actif, décider par l'évaluation si le leave-one-out (1.2 étape 3) reste utile en amont du sémantique ou est rétrogradé après. Consigner la décision et la justification dans le rapport.

### 2.5 Accrochage à l'ingestion
Le pipeline (rafraîchissement semestriel) doit régénérer les vecteurs des articles modifiés/ajoutés : au minimum, documenter la procédure de re-backfill complète par consolidation ; idéalement, backfill différentiel sur les articles dont le texte a changé.

### 2.6 Porte de décision — lemmatisation française
FTS5 n'a pas de stemmer français ; D1 n'accepte pas de tokenizer personnalisé. La solution serait une colonne fantôme normalisée (Snowball FR côté Python à l'ingestion + même normalisation côté Worker sur les requêtes). **Ne l'implémenter que si**, après Phase 2, le journal et l'évaluation montrent des échecs purement morphologiques (*notifié*/*notification*) que l'hybride ne rattrape pas. Sinon, consigner « non nécessaire » et fermer.

### Acceptation de Phase 2
- Cas 19 (requête EN → cpc 490) passe.
- Couverture « must-include » globale ≥ 85 % au recall@10 ; aucun cas régressé vs Phase 1.
- Rapport `phase-2.md` : coûts réels constatés (quotas, latence), decision 2.4 et 2.6.

---

## Phase 3 — Infrastructure de curation ⛔ (l'IA rédige, l'avocat valide)

> Principe transversal : **les tables portent un drapeau `validated INTEGER NOT NULL DEFAULT 0` ; seules les lignes `validated=1` influencent les réponses de production.** Les brouillons vivent dans `curation/drafts/` en CSV lisible.

### 3.1 Sujets au niveau des divisions + divisions compagnes + « Voir aussi »
**Migrations :**
```sql
ALTER TABLE subject_map ADD COLUMN division_path TEXT;  -- adapter au schéma réel découvert en 0.2

CREATE TABLE IF NOT EXISTS division_links (
  law_a TEXT NOT NULL, path_a TEXT NOT NULL,
  law_b TEXT NOT NULL, path_b TEXT NOT NULL,
  rel_type TEXT NOT NULL,           -- 'compagnon' | 'voir_aussi'
  note TEXT,
  validated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (law_a, path_a, law_b, path_b, rel_type)
);
```
**Injection « Voir aussi » :** dans `get_article` et `get_division`, après le contenu officiel : pour la division de l'article (et ses ancêtres), si des liens `validated=1` existent, ajouter au plus 2 lignes : `Voir aussi : C.p.c., Livre V, Titre IV — Les demandes intéressant le droit international privé (procédure) [ga:l_v-gb:l_iv]`. Budget : +~20–40 tokens sur les lectures concernées.
**Génération du brouillon (Claude Code, autonome) :** à partir des intitulés de divisions des deux codes (~200–300 divisions), proposer : (a) l'affectation de matières (vocabulaire des 3 axes de `Lois.xlsx`/`taxonomy.json`) au niveau division ; (b) les paires compagnes évidentes — **au minimum** : C.c.Q. Livre X (droit international privé) ↔ C.p.c. Livre V, Titre IV ; C.c.Q. Livre VIII (prescription) ↔ dispositions C.p.c. sur les délais ; vices cachés (ccq 1726 ss.) ↔ ouvrage/entrepreneur (ccq 2118 ss.). Sortie : `curation/drafts/division_subjects_draft.csv` et `curation/drafts/division_links_draft.csv` avec colonne `justification`.
**⛔ PORTE HUMAINE :** Jason révise les CSV, corrige, approuve → seulement alors, script de chargement qui pose `validated=1`.
**Tests d'acceptation (post-validation) :** `get_article('ccq','3134')` affiche le « Voir aussi » vers C.p.c. Livre V Titre IV ; `find_relevant('défendeur à l'extérieur du Québec')` retourne les deux sièges.

### 3.2 Gazetteer de concepts (expansion de requête)
**Migration :**
```sql
CREATE TABLE IF NOT EXISTS concept_gazetteer (
  id INTEGER PRIMARY KEY,
  concept TEXT NOT NULL,
  variantes TEXT NOT NULL,   -- JSON: ["extranéité","hors du québec","international", ...] (normalisées: minuscules, sans accents)
  cibles TEXT NOT NULL,      -- JSON: [{"law":"ccq","path":"ga:l_dixieme"},{"law":"cpc","path":"ga:l_v-gb:l_iv"}]
  note TEXT,
  validated INTEGER NOT NULL DEFAULT 0
);
```
**Accrochage requête :** avant le FTS, normaliser la requête et tester la présence des `variantes` (`validated=1`). Sur correspondance : (a) étendre la requête FTS (`OR` des variantes) ; (b) préfixer la réponse d'une ligne : `Concept reconnu : extranéité → C.c.Q., Livre X (art. 3076 ss.) ; C.p.c., Livre V, Titre IV (art. 489 ss.)`. Charger le gazetteer en mémoire Worker (il restera < 200 lignes ; recharger par TTL ou à froid).
**Brouillon :** semer avec l'Appendice B → `curation/drafts/gazetteer_draft.csv`.
**⛔ PORTE HUMAINE :** validation entrée par entrée (c'est du vocabulaire juridique — jugement d'avocat). Croissance ultérieure pilotée par le journal des échecs (1.6).
**Test d'acceptation (post-validation) :** `search_text('poursuivre quelqu'un hors du Québec')` affiche la ligne de concept et surface cpc 489–496.

### 3.3 Notes de repérage par article (« headnotes ») — génération différée à l'audit
**Objet :** une ligne de mots-clés FR par article (`art. 490 : délai de réponse du défendeur étranger — extranéité — 30 jours — protocole 3 mois`), indexée en FTS dans une **colonne distincte pondérée** (`bm25(fts, w_texte, w_headnote)`), pour que la recherche lexicale enjambe les écarts de vocabulaire.
**Migration :**
```sql
CREATE TABLE IF NOT EXISTS article_headnotes (
  law TEXT NOT NULL, article TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'fr',
  headnote TEXT NOT NULL,
  model TEXT, generated_at TEXT DEFAULT (datetime('now')),
  validated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (law, article, lang)
);
```
**Lot de génération (Claude Code, autonome — stockage seulement) :** script Python/TS appelant l'API Anthropic (suggestion : `claude-sonnet-4-6` ; ~4,4 K articles × ~50 tokens de sortie — coût négligeable). Prompt : « Une seule ligne, ≤ 25 mots, français, style mots-clés, inclure les synonymes usuels du concept, ne rien affirmer qui ne soit dans le texte, aucune interprétation. » Stocker `validated=0`.
**⛔ PORTE HUMAINE — protocole d'audit :** Jason audite (a) un échantillon aléatoire de 5 % et (b) toutes les notes d'articles impliqués dans des échecs du journal. Approbation → `validated=1` → **seulement ces lignes** sont indexées en FTS. Tout résultat obtenu via une headnote porte l'étiquette `(repéré via note éditoriale non officielle)`.
**Ne pas** afficher les headnotes dans `get_article` — elles servent l'index, pas la lecture.

### 3.4 Durcissement du harnais d'évaluation
- `eval/run.ts` : sortie tableau (cas, recall@10, MRR, chemin de repli utilisé) + JSON committé par exécution.
- Intégration facultative : GitHub Action exécutant l'éval sur un environnement de prévisualisation à chaque PR.
- **⛔ PORTE HUMAINE :** tout ajout/modification de la vérité terrain (`eval/cases.json`) est proposé en PR distincte pour validation par Jason — c'est lui qui sait quel article *est* la bonne réponse.
- Fournir à Jason la routine hebdomadaire (5 min) : requête des échecs (voir 1.6) → nouvelles entrées de gazetteer ou nouveaux cas d'éval.

### Acceptation de Phase 3
Portes franchies, drapeaux `validated` opérants (une ligne `validated=0` n'influence aucune réponse — test explicite), « Voir aussi » et lignes de concept en production, rapport `phase-3.md`.

---

## Déploiement, vérification, rollback

1. **Séquence :** Phase 0 → PR/commits 1.1–1.6 (déployables individuellement) → éval → Phase 2 derrière `HYBRID_SEARCH=0` puis bascule → éval → Phase 3 (schémas d'abord, contenus après validation).
2. **Sauvegardes :** `wrangler d1 export` avant chaque migration ; conserver dans `backups/` (hors git si volumineux).
3. **Rollback :** flags d'abord (`HYBRID_SEARCH`, `RELAX_SEARCH`) ; les migrations sont additives (nouvelles tables/colonnes) — aucune migration destructive dans ce plan.
4. **Rapports :** `docs/reports/phase-N.md` par phase (écarts, deltas de tokens, tableau d'éval, décisions, coûts constatés).

---

## Appendice A — Jeu d'évaluation initial (vérité terrain : cette conversation)

Format `eval/cases.json` : `{ id, query, law_scope (null = corpus), must_include: [{law, article}], nice_to_have: [...] }`. Mesure : recall@10 sur `must_include`, MRR sur le premier `must_include` atteint.

| # | Requête | Portée | must_include | nice_to_have |
|---|---|---|---|---|
| 1 | `délai réponse défendeur hors du Québec assignation` | corpus | cpc 490 | cpc 145 |
| 2 | `signification hors du Québec délai` | cpc | cpc 490 | cpc 494 |
| 3 | `élément d'extranéité` | corpus | ccq 3111 ; cpc 490 | cpc 489 |
| 4 | `défendeur étranger cautionnement frais` | cpc | cpc 492 | cpc 493 |
| 5 | `notification internationale Convention La Haye` | cpc | cpc 494 | cpc 495 |
| 6 | `vice caché maison recours` | ccq | ccq 1726 ; ccq 1739 | ccq 1728, 1729, 2118 |
| 7 | `dénonciation vice caché délai` | ccq | ccq 1739 | ccq 2925 |
| 8 | `récusation juge motifs` | cpc | cpc 202 | cpc 201, 203–205 |
| 9 | `désaveu avocat` | cpc | cpc 191 | — |
| 10 | `avocat cesser d'occuper` | cpc | cpc 194 | cpc 192 |
| 11 | `avocat conflit d'intérêts inhabile` | cpc | cpc 193 | — |
| 12 | `responsabilité civile faute préjudice` | ccq | ccq 1457 | ccq 1458 |
| 13 | `prescription trois ans action personnelle` | ccq | ccq 2925 | ccq 2880 |
| 14 | `congédiement délai de congé raisonnable` | ccq | ccq 2091 | ccq 2092, 2094 |
| 15 | `clause non-concurrence fin d'emploi` | ccq | ccq 2089 ; ccq 2095 | — |
| 16 | `vente sous contrôle de justice garantie` | ccq | ccq 1731 | — |
| 17 | `remplacement du juge délibéré` | cpc | cpc 326 | cpc 327 |
| 18 | `moyen déclinatoire compétence internationale` | cpc | cpc 491 | cpc 167 |
| 19 | `defendant outside Quebec time to answer` *(EN → FR, test sémantique multilingue)* | corpus | cpc 490 | — |
| 20 | `perte de l'ouvrage cinq ans entrepreneur` | ccq | ccq 2118 | ccq 2119, 2124 |

**⛔** Toute évolution de ce jeu passe par Jason (3.4).

---

## Appendice B — Semences du gazetteer (BROUILLON — À VALIDER PAR JASON, `validated=0` au chargement)

| Concept | Variantes (normalisées) | Cibles |
|---|---|---|
| extranéité | extranéité ; hors du québec ; international ; étranger ; défendeur étranger | ccq `ga:l_dixieme` ; cpc `ga:l_v-gb:l_iv` |
| vice caché | vice caché ; défaut caché ; garantie de qualité ; maison défectueuse | ccq art. 1726–1731, 1739 ; ccq art. 2118–2124 (construction) |
| fin d'emploi | congédiement ; renvoi ; licenciement ; fin d'emploi ; délai de congé | ccq art. 2085–2097 |
| récusation | récusation ; impartialité du juge ; juge partial | cpc art. 201–205 |
| désaveu | désaveu ; répudiation du mandat de l'avocat | cpc art. 191 |
| prescription | prescription ; délai pour poursuivre ; forclusion ; hors délai | ccq `ga:l_huitieme` |
| mise en demeure | mise en demeure ; demeure ; défaut | ccq art. 1594–1600 |
| notification | signification ; notification ; huissier | cpc art. 109–140 ; cpc art. 494–496 (internationale) |
| cautionnement pour frais | cautionnement ; sûreté des frais ; security for costs | cpc art. 492 |
| responsabilité civile | responsabilité extracontractuelle ; faute ; 1457 | ccq art. 1457–1481 |

---

## Appendice C — Matrice budget/effort (récapitulatif)

| Tâche | Effort code | Effet tokens (runtime) | Rôle de l'avocat |
|---|---|---|---|
| 1.1 Corpus + élargissement auto | Trivial | Économise des allers-retours | Aucun |
| 1.2 Échelle de relaxation | Faible | +~100 tk, chemins d'échec seulement | Aucun |
| 1.3 Fils d'Ariane / extraits / groupes | Faible | +~300 tk par recherche | Aucun |
| 1.4 Structure profondeur 2 (`list_laws`) | Faible | +~1,5 K tk par appel (rare) | Aucun |
| 1.5 Bogue `lang=en` | Trivial | Nul | Aucun |
| 1.6 Journal des recherches | Trivial | Nul | ~5 min/sem. de revue |
| 2.x Hybride embeddings + Vectorize | 1–2 jours | Net positif (chaînes d'échec éliminées) | Contrôle d'éval seulement |
| 2.6 Lemmatisation FR (conditionnelle) | Modéré | Nul | Aucun |
| 3.1 Sujets/compagnons + « Voir aussi » | Faible (schéma) | +~20–40 tk sur lectures visées | **Validation requise** |
| 3.2 Gazetteer | Trivial (mécanisme) | ~0 | **Rédaction/validation requises** |
| 3.3 Headnotes | Modéré (lot) | ~0 | **Audit d'échantillon requis** |
| 3.4 Harnais d'éval | Faible | Hors ligne | **Vérité terrain requise** |

---

## Appendice D — Ce qu'il ne faut PAS faire

- **Ne pas créer de nouveaux outils MCP** (coût de schéma permanent + ambiguïté de sélection pour l'agent). L'échec d'origine n'était pas un manque de capacité.
- **Ne pas retourner le texte intégral des articles dans les résultats de recherche** — `get_article`/`get_articles` existent pour cela.
- **Ne pas gonfler les descriptions d'outils** au-delà des phrases prévues (R3).
- **Ne pas charger de contenu éditorial non validé** (sujets, liens, gazetteer, headnotes) dans les chemins de production — le drapeau `validated` n'est pas décoratif.
- **Ne pas modifier le texte officiel ni le pipeline de fidélité d'ingestion** pour servir la recherche ; toute normalisation vit dans des colonnes fantômes ou des index séparés.
