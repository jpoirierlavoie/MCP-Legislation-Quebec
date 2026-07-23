# CLAUDE.md — Lois du Québec (serveur MCP)

Serveur MCP **en production** servant le texte officiel de 79 lois et règlements du Québec
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
3. **Données versionnées** — `laws.config.json` (79 lois), `taxonomy.json` (34 matières
   bilingues), `relations.json` (relations curées), `schema.sql` + `schema-decouverte.sql`
   + `migrations/` (wrangler d1 migrations).

Fichiers clés : `src/tools.ts` (outils MCP), `src/lib.ts` (requêtes D1, échelle de
recherche, fusion RRF), `src/relevance.ts` (TOUTES les constantes de calibration : poids
S1–S4, RRF_K, SEMANTIC_MIN_SCORE…), `src/backfill.ts` (route admin vecteurs),
`pipeline/ingest.py` (orchestrateur), `pipeline/discovery/` (recon/migrate/load/relations/verify).
Un seul « backfill » subsiste, celui des VECTEURS (`src/backfill.ts` + `scripts/backfill-vectors.mjs`) :
l'homonyme Python remplissait `name_norm`/`heading_norm` avant que l'invariant n° 3 ne les
fasse calculer au chargement, il est supprimé.

## Commandes

```bash
npx wrangler dev                                   # dev local (D1 local ; PAS Vectorize)
npx tsc --noEmit                                   # type-check (toujours avant commit)
npm run evals                                      # 62 contrôles bout-en-bout (MCP_URL=… pour cibler)
npm run eval                                       # harnais d'éval : 20 cas, recall@10/MRR (production)
PYTHONUTF8=1 ./.venv/Scripts/python.exe -m unittest discover -s pipeline/tests -q   # 23 tests
node --test scripts/check-consolidation.test.mjs   # 13 contrôles du détecteur de veille (sans réseau, en CI)
PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pipeline.ingest --law X --lang fr --apply-local
npx wrangler d1 migrations apply qclaw --local|--remote   # bookmark Time Travel AVANT --remote
npx wrangler deploy                                # jeton requis (voir Secrets)
```

## Secrets et jetons

- `cf.token` (racine, gitignoré) : jeton API Cloudflare. **Ne JAMAIS l'afficher, le lire
  en contexte, ni le supprimer** (consigne de Jason). Chargement inline uniquement :
  `export CLOUDFLARE_API_TOKEN=$(tr -d ' \t\r\n' < cf.token)`.
- `backfill.token` (racine, gitignoré) : Bearer de la route `/admin/backfill-vectors`.
- `mcp.token` (racine, gitignoré) : jeton d'accès de l'endpoint MCP (`src/auth.ts`).
  Miroir du secret Worker `MCP_TOKEN` (`wrangler secret put MCP_TOKEN`) et du secret
  GitHub du même nom (veille CI). Les clients Node le résolvent tout seuls
  (`eval/mcp-client.mjs` : `MCP_TOKEN` puis `mcp.token`) — rien à exporter à la main.
  N'ouvre QUE la lecture MCP : aucun droit sur le compte Cloudflare ni sur la base.
  **Rotation = poser le nouveau secret, puis mettre à jour les 3 copies** (fichier local,
  secret GitHub, URL du connecteur claude.ai — forme `…/mcp?key=<jeton>`).
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
12. **Toute calibration doit dégrader EN DOUCEUR quand le corpus grandit** : un seuil
    (« ≤ N entités → bonus, sinon rien ») a une position qui dépend de la taille du
    corpus. En passant de 47 à 78 lois, « récusation » a franchi le seuil de spécificité
    et le bon chapitre du C.p.c. a disparu du top 8 — sans erreur. Les pondérations sont
    désormais continues (`specificityFactor`). Se méfier de tout `<=` sur un décompte
    d'entités dans `src/relevance.ts`.
13. **Une `description` de matière est une SURFACE D'APPARIEMENT, pas de la prose.** S1
    apparie des tokens et ignore la négation : écrire « distincte de la procédure civile »
    dans la matière *Procédure pénale* lui a fait capter « appel civil » et évincer le
    C.p.c. Jamais de mention contrastive ni de « à ne pas confondre avec » dans une
    description ; n'y mettre que le vocabulaire que l'on VEUT voir matcher.
14. **L'appariement par préfixe de mot est BORNÉ (`MAX_SUFFIX = 4`)** : sans plafond de
    suffixe, un token de 3 lettres avale un mot de 9 — « fin » captait « financier » et
    noyait « clause non-concurrence fin d'emploi » sous tout le secteur financier. Le
    plafond couvre la flexion française (-s, -es, -aux, -ment, -tion) ; l'élargir revient
    à rouvrir cette classe de faux positifs.
15. **Une matière est UNE preuve, pas N candidats** (`MAX_PER_SUBJECT = 3`) : S1 injecte
    un candidat par entité mappée, tous au même score. *Bâtiment et construction* (7 lois)
    remplissait le top 8 à elle seule et en chassait le C.c.Q. Le plafond de diversité ne
    s'applique QU'aux candidats sans autre signal (S2/S3/S4). Toute matière dépassant
    ~5 entités mappées est un candidat à ce défaut : le vérifier à l'éval, pas au jugé.
