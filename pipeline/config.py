"""Lecture de laws.config.json (JSON strict) — voir PLAN.md §8."""
from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "laws.config.json"
SAMPLES_DIR = REPO_ROOT / "pipeline" / "samples"

# En-tête navigateur : LégisQuébec renvoie 403 aux clients de centre de données
# (constaté en phase 0). À utiliser pour tout téléchargement.
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"


def load_config(path: Path | None = None) -> dict:
    with open(path or CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def get_law(law_id: str, path: Path | None = None) -> dict:
    for law in load_config(path)["laws"]:
        if law["id"] == law_id:
            return law
    raise KeyError(f"loi inconnue dans laws.config.json : {law_id!r}")
