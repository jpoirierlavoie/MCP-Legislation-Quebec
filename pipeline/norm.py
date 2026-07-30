"""Normalisation de référence pour l'appariement d'orientation (plan-couche-decouverte §2).

minuscules + suppression des diacritiques (NFD, retrait des combinants) + espaces simples.
Réutilisée par les chargeurs (pipeline/load.py, pipeline/discovery/load.py) et le
parseur. name_norm/heading_norm sont calculés AU CHARGEMENT (invariant 3) : il n'y a
plus de « rattrapage », le module Python qui le faisait a été supprimé.
"""
from __future__ import annotations

import re
import unicodedata


def normalize(s: str | None) -> str | None:
    if s is None:
        return None
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip().lower() or None
