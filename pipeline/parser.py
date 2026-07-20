"""Parseur EPUB LégisQuébec (Irosoft CYBERLEX) -> lignes normalisées.

Calé sur la structure réelle constatée en phase 0 (voir docs/phase0-structure-epub.md,
notamment §8 « stratégie de parseur »). Points clés :

* Les `id` des `<div>` encodent le chemin hiérarchique complet (segments `préfixe:valeur`
  joints par `-`). Préfixes : ga=livre, gb=titre, gc=chapitre, gd=section, ge=sous-section
  (« § »), gf/gg/gi = niveaux plus profonds. Une division est un id fait *uniquement* de
  tels segments (aucun marqueur -h1/-t1/-nb/-ss/-p1/-p2).
* Les articles sont des `<div id="se:NUM">` ; décimaux à underscore (`se:2926_1` = 2926.1,
  `se:132_0_1` = 132.0.1). Alinéas = `-ss:K`, paragraphes = `-p1:N`, sous-paragraphes = `-p2:x`.
* Ligne d'historique = un `<div>` 9pt contenant un `<div class="ligne">` séparateur.
* Nettoyage obligatoire (rapport §7) : retirer les sous-arbres cachés (`class` ~ Hidden OU
  style `display:none`) avant toute extraction ; retirer les attributs `integrity:*` ;
  réécrire les liens en absolu.
* Cas spéciaux : disposition préliminaire (page0) et dispositions finales (page11), servies
  comme pseudo-articles ('préliminaire'/'finales') sous une division `kind='disposition'`.
"""
from __future__ import annotations

import re
import unicodedata
import warnings
import zipfile
from pathlib import Path

from bs4 import BeautifulSoup, Tag
from bs4 import XMLParsedAsHTMLWarning

from .model import Article, Division, Law, DISPOSITION_SORT_BASE
from .norm import normalize

# On parse tout (contenu XHTML et OPF/container XML) avec html.parser à dessein
# (préserve les attributs à namespace comme integrity:*), d'où ce filtre.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

# --- motifs de structure (constatés en phase 0) -----------------------------

_G_PREFIXES = ("ga", "gb", "gc", "gd", "ge", "gf", "gg", "gh", "gi")
_KIND_BY_PREFIX = {
    "ga": "livre", "gb": "titre", "gc": "chapitre", "gd": "section",
    "ge": "sous-section", "gf": "niveau6", "gg": "niveau7", "gi": "niveau8",
}
# Configuration par langue : mots de niveau (pour extraire le numéro depuis l'intitulé) et
# intitulés des dispositions. NB : l'anglais nomme « DIVISION » le niveau que le français
# nomme « SECTION » (le `kind` interne reste 'section' dans les deux langues).
_LANG = {
    "fr": {
        "labels": {"livre": "LIVRE", "titre": "TITRE", "chapitre": "CHAPITRE", "section": "SECTION"},
        "preliminary": "DISPOSITION PRÉLIMINAIRE",
        "finales": "DISPOSITIONS FINALES",
    },
    "en": {
        "labels": {"livre": "BOOK", "titre": "TITLE", "chapitre": "CHAPTER", "section": "DIVISION"},
        "preliminary": "PRELIMINARY PROVISION",
        "finales": "FINAL PROVISIONS",
    },
}
_ANNEXE_RE = re.compile(r"\b(?:ANNEXE|SCHEDULE)\b", re.I)
# Abrogation, FR « (Abrogé) » et EN « (Repealed) ».
_REPEALED_RE = re.compile(r"\(?(?:Abrog|Repea)")

# Un id de sous-élément contient un de ces marqueurs ; un id de division n'en contient aucun.
_MARKER = re.compile(r"-(?:h1|t1|nb|ss|p\d)(?::|-|$)")
# Découpe un id de division en segments : sur '-' précédant un préfixe de niveau connu.
# (Robuste aux valeurs contenant un trait d'union, ex. gc:l_dix-septieme.)
_SEG_SPLIT = re.compile(r"-(?=(?:ga|gb|gc|gd|ge|gf|gg|gh|gi):)")
_ART_ID = re.compile(r"^se:\d+(?:_\d+)*$")  # décimaux à N niveaux (132.0.1, 350.52.0.1…)

_LINK_SCHEME = re.compile(r"^[a-z]+:", re.I)


