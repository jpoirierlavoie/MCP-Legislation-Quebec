# Reconnaissance des 36 textes additionnels (dry-run, phase B)

Généré par `python -m pipeline.discovery.recon` — **aucune écriture en base**. Télécharge FR + EN (tolérant), scanne la structure, teste le parseur existant, moissonne les renvois. À valider avant l'ingestion (phase C).

## Constats généraux

- **36 textes**, 0 téléchargement(s) FR en échec.
- **EN disponible pour 36/36** textes — aucun 404 EN.
- **parse_epub réussit sur 36/36** textes (extraction des articles OK partout). Le décompte parseur = scan + 1 (pseudo-article « préliminaire »).
- **À traiter en phase C (motifs non standard) :**
  - **Tableaux de contenu** : ['t-16-r.10']. Rendre les tables lisiblement dans `text`, conserver le HTML dans `html`. (NB : les tarifs `j-3-r.3.2` et `t-15.01-r.6` ont leurs frais en TEXTE, pas en `<table>` — déjà pris par le parseur.)
  - **Annexes/formulaires structurels** (intitulés hors article `se:`) — non capturés : ['c-25.01-r.0.2.2', 'c-25.01-r.0.2.3', 'c-25.01-r.9', 't-16', 'c-12', 'i-16', 'c-25.01-r.0.2.4', 'c-25.01-r.0.2.1', 'j-3', 'i-13.2.2', 'b-9', 't-15.01-r.5', 't-15.01', 'p-40.1', 'b-1', 'c-1.1', 'c-19', 'c-26', 'e-6.1', 'i-14.01', 'n-1.1', 'p-39.1', 'p-44.1', 't-11.002'].
  - **Blocs `sc-nb:1` non extraits** (le parseur les étiquette « finales » mais le texte est vide — p. ex. section FORMULES) : b-9 « FORMULES ».
  - **id `Note`** (note éditoriale, à exclure du `text` comme les notes A.M.) : ['t-16-r.10', 'j-3-r.3.2', 'i-13.2.2', 't-15.01-r.5', 't-15.01', 't-15.01-r.6', 'b-1', 'c-38', 'e-6.1'].
  - **Articles réels au texte vide** : —.
  - **p-44.1** : numérotation atypique (article « 0 » / renumérotation par partie).
- Format Irosoft confirmé pour les 36 (ids `se:`/`ga:`…). name_en lisible depuis l'OPF anglais ; parent_law_id dérivable via rlrq_cite (voir détail).

## Synthèse

