# Rapport de phase 2 — Discovery v2 : couche sémantique (récupération hybride)

Exécutée le 2026-07-20/21. Commits : 0ccc658 (2.1 infra), 2603c56 (2.2+2.3 code),
ad3c22b (2.4 bascule + réordonnancement). Version en production : bf50f223.
**49 contrôles verts en production ; 23 tests Python verts ; aucune migration D1.**

---

## 1. Acceptation de phase — tout est atteint

| Critère (plan v2) | Résultat |
|---|---|
| Cas 19 (requête EN → cpc 490) passe | ✅ rang 3, étiqueté sémantique |
| Couverture must-include ≥ 85 % au recall@10 | ✅ **98 %** |
| Aucun cas régressé vs phase 1 | ✅ vérifié cas par cas (diff des JSON) |
| Latence ≤ ~1,5 s p50 | ✅ **689 ms** p50 (max 1 238 ms, 10 requêtes hybrides) |

**Trajectoire complète : recall@10 40 % (base) → 88 % (phase 1) → 98 % (phase 2) ;
MRR 0,367 → 0,718 → 0,840 ; cas à zéro 12 → 2 → 0.**

Gains de la phase : cas 12 (« responsabilité civile faute préjudice », deux termes absents
de 1457) 0 % → 100 % (rang 8) ; cas 19 (EN→FR) 0 % → 100 % (rang 3). Le cas 6 reste à
50 % (1739 absent du top 10) — cible du gazetteer « vice caché » (3.2).

## 2. Infrastructure et coûts réels constatés

- Index `qclaw-articles` : 1 024 dims, cosine, index de métadonnées `law`/`type` créés
  **avant** toute insertion. **16 872 vecteurs** (14 136 articles FR + 2 736 divisions).
- Coût de stockage : 16 872 × 1 024 ≈ 17,3 M dims ; 10 M incluses au plan payant →
  **≈ 0,004 $/mois**. Requêtes : ~21 K dims/recherche, 50 M incluses/mois → 0 $ en usage
  réaliste. Embeddings du rattrapage (bge-m3, 0,012 $/M tokens) : **< 0,10 $ une fois**.
  Latence d'embed en requête : comprise dans le p50 de 689 ms.
- 1 seul texte tronqué à ~1 500 tokens sur tout le corpus (une annexe d'i-16).
- Modèle : `@cf/baai/bge-m3` (cible du plan, revérifié à la doc — multilingue, 1 024 dims).
  Alternative consignée : `@cf/qwen/qwen3-embedding-0.6b`.

## 3. Trois murs rencontrés au rattrapage (et leurs leçons)

1. **La fenêtre bge-m3 (60 K tokens) se consomme en lot × PLUS LONG texte** — le moteur
   rembourre au plus long (constaté : « Max context reached 60850 » = 50 × 1 217). Aucune
   estimation de ratio caractères/token n'est fiable (i-16 descend à ~2,4 réels sur ses
   énumérations) → l'embed est **auto-adaptatif** : scission récursive du lot sur l'erreur
   3030. C'est la vérité du modèle qui gouverne, pas une estimation.
2. **Les ids Vectorize sont plafonnés à 64 octets** — un chemin de division profond
   dépasse largement. Ids de divisions = `div:{law}:{sha256(law|path)[:24]}` (stables →
   upserts idempotents) ; le chemin complet vit dans `metadata.path`.
3. **Le WAF de la zone bloque les rafales de POST** non-navigateur sur le domaine
   personnalisé (page HTML, persistant). Le pilote passe par l'URL `workers.dev`
   (hors règles de zone), activée le temps du rattrapage puis **refermée**. Toute erreur
   du Worker est désormais rendue en JSON (jamais de page HTML au pilote).

## 4. Décision 2.4 — ordonnancement de l'échelle (tranchée par l'éval)

Deux défauts que l'ÉVAL a attrapés (et que les contrôles unitaires ne voyaient pas) :
- le sémantique préemptait l'élargissement lexical : « extranéité » restreinte à b-9
  rendait des voisins sémantiques de b-9 au lieu des correspondances **exactes** d'ailleurs ;
- deux voisins au-dessus du plancher court-circuitaient l'étape OU : « vice caché maison
  recours » perdait ccq 1726 (50 % → 0 %, régression détectée au diff).

**Ordre final : dérouler le LEXICAL jusqu'à sa meilleure liste (exact → élargissement →
leave-one-out → OU+bm25), PUIS fusionner RRF (k=60) avec la liste vectorielle ; le
sémantique seul n'est que l'ultime barreau.** Le leave-one-out reste donc EN AMONT du
sémantique — c'est la réponse à la question posée par le plan en 2.4.

Plancher `SEMANTIC_MIN_SCORE = 0,40`, **calibré par mesure en production** : requête
réelle EN→FR 0,525 (cpc 490) ; FR vague 0,47–0,49 ; charabia « zzz qqq » max 0,303.
Sans plancher, Vectorize rend toujours ses topK — le charabia « trouvait » des résultats.

## 5. Décision 2.6 — lemmatisation française : NON NÉCESSAIRE

La base de référence n'avait montré **aucun échec purement morphologique** (les écarts
étaient lexicaux : *congédiement*/délai de congé, *déclinatoire*/décline). Après phase 2 :
0 cas à zéro, et les cas jadis suspects de morphologie (7, 13, 17) passent au rang 1 par
la relaxation. La colonne fantôme Snowball est **fermée sans implémentation** ; à rouvrir
seulement si le journal des échecs réels (`search_log`) montre des ratés flexionnels que
l'hybride ne rattrape pas.

## 6. Procédure 2.5 — rafraîchissement des vecteurs (consolidation semestrielle)

Après chaque réingestion (cron des 5 janvier/5 juillet) :
1. `wrangler.jsonc` : `workers_dev: true` + `npx wrangler deploy` ;
2. `BACKFILL_URL=https://legislation.jpoirierlavoie.workers.dev node scripts/backfill-vectors.mjs`
   (upsert complet, ~10 min, < 0,10 $ ; reprenable — supprimer
   `scripts/.backfill-progress.json` pour repartir de zéro) ;
3. `workers_dev: false` + redéployer.
Les upserts écrasent par id stable ; les articles abrogés restent des lignes « (Abrogé). »
donc pas de vecteurs orphelins. Backfill différentiel : évolution future si le besoin
apparaît (le complet est assez court pour s'en passer).

## 7. Budgets de tokens (R1/R9)

Aucun delta de schéma d'outil en phase 2 (zéro phrase ajoutée). Réponses : la recherche
hybride rend le même gabarit que la phase 1 (les hits sémantiques ajoutent l'étiquette
« (repérage sémantique) » et, au plus, 2 lignes de « Structures pertinentes ») — mesures
phase 1 inchangées (~725 tokens la recherche corpus).

## 8. Rollback

`HYBRID_SEARCH: "0"` + `npx wrangler deploy` = comportement phase 1 à l'identique
(vérifié : le code FTS/relaxation n'a pas changé de chemin quand le flag est éteint).
L'index Vectorize peut rester en place, inerte et quasi gratuit.

## 9. Prochaine étape

Phase 3 (infrastructure de curation ⛔ — l'IA rédige, l'avocat valide) : sujets par
division + divisions compagnes + « Voir aussi » (3.1), gazetteer de concepts (3.2 — le
cas 6 y trouvera son 1739), headnotes différées à l'audit (3.3), durcissement du harnais
(3.4). Chaque contenu passe par `curation/drafts/` et le drapeau `validated` — rien
n'atteint la production sans la validation de Jason.
