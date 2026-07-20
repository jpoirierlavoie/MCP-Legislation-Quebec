"""Rattrapage des colonnes normalisées pour les lignes existantes (plan §2).

Remplit `laws.name_norm` et `divisions.heading_norm` (accents-insensible) pour les lois déjà
au corpus (ccq, cpc). Les lignes futures sont normalisées par le pipeline au chargement.

    python -m pipeline.discovery.backfill --target {local|cloud} [--laws ccq cpc]
"""
from __future__ import annotations

import argparse

from ..d1_api import make_client, q
from ..norm import normalize

_CHUNK = 100  # lignes par UPDATE ... FROM VALUES


def backfill(db, law_ids: list[str]) -> tuple[int, int]:
    in_list = ", ".join(q(i) for i in law_ids)

    # laws.name_norm
    laws = db.run(f"SELECT id, name_fr FROM laws WHERE id IN ({in_list})")
    for l in laws:
        db.run(f"UPDATE laws SET name_norm = {q(normalize(l['name_fr']))} WHERE id = {q(l['id'])}")

    # divisions.heading_norm (par lots via CASE — portable, contrairement à UPDATE ... FROM VALUES)
    divs = db.run(f"SELECT id, heading FROM divisions WHERE law_id IN ({in_list})")
    rows = [(d["id"], normalize(d.get("heading"))) for d in divs]
    for i in range(0, len(rows), _CHUNK):
        chunk = rows[i:i + _CHUNK]
        cases = " ".join(f"WHEN {q(rid)} THEN {q(hn)}" for rid, hn in chunk)
        ids = ", ".join(q(rid) for rid, _ in chunk)
        db.run(f"UPDATE divisions SET heading_norm = CASE id {cases} END WHERE id IN ({ids})")
    return len(laws), len(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Rattrapage name_norm / heading_norm.")
    ap.add_argument("--target", default="local", choices=["local", "cloud"])
    ap.add_argument("--laws", nargs="*", default=["ccq", "cpc"])
    args = ap.parse_args(argv)
    db = make_client(args.target)
    n_laws, n_divs = backfill(db, args.laws)
    print(f"[{db.name}] rattrapage : name_norm sur {n_laws} lois, "
          f"heading_norm sur {n_divs} divisions ({', '.join(args.laws)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
