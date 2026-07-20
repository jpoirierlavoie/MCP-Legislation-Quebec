"""DRY-RUN de reconnaissance des 36 textes additionnels (plan §5, §9 phase B).

Télécharge (FR + EN tolérant), scanne la structure, teste le parseur, moissonne les renvois,
détecte les anomalies — et écrit docs/reconnaissance-36.md. NE CHARGE RIEN en base.

    python -m pipeline.discovery.recon
"""
from __future__ import annotations

import io
import re
import urllib.request
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from bs4 import BeautifulSoup

from .. import config
from ..model import Law
from ..parser import (harvest_renvois, is_division_id, opf_metadata, parse_epub,
                      _ART_ID, _KIND_BY_PREFIX, _SEG_SPLIT)

UA = {"User-Agent": config.USER_AGENT}
REPORT = config.REPO_ROOT / "docs" / "reconnaissance-36.md"
# ids connus (hors motif de division/article) — le reste est une anomalie à signaler.
_KNOWN_HEAD = re.compile(r"^(?:se|sc|page\d+|d\d+e\d+|header|HFContainer)$")
_MARKERS = ("h1", "t1", "nb", "ss", "p1", "p2")
# Intitulé de bloc structurel (annexe/formulaire), à ne compter que HORS d'un article se:.
# NB : pas de « FORM » seul (capterait l'abréviation « form. VI » des références en table).
_STRUCT_HEAD = re.compile(r"^\s*(?:ANNEXE|SCHEDULE|FORMULAIRE|FORMULES)\b", re.I)


def _ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def download(url: str) -> bytes | None:
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
    except Exception:
        return None


def _content_pages(zf: zipfile.ZipFile) -> list[str]:
    ns = [n for n in zf.namelist() if re.search(r"page\d+\.xhtml$", n)]
    return sorted(ns, key=lambda n: int(re.search(r"page(\d+)", n).group(1)))


def scan(data: bytes) -> dict:
    """Scan structurel indépendant du parseur (robuste : ne dépend pas d'un parse réussi)."""
    zf = zipfile.ZipFile(io.BytesIO(data))
    pages = _content_pages(zf)
    art_ids: list[str] = []
    kinds: Counter = Counter()
    unknown: Counter = Counter()
    tables = art_with_table = struct = scnb = 0
    sc_heading: str | None = None
    prelim = finales = False
    htmls: list[str] = []

    for pg in pages:
        html = zf.read(pg).decode("utf-8", "replace")
        htmls.append(html)
        soup = BeautifulSoup(html, "html.parser")
        for el in soup.find_all(id=True):
            i = el.get("id")
            if _ART_ID.fullmatch(i):
                art_ids.append(i)
            elif is_division_id(i):
                kinds[_KIND_BY_PREFIX.get(_SEG_SPLIT.split(i)[-1].split(":")[0], "?")] += 1
            else:
                head = re.split(r"[-:]", i)[0]
                # un sous-élément connu (…-h1, …-ss:K, …) n'est pas une anomalie
                segs = re.split(r"-", i)
                if not (_KNOWN_HEAD.match(head) or i.startswith("ga:")
                        or any(s.split(":")[0] in _MARKERS for s in segs)):
                    unknown[head] += 1
        for t in soup.find_all("table"):  # tables de CONTENU (hors boilerplate en-tête/pied)
            if (t.get("id") == "HFContainer" or "TotalWidth" in (t.get("class") or [])
                    or t.find_parent(id="HFContainer")):
                continue
            tables += 1
            if t.find_parent(id=_ART_ID):
                art_with_table += 1
        # intitulés STRUCTURELS annexe/formulaire/formules, HORS article se: (vrais blocs —
        # pas les références « Annexe I : … » à l'intérieur du texte d'un article)
        for el in soup.find_all(string=_STRUCT_HEAD):
            if el.parent is not None and el.parent.find_parent(id=_ART_ID) is None:
                struct += 1
        sc = soup.find(id="sc-nb:1")
        if sc is not None:
            scnb += 1
            hd = sc.find(id=re.compile(r"^d\d+e"))
            if hd is not None and sc_heading is None:
                sc_heading = _ws(hd.get_text())[:40]
        if re.search(r"DISPOSITION\s+PR[ÉE]LIMINAIRE|PRELIMINARY\s+PROVISION", html, re.I):
            prelim = True
        if re.search(r"DISPOSITIONS?\s+FINALES|FINAL\s+PROVISION", html, re.I):
            finales = True

    ints = sorted(int(a[3:].split("_")[0]) for a in art_ids)
    decimals = [a for a in art_ids if "_" in a]
    return {
        "pages": len(pages), "articles": len(art_ids),
        "int_min": ints[0] if ints else None, "int_max": ints[-1] if ints else None,
        "distinct_ints": len(set(ints)), "decimals": len(decimals),
        "kinds": dict(sorted(kinds.items())), "divisions": sum(kinds.values()),
        "tables": tables, "articles_with_table": art_with_table,
        "struct_blocks": struct, "sc_nb": scnb, "sc_heading": sc_heading,
        "preliminary": prelim, "finales": finales, "unknown_ids": dict(unknown.most_common()),
        "renvois": harvest_renvois(htmls), "opf": opf_metadata(zf),
    }


