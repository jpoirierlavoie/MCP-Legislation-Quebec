# Propositions tirées du journal de recherche — 2026-07-30

> **Rien ici n'est appliqué.** `eval/cases.json` est la vérité terrain de Jason (⛔,
> invariant 16) et le gazetteer relève de la phase 3 v2, dont chaque contenu passe par une
> porte humaine. Ce document PROPOSE ; il ne décide pas.
>
> Instantané daté, conforme à la politique d'archive de `docs/` : les décomptes ci-dessous
> valent pour la fenêtre du **2026-07-21 au 2026-07-30**, et ne seront pas actualisés.
> Pour l'état courant : `node scripts/journal.mjs`.

## D'où ça vient

Premier dépouillement de `search_log` depuis sa création (migration 0001, tâche 1.6 du plan
Discovery v2) : la table était écrite par `logSearch` et lue par personne.

| | requêtes distinctes | appels |
|---|---|---|
| fixtures d'éval et de test | 40 | 1 788 (95 %) |
| **trafic réel** | **98** | **99** |

**Aucune requête réelle n'est revenue vide.** Les 109 zéros du journal viennent
intégralement des trois requêtes-charabia d'éval. En revanche **43 % des appels réels ont eu
besoin d'un barreau de relaxation**, dont 32 `or_relax` — c'est-à-dire un ET lexical qui a
complètement échoué.

## 1. Candidat nº 1 du gazetteer (phase 3.2) — présentation matérielle des actes

La chaîne du 2026-07-21 00:53 montre cinq reformulations de la même question, avec des
résultats à chaque fois :

```
  8 rés            présentation matérielle des actes de procédure papier format Cou…
 10 rés [or_relax] présentation des actes de procédure papier lisible format
 14 rés [or_relax] police caractères taille interligne procédure douze points
  2 rés [widened]  police caractères taille Arial interligne
  3 rés [widened]  police Arial taille interligne caractère        (puis à nouveau)
```

Le vocabulaire de la question (« police », « Arial », « interligne », « douze points »,
« lisible ») ne rencontre pas celui du texte. C'est exactement le cas d'usage du gazetteer :
un concept, ses variantes, et ses cibles.

**Entrée proposée** — à valider, et surtout à compléter par les cibles réelles, que je n'ai
pas vérifiées article par article :

```
concept   : présentation matérielle des actes de procédure
variantes : police, caractère, taille, corps, interligne, points, Arial, lisible,
            format papier, présentation matérielle, mise en page
cibles    : à établir (Règlement de la Cour supérieure / Code de procédure civile —
            dispositions sur la forme des actes)
```

## 2. Autres chaînes longues, mêmes symptômes

| date | longueur | sujet apparent | replis observés |
|---|---|---|---|
| 2026-07-21 00:53 | 13 | formes de sociétés et exercice en multidisciplinarité | 5 × `or_relax` |
| 2026-07-21 00:34 | 9 | rétractation de jugement, tutelle, prescription des mineurs | 4 × `or_relax` |
| 2026-07-21 01:54 | 8 | hypothèque mobilière sans dépossession, RDPRM | `or_relax`, 2 × `semantic` |
| 2026-07-28 15:09 | 6 | déontologie : partie non représentée, devoir d'information | `widened`, 3 × `or_relax` |

Le motif « société de dépenses / partage des frais / cabinet / multidisciplinarité » revient
quatre fois en `or_relax` : second candidat de gazetteer.

## 3. Cas d'éval PROPOSÉS

Tirés de requêtes réelles, choisis pour couvrir des matières que les 20 cas actuels
n'exercent pas. **Les articles cibles ne sont PAS remplis** : c'est précisément la partie qui
relève de vous — savoir quel article *est* la bonne réponse.

| # | requête réelle | matière non couverte aujourd'hui | pourquoi |
|---|---|---|---|
| A | `présentation des actes de procédure papier lisible format` | forme des actes | la chaîne de 5 reformulations ci-dessus ; échec avéré |
| B | `exercice de la profession d'avocat en société et en multidisciplinarité` | droit professionnel / structures | 4 `or_relax` sur le même sujet |
| C | `hypothèque mobilière sans dépossession véhicule routier` | sûretés mobilières + RDPRM | a exigé le chemin sémantique seul |
| D | `partie non représentée par avocat` | déontologie | `widened` — la portée a dû être élargie |
| E | `prescription ne court pas contre les mineurs` | prescription / capacité | `or_relax` |
| F | `langue des contrats, Charte de la langue française, contrat d'adhésion` | langue française | matière absente des cas actuels |

## 4. Deux observations de méthode

**La métrique du journal est la mauvaise.** `idx_search_log_misses` indexe `result_count`.
Sous R7 (*fail open*), l'échelle de relaxation garantit qu'on ne rend quasiment jamais zéro :
la métrique ne peut structurellement pas voir un échec. Consigné dans `src/lib.ts` près de
`logSearch` ; `scripts/journal.mjs` mesure le repli et la reformulation à la place.

**Le journal est à 95 % du bruit d'éval.** Le tri se fait par correspondance de chaînes
contre les fixtures — indicatif, pas une preuve : un usager qui taperait mot pour mot une
requête d'éval serait mal classé. Marquer la source à l'écriture exigerait une migration et
du plombage jusque dans le Durable Object, pour un gain nul sur un serveur à un seul usager.

## 5. Ce que le journal dit AUSSI, et qui n'appelle aucune action

- **4 appels sur 99 en anglais.** Le bilinguisme du repérage est très peu exercé en usage
  réel — à garder en tête avant d'investir dans les notes anglaises ou la calibration EN.
- **37 appels sur 99 en portée restreinte** : un tiers des recherches vise une loi précise.
  Le mode « corpus entier » reste majoritaire, ce qui valide l'élargissement automatique.
