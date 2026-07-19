# Phase 0 — Reconnaissance de la structure de l'EPUB du C.c.Q. (FR)

**Date de l'inspection :** 19 juillet 2026.
**Fichier inspecté :** `pipeline/samples/CCQ-1991-fr.epub` (1 058 652 octets, non versionné — voir `.gitignore`).
**Méthode :** inspection directe du fichier réel (zipfile + regex/parsing Python en mémoire),
suivie d'une **vérification adversariale par 4 agents parallèles** (continuité de la numérotation,
lignes d'historique, hiérarchie des divisions, cas spéciaux) chargés de réfuter chaque constat
sur l'ensemble des 12 fichiers de contenu. Les comptes ci-dessous sont exhaustifs, pas des
échantillons. Dans les extraits, les attributs `xmlns:integrity="http://ref.irosoft.com/integrity/"`
ont été retirés pour la lisibilité (ils sont omniprésents dans le fichier réel).

---

## 1. URL officielle et dates

| Élément | Valeur |
|---|---|
| **URL EPUB FR (confirmée)** | `https://www.legisquebec.gouv.qc.ca/fr/epub/cs/CCQ-1991.epub` |
| Réponse HTTP | 200, `Content-Length: 1 058 652`, `Last-Modified: 16 juil. 2026` |
| **Date de consolidation** | **« À jour au 1er avril 2026 »** (2026-04-01) |
| Source de la date | Page de la loi `https://www.legisquebec.gouv.qc.ca/fr/document/lc/CCQ-1991` |
| URL EPUB EN (validée au passage) | `https://www.legisquebec.gouv.qc.ca/en/epub/cs/CCQ-1991.epub` (200, 1 046 233 o) |

Constats opérationnels pour le pipeline :

- **La date « à jour au » n'est PAS dans l'EPUB.** L'OPF ne porte que `dc:date=1994-01-01`
  (entrée en vigueur) ; la page de garde (page0) ne contient que la sanction (18 déc. 1991) et
  l'entrée en vigueur (1er janv. 1994) dans des spans cachés. La seule occurrence visible est
  vraisemblablement l'image `cover.png` (inexploitable). ⇒ **capturer la date sur la page HTML
  de la loi au moment du téléchargement** (motif : `À jour au 1<sup>er</sup> avril 2026`,
  le jour pouvant être coupé par `<sup>`).
- Le serveur **bloque certains clients** (WebFetch depuis IP de centre de données → 403) ;
  `curl` local passe avec un **User-Agent navigateur**. Prévoir un User-Agent explicite dans le
  pipeline et en CI.
- L'EPUB est **régénéré sans changement de consolidation** (Last-Modified 16 juil. 2026 vs
  consolidation 1er avril 2026) : ne pas se fier à `Last-Modified` pour détecter une nouvelle
  consolidation.

## 2. Enveloppe EPUB

- **EPUB 2.0** (pas de `nav.xhtml`, navigation par `toc.ncx`), généré par Sigil 0.4.2 ;
  producteur réel : chaîne **Irosoft CYBERLEX** (namespaces `http://ref.irosoft.com/…`,
  `provider="Irosoft"` dans une balise `<meta>` maison).
- 22 entrées dans le zip. `META-INF/container.xml` → `OPF/content.opf` :

```xml
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OPF/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
```

- **OPF** (extrait) — métadonnées et spine :

```xml
<dc:title>Code civil du Québec</dc:title>
<dc:creator>Éditeur officiel du Québec</dc:creator>
<dc:language>fr</dc:language>
<dc:date>1994-01-01</dc:date>   <!-- entrée en vigueur, PAS la consolidation -->
…
<spine toc="ncx">
  <itemref idref="cover"/><itemref idref="page0"/><itemref idref="page1"/> … <itemref idref="page11"/>
</spine>
```

