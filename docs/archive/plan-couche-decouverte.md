# Plan d'implémentation — Couche de découverte / pertinence + extension du corpus

**Objet.** Étendre le serveur MCP « Lois du Québec » (en service, `qclaw`) sur deux
fronts : **(A)** ingérer les 36 textes additionnels de la table « Lois » (lois,
règlements de procédure, tarifs, règlements) ; **(B)** ajouter une **couche de
découverte / pertinence** — métadonnées de matière, de fonction et de forum, graphe
d'interconnexion, et outils d'orientation — pour qu'un agent puisse **s'orienter
avant d'extraire** dans un corpus devenu large.

**Destinataire.** Cahier des charges pour Claude Code, à déposer dans le dépôt
existant (aux côtés de `PLAN.md`, qui reste la référence de l'architecture de base).
Avancer **par phases avec points de contrôle** (§9).

**Fichiers livrés avec ce plan** (à déposer dans le dépôt) :

| Fichier | Rôle |
|---|---|
| `schema-decouverte.sql` | Migration D1 additive : 3 nouvelles tables + colonnes ajoutées à `laws`/`divisions` |
| `taxonomy.json` | 28 sujets (11 « socle C.c.Q. » + 17 spécialisés) et 67 mappages sujet→loi/division |
| `relations.json` | 7 relations curées entre lois (le reste du graphe est dérivé automatiquement) |
| `laws.config.additions.json` | Les 36 nouveaux textes : id, nom, citation RLRQ, URL EPUB FR/EN, fonction, forum |

**État constaté du serveur (vérifié en direct avant rédaction) :** `ccq` (3 525
articles) et `cpc` (878), FR+EN, consolidés au 2026‑04‑01. Les chemins de divisions
cités dans `taxonomy.json` (les 10 Livres du C.c.Q. + 4 chapitres du Livre 5) ont
été **vérifiés contre le serveur en service** via `qclaw_get_structure`.

---

## 1. Vue d'ensemble

Le patron cible est une **récupération en deux temps** :

1. **S'orienter** — l'agent appelle `qclaw_find_relevant` (ou `list_laws` /
   `list_subjects`) et obtient une carte annotée : lois et divisions candidates,
   avec le *motif* du rapprochement.
2. **Extraire** — il enchaîne sur les outils existants : `get_structure` dans la
   loi retenue, puis `get_division` / `get_article` / `search_text`.

Les indices de pertinence vivent dans les **sorties d'outils** (canal principal —
voir §6), et reposent sur trois jeux de données : la **taxonomie de matières**
(`subjects` + `subject_map`), les **attributs de loi** (fonction, forum, portée),
et le **graphe d'interconnexion** (`law_relations`).

