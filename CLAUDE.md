# CLAUDE.md — Lois du Québec (serveur MCP)

Serveur MCP **en production** servant le texte officiel de 38 lois et règlements du Québec
(FR + EN) : `https://legislation.poirierlavoie.ca/mcp`. Propriétaire : Jason Poirier Lavoie
(avocat). Lecture seule pour les usagers ; les données viennent des EPUB officiels de
LégisQuébec. **C'est un outil juridique : un résultat faux rendu en silence est le pire
défaut possible — refuser vaut toujours mieux que deviner.**

## Architecture (3 morceaux)

1. **Worker Cloudflare** (`src/`, TypeScript) — McpAgent (Durable Object) + 10 outils
   `qclaw_*`, D1 (`qclaw`), Workers AI (bge-m3) + Vectorize (`qclaw-articles`) pour la
   recherche hybride. Config : `wrangler.jsonc` (PAS .toml).
2. **Pipeline Python** (`pipeline/`, venv `./.venv/Scripts/python.exe`, toujours
   `PYTHONUTF8=1`) — télécharge/parse les EPUB Irosoft, charge D1 par
   staging → validation → bascule. Ne JAMAIS écrire directement en production.
3. **Données versionnées** — `laws.config.json` (38 lois), `taxonomy.json` (28 matières
   bilingues), `relations.json` (relations curées), `schema.sql` + `schema-decouverte.sql`
   + `migrations/` (wrangler d1 migrations).

Fichiers clés : `src/tools.ts` (outils MCP), `src/lib.ts` (requêtes D1, échelle de
recherche, fusion RRF), `src/relevance.ts` (TOUTES les constantes de calibration : poids
S1–S4, RRF_K, SEMANTIC_MIN_SCORE…), `src/backfill.ts` (route admin vecteurs),
`pipeline/ingest.py` (orchestrateur), `pipeline/discovery/` (migrate/load/relations/backfill).

## Commandes

```bash
npx wrangler dev                                   # dev local (D1 local ; PAS Vectorize)
npx tsc --noEmit                                   # type-check (toujours avant commit)
npm run evals                                      # 49 contrôles bout-en-bout (MCP_URL=… pour cibler)
npm run eval                                       # harnais d'éval : 20 cas, recall@10/MRR (production)
PYTHONUTF8=1 ./.venv/Scripts/python.exe -m unittest discover -s pipeline/tests -q   # 23 tests
PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pipeline.ingest --law X --lang fr --apply-local
npx wrangler d1 migrations apply qclaw --local|--remote   # bookmark Time Travel AVANT --remote
npx wrangler deploy                                # jeton requis (voir Secrets)
```

## Secrets et jetons

- `cf.token` (racine, gitignoré) : jeton API Cloudflare. **Ne JAMAIS l'afficher, le lire
  en contexte, ni le supprimer** (consigne de Jason). Chargement inline uniquement :
  `export CLOUDFLARE_API_TOKEN=$(tr -d ' \t\r\n' < cf.token)`.
- `backfill.token` (racine, gitignoré) : Bearer de la route `/admin/backfill-vectors`.
- Commits **signés** (gpgsign actif), footer `Co-Authored-By: Claude <noreply@anthropic.com>`
  adapté au modèle courant. Un commit par sous-tâche ; arrêt pour revue humaine à chaque
  fin de phase.

## Invariants critiques (chacun a déjà cassé quelque chose)

1. **L'ORDRE de `laws.config.json` est porteur** : `_id_base()` dérive les plages d'id de
   la POSITION de chaque loi. Réordonner = toutes les clés primaires se décalent et la
   prochaine ingestion écrase les articles d'autres lois, en silence. **On AJOUTE en fin
   de liste, jamais ailleurs** (épinglé par `pipeline/tests/test_config.py`).
2. **`sortKeyOf()` (src/lib.ts) et `sort_key()` (pipeline/model.py) sont des MIROIRS** de
   la même colonne. Une divergence d'échelle vide silencieusement le mode plage de
   `get_articles` (déjà arrivé : 36 lois sur 38 muettes). Les bornes de plage sont LUES
   en base (`boundKey`) précisément pour amortir ce risque.
3. **Un chargement monolingue ne touche pas l'autre langue** : l'UPSERT de `laws` exclut
   `name_<autre>` / `consol_date_<autre>` (une passe FR écrasait le titre anglais).
   `name_norm`/`heading_norm` sont calculés AU CHARGEMENT (une réingestion les remettait
   à NULL et aveuglait les signaux S2/S3).
4. **Les chemins Irosoft sont PROPRES À LA LANGUE** (`ga:l_cinquieme` FR / `ga:l_five` EN).
   Tout chemin traversant les langues passe par le pont des numéros d'articles
   (`translateDivisionPath`/`translatePaths`). Ne jamais supposer un chemin « canonique ».
5. **Pas de LIKE/GLOB sur les chemins** : `_` est un joker LIKE, et D1 plafonne la
   complexité des motifs (« pattern too complex » sur les chemins profonds du C.c.Q.).
   Sous-arbres = intervalle lexicographique `[path+'-', path+'.')` (`subtreeClause`).