- Le manifest référence `FragmentView.css`, **absent du zip** (aucun CSS nulle part — la classe
  `Hidden` n'est même pas définie ; le masquage repose sur les styles inline `display: none`).
- **Cartographie du contenu** (1 fichier = 1 Livre) :

| Fichier | Contenu | Articles | Plage |
|---|---|---|---|
| `page0.xhtml` | Page de garde + **DISPOSITION PRÉLIMINAIRE** | 0 | — |
| `page1.xhtml` | LIVRE PREMIER — DES PERSONNES | 431 | 1 – 364 |
| `page2.xhtml` | LIVRE DEUXIÈME — DE LA FAMILLE | 410 | 365 – 612 |
| `page3.xhtml` | LIVRE TROISIÈME — DES SUCCESSIONS | 294 | 613 – 898 |
| `page4.xhtml` | LIVRE QUATRIÈME — DES BIENS | 497 | **898.1** – 1370 |
| `page5.xhtml` | LIVRE CINQUIÈME — DES OBLIGATIONS | 1297 | 1371 – 2643 |
| `page6.xhtml` | LIVRE SIXIÈME — PRIORITÉS ET HYPOTHÈQUES | 178 | 2644 – 2802 |
| `page7.xhtml` | LIVRE SEPTIÈME — DE LA PREUVE | 75 | 2803 – 2874.1 |
| `page8.xhtml` | LIVRE HUITIÈME — DE LA PRESCRIPTION | 60 | 2875 – 2933 |
| `page9.xhtml` | LIVRE NEUVIÈME — PUBLICITÉ DES DROITS | 174 | 2934 – 3075.1 |
| `page10.xhtml` | LIVRE DIXIÈME — DROIT INTERNATIONAL PRIVÉ | 107 | 3076 – 3168 |
| `page11.xhtml` | **DISPOSITIONS FINALES** | 0 | — |

  Piège : la frontière Livre 3 / Livre 4 passe **entre l'art. 898 et l'art. 898.1** — un décimal
  peut ouvrir un Livre alors que sa base entière clôt le précédent.
- Fichiers XHTML **minifiés**, **UTF-8 valide** (apostrophes typographiques `’`, espaces fines
  U+2009, insécables U+00A0). Sous Windows, toujours lire/écrire avec `PYTHONUTF8=1` ou
  encodage explicite.

## 3. Document de navigation (`toc.ncx`) — insuffisant pour la hiérarchie

299 `navPoint`, **profondeur max 3** : Livre → Titre → (Chapitres **ou** articles directement,
quand le Titre n'a pas de chapitre). Sections, sous-sections et la majorité des articles n'y
figurent pas. Exemple :

```
[0] Code civil du Québec                              → page0.xhtml
[0] LIVRE PREMIER - DES PERSONNES                     → page1.xhtml#ga:l_premier
  [1] TITRE PREMIER - DE LA JOUISSANCE ET DE L’EXERCICE DES DROITS CIVILS
    [2] Article 1.                                    → page1.xhtml#se:1
  [1] TITRE DEUXIÈME - DE CERTAINS DROITS DE LA PERSONNALITÉ
    [2] CHAPITRE PREMIER - DE L’INTÉGRITÉ DE LA PERSONNE → …-gc:l_premier
```

⇒ **Le ncx ne sert que de contrôle de cohérence.** La hiérarchie complète vient des ids du XHTML.

## 4. Hiérarchie des divisions : les ids encodent le chemin complet

Chaque division est un `<div>` dont l'**id est la chaîne complète de ses ancêtres**, segments
`préfixe:valeur` joints par `-`. **800 conteneurs de division** au total, imbrication XML réelle
confirmée (chaque article est descendant de sa division la plus profonde) :

| Préfixe | Niveau | Nombre | Forme des valeurs |
|---|---|---|---|
| `ga` | Livre | 10 | ordinaux en mots : `l_premier` … `l_dixieme` |
| `gb` | Titre | 45 | mots + décimaux `l_premier_1` (« TITRE PREMIER.1 »), `l_premier_2` + **`s_898_1`** |
| `gc` | Chapitre | **160** | mots, dont **`l_dix-septieme`, `l_dix-huitieme` (avec trait d'union !)** + **`s_1119`** |
| `gd` | Section | 270 | romains `l_i` … `l_ix` + décimal `l_ii_1` (« SECTION II.1 ») |
| `ge` | Sous-section « § » | 213 | chiffres `l_1` … `l_13` + décimaux `l_0_1` (« § 0.1 »), `l_1_1`, `l_3_1`, `l_3_2`, `l_8_1` |
| `gf` | Niveau 6 « I. — » | 86 | romains |
| `gg` | Niveau 7 « 1. — » | 13 | chiffres |
| `gi` | Niveau 8 « I. — » | 3 | romains (**pas de `gh` dans tout le corpus**) |

Vérifié sur les 800 : l'ordre des préfixes est strict, **sans saut de niveau** (jamais de `gd`
sans `gc`, etc.), et chaque division a un bloc d'intitulé enfant `<chemin>-h1`.

**Pièges vérifiés :**

1. **Le split naïf sur `-` est faux** : `gc:l_dix-septieme` (CHAPITRE DIX-SEPTIÈME — DE LA
   TRANSACTION) et `gc:l_dix-huitieme` produisent de faux segments. Segmenter avec un
   lookahead sur les préfixes connus : `re.split(r'-(?=(?:ga|gb|gc|gd|ge|gf|gg|gh|gi|h1|t1|nb|ss|p\d):)', id)`.
2. **Deux divisions sans libellé de niveau** : `gb:s_898_1` (« DISPOSITION GÉNÉRALE » du Livre 4,
   sans le mot TITRE) et `gc:s_1119` (« DISPOSITION GÉNÉRALE », sans le mot CHAPITRE) — valeur
   préfixée `s_` = numéro du premier article visé.
3. **3 divisions abrogées** sans texte d'intitulé (`-h1-t1-nb` absent) : deux SECTIONS
   « (Abrogée, 2020, c. 11, a. 46/52). » et un CHAPITRE « Abrogé, 2000, c. 42, a. 73 ».
4. **89 intitulés de division portent leur propre ligne d'historique** (même bloc 9pt que les
   articles, voir §5) — ex. `ga:l_premier-gb:l_troisieme-gc:l_premier-h1` →
   « 1991, c. 64, c. premier; 2022, c. 22, a. 4. ». Le schéma D1 actuel n'a pas de colonne pour ça.

### Extraits — un intitulé par niveau

**Livre** (`ga:l_premier`, page1) :

```html
<div style="" id="ga:l_premier"><a name="ga:l_premier"/>
  <div style="margin-top: 14pt; …" id="ga:l_premier-h1"><a name="ga:l_premier-h1"/>
    <div integrity:order="19" style="font-weight: bold; text-transform: uppercase; ">
      <span integrity:added="1" style="">LIVRE </span>PREMIER</div>
    <div integrity:order="20" style="font-size: 11pt; text-transform: uppercase; …"
         id="ga:l_premier-h1-t1-nb:1"><a name="ga:l_premier-h1-t1-nb:1"/>DES PERSONNES</div>
  </div> …
```

**Titre** (`…-gb:l_premier`, page1) :

```html
<div style="" id="ga:l_premier-gb:l_premier"><a name="ga:l_premier-gb:l_premier"/>
  <div … id="ga:l_premier-gb:l_premier-h1">…
    <div integrity:order="21" style="font-weight: bold; text-transform: uppercase; ">
      <span integrity:added="1" style="">TITRE </span>PREMIER</div>
    <div … id="ga:l_premier-gb:l_premier-h1-t1-nb:2">DE LA JOUISSANCE ET DE L’EXERCICE DES DROITS CIVILS</div>
  </div>…
```

**Chapitre** (`…-gc:l_premier`, page1) :

```html
<div … id="ga:l_premier-gb:l_deuxieme-gc:l_premier-h1">…
  <div integrity:order="61" style="font-weight: bold; text-transform: uppercase; ">
    <span integrity:added="1" style="">CHAPITRE </span>PREMIER</div>
  <div … id="…-gc:l_premier-h1-t1-nb:2">DE L’INTÉGRITÉ DE LA PERSONNE</div>
</div>
```

**Section** (`…-gd:l_i`, page1) — noter : le libellé est dans un `<span>`, non un `<div>` :

```html
<div … id="…-gc:l_premier-gd:l_i-h1">…
  <span integrity:order="67" style="font-weight: bold; text-transform: uppercase; ">
    <span integrity:added="1" style="">SECTION </span>I</span>
  <div … id="…-gd:l_i-h1-t1-nb:1">DES SOINS</div>
</div>
```

**Sous-section « § »** (`…-ge:l_1`, page1) — intitulé en **italique**, pas de `-h1-t1-nb`,
et ici suivi d'un historique de division (bloc 9pt) :

```html
<div … id="…-gd:l_i-ge:l_1-h1">…
  <span integrity:order="298" style=""><span integrity:added="1" style="">§ </span>1<span
    integrity:added="1" style="">.  — </span></span>
  <span integrity:order="299" style="font-size: 11pt; font-style: italic; …">De l’attribution du nom</span>
  <div style="… font-size: 9pt; …"><div class="ligne">…</div> … historique … </div>
```

Les niveaux `gf`/`gg`/`gi` suivent le même motif que `ge` sans le « § » (« I.  — », « 1.  — »,
numéro et tiret cadratin dans des spans séparés, espaces insécables U+00A0 autour du —).

## 5. Articles : motifs de balisage

**3 523 articles** : 3 168 entiers (**1 → 3168, zéro lacune, zéro doublon** — colle exactement à
l'attendu du PLAN §10 phase 2), 351 décimaux simples, et **4 décimaux doubles** : 132.0.1,
583.0.1, 1070.1.1, 2999.1.1. Premier article observé : **1** ; dernier : **3168**.

- **Conteneur** : `<div id="se:NUM">` — `NUM` avec **underscores pour les décimaux** :
  `se:2926_1` = art. 2926.1, `se:132_0_1` = art. 132.0.1. Motif exhaustif vérifié :
  `se:\d+(_\d+){0,2}` (0 exception sur le corpus). Suffixe décimal max observé : `_47`
  (série 521.1–521.47, union civile). NB : l'exemple « 1615.1 » cité dans PLAN.md **n'existe
  pas** ; les témoins décimaux réels sont p. ex. 2926.1 ou 898.1.
- **Alinéas** : `<div id="se:NUM-ss:K">`, K = 1..n — **5 500** au total ; max 6 alinéas
  (art. 21). L'alinéa 1 contient le numéro d'article en span gras 12 pt (« 1457 » + « . » dans
  deux spans), puis le span de texte. ~34 articles n'ont pas de `ss` (texte directement dans le
  conteneur, surtout des abrogés).
- **Paragraphes « 1°, 2° »** : `<div id="se:NUM-ss:K-p1:N">` — 233. **Sous-paragraphes
  « a), b), c) »** : `<div id="…-p1:N-p2:a">` — 6, tous dans l'art. 1339.