def parse_test(data: bytes, law_id: str, name_fr: str, rlrq: str, lang: str) -> dict:
    """Teste parse_epub (le pipeline) sur le texte ; capture comptes et exceptions."""
    try:
        with open(config.SAMPLES_DIR / f"_recon_{law_id}_{lang}.epub", "wb") as f:
            f.write(data)
        law = Law(id=law_id, name_fr=name_fr, name_en=name_fr, rlrq_cite=rlrq)
        divs, arts = parse_epub(f.name, law, lang)
        disp_nums = ("préliminaire", "finales", "annexe")
        disp = [a.number for a in arts if a.number in disp_nums]
        empty_real = [a.number for a in arts if not a.text and a.number not in disp_nums]
        empty_disp = [a.number for a in arts if not a.text and a.number in disp_nums]
        return {"ok": True, "divisions": len(divs), "articles": len(arts),
                "dispositions": disp, "empty_real": empty_real, "empty_disp": empty_disp}
    except Exception as e:  # noqa: BLE001 — on rapporte l'anomalie, on ne devine pas
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def base_chapter(rlrq_cite: str) -> str | None:
    m = re.search(r"c\.\s*([^,]+)", rlrq_cite or "")
    return m.group(1).strip() if m else None


def anomalies(law: dict, s: dict, pt: dict, name_en: str | None) -> list[str]:
    a: list[str] = []
    if s["articles"] == 0:
        a.append("aucun article `se:` (texte non standard : tarif/tableaux ?)")
    if s["distinct_ints"] and s["articles"] != s["distinct_ints"] + s["decimals"]:
        a.append(f"numérotation atypique : {s['articles']} se: mais {s['distinct_ints']} entiers "
                 f"distincts + {s['decimals']} décimaux (article « 0 » / renumérotation par partie ?)")
    if s["tables"]:
        loc = f", dont {s['articles_with_table']} dans un article" if s["articles_with_table"] else ""
        a.append(f"{s['tables']} tableau(x) de contenu{loc} — rendu texte lisible à faire (tarif)")
    if s["struct_blocks"]:
        a.append(f"{s['struct_blocks']} intitulé(s) structurel(s) annexe/formulaire HORS article — "
                 f"extraction dédiée à prévoir (non capturée par le parseur actuel)")
    if s["unknown_ids"]:
        a.append(f"ids de motif inconnu : {s['unknown_ids']}")
    if pt["ok"]:
        if pt["empty_real"]:
            a.append(f"article(s) réel(s) au texte vide : {pt['empty_real']}")
        if pt["empty_disp"]:
            a.append(f"bloc sc-nb:1 « {s['sc_heading'] or '?'} » non extrait "
                     f"(pseudo-article {pt['empty_disp']} vide — p. ex. section FORMULES)")
    else:
        a.append(f"PARSE ÉCHOUÉ — {pt['error']}")
    if name_en is None:
        a.append("EN indisponible (404) — charger FR seul en phase C")
    return a


