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
    name_norm: str | None = None     # rempli au chargement (couche découverte)


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
    heading_norm: str | None = None  # rempli au chargement (recherche d'orientation)
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
    # rempli au chargement :
    id: int | None = None
    sort_key: int = 0
    division_id: int | None = None


# Clé de tri des pseudo-articles de disposition : APRÈS tout le corpus. Le max d'un article
# réel = ~3168 * 1000^4 ≈ 3.17e15 (< 2^53), donc une base à 9e15 les place tous après.
DISPOSITION_SORT_BASE = 9_000_000_000_000_000


def sort_key(number: str) -> int:
    """Clé de tri 64 bits : packing en base 1000 de l'entier + jusqu'à 4 niveaux décimaux,
    normalisé à 5 composantes pour un ordre correct (132 < 132.0.1 < 133 ; gère aussi
    350.52.0.1). Les pseudo-articles de disposition (préliminaire=0, autres via le parseur)
    encadrent le corpus.
    """
    if number == "préliminaire":
        return 0
    parts = number.split(".")
    if not parts[0].isdigit():
        return DISPOSITION_SORT_BASE  # pseudo-article non numérique (le parseur fixe l'ordre)
    comps = parts[:5]  # entier + jusqu'à 4 niveaux décimaux
    key = 0
    for p in comps:
        key = key * 1000 + (int(p) if p.isdigit() else 0)
    for _ in range(5 - len(comps)):
        key *= 1000  # normaliser la longueur (padding)
    return key
