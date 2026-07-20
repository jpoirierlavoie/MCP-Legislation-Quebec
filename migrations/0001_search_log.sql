-- Migration 0001 — journal des recherches (plan Discovery v2, tâche 1.6).
-- Première migration au format `wrangler d1 migrations` (convention R11 introduite ici ;
-- l'état antérieur de la base reste décrit par schema.sql + schema-decouverte.sql).
-- Sauvegarde préalable : D1 Time Travel (l'export est bloqué par la table virtuelle
-- articles_fts) — bookmark consigné dans docs/reports/phase-1.md.

CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  tool TEXT NOT NULL,              -- 'search_text' | 'find_relevant'
  query TEXT NOT NULL,
  law TEXT, lang TEXT,
  result_count INTEGER NOT NULL,
  fallback TEXT                    -- NULL|'widened'|'loo:<terme>'|'or_relax'|'semantic'
);
CREATE INDEX IF NOT EXISTS idx_search_log_misses ON search_log(result_count, ts);