- **Ligne d'historique** : chaque article (3523/3523, zéro exception) contient **exactement un**
  bloc `<div style="… font-size: 9pt; …">` avec un séparateur `<div class="ligne">` puis le texte
  « 1991, c. 64, a. 1457. » (`class="ligne"` n'apparaît **jamais** ailleurs : 3 614 occurrences =
  3 523 articles + disposition préliminaire + dispositions finales + 89 divisions).
- **Notes ministérielles** : 5 articles (541.11, 541.18, 541.29, 541.31, 603.1) ont **après**
  l'historique un div 10 pt italique « Note — Voir A.M. 2023-5103, 2023-10-19, (2023) 155
  G.O. 2, 4920. » (+ 5 divs à id généré `d36e…`). Le bloc d'historique n'est donc pas toujours
  le dernier enfant.
- **Abrogés** : **68 articles** dont le texte est un span italique (style inline) `(Abrogé).`,
  historique conservé — ex. art. 106 : « 106. (Abrogé). 1991, c. 64, a. 106; 2013, c. 27, a. 7. ».
  Aucune occurrence de « Non en vigueur » ou « Remplacé » (comme statut).
- **Liens** : 93 `<a href>` dans le texte des articles (et 2 dans la disposition préliminaire),
  tous **sans schéma** : `www.legisquebec.gouv.qc.ca/fr/showDoc/cs/C-25.01?&digest=` — renvois
  à d'autres lois RLRQ. Tous les autres `<a>` (~11 000) sont des ancres `name` sans `href`.
