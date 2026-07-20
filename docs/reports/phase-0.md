# Rapport de phase 0 — Discovery v2 : reconnaissance et base de référence

Exécutée le 2026-07-20. Aucun changement de comportement du serveur (contrôlé : les
36 contrôles de `tests/evals.mjs` et les 23 tests Python restent verts). Livrables :
`docs/ARCHITECTURE-NOTES.md` (commit a6bef61), harnais `eval/` + base de référence
(commit c68cb9f), le présent rapport.

---

## 1. Écarts d'hypothèses (plan v2 §2 vs réalité)

Détail complet dans `docs/ARCHITECTURE-NOTES.md` §5. L'essentiel, avec effet sur les
phases à venir :

| Écart | Effet |
|---|---|
| Corpus **complet** : 38 lois, 28 276 articles (14 136 FR / 14 140 EN), 5 476 divisions — pas « 36 stubs » | Phase 2 : ~14,1 K vecteurs d'articles FR + ~2,7 K de divisions ≈ **17 K vecteurs** (à 1 024 dims ≈ 17 M de dimensions stockées — dans les limites du palier payant Vectorize ; chiffrer au moment de 2.1). |
| Découverte v1 **terminée** (taxonomie bilingue, routeur S1–S4, 36 contrôles d'éval) | Les tâches 3.1–3.2 s'appuient sur l'existant ; `subject_map.division_path` **existe déjà** (dans la PK) — l'ALTER prévu en 3.1 est sans objet, seule `division_links` sera créée. |
| Chemins Irosoft **propres à la langue** (R6 du plan faux) ; pont `translatePaths()` déjà en place pour les SORTIES de découverte | Tâche 1.5 = appliquer ce pont à l'ENTRÉE de `get_division`/`get_structure` (chemin FR sous `lang=en` → traduire, repli `[fr]`), pas « canoniser » les chemins. Bogue reconfirmé en production. |
| `wrangler d1 export` **bloqué** par la table virtuelle `articles_fts` | Sauvegarde avant migration = **D1 Time Travel** (plan payant actif ; bookmark vérifié : `00000023-00000004-000050ae-…`). Consigner le bookmark courant dans chaque rapport de phase avant migration. |
| Pas de répertoire `migrations/` | Convention `migrations/NNN_description.sql` + `wrangler d1 migrations apply` à introduire à la première migration (1.6 `search_log`). |
| `wrangler.jsonc` (pas `.toml`) ; ingestion bs4/lxml (pas ebooklib) ; modèle 3.3 → `claude-sonnet-5` | Cosmétique / à revérifier au moment de l'implémentation (§0.6 du plan). |

## 2. Sondes FTS5 sur D1 distant — tout est disponible

| Capacité | Verdict | Conséquence |
|---|---|---|
| `bm25()` | ✅ | L'étape « OU + bm25 » de 1.2 et la pondération de colonnes de 3.3 sont réalisables. |
| `snippet(…, 30)` | ✅ | Extraits élargis de 1.3 sans risque. |
| `highlight()` | ✅ | Disponible si besoin. |
| `fts5vocab` | ✅ (sonde créée, interrogée, **supprimée** — 0 trace) | Le « termes voisins dans l'index » de 1.2 est faisable : `signif%` → signification (94 docs), signifiée (74), signifie (54)… |
| Tokenizer | défaut, `remove_diacritics` actif | « extranéité » ≡ « extraneite » (requêtes sans accents couvertes) ; **pas** de stemming FR — la porte 2.6 reste pertinente. |

Cas fondateur reproduit à l'identique : `« signification hors du Québec délai »` → 0
résultat (ET implicite) ; le leave-one-out de « hors » place cpc 490 **premier** ;
`« extranéité »` corpus entier le trouve aussi. Les correctifs 1.1 et 1.2 auraient
chacun suffi — le plan attaque les bonnes causes.

## 3. Base de référence (production, 2026-07-20)

`eval/baselines/2026-07-20.json` — 20 cas de l'Appendice A, verbatim.

**Agrégats : recall@10 moyen 40 % ; MRR moyen 0,367 ; 8/20 cas pleinement couverts ;
12/20 cas à ZÉRO ; couverture find_relevant 55 %.**

Pour chaque échec, les **termes de la requête absents du texte cible** ont été vérifiés
mot à mot contre la base (le ET implicite échoue dès qu'UN terme manque) :

| Cas | Requête (portée) | recall@10 | Rang | Termes absents du texte cible |
|---|---|---|---|---|
| 1 | délai réponse défendeur hors du Québec assignation | 0 % | — | « réponse », « hors » (490 dit *répondre*) — 2 absents |
| 2 | signification hors du Québec délai (cpc) | 0 % | — | **le cas fondateur** — « hors », seul absent |
| 3 | élément d'extranéité | 100 % | 1 | passe déjà (terme exact présent) |
| 4 | défendeur étranger cautionnement frais (cpc) | 0 % | — | « étranger » (492 dit *demandeur qui ne réside pas au Québec*) |
| 5 | notification internationale Convention La Haye (cpc) | 100 % | 1 | |
| 6 | vice caché maison recours (ccq) | 0 % | — | « maison », « recours » (1726 parle de *bien*, *vendeur*, *acheteur*) — 2 absents |
| 7 | dénonciation vice caché délai (ccq) | 0 % | — | « caché » — 1739 dit *vice* tout court (et contient bien « dénonciation ») |
| 8 | récusation juge motifs (cpc) | 100 % | 3 | |
| 9–11 | désaveu / cesser d'occuper / inhabile (cpc) | 100 % | 1 | |
| 12 | responsabilité civile faute préjudice (ccq) | 0 % | — | « responsabilité », « civile » (1457 dit *faute*, *préjudice*) — 2 absents |
| 13 | prescription trois ans action personnelle (ccq) | 0 % | — | « personnelle » — 2925 dit *droit personnel* (masculin ; « trois ans » y est) |
| 14 | congédiement délai de congé raisonnable (ccq) | 0 % | — | « congédiement » (2091 dit *délai de congé*) |
| 15 | clause non-concurrence fin d'emploi (ccq) | 0 % | — | « clause », « non-concurrence », « d'emploi » (2089 dit *stipuler*, *faire concurrence*, *fin du contrat*) — 3 absents |
| 16 | vente sous contrôle de justice garantie (ccq) | 100 % | 1 | |
| 17 | remplacement du juge délibéré (cpc) | 0 % | — | « remplacement » (326 dit *dessaisi*, *continuées… par un autre juge*) |
| 18 | moyen déclinatoire compétence internationale (cpc) | 0 % | — | « déclinatoire » (491 contient *compétence internationale* !) |
| 19 | defendant outside Quebec time to answer | 0 % | — | EN → FR : hors de portée lexicale (acceptation phase 2) |
| 20 | perte de l'ouvrage cinq ans entrepreneur (ccq) | 100 % | 1 | |

**Lecture d'ensemble.** Les 12 échecs se trient en trois familles, qui prédisent quelle
étape de l'échelle de relaxation (1.2) rattrapera chacun :
- **UN seul terme absent** — le leave-one-out (étape 3) devrait suffire : cas 2, 4, 7,
  13, 14, 17, 18 (7 cas). Nota : ce ne sont pas des échecs « morphologiques » purs mais
  des écarts de vocabulaire juriste↔texte (*congédiement*/délai de congé,
  *déclinatoire*/décline) — exactement ce que le gazetteer (3.2) et les headnotes (3.3)
  visent aussi.
- **Plusieurs termes absents** — le leave-one-out (qui n'omet qu'un terme) ne suffira
  pas ; c'est l'étape OU + bm25 (étape 4) ou le sémantique (phase 2) : cas 1, 6, 12, 15.
  Le cas 12 est prometteur pour l'étape 4 (*faute* et *préjudice* présents dans 1457).
- **Pont sémantique requis** : cas 19 (EN), acceptation de la phase 2.

La couverture `find_relevant` à 55 % montre que le routeur amène souvent au bon SIÈGE
(Livre/loi) même quand la recherche lexicale échoue — les deux couches sont
complémentaires, comme le plan le suppose.

**Attentes chiffrées pour la phase 1** (à mesurer contre cette base) : les 7 cas à un
terme absent + le cas 2 devraient passer par la relaxation ; les 4 cas multi-absents
partiellement par l'étape OU ; plancher attendu après phase 1 ≈ 15/20 cas couverts.
La porte 2.6 (lemmatisation) ne se justifiera que si des échecs purement morphologiques
subsistent après l'hybride — la base n'en montre aucun de pur (les écarts sont
lexicaux, pas flexionnels).

## 4. Décisions prises en phase 0

1. **Sauvegarde = D1 Time Travel** (l'export est impossible, table virtuelle) ; bookmark
   consigné avant toute migration.
2. **Harnais sur client MCP partagé** (`eval/mcp-client.mjs`), une session pour tous les
   appels — `tests/evals.mjs` refactorisé dessus, 36 contrôles verts.
3. **Base de référence prise contre la production** (plan §0.4) ; `MCP_URL` permet de
   viser un environnement local ou de prévisualisation.
4. `eval/cases.json` est la vérité terrain **gelée** : toute évolution passe par Jason
   (⛔ §3.4).

## 5. Prochaine étape

Phase 1 (gains rapides côté Worker), dans l'ordre du plan : 1.1 → 1.2 → 1.3 sur
`qclaw_search_text`, puis 1.4 / 1.5 / 1.6 (indépendantes). Première migration
(`search_log`) = introduction de la convention `migrations/` + bookmark Time Travel
préalable. Porte de fin de phase : ré-exécution de l'éval — attente : les cas
lexicalement atteignables s'améliorent nettement, aucun ne régresse.