| id | fonction | langues | articles | plage | div. | tableaux | annexe/form | parse | anomalies |
|---|---|---|---|---|---|---|---|---|---|
| c-25.01-r.0.2.01 | regles-procedure | fr+en | 93 | 1..93 | 21 | — | — | ✓ 93a/21d | 0 |
| c-25.01-r.0.2.2 | regles-procedure | fr+en | 16 | 1..15 +1déc | 8 | — | 1 bloc(s) | ✓ 17a/9d | 1 |
| c-25.01-r.0.2.3 | regles-procedure | fr+en | 30 | 1..29 +1déc | 25 | — | 1 bloc(s) | ✓ 31a/26d | 1 |
| c-25.01-r.9 | regles-procedure | fr+en | 172 | 1..169 +3déc | 51 | — | 1 bloc(s) | ✓ 173a/52d | 1 |
| t-16 | loi | fr+en | 526 | 1..283 +243déc | 76 | — | 7 bloc(s) | ✓ 527a/77d | 1 |
| t-16-r.10 | tarif | fr+en | 29 | 1..29 | 0 | 5 | — | ✓ 29a/0d | 2 |
| c-12 | loi | fr+en | 162 | 1..139 +23déc | 21 | — | 3 bloc(s) | ✓ 163a/22d | 1 |
| i-16 | loi | fr+en | 73 | 1..63 +10déc | 8 | — | 2 bloc(s) | ✓ 74a/9d | 1 |
| c-25.01-r.0.2.4 | regles-procedure | fr+en | 48 | 1..43 +5déc | 18 | — | 10 bloc(s) | ✓ 49a/19d | 1 |
| c-25.01-r.0.2.1 | regles-procedure | fr+en | 77 | 1..76 +1déc | 15 | — | 1 bloc(s) | ✓ 78a/16d | 1 |
| j-3 | loi | fr+en | 219 | 1..201 +18déc | 42 | — | 5 bloc(s) | ✓ 220a/43d | 1 |
| j-3-r.3.01 | regles-procedure | fr+en | 42 | 1..42 | 18 | — | — | ✓ 42a/18d | 0 |
| j-3-r.3.2 | tarif | fr+en | 12 | 1..12 | 7 | — | — | ✓ 12a/7d | 1 |
| i-13.2.2 | loi | fr+en | 360 | 1..59 +301déc | 81 | — | 1 bloc(s) | ✓ 361a/82d | 2 |
| b-9 | loi | fr+en | 62 | 1..51 +11déc | 0 | — | 4 bloc(s) | ✓ 63a/1d | 2 |
| t-15.01-r.5 | regles-procedure | fr+en | 71 | 1..64 +7déc | 30 | — | 6 bloc(s) | ✓ 72a/31d | 2 |
| t-15.01 | loi | fr+en | 233 | 1..147 +86déc | 28 | — | 2 bloc(s) | ✓ 234a/29d | 2 |
| t-15.01-r.6 | tarif | fr+en | 9 | 1..9 | 2 | — | — | ✓ 9a/2d | 1 |
| p-40.1 | loi | fr+en | 631 | 1..364 +267déc | 56 | — | 15 bloc(s) | ✓ 632a/57d | 1 |
| b-1 | loi | fr+en | 166 | 1..143 +23déc | 31 | — | 2 bloc(s) | ✓ 167a/32d | 2 |
| b-1-r.3.1 | reglement | fr+en | 157 | 1..155 +2déc | 43 | — | — | ✓ 157a/43d | 0 |
| b-1-r.5 | reglement | fr+en | 87 | 1..87 | 23 | — | — | ✓ 87a/23d | 0 |
| c-1.1 | loi | fr+en | 106 | 1..105 +1déc | 22 | — | 1 bloc(s) | ✓ 107a/23d | 1 |
| c-19 | loi | fr+en | 1234 | 1..662 +572déc | 118 | — | 2 bloc(s) | ✓ 1235a/119d | 1 |
| c-26 | loi | fr+en | 479 | 1..199 +280déc | 43 | — | 3 bloc(s) | ✓ 480a/44d | 1 |
| c-38 | loi | fr+en | 493 | 1..234 +259déc | 104 | — | — | ✓ 494a/105d | 1 |
| c-73.2 | loi | fr+en | 207 | 1..162 +45déc | 32 | — | — | ✓ 207a/32d | 0 |
| e-6.1 | loi | fr+en | 932 | 1..750 +182déc | 124 | — | 3 bloc(s) | ✓ 933a/125d | 2 |
| d-9.2 | loi | fr+en | 689 | 1..583 +106déc | 42 | — | — | ✓ 690a/43d | 0 |
| e-12.000001 | loi | fr+en | 106 | 1..86 +20déc | 23 | — | — | ✓ 106a/23d | 0 |
| i-14.01 | loi | fr+en | 274 | 1..240 +34déc | 52 | — | 1 bloc(s) | ✓ 275a/53d | 1 |
| n-1.1 | loi | fr+en | 345 | 1..172 +173déc | 41 | — | 1 bloc(s) | ✓ 346a/42d | 1 |
| p-39.1 | loi | fr+en | 179 | 1..115 +64déc | 29 | — | 1 bloc(s) | ✓ 180a/30d | 1 |
| p-44.1 | loi | fr+en | 323 | 0..302 +21déc | 53 | — | 5 bloc(s) | ✓ 324a/54d | 2 |
| s-31.1 | loi | fr+en | 732 | 1..729 +3déc | 164 | — | — | ✓ 732a/164d | 0 |
| t-11.002 | loi | fr+en | 176 | 1..176 | 50 | — | 1 bloc(s) | ✓ 177a/51d | 1 |

## Détail par texte

### c-25.01-r.0.2.01 — Règlement de la Cour d'appel du Québec en matière civile
*RLRQ, c. C-25.01, r. 0.2.01 · fonction=regles-procedure · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Regulation of the Court of Appeal of Quebec in Civil Matters
- **Parent (via rlrq_cite)** : cpc
- **Articles** : 93 (entiers 1..93, 93 distincts, 0 décimaux)
- **Divisions** : 21 {'livre': 1, 'titre': 20}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 0 · préliminaire : False · finales : False
- **parse_epub** : 93 articles, 21 divisions, dispositions=—
- **Renvois RLRQ** : 5 cibles (top : C-25.01×7, I-16×1, T-16, r. 10×1, CCQ-1991×1, C-25.01, r. 10×1)

