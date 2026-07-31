"""Validation du chargeur de curation (phase 3 v2) — SANS réseau ni base.

POURQUOI CE FICHIER EXISTE. `pipeline/discovery/` n'avait AUCUN test : ni load.py, ni
migrate.py, ni verify.py, ni relations.py. Autrement dit, la fonction la plus proche d'une
porte anti-données-fausses — celle qui refuse un chargement — n'était elle-même gardée par
rien. Sur un outil juridique, un validateur qui cesse de valider est indétectable : le
chargement réussit, et du contenu non relu part en production.

MÉTHODE. `validate()` ne parle à la base que par trois requêtes de lecture (laws,
divisions, articles). On lui passe une fausse base en mémoire : aucun réseau, aucun
wrangler, aucun D1. Éligible à la CI, contrairement aux tests du parseur.
"""
from __future__ import annotations

import unittest

from pipeline.discovery.curation import charger, validate

# Corpus factice minimal : deux lois, trois divisions, trois articles.
_LAWS = [{"id": "ccq"}, {"id": "cpc"}]
_DIVS = [
    {"law_id": "ccq", "lang": "fr", "path": "ga:l_dixieme"},
    {"law_id": "ccq", "lang": "en", "path": "ga:l_ten"},
    {"law_id": "cpc", "lang": "fr", "path": "ga:l_v-gb:l_iv"},
]
_ARTS = [
    {"law_id": "ccq", "lang": "fr", "number": "1726"},
    {"law_id": "ccq", "lang": "fr", "number": "1739"},
    {"law_id": "cpc", "lang": "fr", "number": "490"},
]


class FausseBase:
    """Rend les trois SELECT de validate(), et journalise les écritures de charger()."""

    name = "fausse"

    def __init__(self):
        self.ecritures: list[str] = []

    def run(self, sql: str):
        s = " ".join(sql.split()).lower()
        if s.startswith("select id from laws"):
            return _LAWS
        if "from divisions" in s:
            return _DIVS
        if "from articles" in s:
            return _ARTS
        self.ecritures.append(sql)
        return []


LIEN_OK = {
    "law_a": "ccq", "path_a": "ga:l_dixieme",
    "law_b": "cpc", "path_b": "ga:l_v-gb:l_iv",
    "rel_type": "compagnon", "lang": "fr",
    "note": "Droit international privé : siège substantiel et siège procédural.",
    "validated": False,
}
CONCEPT_OK = {
    "concept": "vice caché", "variantes": ["vice cache", "defaut cache"],
    "cibles": [{"law": "ccq", "articles": ["1726", "1739"]}],
    "lang": "fr", "validated": False,
}


def viol(links=(), concepts=()) -> list[str]:
    return validate(FausseBase(), list(links), list(concepts))


class TestValidationAccepte(unittest.TestCase):
    def test_entrees_correctes(self):
        self.assertEqual(viol([LIEN_OK], [CONCEPT_OK]), [])

    def test_cible_par_chemin(self):
        c = {**CONCEPT_OK, "cibles": [{"law": "ccq", "path": "ga:l_dixieme"}]}
        self.assertEqual(viol([], [c]), [])

    def test_rien_a_charger(self):
        self.assertEqual(viol([], []), [])


