# CLAUDE.md — Lois du Québec (serveur MCP)

Serveur MCP **en production** servant le texte officiel de 79 lois et règlements du Québec
(FR + EN) : `https://legislation.poirierlavoie.ca/mcp`. Propriétaire : Jason Poirier Lavoie
(avocat). Lecture seule pour les usagers ; les données viennent des EPUB officiels de
LégisQuébec. **C'est un outil juridique : un résultat faux rendu en silence est le pire
défaut possible — refuser vaut toujours mieux que deviner.**

## ⛔ OBLIGATION PRÉALABLE À TOUTE MODIFICATION (aucune exception)

**Avant de terminer QUELLE QUE SOIT une tâche touchant ce dépôt, évaluer explicitement son
impact sur les CINQ surfaces ci-dessous, et inclure les mises à jour requises DANS LE MÊME
COMMIT.** Ce n'est pas une bonne pratique, c'est une condition de fin de tâche : une tâche
qui laisse une surface en retard n'est pas terminée, elle est en dette.

**Le coût en tokens n'est JAMAIS une raison de sauter cette évaluation** — consigne
explicite de Jason. Lire les cinq fichiers, comparer, et rendre compte coûte moins cher
qu'une seule ligne fausse servie à un modèle dans un outil juridique.

| # | Surface | Où | Ce qui la fait bouger |
|---|---|---|---|
| 1 | **Outils MCP** | `src/tools.ts` | nom, ajout/retrait (R2), paramètres, comportement, message d'erreur servi |
| 2 | **Descriptions** | `src/tools.ts` (`description`, `title`), `catalogue.json` | toute reformulation ; R3 borne le delta et exige de consigner le coût en tokens |
| 3 | **Schéma** | `schema.sql`, `schema-decouverte.sql`, `migrations/`, `inputSchema` des outils, forme de `structuredContent` | colonne ajoutée/retirée, champ de sortie ajouté/retiré/renommé |
| 4 | **README.md** | racine | tout ce qui change ce que le dépôt *annonce* faire |
| 5 | **Page publique** | `catalogue.json` + `src/site.ts` | tout ce qui change ce que le public *lit* |

**Procédure, à exécuter et à RAPPORTER — pas à supposer :**

1. Pour chacune des cinq surfaces : dire si elle est touchée, et pourquoi (« non touchée »
   est une réponse valable, mais elle doit être ÉNONCÉE, jamais passée sous silence).
2. `node --test tests/catalogue.test.mjs` — garde de parité, hors réseau. Il attrape les
   ruptures structurelles ; il n'attrape PAS un sens qui a changé.
3. Si une surface bouge : `npx tsc --noEmit`, puis `npm run evals` contre la cible.
4. Si le schéma bouge : migration numérotée + bookmark Time Travel AVANT `--remote`
   (invariant 6), et vérifier que `structuredContent` n'a pas rétréci en silence
   (corollaire structuré de R4, décision 001).

**Pourquoi cette obligation existe.** La dérive n'est pas hypothétique ici, elle est
documentée : `qclaw_resolve_reference` a servi aux modèles « Voir les 38 textes
disponibles » pendant que le corpus en comptait 79 ; le README annonçait 3 tarifs sur 4,
~46 000 articles sur 49 255, 57 contrôles sur 62, et publiait une configuration de
connexion qui renvoyait 404 ; `docs/ARCHITECTURE-NOTES.md` est resté à 38 lois / 28 matières.
**Aucun test n'a échoué dans aucun de ces cas.** C'est exactement le mode de défaut que ce
dépôt refuse : faux, servi, silencieux.

Détail des mécanismes et de ce qu'ils n'attrapent pas : **R10**, plus bas.