Principe conservé du projet : la couche de découverte est une **aide heuristique
au repérage**, jamais une détermination du droit applicable (formulation imposée
dans les descriptions d'outils, §4).

---

## 2. Schéma D1 (le « schéma pour le MCP »)

Appliquer `schema-decouverte.sql` (fourni). Résumé :

- **`subjects`** — la taxonomie : `id` (slug), `label_fr/en`, `label_norm`
  (minuscules sans accents, pour l'appariement), `kind`
  (`prive-ccq` | `specialise`), `description_fr`.
- **`subject_map`** — mappage sujet → loi entière (`division_path=''`) **ou**
  division précise (`division_path` = path Irosoft, ex. `ga:l_deuxieme`).
- **`law_relations`** — arêtes du graphe : `rel_type`
  (`reglement-de`, `renvoie-a`, `met-en-oeuvre`, `applique`, `complete`,
  `encadre-par`, `connexe`), `source` (`auto` | `cure`), `weight`,
  `in_corpus` (0 si la cible n'est pas encore au corpus → **liste de candidats
  d'acquisition**), `note`.
- **`laws` étendue** — `fonction`, `forum` (multi « ; », NULL = sans dimension de
  forum), `scope_fr` (une phrase de portée ; repli = `name_fr`), `parent_law_id`
  (loi habilitante d'un règlement), `name_norm`.
- **`divisions.heading_norm`** — intitulés normalisés (recherche d'orientation
  accents-insensible), indexés.

⚠️ Les `ALTER TABLE` de SQLite ne sont **pas idempotents** : le script de
migration doit vérifier `PRAGMA table_info` avant chaque ajout de colonne, ou
n'être exécuté qu'une fois. Un **script de rattrapage** (Python, API HTTP D1)
remplit `name_norm`/`heading_norm` pour les lignes existantes (ccq, cpc) ; le
pipeline les calcule ensuite au chargement. Normalisation de référence :
minuscules + suppression des diacritiques (NFD, retrait des combinants) +
espaces simples.

---

## 3. Données de découverte : contenu et validation

### 3.1 `taxonomy.json`

Deux paliers de sujets :

- **Socle de droit privé** (`kind='prive-ccq'`, 11 sujets) : calqué sur les Livres
  du C.c.Q., avec mappages **au niveau de la division** — les 10 Livres, plus
  4 cibles fines du Livre 5 vérifiées en direct : responsabilité civile
  (`…gb:l_premier-gc:l_troisieme`), louage (`…gb:l_deuxieme-gc:l_quatrieme`),
  contrat de travail (`…gc:l_septieme`), assurances (`…gc:l_quinzieme`), société
  et association (`…gc:l_dixieme`).
- **Matières spécialisées** (17 sujets) : issues de la table « Lois » —
  procédure civile, administration de la justice, droit administratif, louage
  résidentiel, consommation, sociétés et entreprises, valeurs mobilières, secteur
  financier, assurances, travail, renseignements personnels, droit professionnel,
  TI, municipal, immobilier/courtage, droits fondamentaux, interprétation.

Les convergences sont voulues et précieuses : `famille` pointe à la fois le
Livre 2 du C.c.Q. **et** le règlement de la C.S. en matière familiale ;
`publicite-droits` pointe le Livre 9 **et** la Loi sur les bureaux de la publicité
des droits ; `louage-residentiel` pointe le chapitre du louage du C.c.Q. **et** le
bloc TAL. C'est exactement ce que `find_relevant` doit faire remonter ensemble.

### 3.2 `relations.json` (curé — la couche éditoriale du juriste)

7 arêtes de départ, dont les structurantes : `cpc → ccq` (met en œuvre),
`t-15.01 → ccq` (le TAL applique le louage du C.c.Q.), `p-40.1 → ccq` (complète le
droit commun). Fichier versionné, enrichi au fil de l'usage — c'est là que
l'expertise du praticien s'exprime, en peu de lignes.

### 3.3 Relations dérivées automatiquement (pipeline)

- **`reglement-de`** : pour chaque texte `cr`, le **chapitre racine RLRQ** de son
  numéro (ex. « C‑25.01, r. 0.2.01 » → `C-25.01`) désigne sa loi habilitante.
  ⚠️ Résoudre le parent **via `laws.rlrq_cite`**, pas via l'`id` (le chapitre
  `C-25.01` correspond à l'id `cpc`). Renseigner aussi `laws.parent_law_id`.
  Cela relie d'office : 6 règlements + 1 tarif → `cpc` ; tarif judiciaire →
  `t-16` ; règlements TAQ → `j-3` ; règlements TAL → `t-15.01` ; déontologie et
  comptabilité → `b-1`.
- **`renvoie-a`** : moissonner les liens `<a href>` du texte des articles (déjà
  réécrits en absolu par le pipeline) vers d'autres chapitres RLRQ ; agréger par
  paire (loi, cible) avec `weight` = nombre de renvois. Cible hors corpus →
  `in_corpus=0` (candidats d'acquisition, ne pas rejeter).

### 3.4 Validation au chargement (obligatoire, échec bruyant)

Le chargeur de `taxonomy.json`/`relations.json` doit refuser le chargement si :
un `law` référencé n'existe pas dans `laws` ; un `subject` mappé n'est pas déclaré ;
un `division_path` n'existe pas dans `divisions` pour cette loi ; un doublon de
mappage. Lister précisément chaque violation. (Les chemins livrés ont été vérifiés
en direct, mais la validation reste le filet permanent — notamment à chaque
nouvelle consolidation.)

---

## 4. Outils MCP : nouveaux et modifiés

Conventions inchangées : préfixe `qclaw_`, Zod avec descriptions et exemples,
lecture seule (`readOnlyHint`, `idempotentHint`), sorties texte +
`structuredContent`, erreurs actionnables, pagination où pertinent.

### 4.1 `qclaw_list_laws` — enrichi

Ajouter par loi : `fonction`, `forum`, `sujets` (labels), `scope` (repli :
`name_fr`), `parent` (pour les règlements). Pour les grands codes (ccq), lister
les Livres avec leur sujet. Paramètres optionnels de filtre : `fonction?`,
`forum?`, `subject?`. C'est la **carte** du corpus.

### 4.2 `qclaw_list_subjects` — nouveau

Rend la taxonomie : id, label, kind, description, nombre de lois/divisions
mappées. Permet à l'agent de voir les domaines disponibles et d'en choisir.

### 4.3 `qclaw_related_laws` — nouveau

`law`, `rel_type?`, `direction?` (`out`|`in`|`both`, déf. `both`). Rend les arêtes
avec type, note, poids, et signale les cibles hors corpus (`in_corpus=0`) comme
« non disponibles au corpus ». Erreur actionnable si `law` inconnu (lister les id).

### 4.4 `qclaw_find_relevant` — nouveau (le routeur)

Entrée : `query` (thème ou description libre du problème, ex. « vice caché
maison », « congédiement », « bail commercial »), `limit=8`.

Classement **déterministe** (aucun LLM interne), sur la requête normalisée
(minuscules, sans accents, tokens) :

| Signal | Points |
|---|---|
| S1 — token ⊂ `subjects.label_norm` (ou id) → toutes les entités mappées au sujet | +3 |
| S2 — token ⊂ `divisions.heading_norm` (la division correspondante) | +2 |
| S3 — token ⊂ `laws.name_norm` | +2 |
| S4 — voisin de graphe (`cure` ou `reglement-de`) d'une entité déjà retenue | +1 |

Sortie : liste classée de candidats `{law, division_path?, heading, score,
pourquoi[]}` — le champ `pourquoi` cite le signal (« matière : famille »,
« intitulé : DU LOUAGE », « connexe à t-15.01 »). `structuredContent` complet ;
texte lisible en parallèle. Si aucun signal : le dire, et suggérer
`list_subjects` + `search_text`.

**Description imposée (garde-fou), à reprendre telle quelle :** « Aide heuristique
au repérage de lois et de parties de lois candidates. Ne détermine PAS le droit
applicable : toujours vérifier en lisant le texte via get_structure /
get_division / get_article. »

### 4.5 Poids et calibrage

Les poids S1–S4 sont des constantes nommées dans un module unique, avec ~10 cas
de test « requête → candidats attendus » (voir évals §8) ; on les ajuste là,
jamais en dur dans les requêtes SQL.

---

## 5. Extension du corpus : les 36 textes

`laws.config.additions.json` (fourni) fusionne dans `laws.config.json`. Points
d'implémentation :

- **Chemin `cr`** : 13 des 36 sont des règlements — URL en `/fr/epub/cr/…` (le
  pipeline ne connaît que `cs`). Généraliser le téléchargement ; le champ
  `kind_epub` du fichier l'indique par texte.
- **Ids** : dérivés du numéro RLRQ (`t-16`, `p-40.1`, `c-25.01-r.0.2.01`,
  `e-12.000001`…). `ccq`/`cpc` gardent leurs ids historiques.
- **`name_en`** : livré à `null` — le pipeline le remplit depuis le `dc:title` de
  l'OPF **anglais** au premier chargement.
- **EN tolérant** : tenter l'URL EN (`/fr/`→`/en/`) ; si 404, charger FR seul,
  consigner `langues=['fr']`, **ne pas faire échouer l'exécution**. (La
  disponibilité EN des règlements n'est pas garantie — à constater, pas à
  présumer.)
- **`scope_fr`** : non livré (null) — repli sur `name_fr` dans `list_laws` ; une
  passe éditoriale ultérieure du juriste pourra les rédiger.
- **User-Agent navigateur** et capture de la date « à jour au » sur la page HTML
  de chaque texte : mêmes règles que pour le C.c.Q. (PLAN.md §8/§12). Motif de la
  page à généraliser aux règlements (vérifier sur 2–3 pages `cr`).

### 5.1 Risques structurels spécifiques (d'où le dry-run obligatoire, §9 phase B)

La phase 0 n'a inspecté que le C.c.Q. Les 36 textes sont vraisemblablement du même
producteur Irosoft, **mais** :

1. **Annexes et formulaires** : les règlements de cour et plusieurs lois ont des
   ANNEXES (le C.c.Q. n'en avait aucune — le parseur ne les connaît pas). Prévoir
   un `kind='annexe'` et une extraction dédiée, comme pour les dispositions
   préliminaire/finales.
2. **Tarifs = tableaux** : les 3 tarifs sont essentiellement des **tables de
   frais**. L'extraction `text` doit rendre les tableaux lisiblement (lignes
   « intitulé : montant ») et conserver le HTML de table intact dans `html`.
3. **Hétérogénéité de numérotation** : articles peu nombreux, parfois numérotés
   autrement ; aucune hypothèse de continuité 1..N — les invariants seront les
   **comptes constatés au dry-run**, pas des bornes présumées.

---

## 6. Note sur les canaux MCP (où vivent les indices)

Par ordre de fiabilité de consommation par le modèle :

1. **Sorties d'outils** — canal principal ; toujours dans le contexte. Toute
   l'orientation (sujets, portées, graphe, motifs de pertinence) transite par
   `list_laws` / `list_subjects` / `find_relevant` / `related_laws`.
2. **Champ `instructions` du serveur** (option du constructeur `McpServer`,
   renvoyée à l'initialisation) — orientation générale, à mettre à jour :
   « Corpus large. Pour repérer les sources pertinentes d'un problème, commencer
   par qclaw_find_relevant ou qclaw_list_laws, puis cibler avec get_structure →
   get_division/get_article. L'aide au repérage est heuristique : toujours
   vérifier le texte. »
3. **Resources MCP** (facultatif) — une ressource « carte du corpus » (markdown
   généré depuis D1) peut être exposée, mais le support client varie :
   **renfort, jamais canal principal**.
4. **Descriptions d'outils** — chaque outil d'extraction mentionne en une ligne le
   patron en deux temps (« si la loi pertinente est inconnue, commencer par
   qclaw_find_relevant »).

---

## 7. Rafraîchissement

Inchangé dans son principe (PLAN.md §6) : le pipeline semestriel traite désormais
la liste complète (38 textes), recharge la taxonomie et reconstruit les relations
`auto` à chaque exécution (staging → validation → bascule). `taxonomy.json` et
`relations.json` sont **versionnés au dépôt** : toute évolution éditoriale passe
par un commit.

---

## 8. Tests et évaluations

- **Invariants existants intacts** : après toute migration/ingestion, `ccq` =
  3 525 articles et `cpc` = 878, FR et EN, consolidation inchangée — c'est le
  test de non-destruction n° 1.
- **Baselines des 36** : les comptes (articles, divisions, annexes) constatés au
  dry-run de la phase B deviennent les invariants de non-régression.
- **Validation des données de découverte** : chargeur strict (§3.4) + test que
  chaque `division_path` de `subject_map` résout dans `divisions`.
- **Évals du routeur (~10)**, réponses attendues vérifiables, p. ex. :
  « vice caché » → ccq/obligations (vente) en tête ; « bail de logement » →
  bloc TAL + chapitre louage C.c.Q. ; « congédiement » → n-1.1 + contrat de
  travail C.c.Q. ; « appel civil » → c-25.01-r.0.2.01 + cpc ; « hypothèque
  légale construction » → ccq/sûretés ; « assurance responsabilité » →
  chapitre assurances + d-9.2 ; « renseignements personnels fuite » → p-39.1 ;
  « procédure TAQ » → j-3 + j-3-r.3.01.
- **MCP Inspector** sur chaque nouvel outil, et test de bout en bout depuis
  Claude (le connecteur est branché — voir phase E).

---

## 9. Phases de délégation à Claude Code

**Préparation (manuelle).** Déposer au dépôt : ce plan, `schema-decouverte.sql`,
`taxonomy.json`, `relations.json`, `laws.config.additions.json`. Ouvrir Claude
Code à la racine.

### Phase A — Migration + chargement des données de découverte

> « Lis plan-couche-decouverte.md (§2–§3). Écris un script de migration Python
> (API HTTP D1) qui applique schema-decouverte.sql en vérifiant PRAGMA table_info
> avant chaque ALTER, puis un script de rattrapage qui remplit name_norm
> (laws) et heading_norm (divisions) pour ccq et cpc. Écris ensuite le chargeur de
> taxonomy.json et relations.json avec la validation stricte du §3.4 (échec
> bruyant, violations listées). Exécute le tout. Montre-moi : les comptes
> (sujets, mappages, relations), la preuve que chaque division_path de
> subject_map résout, et que ccq=3525 / cpc=878 sont intacts. Commit signé, puis
> arrête-toi. »

### Phase B — Extensions du pipeline + reconnaissance des 36 (dry-run, bloquant)

> « Étends le pipeline selon §5 : URLs cr, fusion de laws.config.additions.json,
> parent_law_id via rlrq_cite, tolérance EN manquant, name_en depuis l'OPF EN,
> extraction des annexes (kind='annexe') et des tableaux (tarifs), moisson des
> renvois <a href> vers des chapitres RLRQ (relations 'renvoie-a', in_corpus=0 si
> hors corpus). Puis exécute un DRY-RUN sur les 36 : télécharge, parse, NE CHARGE
> PAS. Produis docs/reconnaissance-36.md : par texte — nombre d'articles,
> premier/dernier numéro, divisions, annexes et tableaux détectés, langues
> disponibles, anomalies. Signale tout motif de balisage inconnu au lieu de le
> deviner. Commit signé, puis arrête-toi : revue humaine obligatoire. »

*(Point de contrôle : vous validez le rapport — en particulier annexes, tarifs,
et tout texte au balisage divergent — avant toute écriture en base.)*

### Phase C — Ingestion des 36

> « Ingestion réelle des 36 en staging → validation → bascule. Les comptes du
> rapport de phase B sont les invariants attendus ; toute divergence bloque la
> bascule. Vérifie ensuite : ccq/cpc intacts, relations 'reglement-de' présentes
> (13 arêtes attendues), renvois agrégés chargés. Montre le décompte final par
> loi et la sortie de qclaw_list_laws. Commit signé, arrête-toi. »

### Phase D — Outils de découverte

> « Implémente §4 : list_laws enrichi (+filtres), list_subjects, related_laws,
> find_relevant (signaux S1–S4, poids en constantes nommées, description
> garde-fou reprise TELLE QUELLE), mise à jour du champ instructions du serveur
> (§6.2) et des descriptions des outils d'extraction (§6.4). Écris les ~10 évals
> du §8 comme tests exécutables et fais-les passer. Teste chaque outil au MCP
> Inspector et montre-moi les sorties de find_relevant pour « vice caché »,
> « bail de logement », « congédiement ». Commit signé, arrête-toi. »

### Phase E — Déploiement + vérification en conditions réelles

> « Déploie (wrangler deploy). Donne-moi la liste finale des outils exposés et un
> résumé des changements de surface. » — La vérification finale se fait ensuite
> **directement dans Claude** : le connecteur « Législation du Québec » étant
> branché, je testerai moi-même find_relevant, list_subjects et related_laws en
> conversation, sur des cas réels de dossiers.

**Garde-fous permanents :** jamais d'écriture directe sur le magasin en service
(staging → validation → bascule) ; inspection avant parsing (phase B avant C) ;
commits signés par phase ; poids et textes de garde-fou centralisés, pas dupliqués.

---

## 10. Points ouverts (assumés)

1. **`scope_fr`** : passe éditoriale du juriste à planifier (facultative — repli
   `name_fr` en attendant).
2. **Disponibilité EN des règlements** : constatée au dry-run, pas présumée.
3. **Calibrage des poids S1–S4** : premiers réglages via les évals ; à raffiner à
   l'usage.
4. **Enrichissement du graphe** : `relations.json` grandit par commits au fil de
   la pratique ; les cibles `in_corpus=0` forment la liste des candidats
   d'acquisition future.
5. **Sujets au niveau des divisions du C.p.c.** (Livres du C.p.c.) : possible en
   itération ultérieure, même mécanique que le C.c.Q.

---

*Prochaine action : déposer les 5 fichiers au dépôt et lancer la phase A.*
