"""Normalisation de référence pour l'appariement d'orientation (plan-couche-decouverte §2).

minuscules + suppression des diacritiques (NFD, retrait des combinants) + espaces simples.
Réutilisée par le rattrapage, les chargeurs et (à terme) le pipeline au chargement.
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