**`docs/` est une ARCHIVE PAR DÉFAUT — il n'est PAS une sixième surface.** Tout document
qui s'y trouve porte une date et **ne fait jamais foi sur l'état courant** : ce sont des
instantanés, des rapports de phase, des plans exécutés. L'état vivant est D1, les JSON
versionnés, `CLAUDE.md`, `README.md` et la page publique — rien d'autre.
C'est délibérément une politique et non une discipline de plus : un document daté ne dérive
pas, il vieillit. `docs/ARCHITECTURE-NOTES.md` a traversé QUATRE agrandissements du corpus
en se déclarant « état réel » sans qu'aucun test n'échoue, précisément parce qu'il
prétendait au présent. Corollaire de rédaction : dans `docs/`, écrire au passé et dater ;
ne jamais y recopier un décompte vivant en le présentant comme actuel.

## Architecture (3 morceaux)

1. **Worker Cloudflare** (`src/`, TypeScript) — McpAgent (Durable Object) + 10 outils
   `qclaw_*`, D1 (`qclaw`), Workers AI (bge-m3) + Vectorize (`qclaw-articles`) pour la
   recherche hybride. Config : `wrangler.jsonc` (PAS .toml).
2. **Pipeline Python** (`pipeline/`, venv `./.venv/Scripts/python.exe`, toujours
   `PYTHONUTF8=1`) — télécharge/parse les EPUB Irosoft, charge D1 par
   staging → validation → bascule. Ne JAMAIS écrire directement en production.
3. **Données versionnées** — `laws.config.json` (79 lois), `catalogue.json` (doc publique
   des outils et des aides au repérage, bilingue — R10), `taxonomy.json` (34 matières
   bilingues), `relations.json` (relations curées), `schema.sql` + `schema-decouverte.sql`
   + `migrations/` (wrangler d1 migrations).

Fichiers clés : `src/tools.ts` (outils MCP), `src/lib.ts` (requêtes D1, échelle de
recherche, fusion RRF), `src/relevance.ts` (TOUTES les constantes de calibration : poids
S1–S4, RRF_K, SEMANTIC_MIN_SCORE…), `src/backfill.ts` (route admin vecteurs), `src/site.ts` (page publique servie à `/` — ses
décomptes sont LUS en D1, jamais recopiés ; elle ne contient JAMAIS le jeton et n'appelle
jamais `/mcp`), `pipeline/ingest.py` (orchestrateur),
`pipeline/discovery/` (recon/migrate/load/relations/verify).
Un seul « backfill » subsiste, celui des VECTEURS (`src/backfill.ts` + `scripts/backfill-vectors.mjs`) :
l'homonyme Python remplissait `name_norm`/`heading_norm` avant que l'invariant n° 3 ne les
fasse calculer au chargement, il est supprimé.

## Commandes

