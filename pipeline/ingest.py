"""Orchestrateur du pipeline (PLAN §4). Ex. :

    python -m pipeline.ingest --law ccq --lang fr                 # parse + valide + génère le SQL
    python -m pipeline.ingest --law ccq --lang fr --apply-local   # + applique en D1 local
    python -m pipeline.ingest --law ccq --lang fr --show 1457     # affiche un article pour contrôle

Par défaut, l'EPUB est lu depuis pipeline/samples/ ; --download le récupère depuis LégisQuébec.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup

from . import config, load, validate
from .model import Law
from .parser import opf_metadata, parse_epub

_FR_MONTHS = {
    "janvier": 1, "février": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6,
    "juillet": 7, "août": 8, "septembre": 9, "octobre": 10, "novembre": 11, "décembre": 12,
}

OUT_DIR = config.REPO_ROOT / "pipeline" / "out"
DB_NAME = "qclaw"


def _sample_path(law_id: str, lang: str) -> Path:
    return config.SAMPLES_DIR / f"{law_id.upper()}-{lang}.epub"


# Décalage d'id par (loi, langue) : garantit des clés primaires globalement uniques
# (divisions.id / articles.id sont partagées entre lois/langues, chargées une à la fois).
# 10^7 par combinaison >> max d'articles (~3525) ou de divisions (~800).
_LANGS = ("fr", "en")


def _id_base(law_id: str, lang: str) -> int:
    law_ids = [law["id"] for law in config.load_all_laws()]
    combo = law_ids.index(law_id) * len(_LANGS) + _LANGS.index(lang)
    return combo * 10_000_000


def _download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as f:
        f.write(resp.read())
    return dest


def _law_from_config(cfg_law: dict) -> Law:
    consol = cfg_law.get("consolidation", {})
    return Law(
        # name_en peut être null dans les additions (§5) : repli temporaire sur name_fr
        # (name_en NOT NULL) ; le vrai name_en est posé au chargement EN depuis l'OPF.
        id=cfg_law["id"], name_fr=cfg_law["name_fr"],
        name_en=cfg_law.get("name_en") or cfg_law["name_fr"],
        rlrq_cite=cfg_law["rlrq_cite"],
        consol_date_fr=consol.get("fr"), consol_date_en=consol.get("en"),
    )


def fetch_consolidation(url: str) -> str | None:
    """Extrait la date « À jour au JJ mois AAAA » (ISO) de la page HTML de la loi.
    LégisQuébec l'affiche en français même sur les pages EN. Non fatal : None si échec."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
        html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace")
    except Exception:
        return None
    soup = BeautifulSoup(html, "html.parser")
    for d in soup.find_all("div", class_="text-end"):
        m = re.search(r"jour au\s*(\d{1,2})\s*(?:er)?\s*([A-Za-zÀ-ÿ]+)\s*(\d{4})",
                      re.sub(r"\s+", " ", d.get_text()), re.I)
        if m and m.group(2).lower() in _FR_MONTHS:
            return f"{m.group(3)}-{_FR_MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    return None


def run(law_id: str, lang: str, download: bool, apply_local: bool, apply_remote: bool,
        show: list[str], strict: bool, refresh_dates: bool = False) -> int:
    cfg_law = config.get_law_any(law_id)
    law = _law_from_config(cfg_law)
    epub = _sample_path(law_id, lang)
    if download or not epub.exists():
        url = cfg_law["epub"][lang]
        print(f"Téléchargement {url} -> {epub}")
        try:
            _download(url, epub)
        except Exception as e:  # tolérance EN manquant (§5) : on saute cette langue, sans échec
            if lang == "en":
                print(f"EN indisponible pour {law_id} ({e}) — langue ignorée.")
                return 0
            raise

    if lang == "en":
        # vrai name_en depuis l'OPF anglais (les additions le livrent à null — §5)
        import zipfile
        with zipfile.ZipFile(epub) as zf:
            title = opf_metadata(zf)["title"]
        if title:
            law.name_en = title

    if refresh_dates:
        src = cfg_law.get("consolidation_source", {}).get(lang)
        date = fetch_consolidation(src) if src else None
        if date:
            print(f"Date de consolidation ({lang}) captée sur la page : {date}")
            setattr(law, f"consol_date_{lang}", date)
        else:
            print(f"Date de consolidation ({lang}) non captée — repli sur la config.")

    print(f"Parsing {epub.name} ({law_id}/{lang}) …")
    divisions, articles = parse_epub(epub, law, lang)
    load.prepare(law, divisions, articles, id_base=_id_base(law_id, lang))

    rep = validate.validate(law_id, lang, divisions, articles)
    # Invariant phase B (§9 C) : les articles réels (se:) doivent égaler le décompte de scan.
    import re as _re
    import zipfile as _zip
    se_ids: set[str] = set()
    with _zip.ZipFile(epub) as zf:
        for n in zf.namelist():
            if _re.search(r"page\d+\.xhtml$", n):
                se_ids |= set(_re.findall(r'id="(se:\d+(?:_\d+)*)"', zf.read(n).decode("utf-8", "replace")))
    real = [a for a in articles if not validate.is_disposition(a.number)]
    if len(real) != len(se_ids):
        rep.ok = False
        rep.lines.append(f"  ✗ comptes phase B : {len(real)} articles réels vs {len(se_ids)} se: (scan)")
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
    # newline="\n" : NE PAS traduire les \n en \r\n sous Windows, sinon les \n\n entre
    # alinéas seraient stockés en \r\n\r\n dans le texte des articles.
    sql_path.write_text(load.to_sql(law, divisions, articles, lang), encoding="utf-8", newline="\n")
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
    p.add_argument("--all", action="store_true", help="Traiter toutes les lois × langues (base + additions).")
    p.add_argument("--additions", action="store_true", help="Traiter les 36 textes additionnels × langues.")
    p.add_argument("--download", action="store_true", help="Retélécharger l'EPUB depuis LégisQuébec.")
    p.add_argument("--refresh-dates", action="store_true",
                   help="Capter la date de consolidation live sur la page de la loi.")
    p.add_argument("--apply-local", action="store_true", help="Appliquer le SQL en D1 local.")
    p.add_argument("--apply-remote", action="store_true", help="Appliquer le SQL en D1 cloud (auth requise).")
    p.add_argument("--show", nargs="*", default=[], help="Numéros d'articles à afficher (ex. 1457).")
    p.add_argument("--no-strict", dest="strict", action="store_false",
                   help="Générer/appliquer même si des invariants échouent.")
    a = p.parse_args(argv)

    if a.additions:
        combos = [(law["id"], lang) for law in config.load_additions() for lang in _LANGS]
    elif a.all:
        combos = [(law["id"], lang) for law in config.load_all_laws() for lang in _LANGS]
    else:
        combos = [(a.law, a.lang)]

    worst = 0
    for law_id, lang in combos:
        print(f"\n{'=' * 60}\n### {law_id}/{lang}\n{'=' * 60}")
        rc = run(law_id, lang, a.download, a.apply_local, a.apply_remote,
                 a.show, a.strict, a.refresh_dates)
        worst = max(worst, rc)
    return worst


if __name__ == "__main__":
    sys.exit(main())