def is_division_id(eid: str) -> bool:
    return eid.startswith("ga:") and not _MARKER.search(eid)


def _segments(eid: str) -> list[str]:
    return _SEG_SPLIT.split(eid)


def _parent_path(eid: str) -> str | None:
    segs = _segments(eid)
    return "-".join(segs[:-1]) if len(segs) > 1 else None


def number_from_article_id(eid: str) -> str:
    return eid[len("se:"):].replace("_", ".")


# --- nettoyage & normalisation ----------------------------------------------

def _soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")


def _strip_hidden(tag: Tag) -> None:
    """Retire les sous-arbres cachés : class contenant 'Hidden' OU style 'display:none'.
    Les deux règles sont nécessaires (populations disjointes — rapport §7.1)."""
    for el in tag.find_all(True):
        if not el.parent:  # déjà retiré avec un ancêtre
            continue
        cls = el.get("class") or []
        style = el.get("style") or ""
        if any("Hidden" in c for c in cls) or re.search(r"display\s*:\s*none", style):
            el.decompose()


def _clean_attrs(tag: Tag) -> None:
    """Nettoie le HTML stocké : retire integrity:*/xmlns:* et les styles inline Irosoft
    (présentationnels, volumineux), réécrit les liens en absolu. Conserve la structure et les id."""
    for el in tag.find_all(True):
        for key in list(el.attrs):
            if "integrity" in key or key.startswith("xmlns") or key == "style":
                del el.attrs[key]
        href = el.get("href")
        if href and not _LINK_SCHEME.match(href):
            el["href"] = "https://" + href.lstrip("/")


