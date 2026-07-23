-- Migration 0002 — retrait de articles.consol_date (2026-07-23).
--
-- Colonne dénormalisée sans valeur informationnelle : le parseur estampillait la date
-- DE LA LOI sur chacun de ses articles (constante par (law_id, lang) par construction),
-- et AUCUNE requête du Worker ne la lisait — les deux SELECT * de get_articles
-- (src/lib.ts) ne la faisaient jamais entrer dans la sortie des outils, qui projette
-- des champs explicites. Valeur nette NÉGATIVE : NULL pour 36 lois (indices 2-37 de
-- laws.config.json, vestige du lot d'ingestion antérieur au calcul systématique),
-- donc un piège pour toute fonctionnalité future qui l'aurait supposée remplie —
-- « un résultat faux rendu en silence », le pire défaut de cet outil.
--
-- La date de consolidation authentique vit dans laws.consol_date_fr / consol_date_en.
--
-- Légalité du DROP COLUMN vérifiée sur schema.sql : colonne non indexée, absente de
-- articles_fts (text, law_id, lang, number), aucun trigger, aucune vue, aucun CHECK.
-- SQLite réécrit les lignes de la table (~49 K) : opération lourde mais bornée.
-- Sauvegarde préalable : bookmark Time Travel consigné au commit (l'export est bloqué
-- par la table virtuelle articles_fts).

ALTER TABLE articles DROP COLUMN consol_date;
