# Rapport de phase 1 — Discovery v2 : gains rapides côté Worker

Exécutée le 2026-07-20, en 6 commits déployables individuellement (34bc814 1.6,
9d004b0 1.1, 15e8e05 1.2, e2d6131 1.3, 1eb2ac2 1.4, cdb421f 1.5) + contrôles permanents.
Déployée en production (version f09defb6). **46 contrôles verts en production ; 23 tests
Python verts ; migration 0001 appliquée (bookmark Time Travel préalable :
`00000025-00000000-000050af-e412105f383b66d0c41c3fa86f7ba3b8`).**

---

## 1. Porte de fin de phase — éval avant/après (production, 20 cas)

**Agrégats : recall@10 moyen 40 % → 88 % ; MRR 0,367 → 0,718 ; cas pleinement couverts
8/20 → 17/20 ; cas à zéro 12 → 2 ; AUCUNE régression.**
(Attente du rapport de phase 0 : ~15/20 — dépassée.)

| Cas | Requête (portée) | avant | après | rang | Δ |
|---|---|---|---|---|---|
| 1 | délai réponse défendeur hors du Québec assig | 0 % | 100 % | — → 6 | ↑ |
| 2 | signification hors du Québec délai (cpc) | 0 % | 100 % | — → 1 | ↑ |
| 3 | élément d'extranéité | 100 % | 100 % | 1 → 1 | = |
| 4 | défendeur étranger cautionnement frais (cpc) | 0 % | 100 % | — → 1 | ↑ |
| 5 | notification internationale Convention La Haye (cpc) | 100 % | 100 % | 1 → 1 | = |
| 6 | vice caché maison recours (ccq) | 0 % | 50 % | — → 3 | ↑ |
| 7 | dénonciation vice caché délai (ccq) | 0 % | 100 % | — → 1 | ↑ |
| 8 | récusation juge motifs (cpc) | 100 % | 100 % | 3 → 3 | = |
| 9 | désaveu avocat (cpc) | 100 % | 100 % | 1 → 1 | = |
| 10 | avocat cesser d'occuper (cpc) | 100 % | 100 % | 1 → 1 | = |
| 11 | avocat conflit d'intérêts inhabile (cpc) | 100 % | 100 % | 1 → 1 | = |
| 12 | responsabilité civile faute préjudice (ccq) | 0 % | 0 % | — | = |
| 13 | prescription trois ans action personnelle (ccq) | 0 % | 100 % | — → 1 | ↑ |
| 14 | congédiement délai de congé raisonnable (ccq) | 0 % | 100 % | — → 1 | ↑ |
| 15 | clause non-concurrence fin d'emploi (ccq) | 0 % | 100 % | — → 5 | ↑ |
| 16 | vente sous contrôle de justice garantie (ccq) | 100 % | 100 % | 1 → 1 | = |
| 17 | remplacement du juge délibéré (cpc) | 0 % | 100 % | — → 3 | ↑ |
| 18 | moyen déclinatoire compétence internationale (cpc) | 0 % | 100 % | — → 1 | ↑ |
| 19 | defendant outside Quebec time to answer | 0 % | 0 % | — | = |
| 20 | perte de l'ouvrage cinq ans entrepreneur (ccq) | 100 % | 100 % | 1 → 1 | = |

Fichiers : `eval/baselines/2026-07-20.json` (avant) et `2026-07-20-phase1.json` (après).

