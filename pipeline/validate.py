"""Validation des invariants du corpus (garde-fou avant bascule ; tests de non-régression).

Les valeurs témoins du C.c.Q. FR viennent de la phase 0 (docs/phase0-structure-epub.md, PLAN §11).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .model import Article, Division

# Invariants attendus, par (law_id, lang).
EXPECTED = {
    ("ccq", "fr"): {
        "articles_real": 3523,          # articles se: (hors dispositions)
        "int_min": 1, "int_max": 3168,  # entiers complets 1..3168
        "decimals": 355,                # 351 à un niveau + 4 à deux niveaux
        "divisions": 800,
        "div_by_kind": {"livre": 10, "titre": 45, "chapitre": 160, "section": 270,
                         "sous-section": 213, "niveau6": 86, "niveau7": 13, "niveau8": 3},
        "repealed_articles": 68,
        # 4 divisions abrogées : 2 sections + 1 chapitre (constatés en phase 0, niveaux ga-gd)
        # + 1 sous-section « § 8 » (ge:l_8, Livre 5) que le scan ga-gd de la phase 0 n'avait pas comptée.
        "repealed_divisions": 4,
        "dispositions": 2,              # préliminaire + finales
    }
}


@dataclass
class Report:
    ok: bool = True
    lines: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    def check(self, label: str, got, expected=None):
        if expected is None:
            self.lines.append(f"  · {label}: {got}")
        else:
            ok = got == expected
            self.ok &= ok
            self.lines.append(f"  {'✓' if ok else '✗'} {label}: {got}" + ("" if ok else f"  (attendu {expected})"))


def validate(law_id: str, lang: str, divisions: list[Division], articles: list[Article]) -> Report:
    r = Report()
    real = [a for a in articles if a.number not in ("préliminaire", "finales")]
    disp = [a for a in articles if a.number in ("préliminaire", "finales")]
    ints = sorted({int(a.number) for a in real if "." not in a.number})
    decimals = [a for a in real if "." in a.number]
    div_no_disp = [d for d in divisions if d.kind != "disposition"]
    by_kind: dict[str, int] = {}
    for d in div_no_disp:
        by_kind[d.kind] = by_kind.get(d.kind, 0) + 1

    r.stats = {
        "articles_total": len(articles), "articles_real": len(real), "dispositions": len(disp),
        "int_count": len(ints), "int_min": ints[0] if ints else None, "int_max": ints[-1] if ints else None,
        "decimals": len(decimals), "divisions": len(div_no_disp), "div_by_kind": by_kind,
        "repealed_articles": sum(a.repealed for a in real), "repealed_divisions": sum(d.repealed for d in div_no_disp),
    }

    # lacunes / doublons dans la plage entière
    gaps, dups = [], []
    if ints:
        full = set(range(ints[0], ints[-1] + 1))
        gaps = sorted(full - set(ints))
        seen, dd = set(), set()
        for a in real:
            if "." not in a.number:
                n = int(a.number)
                (dd if n in seen else seen).add(n)
        dups = sorted(dd)

    exp = EXPECTED.get((law_id, lang))
    r.lines.append(f"Invariants {law_id}/{lang} :")
    if exp:
        r.check("articles se:", len(real), exp["articles_real"])
        r.check("entiers min/max", (r.stats["int_min"], r.stats["int_max"]), (exp["int_min"], exp["int_max"]))
        r.check("entiers complets (nb)", len(ints), exp["int_max"] - exp["int_min"] + 1)
        r.check("décimaux", len(decimals), exp["decimals"])
        r.check("divisions", len(div_no_disp), exp["divisions"])
        r.check("divisions par type", by_kind, exp["div_by_kind"])
        r.check("articles abrogés", r.stats["repealed_articles"], exp["repealed_articles"])
        r.check("divisions abrogées", r.stats["repealed_divisions"], exp["repealed_divisions"])
        r.check("dispositions (pseudo-articles)", len(disp), exp["dispositions"])
    else:
        r.check("articles se:", len(real))
        r.check("entiers min/max", (r.stats["int_min"], r.stats["int_max"]))
        r.check("divisions", len(div_no_disp))
        r.check("divisions par type", by_kind)

    # invariants structurels (toutes lois)
    r.check("lacunes dans la plage entière", gaps if gaps else "aucune", "aucune")
    r.check("doublons d'entiers", dups if dups else "aucun", "aucun")
    no_div = [a.number for a in real if not a.division_path]
    r.check("articles sans division", no_div if no_div else "aucun", "aucun")
    empty = [a.number for a in articles if not a.text]
    r.check("articles au texte vide", empty if empty else "aucun", "aucun")
    return r
