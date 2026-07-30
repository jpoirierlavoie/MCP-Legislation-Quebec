# Lois du Québec — serveur MCP

Serveur [MCP](https://modelcontextprotocol.io) donnant aux assistants IA un accès **en
lecture seule** au texte officiel de la législation québécoise : **79 lois et règlements**
(dont le Code civil du Québec et le Code de procédure civile), en **français et en
anglais**, avec dates de consolidation, hiérarchie complète (Livres → Titres → Chapitres →
articles) et recherche hybride lexicale + sémantique.

**Page publique :** <https://legislation.poirierlavoie.ca/> — corpus, outils et aides au
repérage, en français et en anglais, avec les décomptes lus en base.

**Point d'accès MCP :** `https://legislation.poirierlavoie.ca/mcp` (HTTP streamable) —
**instance privée, sous jeton** : une requête sans jeton reçoit 404.

Source des données : les EPUB officiels de [LégisQuébec](https://www.legisquebec.gouv.qc.ca)
(Éditeur officiel du Québec). Le texte des articles est restitué **verbatim** — le serveur
n'altère jamais le contenu officiel.

## Accès

Ce serveur est une **instance privée**. L'endpoint MCP exige un jeton d'accès ; une
requête sans jeton reçoit 404 (jamais 401 — un 401 annoncerait un serveur MCP et
déclencherait la découverte OAuth des clients, ce qui a déjà coincé un connecteur).

Pour en demander l'accès : <jason@poirierlavoie.ca>. Le code source est public et le
corpus reproductible — pipeline d'ingestion, taxonomie et données de configuration sont
tous versionnés ici.

## Le corpus

| Catégorie | Textes |
|---|---|
| Codes | Code civil du Québec, Code de procédure civile |
| Lois sectorielles | Charte des droits et libertés, protection du consommateur, normes du travail, renseignements personnels (Loi 25) et accès aux documents publics, valeurs mobilières, assureurs, coopératives de services financiers, police et déontologie policière, bâtiment (Code de construction, Code de sécurité), courtage immobilier, cités et villes, fiscalité et éthique municipales, expropriation, contrats des organismes publics et municipaux, fonction publique, procédure pénale… |
| Règles de procédure | Règlements des cours (appel, supérieure, Québec), du TAQ, du TAL, du TAMF, de la déontologie policière et de la Régie du bâtiment |
| Tarifs | Tarif judiciaire, tarifs du TAQ, du TAL et du TAMF |

Les décomptes exacts (nombre d'articles par langue, dates de consolidation) sont calculés
en base et affichés sur la [page publique](https://legislation.poirierlavoie.ca/) ainsi que
par l'outil `qclaw_list_laws` — ils ne sont pas recopiés ici (R10). Rafraîchissement
semestriel.

## Les 10 outils

Le patron d'usage est en deux temps : **s'orienter** (découverte), puis **extraire**.

### Découverte

| Outil | Rôle | Exemple |
|---|---|---|
| `qclaw_find_relevant` | Le routeur : d'un problème en langage libre vers les lois et chapitres candidats, avec le *pourquoi* de chaque rapprochement | `« vice caché »` → C.c.Q. Livre 5 (Obligations) + L.p.c. |
| `qclaw_list_laws` | Carte du corpus : noms FR/EN, citation RLRQ, dates, matières, loi habilitante, plan des grands codes ; filtres `fonction`/`forum`/`subject` | `fonction=tarif` → les 4 tarifs |
| `qclaw_list_subjects` | Les 34 matières de la taxonomie (droit privé du C.c.Q. + matières spécialisées), bilingues | — |
| `qclaw_related_laws` | Graphe d'une loi : règlements pris sous elle, loi habilitante, renvois, relations curées | `law=cpc` → ses 6 règlements de cour |

### Extraction

| Outil | Rôle | Exemple |
|---|---|---|
| `qclaw_get_article` | Un article verbatim, avec citation, hiérarchie, historique, date | `law=ccq, article=1457` |
| `qclaw_get_articles` | Plage (`from`/`to`) ou liste (`numbers`) d'articles, paginée | `law=cpc, from=489, to=496` |
| `qclaw_get_structure` | L'arbre des divisions, sans texte — pour explorer avant d'extraire | `law=ccq, depth=2` |
| `qclaw_get_division` | Une division (Livre/Titre/Chapitre…) : intitulé, sous-divisions, articles | `path=ga:l_cinquieme` |
| `qclaw_search_text` | Recherche hybride dans le texte des articles (voir ci-dessous) | `« délai réponse défendeur hors du Québec »` |
| `qclaw_resolve_reference` | D'une citation libre vers l'article officiel ; reconnaît les chapitres RLRQ et les abréviations C.c.Q./C.p.c. | `« RLRQ, c. T-16, art. 12 »` |

## La recherche, en détail

`qclaw_search_text` combine deux moteurs et **dit toujours quel chemin a produit les
résultats** :

1. **Lexical** (FTS5, insensible aux accents) — correspondance exacte d'abord ; si une
   recherche restreinte à une loi ne donne rien, elle est automatiquement **élargie au
   corpus** ; sinon l'échelle de **relaxation** s'applique (retrait d'un terme à la fois,
   puis OU pondéré bm25), chaque étape étiquetée : *« résultats approchés (terme ignoré :
   « hors ») »*.
2. **Sémantique** (embeddings multilingues) — fusionné au lexical par RRF ; il fait le
   pont de vocabulaire (*« congédiement »* trouve *« délai de congé »*) et de langue
   (une requête en anglais trouve le texte français). Les résultats issus du seul chemin
   sémantique sont marqués *« (repérage sémantique) »*.

Chaque résultat est auto-explicatif : `C.p.c. — Livre V, Titre IV : LES DEMANDES
INTÉRESSANT LE DROIT INTERNATIONAL PRIVÉ › art. 490 [ga:l_v-gb:l_iv-gc:l_i]` + extrait.
Les recherches corpus sont regroupées par loi (max 6 par loi).

## Avertissement

L'aide au repérage (`find_relevant`, taxonomie, relations) est **heuristique** : elle ne
détermine pas le droit applicable. Toujours vérifier en lisant le texte via
`get_structure` / `get_division` / `get_article`. Ce serveur ne fournit pas de conseil
juridique ; en cas de doute, consulter la version officielle sur LégisQuébec et un
professionnel du droit.

## Pour les développeurs

```
src/            Worker Cloudflare (TypeScript) : outils MCP, recherche, D1/Vectorize
pipeline/       Ingestion Python : EPUB LégisQuébec -> D1 (staging -> validation -> bascule)
laws.config.json, taxonomy.json, relations.json   Données versionnées (corpus, matières, graphe)
migrations/     Migrations D1 — s'appliquent PAR-DESSUS schema.sql, qui décrit l'état
                INITIAL et non l'état courant (procédure complète : CLAUDE.md)
tests/, eval/   contrôles bout-en-bout + harnais d'évaluation (20 cas, recall@10/MRR)
docs/           Notes d'architecture, rapports de phase, format EPUB ; archive des plans
```

Démarrage : `npm install`, `npx wrangler dev`, puis `npm run evals` contre
`http://127.0.0.1:8787/mcp`. **Avant toute modification, lire [CLAUDE.md](CLAUDE.md)** —
les invariants critiques du dépôt y sont consignés (ordre de la config, miroirs de clés
de tri, limites D1/Vectorize, échelle de recherche).

**Toute modification doit évaluer son impact sur CINQ surfaces** — outils MCP,
descriptions, schéma, ce README et la [page publique](https://legislation.poirierlavoie.ca/)
(`catalogue.json`) — et inclure les mises à jour requises dans le même commit. C'est une
condition de fin de tâche, pas une recommandation : voir l'obligation préalable en tête de
[CLAUDE.md](CLAUDE.md) et la règle R10. Garde en CI :
`node --test tests/catalogue.test.mjs`.

Trajectoire mesurée du repérage : recall@10 **40 % → 88 % → 98 %** (`docs/reports/`).