- **Ordre du flux** : strictement croissant sur la clé (entier, déc1, déc2) sur les 3 523
  articles — l'ordre du document est fiable pour `sort_order`.

### Extraits — blocs d'articles complets

**Article 1 (simple, 1 alinéa)** — page1 :

```html
<div style="margin-top: 0.1525in; text-align: justify; " id="se:1"><a name="se:1"/>
  <div style="…" id="se:1-ss:1"><a name="se:1-ss:1"/>
    <span integrity:order="23" style="font-family: Arial; font-weight: bold; margin-right: 4mm;
      font-size: 12pt; …">1<span integrity:added="1" style="">.</span></span>
    <span integrity:order="24" style="…">Tout être humain possède la personnalité juridique;
      il a la pleine jouissance des droits civils.</span>
  </div>
  <div style="… font-size: 9pt; …"><div class="ligne">…</div>
    <span…><span integrity:order="25" style="">1991, c. 64, a. 1</span>…</span></div>
</div>
```

**Article 1457 (3 alinéas)** — page5 :

```html
<div style="margin-top: 0.1525in; text-align: justify; " id="se:1457"><a name="se:1457"/>
  <div style="…" id="se:1457-ss:1"><a name="se:1457-ss:1"/>
    <span integrity:order="9258" style="… font-weight: bold; … font-size: 12pt; …">1457<span
      integrity:added="1" style="">.</span></span>
    <span integrity:order="9259" style="…">Toute personne a le devoir de respecter les règles de
      conduite qui, suivant les circonstances, les usages ou la loi, s’imposent à elle, de manière
      à ne pas causer de préjudice à autrui.</span></div>
  <div style="…" id="se:1457-ss:2"><a name="se:1457-ss:2"/>
    <span integrity:order="9260" style="…">Elle est, lorsqu’elle est douée de raison et qu’elle
      manque à ce devoir, responsable du préjudice qu’elle cause par cette faute à autrui et tenue
      de réparer ce préjudice, qu’il soit corporel, moral ou matériel.</span></div>
  <div style="…" id="se:1457-ss:3"><a name="se:1457-ss:3"/>
    <span integrity:order="9261" style="…">Elle est aussi tenue, en certains cas, de réparer le
      préjudice causé à autrui par le fait ou la faute d’une autre personne ou par le fait des
      biens qu’elle a sous sa garde.</span></div>
  <div style="… font-size: 9pt; …"><div class="ligne">…</div>
    <span…><span integrity:order="9262" style="">1991, c. 64, a. 1457</span>….</span></div>
</div>
```

