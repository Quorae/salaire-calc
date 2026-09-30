"""
Tests du moteur Python : mêmes cas de référence que test.js.
`python3 -m unittest api.test_calc` ou `python3 -m pytest api/test_calc.py`
"""

import unittest

from . import calc as C


def ligne(r, id_):
    return next(l for l in r["lignes"] if l["id"] == id_)


class TestCalc(unittest.TestCase):
    def proche(self, reel, attendu, tolerance, message):
        self.assertLessEqual(abs(reel - attendu), tolerance, f"{message} : obtenu {reel}, attendu {attendu} ± {tolerance}")

    def test_smic_brut_vers_net_officiel(self):
        """SMIC 1 867,02 € brut → net social 1 477,93 € (net SMIC officiel 2026)"""
        r = C.calculer(1867.02)
        self.proche(r["netSocial"], 1478, 5, "net social SMIC")
        self.assertEqual(r["netSocial"], C.SMIC["mensuelNet"])

    def test_3000_brut_non_cadre(self):
        """3 000 € brut non-cadre à 100 % → net social 2 374,79 €, net imposable 2 460,27 €"""
        r = C.calculer(3000, cadre=False, temps_travail=1)
        self.assertEqual(r["netSocial"], 2374.79)
        self.assertEqual(r["netImposable"], 2460.27)
        self.proche(r["netSocial"] / 3000, C.SMIC["mensuelNet"] / C.SMIC["mensuelBrut"], 1e-5, "ratio net/brut identique au SMIC")

    def test_taux_neutre_2400(self):
        """taux neutre : 2 400 € de net imposable → 5,3 %"""
        self.assertEqual(C.taux_neutre(2400), 5.3)

    def test_taux_neutre_bornes_incluses(self):
        """taux neutre : bornes inférieures incluses"""
        self.assertEqual(C.taux_neutre(1634.99), 0)
        self.assertEqual(C.taux_neutre(1635), 0.5)
        self.assertEqual(C.taux_neutre(3570.5), 9.9)
        self.assertEqual(C.taux_neutre(3571), 11.9)
        self.assertEqual(C.taux_neutre(55557.99), 38)
        self.assertEqual(C.taux_neutre(55558), 43)

    def test_cadre_au_dessus_du_pmss(self):
        """cadre au-dessus du PMSS : tranche 2, CET et APEC"""
        r = C.calculer(6000, cadre=True)
        self.assertEqual(ligne(r, "agircArrcoT1")["assiette"], 4005)
        self.assertEqual(ligne(r, "agircArrcoT2")["assiette"], 1995)
        self.assertEqual(ligne(r, "agircArrcoT2")["montant"], 172.37)
        self.assertEqual(ligne(r, "cegT2")["montant"], 21.55)
        self.assertEqual(ligne(r, "cet")["montant"], 8.4)
        self.assertEqual(ligne(r, "apec")["montant"], 1.44)

        non_cadre = C.calculer(6000, cadre=False)
        self.assertEqual(ligne(non_cadre, "cet")["montant"], 0)
        self.assertEqual(ligne(non_cadre, "apec")["montant"], 0)

    def test_plafonds_tranche_2_et_abattement_csg(self):
        """tranche 2 plafonnée à 8 PMSS, abattement CSG limité à 4 PMSS"""
        r = C.calculer(40000, cadre=True)
        self.assertEqual(ligne(r, "agircArrcoT2")["assiette"], 7 * 4005)
        self.assertEqual(ligne(r, "apec")["assiette"], 4 * 4005)

        r2 = C.calculer(20000)
        self.assertEqual(ligne(r2, "csgDeductible")["assiette"], C.arrondi(0.9825 * 16020 + (20000 - 16020)))

    def test_temps_partiel(self):
        """temps partiel : brut et PMSS proratisés"""
        r = C.calculer(6000, temps_travail=0.5)
        self.assertEqual(r["brut"], 3000)
        self.assertEqual(r["pmss"], 2002.5)
        self.assertEqual(ligne(r, "vieillessePlafonnee")["assiette"], 2002.5)
        self.assertEqual(ligne(r, "agircArrcoT2")["assiette"], 997.5)

    def test_net_imposable(self):
        """net imposable = net social + CSG non déductible + CRDS"""
        r = C.calculer(4321.5, cadre=True)
        attendu = r["netSocial"] + ligne(r, "csgNonDeductible")["montant"] + ligne(r, "crds")["montant"]
        self.proche(r["netImposable"], attendu, 0.001, "net imposable")

    def test_parts_quotient_familial(self):
        """parts de quotient familial"""
        self.assertEqual(C.nombre_de_parts(False, 0), 1)
        self.assertEqual(C.nombre_de_parts(True, 0), 2)
        self.assertEqual(C.nombre_de_parts(False, 1), 1.5)
        self.assertEqual(C.nombre_de_parts(True, 2), 3)
        self.assertEqual(C.nombre_de_parts(True, 3), 4)
        self.assertEqual(C.nombre_de_parts(True, 4), 5)

    def test_bareme_ir(self):
        """barème IR : abattement 10 % (min 504, max 14 555), tranches, TMI"""
        celib = C.estimer_impot(30000, 1)
        self.assertEqual(celib["abattement"], 3000)
        self.assertEqual(celib["impot"], C.js_round((27000 - 11600) * 0.11))
        self.assertEqual(celib["tmi"], 0.11)

        self.assertEqual(C.estimer_impot(4000, 1)["abattement"], 504)
        self.assertEqual(C.estimer_impot(4000, 1)["impot"], 0)
        self.assertEqual(C.estimer_impot(200000, 1)["abattement"], 14555)

        # 100 000 € pour un couple (2 parts) : quotient 45 000 €, TMI 30 %
        couple = C.estimer_impot(100000, 2)
        par_part = (29579 - 11600) * 0.11 + (45000 - 29579) * 0.30
        self.assertEqual(couple["impot"], C.js_round(par_part * 2))
        self.assertEqual(couple["tmi"], 0.30)

    def test_mode_bareme(self):
        """mode barème : le PAS mensuel correspond à 1/12 de l'impôt estimé"""
        r = C.calculer(5000, pas={"mode": "bareme", "enCouple": False, "enfants": 0})
        self.proche(r["prelevement"], r["ir"]["impot"] / 12, 0.01, "PAS mensuel")
        self.proche(r["tauxPas"], r["ir"]["impot"] / r["annuel"]["netImposable"], 1e-6, "taux effectif")

    def test_mode_personnalise(self):
        """mode personnalisé : taux appliqué au net imposable"""
        r = C.calculer(3000, pas={"mode": "personnalise", "taux": 10})
        self.assertEqual(r["prelevement"], 246.03)
        self.assertEqual(r["netApresImpot"], C.arrondi(r["netSocial"] - 246.03))

    def test_mode_inverse(self):
        """mode inversé : retrouve le brut à partir du net"""
        self.assertEqual(C.brut_pour_net(2374.79, {}, "netSocial"), 3000)

        params = {"cadre": True, "temps_travail": 1, "pas": {"mode": "neutre"}}
        brut = C.brut_pour_net(4200, params, "netApresImpot")
        self.assertGreaterEqual(C.calculer(brut, **params)["netApresImpot"], 4200)
        self.assertLess(C.calculer(brut - 0.01, **params)["netApresImpot"], 4200)

        self.assertIsNone(C.brut_pour_net(1000, {"pas": {"mode": "personnalise", "taux": 100}}))


if __name__ == "__main__":
    unittest.main()