### c-25.01-r.0.2.2 — Règlement de la Cour supérieure du Québec en matière civile et familiale pour le district de Montréal
*RLRQ, c. C-25.01, r. 0.2.2 · fonction=regles-procedure · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Regulation of the Superior Court of Québec in civil and family matters for the district of Montréal
- **Parent (via rlrq_cite)** : cpc
- **Articles** : 16 (entiers 1..15, 15 distincts, 1 décimaux)
- **Divisions** : 8 {'livre': 8}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 1 · sc-nb:1 : 1 (« ANNEXE 1(a. 1.1)RÈGLEMENT DE LA COUR SUP ») · préliminaire : False · finales : True
- **parse_epub** : 17 articles, 9 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 4 cibles (top : C-25.01, r. 0.2.1×3, C-25.01, r. 6.3×3, C-25.01×3, C-25.01, r. 11×1)
- **Anomalies / à traiter en phase C** :
  - 1 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### c-25.01-r.0.2.3 — Règlement de la Cour supérieure du Québec en matière civile et familiale pour le district de Québec
*RLRQ, c. C-25.01, r. 0.2.3 · fonction=regles-procedure · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Regulation of the Superior Court of Québec in civil matters for the district of Québec
- **Parent (via rlrq_cite)** : cpc
- **Articles** : 30 (entiers 1..29, 29 distincts, 1 décimaux)
- **Divisions** : 25 {'livre': 11, 'titre': 14}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 1 · sc-nb:1 : 1 (« ANNEXE 1(a. 1.1)RÈGLEMENT DE LA COUR SUP ») · préliminaire : False · finales : True
- **parse_epub** : 31 articles, 26 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 9 cibles (top : C-25.01×4, C-25.01, r. 6.3×3, C-38×2, L-4×2, V-1.1×2, E-6.1×2)
- **Anomalies / à traiter en phase C** :
  - 1 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### c-25.01-r.9 — Règlement de la Cour du Québec
*RLRQ, c. C-25.01, r. 9 · fonction=regles-procedure · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Regulation of the Court of Québec
- **Parent (via rlrq_cite)** : cpc
- **Articles** : 172 (entiers 1..169, 169 distincts, 3 décimaux)
- **Divisions** : 51 {'chapitre': 29, 'livre': 6, 'titre': 16}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 1 · sc-nb:1 : 1 (« Annexe I(a. 6)INDEX ET REGISTRES ») · préliminaire : False · finales : True
- **parse_epub** : 173 articles, 52 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 10 cibles (top : C-25.01×6, P-34.1×3, T-15.01×3, C-25.1×2, S-33, r. 1×1, C-12×1)
- **Anomalies / à traiter en phase C** :
  - 1 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### t-16 — Loi sur les tribunaux judiciaires
*RLRQ, c. T-16 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Courts of Justice Act
- **Parent (via rlrq_cite)** : t-16
- **Articles** : 526 (entiers 1..283, 283 distincts, 243 décimaux)
- **Divisions** : 76 {'chapitre': 25, 'livre': 16, 'titre': 35}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 7 · sc-nb:1 : 1 (« ANNEXE I(Article 5.5)Compétence concurre ») · préliminaire : False · finales : True
- **parse_epub** : 527 articles, 77 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 34 cibles (top : C-25.01×13, C-25.1×7, F-3.1.1×5, C-72.01×5, P-34.1×3, R-9×3)
- **Anomalies / à traiter en phase C** :
  - 7 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### t-16-r.10 — Tarif judiciaire en matière civile
