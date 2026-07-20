"""Lecture de laws.config.json (JSON strict) — voir PLAN.md §8."""
from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "laws.config.json"
ADDITIONS_PATH = REPO_ROOT / "laws.config.additions.json"
SAMPLES_DIR = REPO_ROOT / "pipeline" / "samples"

# En-tête navigateur : LégisQuébec renvoie 403 aux clients de centre de données
# (constaté en phase 0). À utiliser pour tout téléchargement.
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"


def load_config(path: Path | None = None) -> dict:
    with open(path or CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_additions() -> list[dict]:
    if not ADDITIONS_PATH.exists():
        return []
    with open(ADDITIONS_PATH, encoding="utf-8") as f:
        return json.load(f)["laws"]


def load_all_laws() -> list[dict]:
    """Corpus complet : lois de base (ccq, cpc) + additions (§5), fusionnées."""
    return list(load_config()["laws"]) + load_additions()


def get_law(law_id: str, path: Path | None = None) -> dict:
    for law in load_config(path)["laws"]:
        if law["id"] == law_id:
            return law
    raise KeyError(f"loi inconnue dans laws.config.json : {law_id!r}")


def get_law_any(law_id: str) -> dict:
    for law in load_all_laws():
        if law["id"] == law_id:
            return law
    raise KeyError(f"loi inconnue (base + additions) : {law_id!r}")
