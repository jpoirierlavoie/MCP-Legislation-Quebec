-- Migration 0003 — infrastructure de curation, phase 3 v2 (2026-07-30).
--
-- « L'IA rédige, l'avocat valide. » Les trois tables portent un drapeau
-- `validated INTEGER NOT NULL DEFAULT 0` et SEULES les lignes `validated = 1` peuvent
-- influencer une réponse. Le drapeau n'est pas décoratif : c'est la frontière entre du
-- contenu éditorial proposé par un modèle et du droit qu'un avocat a relu.
--
-- Sauvegarde préalable : bookmark Time Travel
--   000000ac-00000000-000050b9-a48dd23c3cc768700b033f578ec519c2
-- (l'export D1 reste bloqué par la table virtuelle articles_fts — invariant 6).
--
-- POURQUOI ICI ET PAS DANS schema-decouverte.sql, où vivent pourtant subjects,
-- subject_map et law_relations : le bootstrap d'une D1 vierge en CI ne joue que
-- schema.sql + migrations/ — schema-decouverte.sql n'est couvert par AUCUN garde. Ces
-- trois tables n'ont aucune clé étrangère vers la couche découverte, donc rien ne les y
-- retient, et migrations/ leur donne la couverture que les tables de découverte n'ont
-- jamais eue.
--
-- Migration STRICTEMENT ADDITIVE : rollback = éteindre le drapeau d'environnement
-- (R8), pas revert. Aucune table existante n'est touchée.
--
-- ⚠️ L'`ALTER TABLE subject_map ADD COLUMN division_path` que prévoyait le plan v2 §3.1
-- N'EST PAS ICI, et ne doit pas y être : la colonne existe déjà, elle fait partie de la
-- clé primaire (schema-decouverte.sql), et le signal S1 l'exploite depuis la v1
-- (src/relevance.ts). La tâche 3.1 ajoute du CONTENU, pas du schéma. Constaté en
-- phase 0, jamais répercuté dans le texte du plan.

-- 1. Liens entre divisions — « divisions compagnes » et « voir aussi » (§3.1).
--    Les chemins sont ceux de la LANGUE de rédaction (invariant 4 : les id Irosoft sont
--    propres à la langue, `ga:l_cinquieme` FR vs `ga:l_five` EN). D'où la colonne `lang` :
--    le plan v2 les croyait canoniques, la phase 0 a démenti. Toute lecture en `lang=en`
--    passe par le pont des numéros d'articles.
CREATE TABLE IF NOT EXISTS division_links (
  law_a     TEXT NOT NULL,
  path_a    TEXT NOT NULL,
  law_b     TEXT NOT NULL,
  path_b    TEXT NOT NULL,
  rel_type  TEXT NOT NULL,              -- 'compagnon' | 'voir_aussi'
  lang      TEXT NOT NULL DEFAULT 'fr', -- langue des chemins ci-dessus
  note      TEXT,                       -- éditorial, non officiel (R4)
  validated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (law_a, path_a, law_b, path_b, rel_type)
);

-- L'index porte `validated` EN TÊTE : le filtre est dans chaque requête de production,
-- et il doit être servi par l'index plutôt que par un balayage suivi d'un tri.
CREATE INDEX IF NOT EXISTS idx_dlinks_lookup
  ON division_links(validated, law_a, lang, path_a);

-- 2. Gazetteer de concepts — expansion de requête (§3.2).
--    `variantes` : JSON de chaînes normalisées (minuscules). PAS besoin de replier les
--    accents : le tokenizer FTS5 de D1 a `remove_diacritics` ACTIF (mesuré, cf. le bloc
--    de sondes au-dessus de toFtsQuery dans src/lib.ts).
--    `cibles` : JSON acceptant DEUX formes, parce que l'Appendice B du plan mélange les
--    deux — {"law":"ccq","path":"ga:l_dixieme"} et {"law":"ccq","articles":["1726","1739"]}.
CREATE TABLE IF NOT EXISTS concept_gazetteer (
  id        INTEGER PRIMARY KEY,
  concept   TEXT NOT NULL UNIQUE,
  variantes TEXT NOT NULL,              -- JSON: ["vice cache", "defaut cache", ...]
  cibles    TEXT NOT NULL,              -- JSON: [{"law":..., "path"|"articles":...}]
  lang      TEXT NOT NULL DEFAULT 'fr',
  note      TEXT,
  validated INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_gazetteer_actif
  ON concept_gazetteer(validated, lang);

-- 3. Notes de repérage par article (§3.3) — TABLE CRÉÉE, DÉLIBÉRÉMENT VIDE.
--    La génération est reportée : indexer une headnote suppose une SECONDE colonne
--    pondérée dans articles_fts, donc DÉTRUIRE ET RECRÉER une table virtuelle à contenu
--    externe — une migration destructive, que le plan v2 s'interdit lui-même, sur la
--    table qui bloque `wrangler d1 export`. La créer maintenant évite une seconde
--    migration plus tard ; la laisser vide évite d'y toucher.
--    Tant qu'aucune ligne n'est validée, aucune réponse ne change.
CREATE TABLE IF NOT EXISTS article_headnotes (
  law          TEXT NOT NULL,
  article      TEXT NOT NULL,
  lang         TEXT NOT NULL DEFAULT 'fr',
  headnote     TEXT NOT NULL,
  model        TEXT,                    -- modèle générateur, pour l'audit
  generated_at TEXT DEFAULT (datetime('now')),
  validated    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (law, article, lang)
);

CREATE INDEX IF NOT EXISTS idx_headnotes_actif
  ON article_headnotes(validated, law, lang);