**Les deux échecs restants sont ceux prévus pour la phase 2 :**
- cas 12 : « responsabilité » et « civile » absents de 1457 ; l'étape OU classe d'autres
  articles à *faute*/*préjudice* devant — pont sémantique attendu ;
- cas 19 : requête anglaise → texte français (l'acceptation même de la phase 2).
Le cas 6 est passé à 50 % (1726 trouvé rang 3 ; 1739 pas dans le top 10) — le gazetteer
« vice caché » (3.2) et/ou l'hybride devraient compléter.

Le cas fondateur (490) est réglé trois fois : leave-one-out (rang 1, cas 2), élargissement
(cas 3 corpus), aperçu « ailleurs au corpus » (restreinte avec résultats).

## 2. Livré par tâche

- **1.1** Élargissement automatique sur zéro résultat, étiqueté (`Aucun résultat dans X ;
  N résultat(s) ailleurs dans le corpus :`) + **aperçu « ailleurs au corpus »** quand une
  recherche restreinte A des résultats (voir §3, écart n° 1). +1 phrase de description.
- **1.2** Échelle : exact → élargi → leave-one-out (2–6 termes, ≤ 6 SELECT, meilleur
  ensemble par somme bm25) → OU + bm25 (termes composés éclatés). Flag `RELAX_SEARCH`
  (défaut actif), étiquettes du plan reprises telles quelles, journalisation des chemins.
- **1.3** Fils d'Ariane construits depuis `divisions` (`C.p.c. — Livre V, Titre IV : LES
  DEMANDES INTÉRESSANT LE DROIT INTERNATIONAL PRIVÉ › art. 490 [ga:l_v-gb:l_iv-gc:l_i]`),
  extraits ~30 tokens, groupes par loi (max 6/loi, 14 par défaut, sur-échantillonnage 3×),
  ID machine conservé.
- **1.4** Plan profondeur 2 dans `list_laws` (param `structure`, défaut true) — Livre V +
  Titre IV visibles (test d'acceptation du plan).
- **1.5** Pont de langue à l'ENTRÉE de `get_division`/`get_structure` (numéros d'articles
  invariants) + repli d'intitulé `[fr]`/`[en]`. Test du plan : chemin FR sous `lang=en` →
  « Chapter VII — CONTRACT OF EMPLOYMENT ».
- **1.6** `search_log` (migration 0001, convention `migrations/` + `wrangler d1 migrations`
  introduite). Vérifié en production après la passe de contrôles :
  `loo:hors ×4, or_relax ×4, widened ×2, loo:étranger, loo:remplacement` — les bons
  chemins, aux bons endroits. Requête de revue hebdomadaire dans l'en-tête de la migration.

## 3. Écarts au plan, décisions prises

1. **Tests d'acceptation 1.1 contradictoires.** Le plan exige à la fois que
   `extranéité/ccq` montre « une section élargie contenant cpc 490 » ET qu'« une requête
   restreinte avec résultats ne déclenche pas d'élargissement » — or `extranéité/ccq` A
   un résultat (3111). Résolution : les résultats demandés restent intacts (pas
   d'élargissement), mais une section « Ailleurs au corpus — aperçu » (top 3 hors portée,
   1 requête) montre cpc 490. Les deux intentions sont servies ; c'est en outre le
   scénario RÉEL du post-mortem, que l'élargissement sur zéro seul n'aurait pas couvert.
2. **1.4 : le critère « kind = livre » rate sa cible.** Le parseur classe positionnellement
   (`ga:` = livre) : 36 lois sur 38 ont des « livres », et le plan complet pèse ~22 K
   tokens par appel (mesuré) contre +1,2–1,5 K promis. Le budget annoncé correspond
   exactement à ccq + cpc (93 nœuds) : allowlist `OUTLINE_LAWS = [ccq, cpc]`, extensible.
3. **Étapes 3–4 de l'échelle : portée demandée d'abord** (le plan ne précisait pas) ;
   l'étape OU retente ensuite sans portée. Leave-one-out plafonné à 6 SELECT comme exigé.
4. **« Termes voisins » (fts5vocab, optionnel) : différé.** Faisable (phase 0), mais
   aucun cas d'éval ne le requiert — à réévaluer sur le journal des échecs réels.
5. **Sauvegarde par Time Travel** (l'export D1 reste bloqué par la table virtuelle) —
   bookmark ci-dessus, consigné avant la migration comme l'exige R11 adapté.

## 4. Deltas de tokens (R1/R3/R9)

| Surface | Delta mesuré |
|---|---|
| Schémas d'outils (permanent) | +1 phrase sur `search_text` (~39 tokens) + description du param `structure` (~28 tokens) ≈ **+67 tokens** — sous R3 (≤ 2 phrases/outil). |
| `list_laws` avec `structure=true` | +8,4 K caractères ≈ **+2,1 K tokens** par appel (rare, ≤ 1×/session) — au-dessus des +1,2–1,5 K estimés par le plan, mesuré sur les intitulés réels ; `structure=false` pour le couper. |
| `search_text` corpus groupée | ~2 900 car. ≈ **725 tokens** — sous le plafond R9 (~800). |
| `search_text` relaxée / restreinte+aperçu | 161 / 267 tokens. |

## 5. Prochaine étape

Phase 2 (couche sémantique hybride) : Workers AI + Vectorize, ~17 K vecteurs
(14,1 K articles FR + 2,7 K divisions), flag `HYBRID_SEARCH`. Cibles : cas 19 passe ;
cas 12 et le 1739 du cas 6 rattrapés ; ≥ 85 % de couverture must-include maintenue ;
décisions 2.4 (position du leave-one-out) et 2.6 (lemmatisation — partant défavorisée,
aucun échec purement morphologique constaté) à documenter.
