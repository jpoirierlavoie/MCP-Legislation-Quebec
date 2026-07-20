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
        # le parseur fixe le sort_key des pseudo-articles (dispositions) ; sinon on le calcule.
        a.sort_key = a.sort_key or sort_key(a.number)
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


# D1 refuse toute instruction > 100 Ko (SQLITE_TOOBIG). On plafonne en OCTETS UTF-8 (le
# texte juridique est accentué : compter en caractères sous-estime) avec une marge de sécurité.
_STMT_BUDGET = 80_000


def _bytes(s: str) -> int:
    return len(s.encode("utf-8"))


def _tuple_sql(row: list) -> str:
    return "(" + ", ".join(_q(v) for v in row) + ")"


def _split_literal(s: str, budget: int) -> list[str]:
    """Découpe s en morceaux dont le littéral SQL échappé (quotes doublées) tient dans `budget`
    octets — pour recomposer une valeur trop grosse via des `UPDATE ... = ... || 'morceau'`."""
    chunks: list[str] = []
    start = i = size = 0
    n = len(s)
    while i < n:
        ch = s[i]
        add = len(ch.encode("utf-8")) + (1 if ch == "'" else 0)  # quote échappée = 2 octets
        if size + add > budget and i > start:
            chunks.append(s[start:i])
            start, size = i, 0
        size += add
        i += 1
    if start < n:
        chunks.append(s[start:])
    return chunks


def _oversized_row(table: str, cols: list[str], row: list, big_cols: tuple[str, ...],
                   budget: int) -> list[str]:
    """Charge une ligne unique dont le tuple dépasse le budget : INSERT avec les grosses
    colonnes vidées, puis on ré-append leur contenu par morceaux (`col = col || '...'`)."""
    idx = {c: i for i, c in enumerate(cols)}
    base = list(row)
    for c in big_cols:
        v = base[idx[c]]
        if isinstance(v, str) and v:
            base[idx[c]] = ""  # on repart de '' et on ré-append (garde NULL tel quel)
    stmts = [f"INSERT INTO {table} ({', '.join(cols)}) VALUES {_tuple_sql(base)};"]
    rid = row[idx["id"]]
    payload = budget - 200  # marge pour l'enveloppe UPDATE ... WHERE id = N;
    for c in big_cols:
        v = row[idx[c]]
        if not (isinstance(v, str) and v):
            continue
        for chunk in _split_literal(v, payload):
            lit = "'" + chunk.replace("'", "''") + "'"
            stmts.append(f"UPDATE {table} SET {c} = {c} || {lit} WHERE id = {rid};")
    return stmts


def _rows_sql(table: str, cols: list[str], rows: list[list], budget: int = _STMT_BUDGET,
              big_cols: tuple[str, ...] = ()) -> list[str]:
    """INSERT groupés, plafonnés en OCTETS (D1 : SQLITE_TOOBIG sur instruction > 100 Ko).
    Une ligne dont le tuple seul dépasse le budget est chargée via _oversized_row."""
    out: list[str] = []
    prefix = f"INSERT INTO {table} ({', '.join(cols)}) VALUES\n"
    pbytes = _bytes(prefix)
    buf: list[str] = []
    size = pbytes
    for r in rows:
        tuple_sql = _tuple_sql(r)
        tb = _bytes(tuple_sql)
        if big_cols and pbytes + tb + 1 > budget:
            if buf:
                out.append(prefix + ",\n".join(buf) + ";")
                buf, size = [], pbytes
            out.extend(_oversized_row(table, cols, r, big_cols, budget))
            continue
        if buf and size + tb + 2 > budget:
            out.append(prefix + ",\n".join(buf) + ";")
            buf, size = [], pbytes
        buf.append(tuple_sql)
        size += tb + 2
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
    # text/html peuvent à eux seuls dépasser 100 Ko (ex. le bloc préliminaire d'un tarif) :
    # ces colonnes sont ré-appendables par morceaux si le tuple est trop gros.
    stmts += _rows_sql("_stg_articles", _ART_COLS, art_rows, big_cols=("text", "html"))
    # --- bascule (production intouchée tant que le staging n'est pas complet) ---
    # Portée (law_id, lang) : recharger une langue ne touche pas l'autre langue de la loi.
    stmts += [
        f"DELETE FROM articles  WHERE law_id = {_q(law.id)} AND lang = {_q(lang)};",
        f"DELETE FROM divisions WHERE law_id = {_q(law.id)} AND lang = {_q(lang)};",
        # UPSERT : met à jour les colonnes de base sans écraser fonction/forum/name_norm/
        # parent_law_id (posées par la couche découverte, phase A).
        f"INSERT INTO laws ({', '.join(_LAW_COLS)}) VALUES ({law_vals}) ON CONFLICT(id) DO UPDATE SET "
        + ", ".join(f"{c}=excluded.{c}" for c in _LAW_COLS if c != "id") + ";",
        "INSERT INTO divisions SELECT * FROM _stg_divisions;",
        "INSERT INTO articles  SELECT * FROM _stg_articles;",
        "DROP TABLE _stg_divisions;",
        "DROP TABLE _stg_articles;",
        "-- FTS5 à contenu externe : reconstruire l'index depuis articles",
        "INSERT INTO articles_fts(articles_fts) VALUES('rebuild');",
    ]
    return "\n".join(stmts) + "\n"
