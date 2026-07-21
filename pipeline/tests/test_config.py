"""Garde-fous sur laws.config.json — le fichier unique décrivant le corpus.

L'ORDRE des lois y est significatif : pipeline.ingest._id_base() dérive la plage d'id
(divisions, articles) de la POSITION de la loi dans la liste. Réordonner le fichier, ou
insérer une loi ailleurs qu'en fin, décale toutes les clés primaires : la prochaine
ingestion écrirait alors les articles d'une loi sur ceux d'une autre, silencieusement.
D'où l'ordre épinglé ci-dessous.
"""
from __future__ import annotations

import unittest

from pipeline import config
from pipeline.ingest import _id_base

# Ordre figé au moment de la fusion des deux configurations. On AJOUTE en fin de liste.
ORDRE_ATTENDU = [
    "ccq", "cpc",
    "c-25.01-r.0.2.01", "c-25.01-r.0.2.2", "c-25.01-r.0.2.3", "c-25.01-r.9", "t-16",
    "t-16-r.10", "c-12", "i-16", "c-25.01-r.0.2.4", "c-25.01-r.0.2.1", "j-3",
    "j-3-r.3.01", "j-3-r.3.2", "i-13.2.2", "b-9", "t-15.01-r.5", "t-15.01",
    "t-15.01-r.6", "p-40.1", "b-1", "b-1-r.3.1", "b-1-r.5", "c-1.1", "c-19", "c-26",
    "c-38", "c-73.2", "e-6.1", "d-9.2", "e-12.000001", "i-14.01", "n-1.1", "p-39.1",
    "p-44.1", "s-31.1", "t-11.002",
    # lot d'extension 2026-07-21 (ajouté EN FIN, comme l'exige _id_base)
    "v-1.1", "a-2.1", "a-32.1", "f-2.1", "c-25.1", "c-67.3", "ccq-r.8", "ccq-r.6",
    "a-33.01",
]


class ConfigTest(unittest.TestCase):
    def test_ordre_fige(self):
        ids = [l["id"] for l in config.load_all_laws()]
        self.assertEqual(
            ids, ORDRE_ATTENDU,
            "L'ordre de laws.config.json a changé : les plages d'id (_id_base) se décalent "
            "et une réingestion écraserait les articles d'autres lois. Ajouter EN FIN de liste.",
        )

    def test_plages_id_disjointes(self):
        """Deux combinaisons (loi, langue) ne doivent jamais partager une plage d'id."""
        vus: dict[int, tuple[str, str]] = {}
        for law in config.load_all_laws():
            for lang in ("fr", "en"):
                base = _id_base(law["id"], lang)
                self.assertNotIn(base, vus, f"plage partagée : {law['id']}/{lang} et {vus.get(base)}")
                vus[base] = (law["id"], lang)

    def test_champs_obligatoires(self):
        for law in config.load_all_laws():
            for champ in ("id", "name_fr", "rlrq_cite", "epub", "consolidation",
                          "consolidation_source", "fonction"):
                self.assertIn(champ, law, f"{law.get('id')} : champ '{champ}' manquant")
            for lang in ("fr", "en"):
                self.assertIn(lang, law["epub"], f"{law['id']} : URL EPUB {lang} manquante")
                # une source juridique sans date de consolidation n'est pas citable
                self.assertTrue(law["consolidation"].get(lang),
                                f"{law['id']} : date de consolidation {lang} manquante")

    def test_ids_uniques(self):
        ids = [l["id"] for l in config.load_all_laws()]
        self.assertEqual(len(ids), len(set(ids)), "identifiants de loi en doublon")

    def test_get_law_couvre_tout_le_corpus(self):
        """Régression : avant la fusion, get_law() ne voyait que ccq/cpc et levait sur les 36."""
        for law_id in ("ccq", "cpc", "t-16", "b-1-r.5", "t-11.002"):
            self.assertEqual(config.get_law(law_id)["id"], law_id)


if __name__ == "__main__":
    unittest.main()
