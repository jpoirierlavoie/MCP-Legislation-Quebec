-- ============================================================
-- Couche de découverte / pertinence — migration additive
-- À appliquer sur la base D1 « qclaw » existante.
-- NB : les ALTER TABLE ne sont pas idempotents en SQLite
-- (échec si la colonne existe) — exécuter UNE fois, ou via un
-- script de migration qui vérifie PRAGMA table_info d'abord.
-- ============================================================

-- 1. Taxonomie des matières
CREATE TABLE IF NOT EXISTS subjects (
  id             TEXT PRIMARY KEY,      -- slug : 'obligations-contrats'
  label_fr       TEXT NOT NULL,
  label_en       TEXT,
  label_norm     TEXT NOT NULL,         -- minuscules, sans accents (pour l'appariement)
  kind           TEXT NOT NULL,         -- 'prive-ccq' | 'specialise'
  description_fr TEXT
);

-- 2. Mappage sujet -> loi (ou division précise d'une loi)
CREATE TABLE IF NOT EXISTS subject_map (
  subject_id    TEXT NOT NULL REFERENCES subjects(id),
  law_id        TEXT NOT NULL REFERENCES laws(id),
  division_path TEXT NOT NULL DEFAULT '',  -- '' = toute la loi ; sinon path Irosoft (ex. 'ga:l_deuxieme')
  PRIMARY KEY (subject_id, law_id, division_path)
);
CREATE INDEX IF NOT EXISTS idx_smap_law     ON subject_map(law_id);
CREATE INDEX IF NOT EXISTS idx_smap_subject ON subject_map(subject_id);

-- 3. Graphe d'interconnexion des lois
CREATE TABLE IF NOT EXISTS law_relations (
  from_law_id TEXT NOT NULL REFERENCES laws(id),
  to_law_id   TEXT NOT NULL,            -- id si la cible est au corpus ; sinon chapitre RLRQ brut (candidat d'acquisition)
  rel_type    TEXT NOT NULL,            -- 'reglement-de' | 'renvoie-a' | 'met-en-oeuvre' | 'applique' | 'complete' | 'encadre-par' | 'connexe'
  source      TEXT NOT NULL,            -- 'auto' | 'cure'
  weight      INTEGER NOT NULL DEFAULT 1, -- pour 'renvoie-a' : nombre de renvois relevés
  in_corpus   INTEGER NOT NULL DEFAULT 1, -- 0 si to_law_id absent du corpus
  note        TEXT,
  PRIMARY KEY (from_law_id, to_law_id, rel_type)
);
CREATE INDEX IF NOT EXISTS idx_rel_from ON law_relations(from_law_id);
CREATE INDEX IF NOT EXISTS idx_rel_to   ON law_relations(to_law_id);

-- 3bis. Description anglaise des matières. La description est la SURFACE D'APPARIEMENT du
-- signal S1 de qclaw_find_relevant : sans version anglaise, le routeur est muet en anglais.
ALTER TABLE subjects ADD COLUMN description_en TEXT;

-- 4. Extensions de la table laws (exécuter une seule fois)
ALTER TABLE laws ADD COLUMN fonction      TEXT;   -- 'loi' | 'regles-procedure' | 'tarif' | 'reglement'
ALTER TABLE laws ADD COLUMN forum         TEXT;   -- multi-valeurs jointes par ' ; ' ; NULL = sans dimension de forum
ALTER TABLE laws ADD COLUMN scope_fr      TEXT;   -- une phrase de portée (éditoriale ; repli = name_fr)
ALTER TABLE laws ADD COLUMN parent_law_id TEXT;   -- loi habilitante d'un règlement (résolue via rlrq_cite)
ALTER TABLE laws ADD COLUMN name_norm     TEXT;   -- minuscules, sans accents

-- 5. Normalisation pour la recherche d'orientation (accents-insensible)
ALTER TABLE divisions ADD COLUMN heading_norm TEXT;
CREATE INDEX IF NOT EXISTS idx_div_heading_norm ON divisions(law_id, lang, heading_norm);

-- Remplissage des colonnes *_norm :
--  * lignes existantes (ccq, cpc) : script de rattrapage (pipeline, API HTTP D1) ;
--  * lignes futures : calculées par le pipeline au chargement.