16. **`eval/cases.json` est la vérité terrain de Jason** (⛔) : proposer les évolutions,
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
`npm run evals` (55) → deploy → re-vérifier en production (les Durable Objects mettent
~30–60 s à recycler l'ancien code) → `npm run eval` si le comportement de recherche a
changé — **porte : aucune régression sur les 20 cas**.

**Contrôle d'accès de `/mcp`** (`src/auth.ts`) : jeton partagé accepté sous TROIS formes.
**La forme du connecteur claude.ai est `?key=<jeton>`** — mesurée, pas supposée : le
segment de chemin `/mcp/<jeton>` a ÉCHOUÉ en pratique (« Impossible de joindre ») alors
qu'une session complète y passe en curl, tandis que `?key=` a fonctionné du premier coup.
`Authorization: Bearer` reste la forme des clients maîtrisés (Claude Code, évals, veille CI) ;
le segment de chemin est conservé, testé, mais n'est la forme de personne aujourd'hui.

Deux constats de production à ne pas réapprendre à la dure (2026-07-23) :
- **Le slash final DOIT être toléré.** `/mcp/<jeton>/` renvoyait 404 et ce 404 poussait le
  connecteur vers la découverte OAuth, qui échouait sur l'enregistrement dynamique
  (« Impossible de s'inscrire auprès du service de connexion »). Pour un client MCP un refus
  n'est JAMAIS neutre : il est lu comme « ce serveur demande une authentification ».
- **Le connecteur émet des `GET /mcp` SANS aucun porteur** (constaté au `wrangler tail` :
  les POST portent `?key=`, les GET arrivent nus). Ces GET — le flux SSE serveur→client,
  optionnel dans le transport streamable — sont donc refusés en 404 et le connecteur
  retombe en POST seul, sans perte pour les 10 outils (aucune notification serveur→client).
  Ne pas « réparer » ça en ouvrant les GET : ce serait un trou. L'option propre, si un jour
  le flux devient utile, est d'accepter le `mcp-session-id` (64 hex émis par le DO) comme
  preuve sur les GET seulement.

Trois points à ne pas défaire :
(1) la vérification est dans le handler de module, donc AVANT le Durable Object — c'est ce
qui fait qu'un appel non autorisé ne coûte rien ; (2) un refus répond **404, jamais 401** —
un 401 annonce un serveur MCP et déclenche la découverte OAuth des clients ; (3) **sans
`MCP_TOKEN`, l'endpoint reste ouvert** (R8 : rollback = `wrangler secret delete MCP_TOKEN`,
pas un revert ; c'est aussi ce qui garde `wrangler dev` utilisable). Ordre de bascule :
déployer → vérifier avec le Bearer → **puis** changer l'URL du connecteur claude.ai. Poser
le secret avant d'avoir l'URL sous la main coupe son propre accès.

**Ajouter une loi** : (1) ajouter EN FIN de `laws.config.json` (+ `ORDRE_ATTENDU` du
test) ; (2) dry-run de reconnaissance (`pipeline/discovery/recon.py`) — arrêt revue si
balisage inconnu ; (3) `ingest --law X` local puis remote (staging→bascule, invariants de
scan) ; (4) `discovery/load.py` + `relations.py` (les deux cibles) ; (5) passe éditoriale
de Jason sur `taxonomy.json` (sans mappage, la loi est invisible au signal S1) ;
(6) backfill vecteurs (procédure §6 du rapport phase 2) ; (7) `discovery/verify.py` —
comptes de `subjects`/`subject_map`/`law_relations` et résolution de chaque
`division_path` ; (8) mettre à jour les contrôles épinglés (« 78 lois »…) ;
(9) éval avant/après.

**Rafraîchissement semestriel** : `ingest --all --download --refresh-dates` (76 combos),
rechargement découverte, re-backfill vecteurs complet, éval. **Entièrement manuel et
sous surveillance** : le cron de `wrangler.jsonc` n'exécute RIEN (aucun handler
`scheduled`), et aucun workflow GitHub n'écrit plus en base — l'ancien `refresh.yml` a
été retiré parce qu'il ne rechargeait que les articles (ni découverte ni vecteurs),
laissant les embeddings sur l'ancien texte donc du droit périmé rendu en silence.

**Veille de consolidation** (`.github/workflows/veille-consolidation.yml` +
`scripts/check-consolidation.mjs`) : job **en LECTURE SEULE**, mensuel, qui compare la
date « À jour au » de chaque loi sur LégisQuébec à `consol_date_*` en D1 (lue via
`qclaw_list_laws` sur l'endpoint MCP — jeton de LECTURE `MCP_TOKEN` en secret GitHub,
toujours AUCUN secret Cloudflare) et ouvre/actualise une
issue étiquetée `veille-consolidation` quand un rafraîchissement est dû (issue close
automatiquement à la résolution). Il DÉTECTE, il ne bascule jamais. `extractConsolidation`
est un miroir FIDÈLE de `fetch_consolidation` (portée bornée aux blocs `text-end`) ;
une page atteinte mais illisible est un signal ACTIONNABLE (le miroir a peut-être cassé),
jamais un null confondu avec une panne réseau — verrouillé par
`scripts/check-consolidation.test.mjs` (13 contrôles, en CI). Deux signaux SÉPARÉS
depuis le 2026-07-23 : `drift` (dérive corpus) et `unreachable` (blocage réseau) —
le titre de l'issue dit lequel a parlé, et elle ne clôt que si les DEUX sont éteints
(une page injoignable est une loi NON VÉRIFIÉE, pas une loi à jour). Défauts trouvés par revue
adversariale (2026-07-21) et corrigés avant le premier commit.

## Où trouver quoi

- `docs/ARCHITECTURE-NOTES.md` — état réel constaté (schéma D1, FTS, sondes, écarts).
- `docs/reports/phase-{0,1,2}.md` — mesures, décisions, coûts réels de Discovery v2.
- `docs/phase0-structure-epub.md` — format EPUB Irosoft (référence du parseur).
- `docs/archive/` — plans exécutés (la **phase 3 v2 — curation ⛔ — y reste à faire** :
  `qclaw-discovery-v2-implementation-plan.md`).
- `eval/baselines/*.json` — trajectoire mesurée : recall@10 40 % → 88 % → 98 %.
