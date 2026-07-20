"""Modèle de données du pipeline — reflète le schéma D1 (PLAN.md §2 révisé)."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Law:
    id: str
    name_fr: str
    name_en: str
    rlrq_cite: str
    consol_date_fr: str | None = None
    consol_date_en: str | None = None


@dataclass
class Division:
    law_id: str
    lang: str
    kind: str                    # livre|titre|chapitre|section|sous-section|niveau6|niveau7|niveau8|disposition
    path: str                    # id Irosoft complet (chemin canonique) ; identifiant naturel unique
    number: str | None = None    # ordinal affichable : 'PREMIER', 'I', '§ 1', ...
    heading: str | None = None   # intitulé (peut manquer : divisions abrogées)
    history: str | None = None   # historique de division (89 cas C.c.Q. FR)
    repealed: int = 0            # 1 si division abrogée
    parent_path: str | None = None   # path du parent, résolu en parent_id au chargement
    sort_order: int = 0
    # rempli au chargement :
    id: int | None = None
    parent_id: int | None = None


@dataclass
class Article:
    law_id: str
    lang: str
    number: str                  # '1457', '2926.1', '132.0.1', 'préliminaire', 'finales'
    text: str                    # verbatim (numéro, historique et notes A.M. exclus)
    division_path: str           # id Irosoft de la division feuille
    html: str | None = None      # HTML nettoyé (integrity:* retirés, liens absolus, historique retiré)
    history: str | None = None   # ligne d'historique : '1991, c. 64, a. 1457; ...'
    repealed: int = 0            # 1 si '(Abrogé).'
    consol_date: str | None = None
    # rempli au chargement :
    id: int | None = None
    sort_key: int = 0
    division_id: int | None = None


def sort_key(number: str) -> int:
    """Clé de tri 64 bits (PLAN §12) : n*10^6 + d1*10^3 + d2.

    Gère les décimaux à 1-2 niveaux ('2926.1', '132.0.1') et préserve l'ordre au
    passage d'un Livre à l'autre (898 < 898.1 < 899). Les pseudo-articles de
    disposition encadrent le corpus.
    """
    if number == "préliminaire":
        return 0
    if number == "finales":
        return 9_000_000_000
    if number == "annexe":
        return 9_500_000_000
    parts = number.split(".")
    n = int(parts[0])
    d1 = int(parts[1]) if len(parts) > 1 else 0
    d2 = int(parts[2]) if len(parts) > 2 else 0
    return n * 1_000_000 + d1 * 1_000 + d2