def process(law: dict, parents: dict) -> dict:
    lid = law["id"]
    data_fr = download(law["epub"]["fr"])
    data_en = download(law["epub"].get("en", ""))
    out = {"law": law, "langs": ["fr"] + (["en"] if data_en else [])}
    if not data_fr:
        out["fatal"] = "téléchargement FR échoué"
        return out
    out["scan"] = scan(data_fr)
    out["parse"] = parse_test(data_fr, lid, law["name_fr"], law["rlrq_cite"], "fr")
    out["name_en"] = opf_metadata(zipfile.ZipFile(io.BytesIO(data_en)))["title"] if data_en else None
    out["parent"] = parents.get(base_chapter(law["rlrq_cite"]))
    out["anomalies"] = anomalies(law, out["scan"], out["parse"], out["name_en"])
    return out


def build_report(results: list[dict]) -> str:
    ok = [r for r in results if not r.get("fatal")]
    all_en = [r["law"]["id"] for r in ok if "en" not in r["langs"]]
    parse_fail = [r["law"]["id"] for r in ok if not r["parse"]["ok"]]
    tarifs = [r["law"]["id"] for r in ok if r["scan"]["tables"]]
    struct = [r["law"]["id"] for r in ok if r["scan"]["struct_blocks"]]
    empty_disp = {r["law"]["id"]: r["scan"]["sc_heading"]
                  for r in ok if r["parse"]["ok"] and r["parse"]["empty_disp"]}
    empty_real = [r["law"]["id"] for r in ok if r["parse"]["ok"] and r["parse"]["empty_real"]]
    notes = [r["law"]["id"] for r in ok if "Note" in r["scan"]["unknown_ids"]]
    L = ["# Reconnaissance des 36 textes additionnels (dry-run, phase B)",
         "",
         "Généré par `python -m pipeline.discovery.recon` — **aucune écriture en base**. "
         "Télécharge FR + EN (tolérant), scanne la structure, teste le parseur existant, "
         "moissonne les renvois. À valider avant l'ingestion (phase C).",
         "",
         "## Constats généraux", "",
         f"- **{len(results)} textes**, {len(results) - len(ok)} téléchargement(s) FR en échec.",
         f"- **EN disponible pour {len(ok) - len(all_en)}/{len(ok)}** textes"
         + (f" ; EN manquant : {all_en}" if all_en else " — aucun 404 EN."),
         f"- **parse_epub réussit sur {len(ok) - len(parse_fail)}/{len(ok)}** textes"
         + (f" ; échecs : {parse_fail}" if parse_fail else " (extraction des articles OK partout).")
         + " Le décompte parseur = scan + 1 (pseudo-article « préliminaire »).",
         "- **À traiter en phase C (motifs non standard) :**",
         f"  - **Tableaux de contenu** : {tarifs or '—'}. Rendre les tables lisiblement dans "
         "`text`, conserver le HTML dans `html`. (NB : les tarifs `j-3-r.3.2` et `t-15.01-r.6` "
         "ont leurs frais en TEXTE, pas en `<table>` — déjà pris par le parseur.)",
         f"  - **Annexes/formulaires structurels** (intitulés hors article `se:`) — non capturés : "
         f"{struct or '—'}.",
         f"  - **Blocs `sc-nb:1` non extraits** (le parseur les étiquette « finales » mais le texte "
         "est vide — p. ex. section FORMULES) : "
         + (", ".join(f"{k} « {v} »" for k, v in empty_disp.items()) if empty_disp else "—") + ".",
         f"  - **id `Note`** (note éditoriale, à exclure du `text` comme les notes A.M.) : {notes or '—'}.",
         f"  - **Articles réels au texte vide** : {empty_real or '—'}.",
         "  - **p-44.1** : numérotation atypique (article « 0 » / renumérotation par partie).",
         "- Format Irosoft confirmé pour les 36 (ids `se:`/`ga:`…). name_en lisible depuis "
         "l'OPF anglais ; parent_law_id dérivable via rlrq_cite (voir détail).",
         "",
         "## Synthèse", "",
         "| id | fonction | langues | articles | plage | div. | tableaux | annexe/form | parse | anomalies |",
         "|---|---|---|---|---|---|---|---|---|---|"]
    for r in results:
        law = r["law"]
        if r.get("fatal"):
            L.append(f"| {law['id']} | {law.get('fonction','?')} | — | — | — | — | — | — | ❌ | {r['fatal']} |")
            continue
        s, p = r["scan"], r["parse"]
        rng = f"{s['int_min']}..{s['int_max']}" + (f" +{s['decimals']}déc" if s["decimals"] else "")
        af = f"{s['struct_blocks']} bloc(s)" if s["struct_blocks"] else "—"
        parse = f"✓ {p['articles']}a/{p['divisions']}d" if p["ok"] else "❌"
        L.append(f"| {law['id']} | {law.get('fonction','?')} | {'+'.join(r['langs'])} | "
                 f"{s['articles']} | {rng} | {s['divisions']} | "
                 f"{s['tables'] or '—'} | {af} | {parse} | {len(r['anomalies'])} |")

    L += ["", "## Détail par texte", ""]
    for r in results:
        law = r["law"]
        L.append(f"### {law['id']} — {law['name_fr']}")
        L.append(f"*{law['rlrq_cite']} · fonction={law.get('fonction','?')} · kind_epub={law.get('kind_epub','?')}*")
        if r.get("fatal"):
            L += [f"- ❌ {r['fatal']}", ""]
            continue
        s, p = r["scan"], r["parse"]
        L.append(f"- **Langues** : {', '.join(r['langs'])}" + ("" if r["name_en"] else " (EN indisponible)"))
        L.append(f"- **name_en (OPF)** : {r['name_en'] or '—'}")
        L.append(f"- **Parent (via rlrq_cite)** : {r['parent'] or '—'}")
        L.append(f"- **Articles** : {s['articles']} (entiers {s['int_min']}..{s['int_max']}, "
                 f"{s['distinct_ints']} distincts, {s['decimals']} décimaux)")
        L.append(f"- **Divisions** : {s['divisions']} {s['kinds'] or ''}")
        L.append(f"- **Tableaux (contenu)** : {s['tables']} (dont {s['articles_with_table']} dans un article) · "
                 f"intitulés annexe/formulaire hors article : {s['struct_blocks']} · "
                 f"sc-nb:1 : {s['sc_nb']}" + (f" (« {s['sc_heading']} »)" if s['sc_heading'] else "")
                 + f" · préliminaire : {s['preliminary']} · finales : {s['finales']}")
        if p["ok"]:
            L.append(f"- **parse_epub** : {p['articles']} articles, {p['divisions']} divisions, "
                     f"dispositions={p['dispositions'] or '—'}"
                     + (f", **vide réel**={p['empty_real']}" if p['empty_real'] else "")
                     + (f", disposition vide={p['empty_disp']}" if p['empty_disp'] else ""))
        else:
            L.append(f"- **parse_epub** : ❌ {p['error']}")
        rv = r["scan"]["renvois"]
        top = ", ".join(f"{k}×{v}" for k, v in sorted(rv.items(), key=lambda x: -x[1])[:6])
        L.append(f"- **Renvois RLRQ** : {len(rv)} cibles" + (f" (top : {top})" if rv else ""))
        if r["anomalies"]:
            L.append("- **Anomalies / à traiter en phase C** :")
            L += [f"  - {x}" for x in r["anomalies"]]
        L.append("")
    return "\n".join(L) + "\n"


def main() -> int:
    laws = config.load_additions()
    # carte chapitre -> id des lois habilitantes (non-règlements) pour parent_law_id (§3.3)
    parents = {base_chapter(l["rlrq_cite"]): l["id"]
               for l in config.load_all_laws() if ", r." not in l["rlrq_cite"]}
    config.SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Dry-run sur {len(laws)} textes (téléchargement FR+EN, parse, SANS chargement)…")
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(lambda l: process(l, parents), laws))
    # nettoyage des epubs temporaires de test
    for f in config.SAMPLES_DIR.glob("_recon_*.epub"):
        f.unlink(missing_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(build_report(results), encoding="utf-8", newline="\n")
    n_fatal = sum(1 for r in results if r.get("fatal"))
    n_anom = sum(len(r.get("anomalies", [])) for r in results)
    print(f"Rapport écrit : {REPORT} — {len(results)} textes, {n_fatal} échec(s) fatals, "
          f"{n_anom} anomalie(s) signalée(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