```bash
npx wrangler dev                                   # dev local (D1 local ; PAS Vectorize)
npx tsc --noEmit                                   # type-check (toujours avant commit)
npm run evals                                      # contrôles bout-en-bout (le harnais imprime son total ; MCP_URL=… pour cibler)
npm run eval                                       # harnais d'éval : 20 cas, recall@10/MRR (production)
node eval/run.mjs --refresh-paths                  # revalide eval/cases.resolved.json et SORT — diff à VIDER avant de mesurer
node scripts/journal.mjs [--local|--jours N|--tout] # dépouille search_log (lecture seule) : replis et reformulations
PYTHONUTF8=1 ./.venv/Scripts/python.exe -m unittest discover -s pipeline/tests -q   # 23 tests
node --test scripts/check-consolidation.test.mjs   # 13 contrôles du détecteur de veille (sans réseau, en CI)
node --test tests/catalogue.test.mjs               # garde anti-dérive doc (R10 ; sans réseau, en CI)
node --test tests/page-client.test.mjs             # JS client de la page (sans réseau ni navigateur, en CI)
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
  visiblement étiquetée non officielle. **Corollaire structuré (décision 001, 2026-07-23) :
  toute étiquette qui BORNE un résultat voyage DANS `structuredContent` comme champ
  obligatoire, jamais en prose seule** — un client peut jeter la prose et garder l'objet
  typé, et l'étiquette tomberait sans qu'aucun test n'échoue. Déjà le cas pour `fallback`
  (R7) ; s'impose à la phase 3 v2 (headnotes, drapeau `validated`) avant toute mise en
  service. `outputSchema` reste ABSENT à dessein (coût récurrent de tools/list + un schéma
  qui dérive des gabarits est un contrat menti) ; ne le revisiter que pour un consommateur
  nommé qui VALIDE.
- **R10 — UNE VÉRITÉ, CINQ SURFACES (dérive de documentation).** Mise en œuvre de
  l'**obligation préalable** en tête de ce fichier : outils, descriptions, schéma,
  `README.md`, page publique. Un outil ou une aide au repérage vit dans `src/tools.ts` (ce
  que le modèle reçoit), `catalogue.json` (ce que le public lit) et `README.md` (ce que le
  dépôt annonce) ; tout changement de nom, de titre, de sémantique, de signal, de barreau de
  repli ou de constante de calibration se répercute sur TOUTES les surfaces concernées, dans
  le même commit. **Le coût en tokens n'exempte de rien.**
  **Aucun fait vivant écrit à la main** : un décompte (lois, matières, articles, contrôles)
  se CALCULE (D1, JSON versionné) ou s'IMPORTE (`WEIGHTS`, `SEMANTIC_MIN_SCORE`) — jamais
  recopié dans de la prose. Un fait *historique daté* reste licite AVEC sa date
  (« mesuré à 38 lois : 36 en avaient », « recall@10 40 % → 88 % → 98 % »).
  **Preuve que la consigne seule ne suffit pas** : `qclaw_resolve_reference` a servi aux
  modèles « Voir les 38 textes disponibles » alors que le corpus en comptait 79 ; le README
  annonçait 3 tarifs sur 4 ; `docs/ARCHITECTURE-NOTES.md` est resté à 38 lois / 28 matières.
  Tout cela sans qu'aucun test n'échoue. Garde : `tests/catalogue.test.mjs` (hors réseau,
  en CI) — parité outils ↔ catalogue dans les deux sens, bilinguisme réel, interdiction des
  titres en dur et des valeurs de calibration recopiées, décomptes du README épinglés sur
  les JSON versionnés. **Ce que RIEN n'attrape** : une description reformulée dont la prose
  de page devient fausse sans qu'aucune clé ne bouge — seule la relecture humaine le voit.
  R3 et R9 ne s'appliquent PAS à `catalogue.json` (il n'entre dans aucune réponse MCP) ;
  R4 si (aide éditoriale, visiblement non officielle). L'invariant 13 non plus : la prose de
  page n'est pas une surface d'appariement, contrairement aux descriptions de `taxonomy.json`.
- **R7** : fail open, toujours DIT (étiquettes d'élargissement/relaxation/sémantique).
- **R8** : chemins risqués derrière variables d'env (`RELAX_SEARCH`, `HYBRID_SEARCH`) —
  rollback = flip de variable, pas revert.
- **R9** : réponse de recherche ~≤ 800 tokens en régime normal.
- La description garde-fou de `find_relevant` est IMPOSÉE mot pour mot (const `GARDE_FOU`).

## Procédures sûres

**Modifier le Worker** : coder → `tsc` → `wrangler dev` + contrôles locaux →
`npm run evals` → deploy → re-vérifier en production (les Durable Objects mettent
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
**mettre le connecteur claude.ai sur son URL FINALE (`…/mcp?key=<jeton>`) AVANT de poser le
secret**, puis déployer, puis `wrangler secret put`. Cet ordre est contre-intuitif mais
c'est le seul sûr : `?key=` répond 200 AVEC ET SANS secret (vérifié), donc l'URL finale
fonctionne déjà pendant que l'endpoint est ouvert, et le connecteur ne voit JAMAIS de 404.

**Pourquoi (incident du 2026-07-25, une demi-journée perdue)** : l'ordre inverse — armer
d'abord, corriger l'URL ensuite — a exposé le connecteur à une fenêtre de 404. Pour un
client MCP un 404 n'est pas « pas trouvé » mais « ce serveur exige une authentification » :
il est parti en découverte OAuth, a échoué à l'enregistrement dynamique, et s'est retrouvé
COINCÉ avec un enregistrement à moitié créé — plus modifiable, plus déplaçable, plus
supprimable, plus connectable depuis l'interface claude.ai. Aucune manipulation côté client
n'en venait à bout. Le SEUL déblocage a été `wrangler secret delete MCP_TOKEN` : l'endpoint
rouvert, le connecteur s'est réparé tout seul au retry suivant. Retenir : une fenêtre de
404, même de quelques minutes, peut détruire un connecteur de façon irréversible côté
client.

**Reconstruire une base à partir de rien** (nouvel environnement, D1 de CI, dev local
vierge). `schema.sql` décrit l'ÉTAT INITIAL et les migrations s'appliquent PAR-DESSUS :
c'est pourquoi il porte encore `articles.consol_date` (retirée par 0002) et PAS
`search_log` (créée par 0001). Ne jamais éditer `schema.sql` comme s'il décrivait l'état
COURANT : SQLite n'a pas de « DROP COLUMN IF EXISTS », donc une colonne retirée des DEUX
côtés rend la migration injouable sur une base neuve (arrivé avec 0002, vu à l'audit).

```bash
npx wrangler d1 execute qclaw --local --file=./schema.sql   # 1. état initial
PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pipeline.discovery.migrate --target local
npx wrangler d1 migrations apply qclaw --local              # 3. 0001, 0002, …
PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pipeline.ingest --all --apply-local
PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pipeline.discovery.load --target local
```

Épinglé en CI (étapes 1 et 3, sur une base jetable) : c'est le SEUL contrôle qui parte du
vide — le harnais d'éval ne teste que contre une base déjà peuplée.

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

- **Sondes FTS5** (tokenizer `unicode61`, `remove_diacritics` ACTIF, AUCUN stemming
  français, `bm25`/`snippet`/`highlight`/`fts5vocab` disponibles) et **cas fondateur de
  l'art. 490 C.p.c.** — dans `src/lib.ts`, au-dessus de `toFtsQuery`. Mesurés en production
  le 2026-07-20 ; ce sont des faits sur la PLATEFORME, donc ils ne vieillissent pas quand le
  corpus grandit. Ils vivent dans le code parce qu'on en a besoin en touchant à la requête.
- `docs/ARCHITECTURE-NOTES.md` — **relevé daté du 2026-07-20**, ne fait PAS foi sur l'état
  courant ; réduit le 2026-07-30 à ce qu'il est seul à porter : les volumes de la base à
  38 lois et les écarts entre le plan Discovery v2 et la réalité, qui expliquent pourquoi
  les invariants 4, 6 et 10 existent.
- `docs/reports/phase-{0,1,2}.md` — mesures, décisions, coûts réels de Discovery v2, et les
  **bookmarks Time Travel** consignés avant chaque migration.
- `docs/phase0-structure-epub.md` — format EPUB Irosoft. **Référence vivante du parseur** :
  citée par `pipeline/__init__.py`, `parser.py` et `validate.py`, dont les valeurs témoins
  en viennent. C'est le seul document de `docs/` que du code appelle.
- `docs/archive/` — plans exécutés (la **phase 3 v2 — curation ⛔ — y reste à faire** :
  `qclaw-discovery-v2-implementation-plan.md`). Les vidages de reconnaissance en ont été
  retirés le 2026-07-30 : sorties reproductibles de `recon.py`, pas des décisions.
- `eval/baselines/*.json` — trajectoire mesurée : recall@10 40 % → 88 % → 98 %.
- `eval/cases.resolved.json` — cache des `division_path` de la vérité terrain, DÉRIVÉ
  (régénérable), pas ⛔ contrairement à `cases.json`. Il ne portait aucune revalidation :
  une clé périmée faisait chuter FR-couv **sans un mot**, et un ancien chemin PRÉFIXE du
  nouveau faisait au contraire SUR-estimer la couverture. `--refresh-paths` le revalide et
  sort sans mesurer — régénérer et mesurer d'un même geste invaliderait la comparaison aux
  baselines. Seule une réingestion du C.c.Q. ou du C.p.c. peut l'invalider.
- `docs/propositions-journal-2026-07-30.md` — premier dépouillement de `search_log` :
  cas d'éval et entrées de gazetteer **proposés** (⛔, rien d'appliqué).
