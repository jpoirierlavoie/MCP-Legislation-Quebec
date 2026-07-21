"""Relations dérivées automatiquement (plan §3.3) : construites depuis les textes/config,
chargées dans law_relations (source='auto', sans toucher aux relations 'cure').

* reglement-de : chaque règlement (« RLRQ, c. X, r. Y ») -> sa loi habilitante (chapitre racine
  X, résolu via rlrq_cite, PAS via l'id). Renseigne aussi laws.parent_law_id.
* renvoie-a : renvois <a href> vers d'autres chapitres RLRQ, agrégés par (loi, cible) avec
  weight = nombre de renvois ; cible hors corpus -> in_corpus=0 (candidat d'acquisition).

    python -m pipeline.discovery.relations --target {local|cloud}
"""
from __future__ import annotations

import argparse
import re
import zipfile
from collections import Counter

from .. import config
from ..d1_api import make_client, q
from ..ingest import _sample_path
from ..parser import harvest_renvois


def _chapter(rlrq_cite: str, root: bool = False) -> str | None:
    """Chapitre d'un rlrq_cite. root=True : chapitre racine (avant « , r. ») pour le parent."""
    m = re.search(r"c\.\s*(.+)$", rlrq_cite or "")
    if not m:
        return None
    chap = m.group(1).strip()
    return chap.split(",")[0].strip() if root else chap


# Chapitres RLRQ dont la loi et ses règlements ne portent PAS le même identifiant.
# Le Code civil est « c. CCQ-1991 » mais ses règlements sont « c. CCQ, r. N » : sans cet
# alias, ccq-r.6 / ccq-r.8 n'auraient AUCUN parent — en silence, sans erreur.
_ALIAS_RACINE = {"ccq": "ccq-1991"}


def _key(chapter: str | None) -> str:
    k = re.sub(r"\s+", "", chapter or "").lower()
    return _ALIAS_RACINE.get(k, k)


def _is_regulation(rlrq_cite: str) -> bool:
    return ", r." in (rlrq_cite or "")


def build(db) -> dict:
    laws = config.load_all_laws()
    # cartes chapitre -> id : complète (toutes lois) et racine (lois habilitantes seulement)
    by_full = {_key(_chapter(l["rlrq_cite"])): l["id"] for l in laws}
    by_root = {_key(_chapter(l["rlrq_cite"], root=True)): l["id"]
               for l in laws if not _is_regulation(l["rlrq_cite"])}

    edges: dict[tuple, list] = {}   # (from, to, rel_type) -> [weight, in_corpus, note]
    parents: dict[str, str] = {}

    # 1) reglement-de (+ parent_law_id)
    for l in laws:
        if _is_regulation(l["rlrq_cite"]):
            parent = by_root.get(_key(_chapter(l["rlrq_cite"], root=True)))
            if parent and parent != l["id"]:
                edges[(l["id"], parent, "reglement-de")] = [1, 1, "chapitre racine RLRQ"]
                parents[l["id"]] = parent

    # 2) renvoie-a (moisson des <a href> depuis l'EPUB FR)
    for l in laws:
        epub = _sample_path(l["id"], "fr")
        if not epub.exists():
            continue
        with zipfile.ZipFile(epub) as zf:
            htmls = [zf.read(n).decode("utf-8", "replace")
                     for n in zf.namelist() if re.search(r"page\d+\.xhtml$", n)]
        self_key = _key(_chapter(l["rlrq_cite"]))
        for chapter, count in harvest_renvois(htmls).items():
            if _key(chapter) == self_key:
                continue  # renvoi interne
            target_id = by_full.get(_key(chapter))
            to = target_id or chapter
            key = (l["id"], to, "renvoie-a")
            prev = edges.get(key, [0, 1 if target_id else 0, None])
            edges[key] = [prev[0] + count, 1 if target_id else 0, None]

    # 3) chargement (sans toucher aux relations 'cure')
    db.run("DELETE FROM law_relations WHERE source = 'auto'")
    rows = [[f, t, rt, "auto", w, ic, note] for (f, t, rt), (w, ic, note) in edges.items()]
    cols = ["from_law_id", "to_law_id", "rel_type", "source", "weight", "in_corpus", "note"]
    for i in range(0, len(rows), 100):
        vals = ", ".join("(" + ", ".join(q(v) for v in r) + ")" for r in rows[i:i + 100])
        db.run(f"INSERT OR REPLACE INTO law_relations ({', '.join(cols)}) VALUES {vals}")
    for lid, pid in parents.items():
        db.run(f"UPDATE laws SET parent_law_id = {q(pid)} WHERE id = {q(lid)}")

    reglement = sum(1 for k in edges if k[2] == "reglement-de")
    renvoie = sum(1 for k in edges if k[2] == "renvoie-a")
    in_corpus = sum(1 for k, v in edges.items() if k[2] == "renvoie-a" and v[1])
    return {"reglement_de": reglement, "renvoie_a": renvoie,
            "renvoie_a_in_corpus": in_corpus, "parents": len(parents)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Relations dérivées (reglement-de, renvoie-a).")
    ap.add_argument("--target", default="local", choices=["local", "cloud"])
    args = ap.parse_args(argv)
    db = make_client(args.target)
    c = build(db)
    print(f"[{db.name}] relations 'auto' : {c['reglement_de']} reglement-de "
          f"(parent_law_id sur {c['parents']} lois), {c['renvoie_a']} renvoie-a "
          f"(dont {c['renvoie_a_in_corpus']} au corpus).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