6. **D1 refuse toute instruction > 100 Ko** : lots SQL plafonnés en OCTETS UTF-8
   (pas en caractères), lignes surdimensionnées via INSERT + `UPDATE …||` par morceaux
   (`pipeline/load.py`). `wrangler d1 export` est BLOQUÉ par la table virtuelle
   `articles_fts` → sauvegarde = **Time Travel** (bookmark consigné avant migration).
7. **Échelle de recherche (ordre tranché par l'éval, ne pas réordonner sans re-mesurer)** :
   exact → élargissement corpus → leave-one-out → OU+bm25, PUIS fusion RRF avec les
   vecteurs ; le sémantique SEUL est l'ultime barreau, sous plancher
   `SEMANTIC_MIN_SCORE=0,40` **calibré par mesure** (réel EN→FR 0,525 ; charabia 0,303).
   Tout chemin de repli est ÉTIQUETÉ dans la réponse et journalisé (`search_log`).
8. **Vectorize** : ids ≤ 64 octets (chemins de divisions hachés SHA-256/24hex) ; index de
   métadonnées créés AVANT toute insertion (pas rétroactifs) ; fenêtre bge-m3 consommée
   en lot × PLUS LONG texte (rembourrage) → l'embed du backfill se scinde récursivement
   sur l'erreur 3030, ne jamais revenir à une estimation fixe.
9. **Le WAF de la zone bloque les rafales de POST** non-navigateur sur le domaine
   personnalisé. Backfill de vecteurs : activer temporairement `workers_dev: true`,
   passer par `legislation.jpoirierlavoie.workers.dev`, refermer ensuite.
10. **Une session MCP par lot de vérifications** (`eval/mcp-client.mjs`) — un processus
    Inspector par appel multiplie les sessions Durable Object (a déjà épuisé un quota).
    L'Inspector CLI sert aux contrôles ponctuels seulement.
11. **Environnement Windows/Git Bash : les heredocs bash retirent un niveau de `\`**.
    Tout patch contenant des barres obliques inverses passe par un FICHIER script
    (outil Write) puis exécution — jamais par heredoc.
12. **`eval/cases.json` est la vérité terrain de Jason** (⛔) : proposer les évolutions,
    ne jamais modifier de son propre chef. Idem tout contenu éditorial juridique
    (taxonomie, gazetteer, headnotes — drapeau `validated`, phase 3 v2).

## Règles de conception actives (héritées du plan v2, toujours en vigueur)

- **R2** : AUCUN nouvel outil MCP sans approbation explicite (enrichir les 10 existants).
- **R3** : delta de description d'outil ≤ 2 phrases ; consigner le delta de tokens.
- **R4** : ne jamais altérer le texte officiel ni son rendu ; toute aide éditoriale est
  visiblement étiquetée non officielle.
- **R7** : fail open, toujours DIT (étiquettes d'élargissement/relaxation/sémantique).
- **R8** : chemins risqués derrière variables d'env (`RELAX_SEARCH`, `HYBRID_SEARCH`) —
  rollback = flip de variable, pas revert.
- **R9** : réponse de recherche ~≤ 800 tokens en régime normal.
- La description garde-fou de `find_relevant` est IMPOSÉE mot pour mot (const `GARDE_FOU`).

## Procédures sûres

**Modifier le Worker** : coder → `tsc` → `wrangler dev` + contrôles locaux →
`npm run evals` (49) → deploy → re-vérifier en production (les Durable Objects mettent
~30–60 s à recycler l'ancien code) → `npm run eval` si le comportement de recherche a
changé — **porte : aucune régression sur les 20 cas**.

**Ajouter une loi** : (1) ajouter EN FIN de `laws.config.json` (+ `ORDRE_ATTENDU` du
test) ; (2) dry-run de reconnaissance (`pipeline/discovery/recon.py`) — arrêt revue si
balisage inconnu ; (3) `ingest --law X` local puis remote (staging→bascule, invariants de
scan) ; (4) `discovery/load.py` + `relations.py` (les deux cibles) ; (5) passe éditoriale
de Jason sur `taxonomy.json` (sans mappage, la loi est invisible au signal S1) ;
(6) backfill vecteurs (procédure §6 du rapport phase 2) ; (7) mettre à jour les contrôles
épinglés (« 38 lois »…) ; (8) éval avant/après.

**Rafraîchissement semestriel** : `ingest --all --download --refresh-dates` (76 combos),
rechargement découverte, re-backfill vecteurs complet, éval. Le cron déclaré dans
`wrangler.jsonc` n'exécute RIEN aujourd'hui (pas de handler `scheduled`) — le
rafraîchissement est manuel.

## Où trouver quoi

- `docs/ARCHITECTURE-NOTES.md` — état réel constaté (schéma D1, FTS, sondes, écarts).
- `docs/reports/phase-{0,1,2}.md` — mesures, décisions, coûts réels de Discovery v2.
- `docs/phase0-structure-epub.md` — format EPUB Irosoft (référence du parseur).
- `docs/archive/` — plans exécutés (la **phase 3 v2 — curation ⛔ — y reste à faire** :
  `qclaw-discovery-v2-implementation-plan.md`).
- `eval/baselines/*.json` — trajectoire mesurée : recall@10 40 % → 88 % → 98 %.