class TestValidationRefuse(unittest.TestCase):
    """Chaque contrôle DOIT rougir : un validateur qui ne refuse rien ne valide rien."""

    def _refuse(self, motif: str, links=(), concepts=()):
        v = viol(links, concepts)
        self.assertTrue(v, f"aucune violation levée pour : {motif}")
        return " | ".join(v)

    def test_loi_inconnue(self):
        m = self._refuse("loi absente", [{**LIEN_OK, "law_a": "zzz"}])
        self.assertIn("absente du corpus", m)

    def test_division_introuvable(self):
        m = self._refuse("chemin fantôme", [{**LIEN_OK, "path_a": "ga:l_inexistant"}])
        self.assertIn("introuvable", m)

    def test_division_de_la_mauvaise_langue(self):
        # `ga:l_ten` existe, mais en ANGLAIS. Les chemins Irosoft sont propres à la langue
        # (invariant 4) : un lien FR pointant un chemin EN serait muet, pas faux — donc
        # invisible sans ce contrôle.
        m = self._refuse("chemin EN sous lang=fr", [{**LIEN_OK, "path_a": "ga:l_ten"}])
        self.assertIn("introuvable", m)

    def test_article_cible_inexistant(self):
        c = {**CONCEPT_OK, "cibles": [{"law": "ccq", "articles": ["9999"]}]}
        m = self._refuse("article fantôme", [], [c])
        self.assertIn("article 9999 introuvable", m)

    def test_rel_type_hors_vocabulaire(self):
        m = self._refuse("rel_type libre", [{**LIEN_OK, "rel_type": "cousin"}])
        self.assertIn("rel_type", m)

    def test_doublon_de_cle(self):
        m = self._refuse("clé en double", [LIEN_OK, dict(LIEN_OK)])
        self.assertIn("doublon", m)

    def test_lien_vers_soi_meme(self):
        lien = {**LIEN_OK, "law_b": "ccq", "path_b": "ga:l_dixieme"}
        m = self._refuse("auto-référence", [lien])
        self.assertIn("elle-même", m)

    def test_drapeau_validated_absent(self):
        sans = {k: x for k, x in LIEN_OK.items() if k != "validated"}
        m = self._refuse("validated absent", [sans])
        self.assertIn("validated", m)

    def test_concept_en_double(self):
        m = self._refuse("concept répété", [], [CONCEPT_OK, dict(CONCEPT_OK)])
        self.assertIn("double", m)

    def test_variante_non_normalisee(self):
        # Les variantes sont une SURFACE D'APPARIEMENT (invariant 13) : la casse doit être
        # normalisée. Les accents, eux, n'ont pas à l'être — remove_diacritics est ACTIF.
        c = {**CONCEPT_OK, "variantes": ["Vice Caché"]}
        m = self._refuse("variante en capitales", [], [c])
        self.assertIn("non normalisée", m)

    def test_variantes_vides(self):
        self._refuse("aucune variante", [], [{**CONCEPT_OK, "variantes": []}])

    def test_cible_sans_path_ni_articles(self):
        c = {**CONCEPT_OK, "cibles": [{"law": "ccq"}]}
        m = self._refuse("cible creuse", [], [c])
        self.assertIn("sans 'path' ni 'articles'", m)

    def test_toutes_les_violations_sont_listees(self):
        # Corriger un brouillon de 200 lignes une erreur à la fois serait intenable :
        # validate() doit rendre TOUT, pas la première violation.
        v = viol([{**LIEN_OK, "law_a": "zzz", "law_b": "yyy"}])
        self.assertGreaterEqual(len(v), 2, f"une seule violation rendue : {v}")


class TestChargement(unittest.TestCase):
    def test_le_drapeau_est_recopie_tel_quel(self):
        db = FausseBase()
        charger(db, [LIEN_OK, {**LIEN_OK, "path_b": "ga:l_dixieme", "law_b": "ccq",
                               "validated": True}], [])
        sql = "\n".join(db.ecritures)
        self.assertIn("DELETE FROM division_links", sql)
        self.assertIn(", 0)", sql, "une entrée non validée doit arriver avec validated=0")
        self.assertIn(", 1)", sql, "une entrée validée doit arriver avec validated=1")

    def test_json_imbrique_conserve_les_accents(self):
        # ensure_ascii=False : une variante rendue en \\uXXXX ne s'apparierait plus.
        db = FausseBase()
        charger(db, [], [{**CONCEPT_OK, "variantes": ["extranéité"]}])
        self.assertIn("extranéité", "\n".join(db.ecritures))

    def test_apostrophe_echappee(self):
        db = FausseBase()
        charger(db, [], [{**CONCEPT_OK, "note": "l'ouvrage"}])
        self.assertIn("l''ouvrage", "\n".join(db.ecritures))


if __name__ == "__main__":
    unittest.main()
