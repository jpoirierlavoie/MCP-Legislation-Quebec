"""Orchestrateur du pipeline (PLAN §4). Ex. :

    python -m pipeline.ingest --law ccq --lang fr                 # parse + valide + génère le SQL
    python -m pipeline.ingest --law ccq --lang fr --apply-local   # + applique en D1 local
    python -m pipeline.ingest --law ccq --lang fr --show 1457     # affiche un article pour contrôle

Par défaut, l'EPUB est lu depuis pipeline/samples/ ; --download le récupère depuis LégisQuébec.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import urllib.request
from pathlib import Path

from . import config, load, validate
from .model import Law
from .parser import parse_epub

OUT_DIR = config.REPO_ROOT / "pipeline" / "out"
DB_NAME = "qclaw"


def _sample_path(law_id: str, lang: str) -> Path:
    return config.SAMPLES_DIR / f"{law_id.upper()}-{lang}.epub"


def _download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as f:
        f.write(resp.read())
    return dest


def _law_from_config(cfg_law: dict) -> Law:
    consol = cfg_law.get("consolidation", {})
    return Law(
        id=cfg_law["id"], name_fr=cfg_law["name_fr"], name_en=cfg_law["name_en"],
        rlrq_cite=cfg_law["rlrq_cite"],
        consol_date_fr=consol.get("fr"), consol_date_en=consol.get("en"),
    )


def run(law_id: str, lang: str, download: bool, apply_local: bool, apply_remote: bool,
        show: list[str], strict: bool) -> int:
    cfg_law = config.get_law(law_id)
    law = _law_from_config(cfg_law)
    epub = _sample_path(law_id, lang)
    if download or not epub.exists():
        url = cfg_law["epub"][lang]
        print(f"Téléchargement {url} -> {epub}")
        _download(url, epub)

    print(f"Parsing {epub.name} ({law_id}/{lang}) …")
    divisions, articles = parse_epub(epub, law, lang)
    load.prepare(law, divisions, articles)

    rep = validate.validate(law_id, lang, divisions, articles)
    print("\n".join(rep.lines))
    print(f"\nRésultat des invariants : {'OK ✅' if rep.ok else 'ÉCHEC ❌'}")

    for num in show:
        a = next((x for x in articles if x.number == num), None)
        if a is None:
            print(f"\n[art {num} introuvable]")
            continue
        print(f"\n===== ARTICLE {a.number} (loi={a.law_id}, lang={a.lang}, abrogé={a.repealed}) =====")
        print(f"division_path : {a.division_path}")
        print(f"historique    : {a.history}")
        print(f"consolidation : {a.consol_date}")
        print("--- texte ---")
        print(a.text)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sql_path = OUT_DIR / f"{law_id}-{lang}.sql"
    sql_path.write_text(load.to_sql(law, divisions, articles), encoding="utf-8")
    print(f"\nSQL écrit : {sql_path}  ({sql_path.stat().st_size // 1024} Ko, "
          f"{len(divisions)} divisions, {len(articles)} articles)")

    if strict and not rep.ok:
        print("Invariants en échec -> bascule refusée (utiliser --no-strict pour forcer).")
        return 1

    for remote in ([False] if apply_local else []) + ([True] if apply_remote else []):
        flag = "--remote" if remote else "--local"
        print(f"\nApplication des données en D1 {flag} …")
        cmd = f'npx wrangler d1 execute {DB_NAME} {flag} --file="{sql_path}"' + (" -y" if remote else "")
        res = subprocess.run(cmd, shell=True, cwd=config.REPO_ROOT)
        if res.returncode != 0:
            print(f"wrangler a échoué (code {res.returncode}).")
            return res.returncode
    return 0 if rep.ok else 2


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Pipeline d'ingestion Lois du Québec (EPUB -> D1).")
    p.add_argument("--law", default="ccq")
    p.add_argument("--lang", default="fr", choices=["fr", "en"])
    p.add_argument("--download", action="store_true", help="Retélécharger l'EPUB depuis LégisQuébec.")
    p.add_argument("--apply-local", action="store_true", help="Appliquer le SQL en D1 local.")
    p.add_argument("--apply-remote", action="store_true", help="Appliquer le SQL en D1 cloud (auth requise).")
    p.add_argument("--show", nargs="*", default=[], help="Numéros d'articles à afficher (ex. 1457).")
    p.add_argument("--no-strict", dest="strict", action="store_false",
                   help="Générer/appliquer même si des invariants échouent.")
    a = p.parse_args(argv)
    return run(a.law, a.lang, a.download, a.apply_local, a.apply_remote, a.show, a.strict)


if __name__ == "__main__":
    sys.exit(main())