**Article décimal 2926.1** — page8 (noter l'id à underscore et, dans l'historique, le
**doublement caché/visible**) :

```html
<div style="margin-top: 0.1525in; text-align: justify; " id="se:2926_1"><a name="se:2926_1"/>
  <div style="…" id="se:2926_1-ss:1"><a name="se:2926_1-ss:1"/>
    <span integrity:order="15930" style="… font-weight: bold; …">2926.1<span
      integrity:added="1" style="">.</span></span>
    <span integrity:order="15931" style="…">L’action en réparation du préjudice corporel résultant
      d’un acte pouvant constituer une infraction criminelle se prescrit par 10 ans …</span></div>
  …
  <!-- dans le bloc d'historique : -->
  <span class="Hidden" integrity:order="15935">2020, c. 13</span><span integrity:added="1"
    style="">2020, c. 13</span>  <!-- copie cachée immédiatement suivie de la copie visible -->
</div>
```

Historique visible (après exclusion des spans cachés) :
`2013, c. 8, a. 7; 2020, c. 13, a. 2; 2020, c. 28, a. 6; 2021, c. 13, a. 175; 2022, c. 22, a. 120.`

**Article abrogé 106** — page1 :

```html
<div … id="se:106"><a name="se:106"/><div … id="se:106-ss:1">…
  <span integrity:order="796" style="… font-weight: bold; …">106<span…>.</span></span>
  <span style="…"><span integrity:order="797" style="font-style: italic; ">(Abrogé).</span></span></div>
  <div style="… font-size: 9pt; …">… 1991, c. 64, a. 106; 2013, c. 27, a. 7.</div></div>
```

**Paragraphes et sous-paragraphes (art. 36 et 1339)** :

```html
<div style="margin-top: 0.1525in; " id="se:36-ss:1-p1:1"><a name="se:36-ss:1-p1:1"/>
  <span integrity:order="224" style="font-weight: normal; ">1<span integrity:added="1"
    style="">° </span>…</span>
  <span integrity:order="225" style="…">Pénétrer chez elle ou y prendre quoi que ce soit;</span></div>

<div … id="se:1339-ss:1-p1:5-p2:a"><a name="se:1339-ss:1-p1:5-p2:a"/>
  <span integrity:order="8690" style="font-style: italic; …">a<span…>) </span>…</span>
  <span integrity:order="8691" style="…">Ils sont garantis par une hypothèque de premier rang …</span></div>
```

## 6. Contenu hors articles/divisions (traitements spéciaux)

