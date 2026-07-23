-- Schéma D1 du serveur MCP « Lois du Québec » (qclaw).
-- Transcription du PLAN.md §2 tel que révisé en phase 0 (voir §12 : décisions arrêtées,
-- et docs/phase0-structure-epub.md pour la justification de chaque colonne).
-- Ordre : laws -> divisions -> articles -> index -> articles_fts (la table FTS externe
-- référence `articles`, donc `articles` doit exister avant).

-- Une ligne par loi.
CREATE TABLE laws (
  id             TEXT PRIMARY KEY,          -- 'ccq', 'cpc', ...
  name_fr        TEXT NOT NULL,
  name_en        TEXT NOT NULL,
  rlrq_cite      TEXT NOT NULL,             -- 'RLRQ, c. CCQ-1991'
  consol_date_fr TEXT,                      -- 'à jour au' (ISO 8601), prise sur la page HTML de la loi
  consol_date_en TEXT
);

-- Noeuds de hiérarchie (Livre/Titre/Chapitre/Section/Sous-section/niveaux 6-8/disposition).
CREATE TABLE divisions (
  id         INTEGER PRIMARY KEY,
  law_id     TEXT NOT NULL REFERENCES laws(id),
  lang       TEXT NOT NULL,                 -- 'fr' | 'en'
  kind       TEXT NOT NULL,                 -- 'livre','titre','chapitre','section','sous-section','niveau6','niveau7','niveau8','disposition'
  number     TEXT,                          -- 'TROISIÈME', 'I', '§ 1', ... (peut manquer)
  heading    TEXT,                          -- intitulé ; NULL possible (divisions abrogées, 3 cas)
  history    TEXT,                          -- historique de division (89 cas), sinon NULL
  path       TEXT NOT NULL,                 -- chemin canonique = id Irosoft complet, ex. 'ga:l_premier-gb:l_troisieme-gc:l_premier'
  repealed   INTEGER NOT NULL DEFAULT 0,    -- 1 si division abrogée (3 cas)
  parent_id  INTEGER REFERENCES divisions(id),
  sort_order INTEGER NOT NULL
);

-- Une ligne par article par langue.
CREATE TABLE articles (
  id            INTEGER PRIMARY KEY,
  law_id        TEXT NOT NULL REFERENCES laws(id),
  lang          TEXT NOT NULL,              -- 'fr' | 'en'
  number        TEXT NOT NULL,              -- '1457', '2926.1', '132.0.1' (chaîne : décimaux à 1-2 niveaux)
  sort_key      INTEGER NOT NULL,           -- clé 64 bits : n*10^6 + d1*10^3 + d2 (PLAN §12)
  division_id   INTEGER REFERENCES divisions(id),
  division_path TEXT NOT NULL,              -- id Irosoft de la division feuille (dénormalisé)
  text          TEXT NOT NULL,              -- verbatim (numéro, historique et notes A.M. EXCLUS)
  html          TEXT,                       -- HTML nettoyé (integrity:* retirés, liens en absolu)
  history       TEXT,                       -- ligne d'historique : '1991, c. 64, a. 1457; ...'
  repealed      INTEGER NOT NULL DEFAULT 0  -- 1 si '(Abrogé).' (68 cas)
  -- consol_date : retirée (migration 0002) — constante par (law_id, lang) par
  -- construction, jamais lue ; la date authentique vit dans laws.consol_date_fr/en.
);

CREATE INDEX idx_art_lookup   ON articles(law_id, lang, number);
CREATE INDEX idx_art_division ON articles(law_id, lang, division_path);
CREATE INDEX idx_art_sort     ON articles(law_id, lang, sort_key);
CREATE INDEX idx_div_parent   ON divisions(parent_id);
CREATE INDEX idx_div_path     ON divisions(law_id, lang, path);

-- Recherche plein texte (D1 supporte FTS5). Table à contenu externe adossée à `articles`.
-- La synchronisation (triggers ou repopulation) est faite par le pipeline en phase 2.
CREATE VIRTUAL TABLE articles_fts USING fts5(
  text,
  law_id UNINDEXED, lang UNINDEXED, number UNINDEXED,
  content='articles', content_rowid='id'
);
