"""Tests de non-régression du parseur sur le C.c.Q. FR (invariants phase 0 + témoins verbatim).

Lancer :  python -m unittest pipeline.tests.test_ccq_fr   (ou pytest)

L'EPUB échantillon (pipeline/samples/, non versionné) est téléchargé si absent.
"""
from __future__ import annotations

import unittest

from pipeline import config, load, validate
from pipeline.ingest import _download, _law_from_config, _sample_path
from pipeline.model import sort_key
from pipeline.parser import parse_epub

LAW_ID, LANG = "ccq", "fr"


class CcqFrTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cfg = config.get_law(LAW_ID)
        cls.law = _law_from_config(cfg)
        epub = _sample_path(LAW_ID, LANG)
        if not epub.exists():
            _download(cfg["epub"][LANG], epub)
        cls.divisions, cls.articles = parse_epub(epub, cls.law, LANG)
        load.prepare(cls.law, cls.divisions, cls.articles)
        cls.by_num = {a.number: a for a in cls.articles}

    # --- invariants globaux ---
    def test_invariants(self):
        rep = validate.validate(LAW_ID, LANG, self.divisions, self.articles)
        self.assertTrue(rep.ok, "\n".join(rep.lines))

    def test_article_range_complete(self):
        ints = sorted(int(a.number) for a in self.articles if a.number.isdigit())
        self.assertEqual((ints[0], ints[-1]), (1, 3168))
        self.assertEqual(len(ints), 3168, "lacune ou doublon dans les entiers")

    # --- témoins verbatim ---
    def test_article_1(self):
        a = self.by_num["1"]
        self.assertEqual(
            a.text,
            "Tout être humain possède la personnalité juridique; "
            "il a la pleine jouissance des droits civils.")
        self.assertEqual(a.history, "1991, c. 64, a. 1.")
        self.assertEqual(a.repealed, 0)

    def test_article_1457_three_alineas(self):
        a = self.by_num["1457"]
        self.assertTrue(a.text.startswith("Toute personne a le devoir de respecter"))
        self.assertEqual(a.text.count("\n\n"), 2, "1457 doit avoir 3 alinéas")
        self.assertIn("qu’il soit corporel, moral ou matériel.", a.text)
        self.assertEqual(a.history, "1991, c. 64, a. 1457.")

    def test_article_106_repealed(self):
        a = self.by_num["106"]
        self.assertEqual(a.text, "(Abrogé).")
        self.assertEqual(a.repealed, 1)
        self.assertEqual(a.history, "1991, c. 64, a. 106; 2013, c. 27, a. 7.")

    def test_decimals_present(self):
        for num in ("2926.1", "132.0.1", "521.1", "898.1"):
            self.assertIn(num, self.by_num, f"article décimal {num} manquant")
        # l'exemple faux du PLAN d'origine ne doit PAS exister
        self.assertNotIn("1615.1", self.by_num)

    def test_no_hidden_leak_in_history(self):
        # historique exact = aucune date dupliquée (fuite de span caché exclue)
        a = self.by_num["2926.1"]
        self.assertEqual(a.history, "2013, c. 8, a. 7; 2020, c. 13, a. 2; 2020, c. 28, a. 6; "
                                    "2021, c. 13, a. 175; 2022, c. 22, a. 120.")

    def test_dispositions_pseudo_articles(self):
        prelim = self.by_num["préliminaire"]
        self.assertTrue(prelim.text.startswith("Le Code civil du Québec régit"))
        self.assertEqual(prelim.text.count("\n\n"), 1, "préliminaire = 2 alinéas")
        self.assertNotIn("DISPOSITION PRÉLIMINAIRE", prelim.text)
        self.assertEqual(prelim.history, "1991, c. 64, préam.; 2022, c. 14, a. 123.")
        finales = self.by_num["finales"]
        self.assertTrue(finales.text.startswith("Le présent code remplace"))

    # --- clés de tri ---
    def test_sort_key_ordering(self):
        self.assertLess(sort_key("898"), sort_key("898.1"))
        self.assertLess(sort_key("898.1"), sort_key("899"))
        self.assertLess(sort_key("2926"), sort_key("2926.1"))
        self.assertLess(sort_key("2926.1"), sort_key("2927"))
        self.assertLess(sort_key("132"), sort_key("132.0.1"))
        self.assertLess(sort_key("132.0.1"), sort_key("133"))
        self.assertEqual(sort_key("préliminaire"), 0)
        self.assertLess(sort_key("3168"), sort_key("finales"))

    # --- divisions ---
    def test_division_of_1457(self):
        a = self.by_num["1457"]
        d = next(d for d in self.divisions if d.id == a.division_id)
        self.assertEqual(d.kind, "sous-section")
        self.assertEqual(d.path, "ga:l_cinquieme-gb:l_premier-gc:l_troisieme-gd:l_i-ge:l_1")

    def test_repealed_divisions(self):
        rep = [d for d in self.divisions if d.repealed]
        self.assertEqual(len(rep), 4)


if __name__ == "__main__":
    unittest.main()