Test de couverture exhaustif (suppression des sous-arbres d'articles et d'intitulés, puis mesure
du texte restant) : **pages 1 à 10 → 0 caractère perdu.** Deux zones spéciales seulement :

1. **page0 — DISPOSITION PRÉLIMINAIRE** : aucun id `se:` ni id de division. Titre en span
   italique « DISPOSITION PRÉLIMINAIRE », deux alinéas en divs anonymes, historique en bloc
   9pt/`ligne` : « 1991, c. 64, préam.; 2022, c. 14, a. 123. » ⇒ extraction structurelle dédiée.
2. **page11 — DISPOSITIONS FINALES** : conteneur `id="sc-nb:1"`, heading dans `id="d36e54585"`,
   deux alinéas, historique « 1991, c. 64, annexe. » ⇒ extraction dédiée.

`HFContainer`/`header` (fin de chaque page) : tableau d'en-tête/pied vide — à ignorer.
Aucune ANNEXE dans le C.c.Q.

## 7. Pièges d'extraction (règles fermes, toutes vérifiées)

1. **Texte caché dupliqué** — deux populations **disjointes** (intersection nulle, donc les
   DEUX règles sont obligatoires) : 776 spans `class="Hidden"` et 973 spans
   `style="display: none; …"`. La quasi-totalité duplique le texte visible adjacent (dates,
   références d'historique) ; le reste est du bruit de tri (« 12 », « 01 »…). **Règle : supprimer
   récursivement tout sous-arbre dont `class` contient `Hidden` OU dont le style inline matche
   `display:\s*none`, avant toute extraction de texte.** Vérifiée : aucun doublon résiduel sur
   les 3 523 historiques.
2. Attributs parasites `integrity:*` sur presque chaque élément → à retirer du HTML stocké
   (réduction de poids substantielle), en conservant les `id`.
3. Liens sans schéma `www.legisquebec.gouv.qc.ca/…` → préfixer `https://` dans le HTML stocké.
4. Espaces typographiques (U+2009, U+00A0) dans les intitulés (« § 1.  — ») → normaliser pour
   les champs `number`/`heading`, conserver dans le texte verbatim.
5. Notes « Voir A.M./Décret » (5 articles) → à séparer du texte de l'article.
6. Le `toc.ncx` ne sert que de contrôle croisé (compte de Livres/Titres/Chapitres).

## 8. Stratégie de parseur proposée

**Principe : piloté par les `id`, pas par l'imbrication** (les deux sont cohérents — vérifié —
mais l'id est autoporteur et plus robuste).

1. **Itération** : fichiers du spine dans l'ordre (`page0` … `page11`), parse `lxml` complet par
   fichier (max 2,6 Mo — trivial hors Workers).
2. **Segmentation d'id** : `re.split(r'-(?=(?:ga|gb|gc|gd|ge|gf|gg|gh|gi|h1|t1|nb|ss|p\d):)', id)`
   (lookahead sur préfixes connus — survit aux valeurs à trait d'union ; `gh` inclus par
   précaution pour d'autres lois).
3. **Divisions** : à chaque `<div>` dont l'id est une chaîne de segments `g?:valeur` :
   - le chemin complet = l'id lui-même → créer les nœuds manquants (ils apparaissent toujours
     dans l'ordre parent→enfant), `kind` = dernier préfixe (`ga`→livre … `ge`→sous-section, etc.);
   - `number`/`heading` extraits du bloc `-h1` : libellé+ordinal (div/span gras majuscules pour
     ga–gd, « § N. — » pour ge, « N. — » pour gf/gg/gi) et texte d'intitulé (`-h1-t1-nb:*` pour
     ga–gd, span italique pour ge+) ; tolérer les 3 divisions abrogées et les 2 « DISPOSITION
     GÉNÉRALE » (`s_898_1`, `s_1119`) sans libellé de niveau;
   - capturer l'**historique de division** s'il y a un bloc 9pt/`ligne` dans le `-h1` (89 cas);
   - `sort_order` = compteur global du flux ; `path` matérialisé (voir question ouverte n° 3).
4. **Articles** : à chaque `<div id="se:…">` (motif `se:\d+(_\d+){0,2}`) :
   - `number` = id sans `se:`, `_`→`.` ;
   - **pile courante** = division dont l'article est descendant (ou dernière division vue —
     équivalent vérifié) → `division_id`/`division_path` ;
   - **nettoyage** : retirer sous-arbres cachés (règle §7.1) ; détacher le bloc d'historique
     (unique, identifié par `div.ligne`) et les éventuelles notes 10 pt qui le suivent ;
   - `text` = texte visible restant, alinéas séparés par `\n\n` (ordre `ss:K`, puis `p1`/`p2`
     imbriqués), sans le numéro d'article en tête (stocké dans `number`) ;
   - `html` = sérialisation du conteneur nettoyé (sans `integrity:*`, liens réécrits en absolu) ;
   - `history` = texte visible du bloc d'historique ; flag abrogé si le texte matche `^\(Abrogé\)\.` ;
