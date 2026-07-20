"""Chargeur des données de découverte (plan §3), validation stricte §3.4 (échec bruyant).

Étapes :
  1. Enregistre les métadonnées des lois additionnelles (id, noms, citation, fonction, forum,
     name_norm) pour que les références résolvent. Leur CONTENU (articles) vient en phase C ;
     name_en est un repli temporaire (= name_fr) écrasé au chargement EN de la phase C.
  2. Valide taxonomy.json / relations.json : loi référencée présente, sujet déclaré,
     division_path résolvant, aucun doublon, from_law_id de relation présent. Toute violation
     est listée et interrompt le chargement.
  3. Charge subjects / subject_map / law_relations (source='cure').

    python -m pipeline.discovery.load --target {local|cloud}
"""
from __future__ import annotations

import argparse
import json

from .. import config
from ..d1_api import make_client, q
from ..norm import normalize


class ValidationError(Exception):
    pass


def _read(name: str) -> dict:
    return json.loads((config.REPO_ROOT / name).read_text(encoding="utf-8"))


def _insert_rows(db, table: str, cols: list[str], rows: list[list], or_ignore: bool = False):
    if not rows:
        return
    verb = "INSERT OR IGNORE INTO" if or_ignore else "INSERT INTO"
    values = ", ".join("(" + ", ".join(q(v) for v in r) + ")" for r in rows)
    db.run(f"{verb} {table} ({', '.join(cols)}) VALUES {values}")


def seed_laws(db) -> int:
    """Enregistre les lois de la configuration (métadonnées) et pose les attributs de
    découverte sur TOUTES — pas seulement sur les 36 ajouts, sans quoi ccq/cpc restaient
    sans `fonction` et échappaient au filtre correspondant."""
    laws = config.load_all_laws()
    rows = [[l["id"], l["name_fr"], l.get("name_en") or l["name_fr"], l["rlrq_cite"]]
            for l in laws]
    _insert_rows(db, "laws", ["id", "name_fr", "name_en", "rlrq_cite"], rows, or_ignore=True)
    for l in laws:
        forum = " ; ".join(l.get("forum") or []) or None
        consol = l.get("consolidation") or {}
        # Les métadonnées de loi issues de la CONFIG sont synchronisées ici : c'est bien
        # moins coûteux que de réingérer les 76 combinaisons pour deux colonnes de date.
        # (name_en n'y figure PAS : il vient de l'OPF anglais, pas de la config — §5.)
        db.run(f"UPDATE laws SET fonction = {q(l.get('fonction'))}, forum = {q(forum)}, "
               f"name_fr = {q(l['name_fr'])}, name_norm = {q(normalize(l['name_fr']))}, "
               f"consol_date_fr = {q(consol.get('fr'))}, consol_date_en = {q(consol.get('en'))} "
               f"WHERE id = {q(l['id'])}")
    return len(laws)


def validate(db, taxonomy: dict, relations: dict) -> list[str]:
    v: list[str] = []
    law_ids = {r["id"] for r in db.run("SELECT id FROM laws")}
    subject_ids = {s["id"] for s in taxonomy["subjects"]}
    div_paths = {(r["law_id"], r["path"]) for r in db.run("SELECT DISTINCT law_id, path FROM divisions")}
    div_laws = {law for (law, _) in div_paths}

    seen: set[tuple] = set()
    for m in taxonomy["mappings"]:
        subj, law = m["subject"], m["law"]
        path = m.get("division_path", "") or ""
        key = (subj, law, path)
        if key in seen:
            v.append(f"mappage en doublon : {key}")
        seen.add(key)
        if subj not in subject_ids:
            v.append(f"sujet non déclaré : '{subj}' (mappage vers '{law}')")
        if law not in law_ids:
            v.append(f"loi absente de `laws` : '{law}' (sujet '{subj}')")
        if path:
            if law in div_laws and (law, path) not in div_paths:
                v.append(f"division_path introuvable dans `divisions` : {law}/{path} (sujet '{subj}')")
            elif law not in div_laws:
                v.append(f"division_path '{path}' fourni mais aucune division pour '{law}' (sujet '{subj}')")

    for s_ in taxonomy["subjects"]:
        for champ in ("label_en", "description_en"):
            if not s_.get(champ):
                v.append(f"matière '{s_['id']}' : '{champ}' manquant "
                         f"(le routeur serait muet en anglais sur cette matière)")

    for rel in relations["relations"]:
        if rel["from"] not in law_ids:
            v.append(f"relation 'from' absente de `laws` : '{rel['from']}' -> '{rel['to']}'")
    return v


def load(db, taxonomy: dict, relations: dict) -> dict:
    law_ids = {r["id"] for r in db.run("SELECT id FROM laws")}

    db.run("DELETE FROM subject_map")
    db.run("DELETE FROM subjects")
    _insert_rows(db, "subjects",
                 ["id", "label_fr", "label_en", "label_norm", "kind",
                  "description_fr", "description_en"],
                 [[s["id"], s["label_fr"], s.get("label_en"), normalize(s["label_fr"]),
                   s["kind"], s.get("description_fr"), s.get("description_en")]
                  for s in taxonomy["subjects"]])
    _insert_rows(db, "subject_map", ["subject_id", "law_id", "division_path"],
                 [[m["subject"], m["law"], m.get("division_path", "") or ""] for m in taxonomy["mappings"]])

    db.run("DELETE FROM law_relations WHERE source = 'cure'")
    _insert_rows(db, "law_relations",
                 ["from_law_id", "to_law_id", "rel_type", "source", "weight", "in_corpus", "note"],
                 [[r["from"], r["to"], r["rel_type"], "cure", 1,
                   1 if r["to"] in law_ids else 0, r.get("note")] for r in relations["relations"]])

    return {
        "subjects": db.run("SELECT COUNT(*) AS n FROM subjects")[0]["n"],
        "subject_map": db.run("SELECT COUNT(*) AS n FROM subject_map")[0]["n"],
        "law_relations": db.run("SELECT COUNT(*) AS n FROM law_relations")[0]["n"],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Chargeur des données de découverte.")
    ap.add_argument("--target", default="local", choices=["local", "cloud"])
    args = ap.parse_args(argv)
    db = make_client(args.target)

    taxonomy = _read("taxonomy.json")
    relations = _read("relations.json")

    n_seed = seed_laws(db)
    print(f"[{db.name}] lois enregistrées / attributs posés : {n_seed}")

    violations = validate(db, taxonomy, relations)
    if violations:
        print(f"\n❌ VALIDATION ÉCHOUÉE — {len(violations)} violation(s) :")
        for x in violations:
            print("  -", x)
        raise ValidationError(f"{len(violations)} violation(s) — chargement refusé (§3.4).")

    counts = load(db, taxonomy, relations)
    print("✅ Validation OK. Chargé :",
          f"{counts['subjects']} sujets, {counts['subject_map']} mappages, "
          f"{counts['law_relations']} relations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
