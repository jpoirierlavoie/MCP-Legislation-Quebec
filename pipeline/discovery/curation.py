"""Chargeur de la couche de curation (phase 3 v2) : division_links et concept_gazetteer.

    python -m pipeline.discovery.curation --target {local|cloud}
    python -m pipeline.discovery.curation --target local --dry-run

PRINCIPE — « l'IA rédige, l'avocat valide ». Les JSON de `curation/` sont le POINT DE
VÉRITÉ : ils portent le drapeau `validated` de chaque entrée, et le chargeur le recopie
tel quel en base. Une entrée `validated: false` est donc chargée, mais aucune requête de
production ne la verra (toutes filtrent `WHERE validated = 1`, en SQL, jamais en JS).

VALIDATION STRICTE, ÉCHEC BRUYANT, VIOLATIONS LISTÉES — c'est la règle §3.4 du plan v1,
déjà éprouvée par `discovery/load.py`. Le chargeur accumule TOUTES les violations avant de
refuser : corriger un brouillon de 200 lignes une erreur à la fois serait intenable.

CE QUI N'EST PAS ICI, ET POURQUOI. Les mappages matière → division de la tâche 3.1 ne
passent PAS par ce chargeur. Ils vivent dans `taxonomy.json` et sont chargés par
`discovery/load.py`, parce que `subject_map` n'a PAS de colonne `validated` et qu'elle est
lue par cinq chemins — dont `src/site.ts`, la page publique, HORS MCP. Y ajouter un drapeau
demanderait cinq `WHERE validated = 1` dont un seul oubli servirait du contenu non relu,
pour un bénéfice nul : `taxonomy.json` est déjà du contenu éditorial ⛔ dont la porte est
la revue de commit — le protocole v1, qui a fonctionné. Les propositions de mappage vivent
donc dans `curation/division-subjects.proposition.json`, que RIEN ne charge.
"""
from __future__ import annotations

import argparse
import json

from .. import config
from ..d1_api import make_client
from ..load import _rows_sql

CURATION_DIR = config.REPO_ROOT / "curation"

REL_TYPES = {"compagnon", "voir_aussi"}


class ValidationError(RuntimeError):
    """Le chargement est refusé : au moins une violation (§3.4)."""


def _read(name: str) -> list[dict]:
    p = CURATION_DIR / name
    if not p.exists():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    # Un objet avec une clé racine (comme taxonomy.json) ou un tableau nu : on accepte les
    # deux, en ignorant les clés de commentaire `_*` (patron de catalogue.json).
    if isinstance(data, dict):
        for k, v in data.items():
            if not k.startswith("_") and isinstance(v, list):
                return v
        return []
    return data


# --- validation ---------------------------------------------------------------

def _index_divisions(db) -> set[tuple[str, str, str]]:
    """(law_id, lang, path) existants. Chargé en bloc : ~9 300 lignes, une requête."""
    return {(r["law_id"], r["lang"], r["path"])
            for r in db.run("SELECT law_id, lang, path FROM divisions")}


def _index_articles(db) -> set[tuple[str, str, str]]:
    """(law_id, lang, number) existants — ~49 K lignes, une requête."""
    return {(r["law_id"], r["lang"], r["number"])
            for r in db.run("SELECT law_id, lang, number FROM articles")}


def validate(db, links: list[dict], concepts: list[dict]) -> list[str]:
    """Toutes les violations, jamais la première seule. Liste vide = chargement permis."""
    v: list[str] = []
    laws = {r["id"] for r in db.run("SELECT id FROM laws")}
    divs = _index_divisions(db)
    arts = _index_articles(db)

    def cible_ok(etiquette: str, law: str, lang: str, path: str | None,
                 articles: list | None) -> None:
        """Une cible doit RÉSOUDRE : c'est ce qui empêche de servir un renvoi vers le vide."""
        if law not in laws:
            v.append(f"{etiquette} : loi '{law}' absente du corpus")
            return
        if path:
            if (law, lang, path) not in divs:
                v.append(f"{etiquette} : division '{path}' introuvable dans {law} ({lang})")
        for num in articles or []:
            if (law, lang, str(num)) not in arts:
                v.append(f"{etiquette} : article {num} introuvable dans {law} ({lang})")
        if not path and not articles:
            v.append(f"{etiquette} : cible sans 'path' ni 'articles'")

    # --- division_links ---
    vus: set[tuple] = set()
    for i, e in enumerate(links):
        et = f"division_links[{i}]"
        manquants = [k for k in ("law_a", "path_a", "law_b", "path_b", "rel_type") if not e.get(k)]
        if manquants:
            v.append(f"{et} : champ(s) obligatoire(s) manquant(s) : {', '.join(manquants)}")
            continue
        if e["rel_type"] not in REL_TYPES:
            v.append(f"{et} : rel_type '{e['rel_type']}' hors de {sorted(REL_TYPES)}")
        if "validated" not in e:
            v.append(f"{et} : drapeau 'validated' absent — il n'a pas de valeur par défaut ici")
        lang = e.get("lang", "fr")
        cle = (e["law_a"], e["path_a"], e["law_b"], e["path_b"], e["rel_type"])
        if cle in vus:
            v.append(f"{et} : doublon de clé primaire {cle}")
        vus.add(cle)
        cible_ok(f"{et}.a", e["law_a"], lang, e["path_a"], None)
        cible_ok(f"{et}.b", e["law_b"], lang, e["path_b"], None)
        if e["law_a"] == e["law_b"] and e["path_a"] == e["path_b"]:
            v.append(f"{et} : lien d'une division vers elle-même")

    # --- concept_gazetteer ---
    concepts_vus: set[str] = set()
    for i, e in enumerate(concepts):
        et = f"gazetteer[{i}]"
        if not e.get("concept"):
            v.append(f"{et} : 'concept' manquant")
            continue
        if e["concept"] in concepts_vus:
            v.append(f"{et} : concept '{e['concept']}' en double")
        concepts_vus.add(e["concept"])
        if "validated" not in e:
            v.append(f"{et} : drapeau 'validated' absent")
        lang = e.get("lang", "fr")

        variantes = e.get("variantes") or []
        if not isinstance(variantes, list) or not variantes:
            v.append(f"{et} : 'variantes' doit être une liste non vide")
        for x in variantes:
            if not isinstance(x, str) or not x.strip():
                v.append(f"{et} : variante vide ou non textuelle")
            elif x != x.lower():
                # Les variantes sont une SURFACE D'APPARIEMENT, pas de la prose (invariant 13).
                # Le tokenizer FTS5 de D1 replie déjà les accents (remove_diacritics ACTIF,
                # mesuré) : inutile de les retirer, mais la casse, elle, doit être normalisée.
                v.append(f"{et} : variante '{x}' non normalisée (minuscules attendues)")

        cibles = e.get("cibles") or []
        if not isinstance(cibles, list) or not cibles:
            v.append(f"{et} : 'cibles' doit être une liste non vide")
        for j, c in enumerate(cibles):
            if not isinstance(c, dict) or not c.get("law"):
                v.append(f"{et}.cibles[{j}] : 'law' manquant")
                continue
            cible_ok(f"{et}.cibles[{j}]", c["law"], lang, c.get("path"), c.get("articles"))
    return v