*RLRQ, c. T-16, r. 10 · fonction=tarif · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Tariff of judicial fees in civil matters
- **Parent (via rlrq_cite)** : t-16
- **Articles** : 29 (entiers 1..29, 29 distincts, 0 décimaux)
- **Divisions** : 0 
- **Tableaux (contenu)** : 5 (dont 5 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 0 · préliminaire : False · finales : False
- **parse_epub** : 29 articles, 0 divisions, dispositions=—
- **Renvois RLRQ** : 7 cibles (top : C-25.01×4, C-24.2×1, P-2.2×1, N-2×1, E-19×1, T-15.01×1)
- **Anomalies / à traiter en phase C** :
  - 5 tableau(x) de contenu, dont 5 dans un article — rendu texte lisible à faire (tarif)
  - ids de motif inconnu : {'Note': 1}

### c-12 — Charte des droits et libertés de la personne
*RLRQ, c. C-12 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Charter of human rights and freedoms
- **Parent (via rlrq_cite)** : c-12
- **Articles** : 162 (entiers 1..139, 139 distincts, 23 décimaux)
- **Divisions** : 21 {'livre': 7, 'titre': 14}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 3 · sc-nb:1 : 1 (« ANNEXE I ») · préliminaire : False · finales : True
- **parse_epub** : 163 articles, 22 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 11 cibles (top : A-2.01×5, C-25.01×5, C-11×2, E-12.001×2, P-34.1×2, C-37×2)
- **Anomalies / à traiter en phase C** :
  - 3 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### i-16 — Loi d’interprétation
*RLRQ, c. I-16 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Interpretation Act
- **Parent (via rlrq_cite)** : i-16
- **Articles** : 73 (entiers 1..63, 63 distincts, 10 décimaux)
- **Divisions** : 8 {'livre': 8}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 2 · sc-nb:1 : 1 (« ANNEXE A(Article 62) ») · préliminaire : False · finales : False
- **parse_epub** : 74 articles, 9 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 1 cibles (top : C-11×1)
- **Anomalies / à traiter en phase C** :
  - 2 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### c-25.01-r.0.2.4 — Règlement de la Cour supérieure du Québec en matière familiale
*RLRQ, c. C-25.01, r. 0.2.4 · fonction=regles-procedure · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Regulation of the Superior Court of Québec in family matters
- **Parent (via rlrq_cite)** : cpc
- **Articles** : 48 (entiers 1..43, 43 distincts, 5 décimaux)
- **Divisions** : 18 {'chapitre': 3, 'livre': 3, 'titre': 12}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 10 · sc-nb:1 : 1 (« ANNEXE AAVIS AUX SUPERVISEURS DE DROITS  ») · préliminaire : False · finales : True
- **parse_epub** : 49 articles, 19 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 6 cibles (top : C-25.01×4, P-34.1×2, G-1.021×2, S-4.2×2, R-9×1, C-25.01, r. 6×1)
- **Anomalies / à traiter en phase C** :
  - 10 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### c-25.01-r.0.2.1 — Règlement de la Cour supérieure du Québec en matière civile
*RLRQ, c. C-25.01, r. 0.2.1 · fonction=regles-procedure · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Regulation of the Superior Court of Québec in civil matters
- **Parent (via rlrq_cite)** : cpc
- **Articles** : 77 (entiers 1..76, 76 distincts, 1 décimaux)
- **Divisions** : 15 {'livre': 13, 'titre': 2}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 1 · sc-nb:1 : 1 (« ANNEXE 1(a. 1.1)RÈGLEMENT DE LA COUR SUP ») · préliminaire : False · finales : True
- **parse_epub** : 78 articles, 16 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 10 cibles (top : C-25.01×18, C-25.01, r. 6.3×3, F-3.2.0.1.1×2, C-38×2, L-4×2, V-1.1×2)
- **Anomalies / à traiter en phase C** :
  - 1 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### j-3 — Loi sur la justice administratif
*RLRQ, c. J-3 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act respecting administrative justice
- **Parent (via rlrq_cite)** : j-3
- **Articles** : 219 (entiers 1..201, 201 distincts, 18 décimaux)
- **Divisions** : 42 {'chapitre': 26, 'livre': 3, 'titre': 13}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 5 · sc-nb:1 : 1 (« ANNEXE ILA SECTION DES AFFAIRES SOCIALES ») · préliminaire : False · finales : True
- **parse_epub** : 220 articles, 43 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 112 cibles (top : C-25.01×5, A-13.1.1×4, P-38.001×4, S-6.2×3, R-9×3, A-6.001×3)
- **Anomalies / à traiter en phase C** :
  - 5 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### j-3-r.3.01 — Règlement sur la procédure du Tribunal administratif du Québec
*RLRQ, c. J-3, r. 3.01 · fonction=regles-procedure · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Regulation respecting the procedure of the Administrative Tribunal of Québec
- **Parent (via rlrq_cite)** : j-3
- **Articles** : 42 (entiers 1..42, 42 distincts, 0 décimaux)
- **Divisions** : 18 {'livre': 16, 'titre': 2}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 0 · préliminaire : False · finales : False
- **parse_epub** : 42 articles, 18 divisions, dispositions=—
- **Renvois RLRQ** : 6 cibles (top : C-1.1×3, J-3×2, J-3, r. 3×2, E-25×1, Q-2×1, C-25.01, r. 3×1)

### j-3-r.3.2 — Tarif des droits, honoraires et autres frais afférents aux recours instruits devant le Tribunal administratif du Québec
*RLRQ, c. J-3, r. 3.2 · fonction=tarif · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Regulation respecting the Tariff of administrative fees, professional fees and other charges attached to proceedings before the Administrative Tribunal of Québec
- **Parent (via rlrq_cite)** : j-3
- **Articles** : 12 (entiers 1..12, 12 distincts, 0 décimaux)
- **Divisions** : 7 {'livre': 4, 'titre': 3}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 0 · préliminaire : False · finales : False
- **parse_epub** : 12 articles, 7 divisions, dispositions=—
- **Renvois RLRQ** : 4 cibles (top : J-3×3, F-2.1×1, E-25×1, B-1, r. 22×1)
- **Anomalies / à traiter en phase C** :
  - ids de motif inconnu : {'Note': 1}

### i-13.2.2 — Loi sur les institutions de dépôts et la protection des dépôts
*RLRQ, c. I-13.2.2 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Deposit Institutions and Deposit Protection Act
- **Parent (via rlrq_cite)** : i-13.2.2
- **Articles** : 360 (entiers 1..59, 59 distincts, 301 décimaux)
- **Divisions** : 81 {'chapitre': 27, 'livre': 7, 'section': 12, 'sous-section': 9, 'titre': 26}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 1 · sc-nb:1 : 1 (« ANNEXE ABROGATIVE ») · préliminaire : False · finales : True
- **parse_epub** : 361 articles, 82 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 20 cibles (top : C-67.3×10, S-29.02×6, E-6.1×6, A-32.1×4, J-3×4, P-44.1×3)
- **Anomalies / à traiter en phase C** :
  - 1 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)
  - ids de motif inconnu : {'Note': 1}