def _norm(text: str) -> str:
    """Normalise l'espace : ramène toute variante d'espace Unicode (insécable U+00A0, fine
    U+2009, etc. — de la typographie de justification, non du contenu) à une espace normale,
    réduit les blancs, et préserve les alinéas (\\n\\n). Conserve les autres caractères
    verbatim, dont l'apostrophe typographique ’."""
    text = "".join(" " if unicodedata.category(ch) == "Zs" else ch for ch in text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _history_block(container: Tag) -> Tag | None:
    """Le bloc d'historique 9pt = le div contenant un `<div class="ligne">` (unique par article)."""
    ligne = container.find("div", class_="ligne")
    return ligne.parent if ligne else None


# --- extraction d'articles ---------------------------------------------------

def _add_paragraph_breaks(scope: Tag) -> None:
    for p in scope.find_all("div", id=_MARKER_P):
        p.insert_before("\n")


_MARKER_P = re.compile(r"-p[12]:")
_NOTE_ID = re.compile(r"^(?:d\d+e|Note)")


def _strip_notes(scope: Tag) -> None:
    """Retire les notes éditoriales (divs d36e*/Note, spans class noteInTable) — hors du texte
    normatif, comme les notes A.M. du C.c.Q. (rapport §7)."""
    for n in scope.find_all(id=_NOTE_ID):
        n.decompose()
    for n in scope.find_all(class_="noteInTable"):
        n.decompose()


def _render_tables(scope: Tag) -> None:
    """Rend les tableaux lisiblement dans le texte : « cellule : cellule » par ligne (tarifs)."""
    for t in scope.find_all("table"):
        rows = []
        for tr in t.find_all("tr"):
            cells = [c for c in (_norm(td.get_text()) for td in tr.find_all(["td", "th"])) if c]
            if cells:
                rows.append(" : ".join(cells))
        t.replace_with("\n" + "\n".join(rows) + "\n" if rows else "")


def extract_article_body(container: Tag, number: str) -> tuple[str, str | None, str | None, int]:
    """Retourne (text, html, history, repealed) pour un conteneur d'article.

    * text : verbatim visible, numéro d'article/historique/notes A.M. exclus, alinéas séparés
      par des lignes vides, sous-paragraphes sur leur propre ligne.
    * html : HTML nettoyé du corps (cachés retirés, integrity:* retirés, liens absolus,
      historique retiré ; les notes A.M. sont conservées — rapport §7).
    * history : texte de la ligne d'historique.
    """
    eid = container.get("id")
    work = _soup(str(container))
    root = work.find(id=eid)
    _strip_hidden(root)

    hb = _history_block(root)
    history = _norm(hb.get_text()) if hb else None
    if hb:
        hb.decompose()

    # --- texte : uniquement les alinéas (notes exclues, tableaux rendus lisiblement) ---
    ss_re = re.compile(re.escape(eid) + r"-ss:\d+$")
    text_source = _soup(str(root)).find(id=eid)  # copie dédiée au texte (on va y insérer des \n)
    _strip_notes(text_source)
    _render_tables(text_source)
    text_ss = [d for d in text_source.find_all("div", id=True) if ss_re.fullmatch(d.get("id"))]

    def _strip_leading_number(s: str) -> str:
        return re.sub(r"^" + re.escape(number) + r"\s*\.\s*", "", s, count=1)

    parts: list[str] = []
    if text_ss:
        for k, d in enumerate(text_ss):
            _add_paragraph_breaks(d)
            t = _norm(d.get_text())
            if k == 0:
                t = _strip_leading_number(t)
            if t:
                parts.append(t)
    else:
        # ~34 articles (souvent abrogés) portent le texte directement dans le conteneur
        _add_paragraph_breaks(text_source)
        t = _strip_leading_number(_norm(text_source.get_text()))
        if t:
            parts.append(t)
    text = "\n\n".join(parts)
    repealed = 1 if re.match(r"^\((?:Abrog|Repea)", text) else 0

    # --- html : corps nettoyé, historique retiré, notes conservées ---
    _clean_attrs(root)
    for anchor in root.find_all("a", attrs={"name": True}):
        if not anchor.get_text(strip=True):
            anchor.decompose()
    html = str(root)

    return text, html, history, repealed


# --- extraction de divisions -------------------------------------------------

def extract_division(el: Tag, law_id: str, lang: str, sort_order: int, labels: dict[str, str]) -> Division:
    eid = el.get("id")
    prefix = _segments(eid)[-1].split(":")[0]
    kind = _KIND_BY_PREFIX[prefix]
    seg_value = _segments(eid)[-1].split(":", 1)[1]

    number = heading = history = None
    repealed = 0

    h1 = el.find(id=eid + "-h1")
    if h1 is not None:
        work = _soup(str(h1))
        h1c = work.find(id=eid + "-h1")
        _strip_hidden(h1c)
        hb = _history_block(h1c)
        if hb:
            history = _norm(hb.get_text())
            hb.decompose()
        nb = h1c.find(id=re.compile(re.escape(eid) + r"-h1-t\d+-nb:\d+"))
        if nb is not None:
            heading = _norm(nb.get_text())
        full = _norm(h1c.get_text())
        if heading and heading in full:
            label = full[: full.rfind(heading)].strip()
        else:
            label = full
        repealed = 1 if _REPEALED_RE.search(full) else 0

        word = labels.get(kind)
        if seg_value.startswith("s_"):
            # « DISPOSITION GÉNÉRALE » (s_898_1, s_1119) : pas d'ordinal
            number = None
            if heading is None:
                heading = label or None
        elif word and word in label:
            number = _norm(label.split(word, 1)[1]) or None
        elif kind == "sous-section":
            m = re.match(r"(§\s*[^\s.—]+)", full)
            number = m.group(1).strip() if m else None
            if heading is None:
                it = h1c.find("span", style=re.compile("italic"))
                heading = _norm(it.get_text()) if it else None
        else:  # gf/gg/gi : « I. — », « 1. — »
            m = re.match(r"([IVXLCDM0-9]+)\s*\.", full)
            number = m.group(1) if m else None
            if heading is None:
                it = h1c.find("span", style=re.compile("italic"))
                heading = _norm(it.get_text()) if it else None

        if repealed and number:
            number = _REPEALED_RE.split(number)[0].strip() or None
        if number:
            number = number.rstrip(". ").strip() or None
        if repealed:
            heading = None  # divisions abrogées : intitulé absent

    return Division(
        law_id=law_id, lang=lang, kind=kind, path=eid,
        number=number, heading=heading, history=history, repealed=repealed,
        parent_path=_parent_path(eid), sort_order=sort_order,
    )


# --- dispositions préliminaire / finales (pseudo-articles) -------------------

def _extract_disposition(block: Tag, number: str, heading: str, path: str, kind: str) -> tuple[Division, Article]:
    work = _soup(str(block))
    root = work.find(True)
    _strip_hidden(root)
    hb = _history_block(root)
    history = _norm(hb.get_text()) if hb else None
    if hb:
        hb.decompose()
    # les alinéas des dispositions sont des <div> (pas de -ss:) : les séparer
    for d in root.find_all("div"):
        d.insert_before("\n\n")
    full = _norm(root.get_text())
    full = re.sub(r"^\s*" + re.escape(heading) + r"\s*", "", full, flags=re.S).strip()
    _clean_attrs(root)
    html = str(root)
    div = Division(law_id="", lang="", kind=kind, path=path,
                   number=None, heading=heading, history=None, repealed=0,
                   parent_path=None, sort_order=0)
    art = Article(law_id="", lang="", number=number, text=full, division_path=path,
                  html=html, history=history, repealed=0)
    return div, art


def _parse_preliminary(soup: BeautifulSoup, marker: str) -> tuple[Division, Article] | None:
    ligne = soup.find("div", class_="ligne")
    if ligne is None:
        return None
    node = ligne
    # remonter jusqu'au plus petit ancêtre contenant aussi le titre de la disposition
    while node is not None and node.parent is not None:
        node = node.parent
        if marker in node.get_text():
            return _extract_disposition(node, "préliminaire", marker, "disposition-preliminaire", "disposition")
    return None


_DISP_CANON = {"schedule": "annexe", "form": "formulaire"}


def _disposition_number(heading: str) -> tuple[str, str]:
    """(numéro-slug, kind) d'un bloc `sc-nb:N` d'après son intitulé : DISPOSITIONS FINALES ->
    ('finales','disposition') ; ANNEXE 1 -> ('annexe-1','annexe') ; FORMULAIRE VI ->
    ('formulaire-vi','annexe') ; FORMULES -> ('formules','annexe')."""
    h = normalize(heading or "") or ""
    if "final" in h:
        return "finales", "disposition"
    # label + son 1er repère (romain/chiffre, ou mot comme « abrogative ») — l'en-tête d36e
    # peut contenir un sous-titre après (ex. « ANNEXE I TARIF DES DROITS… »), qu'on écarte.
    m = re.match(r"(annexe|formulaire|formules|schedule|form)\.?\s*([ivxlcdm\d][ivxlcdm\d.]*|[a-z]+)?", h)
    if m:
        # label canonique (FR) pour que l'annexe ait le MÊME numéro en FR et EN
        # (schedule->annexe, form->formulaire) : symétrie inter-langues.
        label = _DISP_CANON.get(m.group(1), m.group(1))
        tokens = [label] + ([m.group(2)] if m.group(2) else [])
        return re.sub(r"[^a-z0-9]+", "-", "-".join(tokens)).strip("-"), "annexe"
    slug = re.sub(r"[^a-z0-9]+", "-", h).strip("-")[:24]
    # un numéro de disposition ne doit JAMAIS être numérique (sinon confusion avec un article
    # réel) : certaines annexes n'ont qu'un numéro en intitulé (c-19 : « 2 »…« 36 »).
    if not slug or re.fullmatch(r"[\d-]+", slug):
        slug = f"annexe-{slug}" if slug else "annexe"
    return slug, "annexe"


def _parse_sc_block_el(cont: Tag, cfg: dict) -> tuple[Division, Article]:
    """Extrait UN bloc `sc-nb:N` (dispositions finales OU annexe/formulaire). Classé et numéroté
    sur l'INTITULÉ (div d'en-tête d36e) — un même EPUB peut avoir sc-nb:1..N (une annexe chacun)."""
    head_el = cont.find(id=re.compile(r"^d\d+e"))
    heading = _norm(head_el.get_text()).split("\n")[0][:50] if head_el else cfg["finales"]
    number, kind = _disposition_number(heading)
    return _extract_disposition(cont, number, heading, number, kind)


# --- pilote OPF / spine ------------------------------------------------------

def _spine_documents(zf: zipfile.ZipFile) -> list[str]:
    """Ordre des documents de contenu d'après container.xml -> OPF -> spine."""
    container = _soup(zf.read("META-INF/container.xml").decode("utf-8"))
    opf_path = container.find("rootfile")["full-path"]
    opf_dir = str(Path(opf_path).parent).replace("\\", "/")
    opf = _soup(zf.read(opf_path).decode("utf-8"))
    manifest = {it["id"]: it["href"] for it in opf.find_all("item")}
    docs = []
    for ref in opf.find("spine").find_all("itemref"):
        href = manifest[ref["idref"]]
        docs.append(f"{opf_dir}/{href}" if opf_dir and opf_dir != "." else href)
    return docs


def opf_metadata(zf: zipfile.ZipFile) -> dict:
    """Métadonnées Dublin Core de l'OPF (title, language, date). Sert à remplir name_en
    depuis l'OPF anglais (§5) et à vérifier langue/date."""
    container = _soup(zf.read("META-INF/container.xml").decode("utf-8"))
    opf = _soup(zf.read(container.find("rootfile")["full-path"]).decode("utf-8"))

    def g(tag: str) -> str | None:
        el = opf.find(tag)
        return _norm(el.get_text()) if el else None

    return {"title": g("dc:title"), "language": g("dc:language"), "date": g("dc:date")}


_HREF_CHAPTER = re.compile(r"showDoc/(?:cs|cr)/([^?\"&/#]+)", re.I)


def harvest_renvois(htmls) -> dict[str, int]:
    """Compte les renvois <a href> vers d'autres chapitres RLRQ, par code de chapitre
    (ex. 'C-11'), agrégés (§3.3 'renvoie-a'). Les liens ont déjà été réécrits en absolu."""
    import urllib.parse
    from collections import Counter
    counts: Counter = Counter()
    for html in htmls:
        for m in _HREF_CHAPTER.finditer(html or ""):
            counts[urllib.parse.unquote(m.group(1)).strip()] += 1
    return dict(counts)


def parse_epub(epub_path: str | Path, law: Law, lang: str) -> tuple[list[Division], list[Article]]:
    """Parse un EPUB LégisQuébec et retourne (divisions, articles) normalisés.

    L'ordre du document fixe `sort_order` des divisions ; la division feuille d'un article
    est la dernière division rencontrée dans le flux (rapport §8, imbrication vérifiée §C4).
    Bilingue : `lang` sélectionne les mots de niveau et les intitulés de disposition.
    """
    cfg = _LANG.get(lang, _LANG["fr"])
    consol = law.consol_date_fr if lang == "fr" else law.consol_date_en
    divisions: list[Division] = []
    articles: list[Article] = []
    sort_order = 0

    disp_idx = 0

    def add_special(res):
        nonlocal sort_order, disp_idx
        if not res:
            return
        div, art = res
        if not art.text and art.number not in ("préliminaire",):
            return  # bloc de disposition sans contenu (en-tête de section, ex. « FORMULES »)
        div.law_id = art.law_id = law.id
        div.lang = art.lang = lang
        div.sort_order = sort_order
        art.consol_date = consol
        # sort_key des pseudo-articles : préliminaire avant tout, finales/annexes après le
        # corpus, dans l'ordre du document (le parseur le fixe ; load.prepare le respecte).
        if art.number == "préliminaire":
            art.sort_key = 0
        else:
            art.sort_key = DISPOSITION_SORT_BASE + disp_idx * 1_000_000
            disp_idx += 1
        sort_order += 1
        divisions.append(div)
        articles.append(art)

    with zipfile.ZipFile(epub_path) as zf:
        for doc in _spine_documents(zf):
            try:
                html = zf.read(doc).decode("utf-8")
            except KeyError:
                continue
            soup = _soup(html)

            # 1) divisions + articles ordinaires (dans l'ordre du document)
            current_div_path: str | None = None
            for el in soup.find_all(id=True):
                eid = el.get("id")
                if is_division_id(eid):
                    div = extract_division(el, law.id, lang, sort_order, cfg["labels"])
                    sort_order += 1
                    divisions.append(div)
                    current_div_path = eid
                elif _ART_ID.fullmatch(eid):
                    text, art_html, history, repealed = extract_article_body(el, number_from_article_id(eid))
                    articles.append(Article(
                        law_id=law.id, lang=lang, number=number_from_article_id(eid),
                        text=text, html=art_html, history=history, repealed=repealed,
                        division_path=current_div_path or "", consol_date=consol,
                    ))

            # 2) blocs spéciaux : disposition préliminaire, puis TOUS les blocs sc-nb:N
            # (dispositions finales et/ou annexes/formulaires — un par bloc).
            if cfg["preliminary"] in html:
                add_special(_parse_preliminary(soup, cfg["preliminary"]))
            for sc in soup.find_all(id=re.compile(r"^sc-nb:\d+$")):
                add_special(_parse_sc_block_el(sc, cfg))

    return divisions, articles