# --- chargement ---------------------------------------------------------------

_LINK_COLS = ["law_a", "path_a", "law_b", "path_b", "rel_type", "lang", "note", "validated"]
_CONCEPT_COLS = ["concept", "variantes", "cibles", "lang", "note", "validated"]


def _run_batched(db, table: str, cols: list[str], rows: list[list]) -> int:
    """INSERT plafonnés en OCTETS via pipeline.load._rows_sql — invariant 6.

    On IMPORTE le plafonnement au lieu de le réécrire : `discovery/load.py::_insert_rows`
    émet UNE instruction pour toutes les lignes, sans aucun plafond. Cela passe pour 117
    mappages ; ce serait `SQLITE_TOOBIG` pour les 4 403 headnotes de la tâche 3.3, et c'est
    déjà sans marge pour quelques centaines de liens portant une note. Un seul point de
    vérité pour la limite des 100 Ko.
    """
    if not rows:
        return 0
    for stmt in _rows_sql(table, cols, rows):
        db.run(stmt)
    return len(rows)


def charger(db, links: list[dict], concepts: list[dict]) -> dict[str, int]:
    # Table rase : les JSON sont le point de vérité, drapeau compris. Contrairement à
    # law_relations (qui partage la table entre 'auto' et 'cure'), rien d'autre n'écrit ici.
    db.run("DELETE FROM division_links")
    db.run("DELETE FROM concept_gazetteer")

    n_l = _run_batched(db, "division_links", _LINK_COLS, [
        [e["law_a"], e["path_a"], e["law_b"], e["path_b"], e["rel_type"],
         e.get("lang", "fr"), e.get("note"), 1 if e.get("validated") else 0]
        for e in links
    ])
    n_c = _run_batched(db, "concept_gazetteer", _CONCEPT_COLS, [
        [e["concept"], json.dumps(e["variantes"], ensure_ascii=False),
         json.dumps(e["cibles"], ensure_ascii=False), e.get("lang", "fr"),
         e.get("note"), 1 if e.get("validated") else 0]
        for e in concepts
    ])
    return {"division_links": n_l, "concept_gazetteer": n_c}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Chargeur de la couche de curation (phase 3).")
    ap.add_argument("--target", default="local", choices=["local", "cloud"])
    ap.add_argument("--dry-run", action="store_true",
                    help="valider sans écrire (la porte ⛔ avant toute écriture)")
    args = ap.parse_args(argv)

    links = _read("division-links.json")
    concepts = _read("gazetteer.json")
    db = make_client(args.target)

    violations = validate(db, links, concepts)
    if violations:
        print(f"\n❌ VALIDATION ÉCHOUÉE — {len(violations)} violation(s) :")
        for x in violations:
            print("  -", x)
        raise ValidationError(f"{len(violations)} violation(s) — chargement refusé (§3.4).")

    v_l = sum(1 for e in links if e.get("validated"))
    v_c = sum(1 for e in concepts if e.get("validated"))
    print(f"[{db.name}] validation OK — "
          f"{len(links)} lien(s) dont {v_l} validé(s) ; "
          f"{len(concepts)} concept(s) dont {v_c} validé(s).")

    if args.dry_run:
        print("--dry-run : rien n'a été écrit.")
        return 0

    n = charger(db, links, concepts)
    print(f"[{db.name}] chargé : {n['division_links']} liens, {n['concept_gazetteer']} concepts.")
    if v_l + v_c == 0:
        print("⚠️  AUCUNE entrée validée : la production ne verra rien. C'est le comportement")
        print("    attendu tant que la porte ⛔ n'est pas franchie.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