### b-9 — Loi sur les bureaux de la publicité des droits
*RLRQ, c. B-9 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act respecting registry offices
- **Parent (via rlrq_cite)** : b-9
- **Articles** : 62 (entiers 1..51, 51 distincts, 11 décimaux)
- **Divisions** : 0 
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 4 · sc-nb:1 : 1 (« FORMULES ») · préliminaire : False · finales : False
- **parse_epub** : 63 articles, 1 divisions, dispositions=['finales'], disposition vide=['finales']
- **Renvois RLRQ** : 17 cibles (top : C-25.01×2, A-6.001×2, N-3×1, L-0.1×1, S-11.0101×1, P-9.002×1)
- **Anomalies / à traiter en phase C** :
  - 4 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)
  - bloc sc-nb:1 « FORMULES » non extrait (pseudo-article ['finales'] vide — p. ex. section FORMULES)

### t-15.01-r.5 — Règlement sur la procédure devant le Tribunal administratif du logement
*RLRQ, c. T-15.01, r. 5 · fonction=regles-procedure · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Rules of procedure of the Administrative Housing Tribunal
- **Parent (via rlrq_cite)** : t-15.01
- **Articles** : 71 (entiers 1..64, 64 distincts, 7 décimaux)
- **Divisions** : 30 {'chapitre': 5, 'livre': 8, 'titre': 17}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 6 · sc-nb:1 : 1 (« ANNEXE I ») · préliminaire : False · finales : True
- **parse_epub** : 72 articles, 31 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 3 cibles (top : R-8.1, r. 5×1, S-33×1, T-15.01×1)
- **Anomalies / à traiter en phase C** :
  - 6 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)
  - ids de motif inconnu : {'Note': 1}

### t-15.01 — Loi sur le Tribunal administratif du logement
*RLRQ, c. T-15.01 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act respecting the Administrative Housing Tribunal
- **Parent (via rlrq_cite)** : t-15.01
- **Articles** : 233 (entiers 1..147, 147 distincts, 86 décimaux)
- **Divisions** : 28 {'chapitre': 14, 'livre': 4, 'section': 4, 'titre': 6}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 2 · sc-nb:1 : 1 (« ANNEXE I(LOI SUR LE TRIBUNAL ADMINISTRAT ») · préliminaire : False · finales : False
- **parse_epub** : 234 articles, 29 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 18 cibles (top : C-25.01×6, J-3×4, A-19.1×3, F-3.1.1×2, A-6.01×1, R-12.1×1)
- **Anomalies / à traiter en phase C** :
  - 2 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)
  - ids de motif inconnu : {'Note': 1}

### t-15.01-r.6 — Tarif des frais exigibles par le Tribunal administratif du logement
*RLRQ, c. T-15.01, r. 6 · fonction=tarif · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Tariff of costs exigible by the Administrative Housing Tribunal
- **Parent (via rlrq_cite)** : t-15.01
- **Articles** : 9 (entiers 1..9, 9 distincts, 0 décimaux)
- **Divisions** : 2 {'livre': 2}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 0 · préliminaire : False · finales : False
- **parse_epub** : 9 articles, 2 divisions, dispositions=—
- **Renvois RLRQ** : 3 cibles (top : T-15.01×2, R-8.1, r. 6×1, H-4.1, r. 13.1×1)
- **Anomalies / à traiter en phase C** :
  - ids de motif inconnu : {'Note': 1}