5. **`sort_key`** — la formule du PLAN §2 (`entier×1000 + décimale`) est **insuffisante** (4
   articles à 2 niveaux : 132.0.1…). Proposition : `n×10⁶ + d1×10³ + d2`
   (ex. `1457` → 1 457 000 000 ; `2926.1` → 2 926 001 000 ; `132.0.1` → 132 000 001) —
   entier 64 bits, OK pour SQLite/D1 ; marges larges (d1 max observé = 47).
6. **Spéciaux** : page0 (disposition préliminaire) et page11 (dispositions finales) par
   extraction structurelle dédiée → division `kind='disposition'` + pseudo-article (question
   ouverte n° 2).
7. **Invariants de non-régression** (tests phase 2) : 3 523 articles ; entiers 1..3168 complets ;
   800 divisions (10/45/160/270/213/86/13/3) ; 68 abrogés ; bornes par Livre (table §2) ;
   verbatim des témoins (disposition préliminaire, art. 1, 1457, 2926.1, 106) ; 3 614 blocs
   `ligne` ; 0 texte résiduel hors modèle sur pages 1–10.

## 9. Questions ouvertes / ambiguïtés (décisions à prendre avant la phase 2)

1. **`sort_key`** : entériner la formule à 3 composantes (§8.5) — divergence assumée avec la
   note du PLAN §2 ? (Alternative : clé chaîne à rembourrage fixe.)
2. **Disposition préliminaire / dispositions finales** : comment les servir via MCP ?
   Proposition : pseudo-articles `number='préliminaire'`/`'finales'` (+ `kind='disposition'`
   côté divisions), pour rester accessibles par `qclaw_get_article`/`get_division`.
3. **Format du `path`** des divisions (`/L5/T1/C2/S1` au PLAN §2) : nécessite une table de
   conversion ordinal→nombre (mots FR dont composés « dix-septième », romains, décimaux
   `l_ii_1`→`II.1`, cas `s_898_1`/`s_1119`). Proposition : chemin canonique numérique
   (`/L4/TG898.1/…` à définir) avec repli sur la valeur brute si conversion inconnue.
4. **Historique des divisions** (89 cas) : ajouter une colonne `history` à `divisions` — ou
   l'abandonner ? Proposition : l'ajouter (coût nul, information officielle).
5. **Notes « Voir A.M./Décret »** (5 articles) : champ dédié `notes`, ou seulement dans `html` ?
   Proposition : les garder dans `html` et les exclure de `text` (verbatim de la loi seulement).
6. **Articles/divisions abrogés** : colonne/flag `repealed` (68 + 3 cas) ou statu quo (texte
   « (Abrogé). » verbatim) ? Proposition : flag booléen en plus du verbatim.
7. **Version EN** : URL validée (200) mais date « à jour au » EN non capturée (la page EN ne
   matche pas les motifs testés — à revoir) ; symétrie de structure EN présumée, à vérifier
   avant la phase 4 (les ids `ga:`/`se:` sont probablement identiques, langue du contenu seule
   différente — à confirmer sur fichier réel).
8. **C.p.c.** : rien inspecté (hors périmètre phase 0) ; la présence d'ANNEXES et la
   numérotation recodifiée 2016 restent à reconnaître avant ingestion.
9. **`laws.config.json`** : converti en JSON strict (les commentaires `//` hérités du gabarit
   cassaient `json.loads`).

---

*Rapport produit en phase 0 (inspection seule — aucun code de parseur écrit). Prochaine étape
proposée : revue humaine de ce rapport, décisions sur §9, puis phase 1 (échafaudage Worker).*
