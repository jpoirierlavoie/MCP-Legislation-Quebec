"""Tests de non-régression bilingues / multi-lois (C.c.Q. + C.p.c., FR + EN).

Lance parse + validation sur les 4 combinaisons et vérifie quelques témoins verbatim.
L'EPUB échantillon (pipeline/samples/, non versionné) est téléchargé si absent.
"""
from __future__ import annotations

import unittest

from pipeline import config, load, validate
from pipeline.ingest import _download, _id_base, _law_from_config, _sample_path
from pipeline.parser import parse_epub

COMBOS = [("ccq", "fr"), ("ccq", "en"), ("cpc", "fr"), ("cpc", "en")]
_cache: dict[tuple[str, str], tuple] = {}


def corpus(law_id: str, lang: str):
    if (law_id, lang) not in _cache:
        cfg = config.get_law(law_id)
        law = _law_from_config(cfg)
        epub = _sample_path(law_id, lang)
        if not epub.exists():
            try:
                _download(cfg["epub"][lang], epub)
            except Exception as e:  # pragma: no cover
                raise unittest.SkipTest(f"EPUB {law_id}/{lang} indisponible : {e}")
        divs, arts = parse_epub(epub, law, lang)
        load.prepare(law, divs, arts, id_base=_id_base(law_id, lang))
        _cache[(law_id, lang)] = (law, divs, arts, {a.number: a for a in arts})
    return _cache[(law_id, lang)]


class CorpusTest(unittest.TestCase):
    def test_invariants_all_combos(self):
        for law_id, lang in COMBOS:
            with self.subTest(law=law_id, lang=lang):
                _, divs, arts, _ = corpus(law_id, lang)
                rep = validate.validate(law_id, lang, divs, arts)
                self.assertTrue(rep.ok, f"{law_id}/{lang}\n" + "\n".join(rep.lines))

    def test_fr_en_symmetry(self):
        # FR et EN d'une même loi ont les mêmes numéros d'articles (même loi, traduite)
        for law_id in ("ccq", "cpc"):
            *_, fr = corpus(law_id, "fr")
            *_, en = corpus(law_id, "en")
            self.assertEqual(set(fr), set(en), f"{law_id}: numéros FR ≠ EN")

    def test_ccq_en_witnesses(self):
        _, _, _, by = corpus("ccq", "en")
        self.assertTrue(by["1"].text.startswith("Every human being possesses juridical personality"))
        self.assertEqual(by["106"].text, "(Repealed).")
        self.assertEqual(by["106"].repealed, 1)
        self.assertTrue(by["1457"].text.startswith("Every person has a duty to abide by the rules of conduct"))

    def test_cpc_fr_witnesses(self):
        _, _, _, by = corpus("cpc", "fr")
        self.assertTrue(by["1"].text.startswith("Les modes privés de prévention"))
        self.assertIn("836", by)          # dernier article
        self.assertNotIn("837", by)

    def test_cpc_en_witnesses(self):
        _, _, _, by = corpus("cpc", "en")
        self.assertTrue(by["1"].text.startswith("To prevent a potential dispute"))

    def test_cpc_annexe(self):
        # l'annexe (convention de La Haye) est un pseudo-article, dans les 2 langues
        for lang, marker in (("fr", "annexe"), ("en", "Schedule")):
            _, _, _, by = corpus("cpc", lang)
            self.assertIn("annexe", by)
            self.assertIn(marker, by["annexe"].history or "")
        # le C.c.Q. n'a PAS d'annexe (son bloc sc-nb:1 = dispositions finales)
        _, _, _, ccq = corpus("ccq", "fr")
        self.assertNotIn("annexe", ccq)
        self.assertIn("finales", ccq)

    def test_globally_unique_ids(self):
        # les id de divisions/articles ne doivent pas entrer en collision entre combos
        div_ids: set[int] = set()
        art_ids: set[int] = set()
        for law_id, lang in COMBOS:
            _, divs, arts, _ = corpus(law_id, lang)
            d = {x.id for x in divs}
            a = {x.id for x in arts}
            self.assertTrue(div_ids.isdisjoint(d), f"collision id division sur {law_id}/{lang}")
            self.assertTrue(art_ids.isdisjoint(a), f"collision id article sur {law_id}/{lang}")
            div_ids |= d
            art_ids |= a


if __name__ == "__main__":
    unittest.main()