### p-40.1 — Loi sur la protection du consommateur
*RLRQ, c. P-40.1 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Consumer Protection Act
- **Parent (via rlrq_cite)** : p-40.1
- **Articles** : 631 (entiers 1..364, 364 distincts, 267 décimaux)
- **Divisions** : 56 {'chapitre': 15, 'livre': 10, 'section': 15, 'sous-section': 5, 'titre': 11}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 15 · sc-nb:1 : 1 (« ANNEXE 1 ») · préliminaire : False · finales : False
- **parse_epub** : 632 articles, 57 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 29 cibles (top : C-24.2×6, P-40×5, A-32.1×3, P-44.1×3, P-39.1×3, S-29.02×2)
- **Anomalies / à traiter en phase C** :
  - 15 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### b-1 — Loi sur le Barreau
*RLRQ, c. B-1 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act respecting the Barreau du Québec
- **Parent (via rlrq_cite)** : b-1
- **Articles** : 166 (entiers 1..143, 143 distincts, 23 décimaux)
- **Divisions** : 31 {'livre': 18, 'titre': 13}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 2 · sc-nb:1 : 1 (« ANNEXE I(Article 5)LIMITES TERRITORIALES ») · préliminaire : False · finales : True
- **parse_epub** : 167 articles, 32 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 17 cibles (top : C-26×27, C-25.01×7, N-3×2, R-18.1×1, R-15.1×1, C-27×1)
- **Anomalies / à traiter en phase C** :
  - 2 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)
  - ids de motif inconnu : {'Note': 1}

### b-1-r.3.1 — Code de déontologie des avocats
*RLRQ, c. B-1, r. 3.1 · fonction=reglement · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Code of Professional Conduct of Lawyers
- **Parent (via rlrq_cite)** : b-1
- **Articles** : 157 (entiers 1..155, 155 distincts, 2 décimaux)
- **Divisions** : 43 {'chapitre': 17, 'livre': 3, 'section': 19, 'titre': 4}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 0 · préliminaire : False · finales : True
- **parse_epub** : 157 articles, 43 divisions, dispositions=—
- **Renvois RLRQ** : 9 cibles (top : C-26×9, B-1×3, B-1, r. 9×2, I-3×2, C-12×1, CCQ-1991×1)

### b-1-r.5 — Règlement sur la comptabilité et les normes d’exercice professionnel des avocats
*RLRQ, c. B-1, r. 5 · fonction=reglement · kind_epub=cr*
- **Langues** : fr, en
- **name_en (OPF)** : Règlement sur la comptabilité et les normes d’exercice professionnel des avocats
- **Parent (via rlrq_cite)** : b-1
- **Articles** : 87 (entiers 1..87, 87 distincts, 0 décimaux)
- **Divisions** : 23 {'livre': 11, 'titre': 12}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 0 · préliminaire : False · finales : False
- **parse_epub** : 87 articles, 23 divisions, dispositions=—
- **Renvois RLRQ** : 7 cibles (top : I-13.2.2×2, A-2.1×1, A-6.001×1, CCQ-1991×1, T-16×1, C-26×1)

### c-1.1 — Loi concernant le cadre juridique des technologies de l’information
*RLRQ, c. C-1.1 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act to establish a legal framework for information technology
- **Parent (via rlrq_cite)** : c-1.1
- **Articles** : 106 (entiers 1..105, 105 distincts, 1 décimaux)
- **Divisions** : 22 {'chapitre': 8, 'livre': 5, 'titre': 9}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 1 · sc-nb:1 : 1 (« ANNEXE ABROGATIVE ») · préliminaire : False · finales : False
- **parse_epub** : 107 articles, 23 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 3 cibles (top : A-21.1×1, P-44.1×1, A-6.01×1)
- **Anomalies / à traiter en phase C** :
  - 1 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### c-19 — Loi sur les cités et villes
*RLRQ, c. C-19 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Cities and Towns Act
- **Parent (via rlrq_cite)** : c-19
- **Articles** : 1234 (entiers 1..662, 662 distincts, 572 décimaux)
- **Divisions** : 118 {'chapitre': 32, 'livre': 21, 'section': 5, 'titre': 60}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 2 · sc-nb:1 : 1 (« FORMULES 1 ») · préliminaire : False · finales : False
- **parse_epub** : 1235 articles, 119 divisions, dispositions=['finales']
- **Renvois RLRQ** : 67 cibles (top : F-2.1×25, C-25.01×23, E-2.2×20, C-65.01×13, C-35×10, C-47.1×8)
- **Anomalies / à traiter en phase C** :
  - 2 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### c-26 — Code des professions
