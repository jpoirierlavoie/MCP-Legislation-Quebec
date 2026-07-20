"""Preuves de la phase A (plan §9 A) : comptes, résolution des division_path, non-destruction.

    python -m pipeline.discovery.verify --target {local|cloud}
"""
from __future__ import annotations

import argparse

from ..d1_api import make_client


def verify(db) -> bool:
    ok = True
    print(f"=== Vérification [{db.name}] ===")

    # 1. Comptes
    for tbl in ("subjects", "subject_map", "law_relations"):
        n = db.run(f"SELECT COUNT(*) AS n FROM {tbl}")[0]["n"]
        print(f"  {tbl:14}: {n}")
    print("  laws (métadonnées) :", db.run("SELECT COUNT(*) AS n FROM laws")[0]["n"])

    # 2. Chaque division_path de subject_map résout dans divisions (même loi)
    total_paths = db.run("SELECT COUNT(*) AS n FROM subject_map WHERE division_path != ''")[0]["n"]
    unresolved = db.run(
        "SELECT sm.subject_id, sm.law_id, sm.division_path FROM subject_map sm "
        "WHERE sm.division_path != '' AND NOT EXISTS "
        "(SELECT 1 FROM divisions d WHERE d.law_id = sm.law_id AND d.path = sm.division_path)"
    )
    print(f"\n  division_path non vides : {total_paths} | non résolus : {len(unresolved)}")
    for u in unresolved:
        ok = False
        print("   ✗ NON RÉSOLU :", u)
    if not unresolved:
        print("   ✓ tous les division_path de subject_map résolvent")

    # 3. Non-destruction : ccq = 3525, cpc = 878 (articles, toutes langues)
    print("\n  Non-destruction (articles) :")
    for law_id, expected in (("ccq", 3525), ("cpc", 878)):
        for lang in ("fr", "en"):
            n = db.run(f"SELECT COUNT(*) AS n FROM articles WHERE law_id='{law_id}' AND lang='{lang}'")[0]["n"]
            good = n == expected
            ok &= good
            print(f"   {'✓' if good else '✗'} {law_id}/{lang} : {n}" + ("" if good else f" (attendu {expected})"))

    # 4. Colonnes *_norm remplies pour ccq/cpc
    laws_norm = db.run("SELECT COUNT(*) AS n FROM laws WHERE id IN ('ccq','cpc') AND name_norm IS NOT NULL")[0]["n"]
    div_norm = db.run("SELECT COUNT(*) AS n FROM divisions WHERE law_id IN ('ccq','cpc') AND heading_norm IS NOT NULL")[0]["n"]
    print(f"\n  name_norm rempli (ccq,cpc) : {laws_norm}/2 | heading_norm rempli : {div_norm} divisions")

    print(f"\n=== Résultat : {'OK ✅' if ok else 'ÉCHEC ❌'} ===")
    return ok


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Preuves de la phase A.")
    ap.add_argument("--target", default="local", choices=["local", "cloud"])
    args = ap.parse_args(argv)
    return 0 if verify(make_client(args.target)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
