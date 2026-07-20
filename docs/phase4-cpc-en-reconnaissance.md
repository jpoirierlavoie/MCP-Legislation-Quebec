# Phase 4 — Reconnaissance C.c.Q. anglais + C.p.c. (FR/EN)

Reconnaissance dédiée exigée par PLAN.md §12 (points ouverts 2 et 3) avant ingestion, faite
sur les fichiers réels (2026-07-19). Toutes les dates de consolidation constatées : **2026-04-01**.

## C.c.Q. anglais (CCQ-1991, EN)

**Structure identique au français** — mêmes `id` de division (`ga:`…) et d'article (`se:`),
mêmes décomptes : 3523 articles (1→3168), 355 décimaux, 800 divisions (10/45/160/270/213/86/13/3),
68 articles abrogés, 4 divisions abrogées. Seul le **texte** diffère (anglais). Différences de
surface à gérer :

- **Mots de niveau EN** : `BOOK` / `TITLE` / `CHAPTER` / **`DIVISION`** (l'anglais nomme
  « DIVISION » le niveau `gd` que le français nomme « SECTION » ; le `kind` interne reste
  `section` dans les deux langues). Ordinaux parfois en toutes lettres (« BOOK ONE »).
- **Dispositions EN** : « PRELIMINARY PROVISION » (page0) et « FINAL PROVISIONS » (`sc-nb:1`).
- **Abrogation EN** : « (Repealed). » (et non « (Abrogé). »).
- **Chemins de division lang-spécifiques** : les valeurs de segment sont traduites
  (`ga:l_cinquieme` en FR vs `ga:l_five` en EN). Chaque langue a donc sa propre hiérarchie de
  `path` ; les outils MCP opèrent par langue (on obtient un `path` via `qclaw_get_structure`
  dans la langue voulue avant d'appeler `qclaw_get_division`).

## C.p.c. (C-25.01, FR et EN)

Même format Irosoft, plus petit et moins profond :

- **876 articles** (entiers **1→836** sans lacune + 40 décimaux) ; **307 divisions**
  réparties `livre 8 / titre 30 / chapitre 129 / section 123 / sous-section 17` (aucun niveau
  6/7/8). **1 article abrogé**, 0 division abrogée. FR et EN symétriques.
- **Code 2016 natif** : le fichier est déjà la version recodifiée (C-25.01) ; il n'y a pas
  d'ancienne numérotation à démêler à l'intérieur. **Question ouverte laissée telle quelle** :
  couvrir aussi l'**ancien C.p.c.** (C-25, abrogé, numérotation différente) est une décision
  produit — non fait (seul C-25.01 est configuré).
- **Dispositions finales = articles ordinaires** : contrairement au C.c.Q., les dispositions
  transitoires et finales du C.p.c. sont de vrais articles `se:` du Livre VIII (jusqu'à 836).
  Aucun pseudo-article « finales ».
- **ANNEXE I** (unique bloc spécial propre au C.p.c.) : dans `sc-nb:1` sur la dernière page —
  la *Convention de La Haye relative à la signification…* reproduite comme annexe. Historique
  « 2014, c. 1, annexe I. » (EN : « Schedule I »). Servie comme pseudo-article `number='annexe'`
  sous une division `kind='annexe'`.

**Piège corrigé** : l'`id` `sc-nb:1` sert au C.c.Q. pour les DISPOSITIONS FINALES **et** au
C.p.c. pour l'ANNEXE. On classe donc sur l'**intitulé** du bloc (div d'en-tête `d36e`), pas sur
l'id — d'autant que l'historique des finales du C.c.Q. contient le mot « annexe » (« 1991, c. 64,
annexe. ») sans en être une.

## Adaptations du parseur (pipeline/parser.py)

- Config par langue `_LANG` (mots de niveau + intitulés de disposition).
- Détection d'abrogation bilingue `_REPEALED_RE` = `(Abrog|Repea)`.
- `_parse_sc_block` classe `sc-nb:1` en **finales** ou **annexe** selon l'intitulé.
- `sort_key('annexe')` = 9,5×10⁹ (après tout le corpus).
- Chargeur : bascule scopée par **(law_id, lang)** (recharger une langue n'efface pas l'autre) ;
  `id` de divisions/articles **globalement uniques** via un décalage par (loi, langue) —
  la clé primaire est partagée par toutes les combinaisons, chargées une à la fois.

## Vérification

Invariants des 4 combinaisons (ccq/fr, ccq/en, cpc/fr, cpc/en) verts ; 18 tests de
non-régression ; outils MCP testés bilingues et en recherche multi-lois ; vérification
adversariale du verbatim (ré-extraction indépendante) sur un échantillon EN + C.p.c.