*RLRQ, c. C-26 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Professional Code
- **Parent (via rlrq_cite)** : c-26
- **Articles** : 479 (entiers 1..199, 199 distincts, 280 décimaux)
- **Divisions** : 43 {'chapitre': 16, 'livre': 15, 'titre': 12}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 3 · sc-nb:1 : 1 (« ANNEXE I(Articles 1, 24, 31, 35 et 39.2) ») · préliminaire : False · finales : True
- **parse_epub** : 480 articles, 44 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 38 cibles (top : C-25.01×36, C-11×3, C-37×3, I-13.3×3, R-18.1×3, A-2.1×3)
- **Anomalies / à traiter en phase C** :
  - 3 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### c-38 — Loi sur les compagnies
*RLRQ, c. C-38 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Companies Act
- **Parent (via rlrq_cite)** : c-38
- **Articles** : 493 (entiers 1..234, 234 distincts, 259 décimaux)
- **Divisions** : 104 {'chapitre': 16, 'livre': 5, 'titre': 83}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 1 (« ANNEXES ABROGATIVES ») · préliminaire : False · finales : True
- **parse_epub** : 494 articles, 105 divisions, dispositions=['finales']
- **Renvois RLRQ** : 15 cibles (top : P-44.1×25, T-11.002×6, S-31.1×3, S-29.02×2, J-3×2, C-67.2×2)
- **Anomalies / à traiter en phase C** :
  - ids de motif inconnu : {'Note': 1}

### c-73.2 — Loi sur le courtage immobilier
*RLRQ, c. C-73.2 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Real Estate Brokerage Act
- **Parent (via rlrq_cite)** : c-73.2
- **Articles** : 207 (entiers 1..162, 162 distincts, 45 décimaux)
- **Divisions** : 32 {'livre': 11, 'titre': 21}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 0 · préliminaire : False · finales : False
- **parse_epub** : 207 articles, 32 divisions, dispositions=—
- **Renvois RLRQ** : 14 cibles (top : C-25.01×6, C-37×3, C-73.1×3, D-9.2×3, C-26×2, A-32.1×2)

### e-6.1 — Loi sur l’encadrement du secteur financier
*RLRQ, c. E-6.1 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act respecting the regulation of the financial sector
- **Parent (via rlrq_cite)** : e-6.1
- **Articles** : 932 (entiers 1..750, 750 distincts, 182 décimaux)
- **Divisions** : 124 {'chapitre': 24, 'livre': 8, 'titre': 92}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 3 · sc-nb:1 : 1 (« ANNEXE 1(article 7) ») · préliminaire : False · finales : False
- **parse_epub** : 933 articles, 125 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 31 cibles (top : V-1.1×16, D-9.2×15, I-14.01×7, C-25.01×7, C-67.3×5, I-13.2.2×5)
- **Anomalies / à traiter en phase C** :
  - 3 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)
  - ids de motif inconnu : {'Note': 1}

### d-9.2 — Loi sur la distribution de produits et services financiers
*RLRQ, c. D-9.2 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act respecting the distribution of financial products and services
- **Parent (via rlrq_cite)** : d-9.2
- **Articles** : 689 (entiers 1..583, 583 distincts, 106 décimaux)
- **Divisions** : 42 {'chapitre': 5, 'livre': 15, 'titre': 22}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 1 (« ANNEXES ABROGATIVES ») · préliminaire : False · finales : False
- **parse_epub** : 690 articles, 43 divisions, dispositions=['finales']
- **Renvois RLRQ** : 19 cibles (top : I-15.1×13, V-1.1×8, A-32.1×6, C-67.3×3, I-14.01×3, I-13.2.2×3)

### e-12.000001 — Loi sur les entreprises de services monétaires
*RLRQ, c. E-12.000001 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Money-Services Businesses Act
- **Parent (via rlrq_cite)** : e-12.000001
- **Articles** : 106 (entiers 1..86, 86 distincts, 20 décimaux)
- **Divisions** : 23 {'livre': 11, 'titre': 12}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 0 · préliminaire : False · finales : True
- **parse_epub** : 106 articles, 23 divisions, dispositions=—
- **Renvois RLRQ** : 13 cibles (top : A-6.002×5, A-32.1×1, C-67.3×1, I-14.01×1, S-29.02×1, V-1.1×1)

