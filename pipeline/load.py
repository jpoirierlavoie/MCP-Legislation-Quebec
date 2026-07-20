"""Chargement en D1 : attribution des clés/FK, génération de SQL (staging -> bascule).

Garde-fou (PLAN §4/§10) : on écrit d'abord dans des tables de staging, entièrement, puis on
bascule en production en fin de script. Si une insertion échoue, la production reste intacte
(les DELETE/INSERT de bascule ne sont jamais atteints).
"""
from __future__ import annotations

from .model import Article, Division, Law, sort_key


def prepare(law: Law, divisions: list[Division], articles: list[Article], id_base: int = 0) -> None:
    """Attribue id (divisions, articles), parent_id, division_id et sort_key, en place.

    `id_base` décale les id pour qu'ils soient GLOBALEMENT uniques : les tables divisions et
    articles ont une clé primaire partagée par toutes les lois/langues, mais on charge une
    combinaison à la fois. ingest passe un base distinct par (loi, langue)."""
    by_path: dict[str, Division] = {}
    for i, d in enumerate(divisions, start=1):
        d.id = id_base + i
        by_path[d.path] = d
    for d in divisions:
        d.parent_id = by_path[d.parent_path].id if d.parent_path and d.parent_path in by_path else None
    for j, a in enumerate(articles, start=1):
        a.id = id_base + j
        a.sort_key = sort_key(a.number)
        leaf = by_path.get(a.division_path)
        a.division_id = leaf.id if leaf else None


# --- génération SQL ----------------------------------------------------------

def _q(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


_DIV_COLS = ["id", "law_id", "lang", "kind", "number", "heading", "history", "path", "repealed", "parent_id", "sort_order"]
_ART_COLS = ["id", "law_id", "lang", "number", "sort_key", "division_id", "division_path", "text", "html", "history", "repealed", "consol_date"]
_LAW_COLS = ["id", "name_fr", "name_en", "rlrq_cite", "consol_date_fr", "consol_date_en"]


def _rows_sql(table: str, cols: list[str], rows: list[list], max_len: int = 90_000) -> list[str]:
    """INSERT groupés, plafonnés en taille (D1/SQLite : SQLITE_TOOBIG sur instruction trop longue)."""
    out: list[str] = []
    prefix = f"INSERT INTO {table} ({', '.join(cols)}) VALUES\n"
    buf: list[str] = []
    size = len(prefix)
    for r in rows:
        tuple_sql = "(" + ", ".join(_q(v) for v in r) + ")"
        if buf and size + len(tuple_sql) + 2 > max_len:
            out.append(prefix + ",\n".join(buf) + ";")
            buf, size = [], len(prefix)
        buf.append(tuple_sql)
        size += len(tuple_sql) + 2
    if buf:
        out.append(prefix + ",\n".join(buf) + ";")
    return out


def to_sql(law: Law, divisions: list[Division], articles: list[Article], lang: str) -> str:
    div_rows = [[getattr(d, c) for c in _DIV_COLS] for d in divisions]
    art_rows = [[getattr(a, c) for c in _ART_COLS] for a in articles]
    law_vals = ", ".join(_q(getattr(law, c)) for c in _LAW_COLS)

    stmts: list[str] = [
        "-- Généré par pipeline.ingest — NE PAS éditer à la main.",
        "PRAGMA defer_foreign_keys = TRUE;",
        "DROP TABLE IF EXISTS _stg_divisions;",
        "DROP TABLE IF EXISTS _stg_articles;",
        "CREATE TABLE _stg_divisions AS SELECT * FROM divisions WHERE 0;",
        "CREATE TABLE _stg_articles  AS SELECT * FROM articles  WHERE 0;",
    ]
    stmts += _rows_sql("_stg_divisions", _DIV_COLS, div_rows)
    stmts += _rows_sql("_stg_articles", _ART_COLS, art_rows)
    # --- bascule (production intouchée tant que le staging n'est pas complet) ---
    # Portée (law_id, lang) : recharger une langue ne touche pas l'autre langue de la loi.
    stmts += [
        f"DELETE FROM articles  WHERE law_id = {_q(law.id)} AND lang = {_q(lang)};",
        f"DELETE FROM divisions WHERE law_id = {_q(law.id)} AND lang = {_q(lang)};",
        f"INSERT OR REPLACE INTO laws ({', '.join(_LAW_COLS)}) VALUES ({law_vals});",
        "INSERT INTO divisions SELECT * FROM _stg_divisions;",
        "INSERT INTO articles  SELECT * FROM _stg_articles;",
        "DROP TABLE _stg_divisions;",
        "DROP TABLE _stg_articles;",
        "-- FTS5 à contenu externe : reconstruire l'index depuis articles",
        "INSERT INTO articles_fts(articles_fts) VALUES('rebuild');",
    ]
    return "\n".join(stmts) + "\n"
