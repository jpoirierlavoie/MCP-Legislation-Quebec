# Relevé de la base D1 — INSTANTANÉ DATÉ du 2026-07-20

> ⚠️ **CE DOCUMENT NE FAIT PAS FOI SUR L'ÉTAT COURANT** et n'a jamais vocation à le faire.
> C'est un relevé pris le 2026-07-20, quand le corpus comptait 38 lois et 28 matières. Il
> en compte davantage depuis. **L'état vivant** : D1 lui-même, les JSON versionnés
> (`laws.config.json`, `taxonomy.json`, `relations.json`, `catalogue.json`), `CLAUDE.md`,
> `README.md` et la [page publique](https://legislation.poirierlavoie.ca/), qui calcule ses
> décomptes en base à chaque rendu.
>
> Ce fichier a été **réduit le 2026-07-30** à ce qu'il est seul à porter. Ce qu'il
> contenait par ailleurs a été rapatrié là où on en a besoin au moment où on en a besoin :

| Ce qu'il portait | Où ça vit maintenant | Pourquoi là |
|---|---|---|
| Sondes FTS5 (tokenizer, équivalence diacritique, absence de stemming, `bm25`/`snippet`/`highlight`/`fts5vocab`) et cas fondateur de l'art. 490 C.p.c. | **`src/lib.ts`, au-dessus de `toFtsQuery`** | Ce sont des faits sur la PLATEFORME, pas sur le corpus : ils ne vieillissent pas. Ils se lisent au moment où l'on touche à la requête FTS. |
| DDL de `articles_fts`, contrainte de la colonne unique indexée | **`schema.sql`** | C'est le fichier qui la crée. |
| `wrangler d1 export` bloqué → Time Travel, fenêtre de 30 jours | **`CLAUDE.md`, invariant 6** | C'est une procédure vivante, pas une mesure. |
| Arborescence annotée du dépôt | **`CLAUDE.md`** (architecture, fichiers clés, invariants) et `README.md` | Elle prétendait au présent et avait vieilli sur presque chaque ligne : `migrations/` absent, `backfill.py` depuis supprimé, décomptes figés à 38 lois. |

---

## 1. Volumes relevés en base distante, 2026-07-20

Point de trajectoire, pas un décompte courant.

| Grandeur | Valeur au 2026-07-20 |
|---|---|
| Articles | **28 276** (14 136 FR / 14 140 EN) |
| Divisions | **5 476** (2 736 FR) |
| Lois | 38 |
| Matières | 28 |
| Mappages matière → loi/division | 67 |
| Relations | 772 (7 curées + 765 automatiques) |

Base : `qclaw`, `b707af5a-8807-4a02-805d-13e5b0de033e`. Code en production à cette date :
`legislation.poirierlavoie.ca`. Référentiel du relevé :
`archive/qclaw-discovery-v2-implementation-plan.md` (§0.1–0.3).

---

## 2. Écarts entre le plan Discovery v2 (§2) et la réalité constatée

C'est la partie que rien d'autre ne porte : elle explique **pourquoi** plusieurs invariants
de `CLAUDE.md` existent. Écrite au passé, close, non actualisée.

| Hypothèse du plan v2 | Réalité constatée le 2026-07-20 |
|---|---|
| « ~36 textes en stubs (0 article) » | **38 lois entièrement ingérées** (28 276 articles), datées 2026-04-01 (p-40.1 : 04-02). A redimensionné la phase 2 : ~17 K vecteurs au lieu de 4,4 K. |
| « couche découverte v1 en cours » | **Terminée** (phases A–E) : taxonomie bilingue, graphe, routeur S1–S4 pondéré par spécificité. |
| Ingestion « ebooklib/lxml » | beautifulsoup4 + lxml. |
| 3.1 : `ALTER subject_map ADD division_path` | **Colonne déjà présente, et dans la PK.** |
| R6 : « chemins neutres quant à la langue » | **Faux** — les id Irosoft sont propres à la langue (`ga:l_cinquieme` FR / `ga:l_five` EN). Le pont passe par les numéros d'articles. → **invariant 4**. |
| R11 : `wrangler d1 export` comme sauvegarde | Export **bloqué** par la table virtuelle `articles_fts` → Time Travel. → **invariant 6**. |
| Harnais d'éval à créer de zéro | Client MCP maison réutilisable. Leçon opérationnelle : chaque invocation de l'Inspector CLI ouvre une session Durable Object neuve, ce qui a épuisé le quota gratuit le 2026-07-20. → **invariant 10**. |
| `wrangler.toml` | `wrangler.jsonc`. |
| 3.3 : modèle `claude-sonnet-4-6` | Modèle courant à la date du relevé : `claude-sonnet-5`. |

**Deux constats de ce tableau ont depuis été corrigés** et ne doivent pas être repris : le
bogue `lang=en` sur un chemin FR passé explicitement (corrigé, épinglé par une éval), et
l'absence de répertoire `migrations/` (créé en phase 1 ; `schema.sql` décrit désormais
l'ÉTAT INITIAL, les migrations s'appliquent par-dessus — procédure dans `CLAUDE.md`).