### i-14.01 — Loi sur les instruments dérivés
*RLRQ, c. I-14.01 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Derivatives Act
- **Parent (via rlrq_cite)** : i-14.01
- **Articles** : 274 (entiers 1..240, 240 distincts, 34 décimaux)
- **Divisions** : 52 {'chapitre': 10, 'livre': 11, 'section': 11, 'titre': 20}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 1 · sc-nb:1 : 1 (« ANNEXE ABROGATIVE ») · préliminaire : False · finales : False
- **parse_epub** : 275 articles, 53 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 17 cibles (top : V-1.1×11, E-6.1×9, A-2.1×3, R-18.1×2, I-3×1, A-32.1×1)
- **Anomalies / à traiter en phase C** :
  - 1 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### n-1.1 — Loi sur les normes du travail
*RLRQ, c. N-1.1 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act respecting labour standards
- **Parent (via rlrq_cite)** : n-1.1
- **Articles** : 345 (entiers 1..172, 172 distincts, 173 décimaux)
- **Divisions** : 41 {'chapitre': 2, 'livre': 11, 'titre': 28}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 1 · sc-nb:1 : 1 (« ANNEXE I ») · préliminaire : False · finales : False
- **parse_epub** : 346 articles, 42 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 36 cibles (top : C-27×9, I-3×9, T-15.1×5, C-26×4, R-20×3, A-3.001×3)
- **Anomalies / à traiter en phase C** :
  - 1 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### p-39.1 — Loi sur la protection des renseignements personnels dans le secteur privé
*RLRQ, c. P-39.1 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act respecting the protection of personal information in the private sector
- **Parent (via rlrq_cite)** : p-39.1
- **Articles** : 179 (entiers 1..115, 115 distincts, 64 décimaux)
- **Divisions** : 29 {'livre': 11, 'titre': 18}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 1 · sc-nb:1 : 1 (« ANNEXE ABROGATIVE ») · préliminaire : False · finales : True
- **parse_epub** : 180 articles, 30 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 15 cibles (top : A-2.1×5, C-26×2, A-8.2×2, S-3.5×2, A-6.002×2, E-3.3×1)
- **Anomalies / à traiter en phase C** :
  - 1 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### p-44.1 — Loi sur la publicité légale des entreprises
*RLRQ, c. P-44.1 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act respecting the legal publicity of enterprises
- **Parent (via rlrq_cite)** : p-44.1
- **Articles** : 323 (entiers 0..302, 303 distincts, 21 décimaux)
- **Divisions** : 53 {'chapitre': 5, 'livre': 14, 'titre': 34}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 5 · sc-nb:1 : 1 (« ANNEXE I(Article 75, premier alinéa et a ») · préliminaire : False · finales : False
- **parse_epub** : 324 articles, 54 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 65 cibles (top : P-45×12, S-31.1×8, C-38×7, I-3×6, A-2.1×5, R-17.1×5)
- **Anomalies / à traiter en phase C** :
  - numérotation atypique : 323 se: mais 303 entiers distincts + 21 décimaux (article « 0 » / renumérotation par partie ?)
  - 5 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

### s-31.1 — Loi sur les sociétés par actions
*RLRQ, c. S-31.1 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Business Corporations Act
- **Parent (via rlrq_cite)** : s-31.1
- **Articles** : 732 (entiers 1..729, 729 distincts, 3 décimaux)
- **Divisions** : 164 {'chapitre': 48, 'livre': 24, 'section': 12, 'titre': 80}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 0 · sc-nb:1 : 0 · préliminaire : False · finales : False
- **parse_epub** : 732 articles, 164 divisions, dispositions=—
- **Renvois RLRQ** : 18 cibles (top : P-44.1×29, C-38×11, V-1.1×9, T-11.002×8, E-6.1×7, J-3×2)

### t-11.002 — Loi sur le transfert de valeurs mobilières et l’obtention de titres intermédiés
*RLRQ, c. T-11.002 · fonction=loi · kind_epub=cs*
- **Langues** : fr, en
- **name_en (OPF)** : Act respecting the transfer of securities and the establishment of security entitlements
- **Parent (via rlrq_cite)** : t-11.002
- **Articles** : 176 (entiers 1..176, 176 distincts, 0 décimaux)
- **Divisions** : 50 {'chapitre': 21, 'livre': 6, 'section': 4, 'titre': 19}
- **Tableaux (contenu)** : 0 (dont 0 dans un article) · intitulés annexe/formulaire hors article : 1 · sc-nb:1 : 1 (« ANNEXE ABROGATIVE ») · préliminaire : False · finales : False
- **parse_epub** : 177 articles, 51 divisions, dispositions=['annexe']
- **Renvois RLRQ** : 4 cibles (top : V-1.1×2, I-14.01×1, S-29.02×1, I-13.2.2×1)
- **Anomalies / à traiter en phase C** :
  - 1 intitulé(s) structurel(s) annexe/formulaire HORS article — extraction dédiée à prévoir (non capturée par le parseur actuel)

