"""
Moteur de calcul salaire brut → net, barèmes 2026.
Portage fidèle de calc.js : mêmes constantes, mêmes étapes, mêmes arrondis.
Taux internes en fraction (0,069 = 6,9 %), sauf la grille du taux neutre (en %).
"""

import math
import sys

PMSS = 4005

SMIC = {"horaireBrut": 12.31, "mensuelBrut": 1867.02, "mensuelNet": 1477.93}

TAUX = {
    "vieillessePlafonnee": 0.069,
    "vieillesseDeplafonnee": 0.004,
    "agircArrcoT1": 0.0315,
    "agircArrcoT2": 0.0864,
    "cegT1": 0.0086,
    "cegT2": 0.0108,
    "cet": 0.0014,
    "apec": 0.00024,
    "csgDeductible": 0.068,
    "csgNonDeductible": 0.024,
    "crds": 0.005,
}

ABATTEMENT_CSG = 0.0175

# Grille du taux neutre (métropole) : [borne inférieure incluse, taux en %].
# Chaque tranche court jusqu'à la borne inférieure de la suivante (exclue).
GRILLE_TAUX_NEUTRE = [
    (0, 0), (1635, 0.5), (1698, 1.3), (1807, 2.1), (1928, 2.9), (2060, 3.5),
    (2170, 4.1), (2315, 5.3), (2738, 7.5), (3135, 9.9), (3571, 11.9), (4019, 13.8),
    (4690, 15.8), (5624, 17.9), (7037, 20), (8789, 24), (12200, 28), (16523, 33),
    (25937, 38), (55558, 43),
]

# Barème IR 2026 (revenus 2025) par part : [seuil, taux marginal au-delà du seuil].
BAREME_IR = [(0, 0), (11600, 0.11), (29579, 0.30), (84577, 0.41), (181917, 0.45)]

ABATTEMENT_FRAIS_PRO = {"taux": 0.10, "min": 504, "max": 14555}


def js_round(x):
    """Math.round de JavaScript : au plus proche, demi vers +∞ (round() de Python arrondit au pair)."""
    entier = math.floor(x)
    return entier + 1 if x - entier >= 0.5 else entier


def arrondi(x):
    return js_round((x + sys.float_info.epsilon) * 100) / 100


def borner(x, mini, maxi):
    return min(max(x, mini), maxi)


def somme(valeurs):
    """Somme de gauche à droite, comme reduce en JS (sum() compense les erreurs depuis Python 3.12)."""
    total = 0
    for v in valeurs:
        total += v
    return total


def taux_neutre(net_imposable_mensuel):
    taux = 0
    for seuil, t in GRILLE_TAUX_NEUTRE:
        if net_imposable_mensuel >= seuil:
            taux = t
        else:
            break
    return taux


def nombre_de_parts(en_couple, enfants):
    n = max(0, math.floor(enfants or 0))
    return (2 if en_couple else 1) + 0.5 * min(n, 2) + max(0, n - 2)


def estimer_impot(revenu_imposable_annuel, parts):
    """
    Impôt annuel estimé pour un revenu net imposable (celui de la fiche de paie, avant abattement 10 %).
    Hors décote et plafonnement du quotient familial.
    """
    revenu = max(0, revenu_imposable_annuel)
    abattement = min(
        borner(revenu * ABATTEMENT_FRAIS_PRO["taux"], ABATTEMENT_FRAIS_PRO["min"], ABATTEMENT_FRAIS_PRO["max"]),
        revenu,
    )
    revenu_net_imposable = revenu - abattement
    quotient = revenu_net_imposable / parts

    impot_par_part = 0
    tmi = 0
    for i, (seuil, t) in enumerate(BAREME_IR):
        plafond = BAREME_IR[i + 1][0] if i + 1 < len(BAREME_IR) else math.inf
        if quotient > seuil:
            impot_par_part += (min(quotient, plafond) - seuil) * t
            tmi = t

    impot = js_round(impot_par_part * parts)
    return {
        "abattement": arrondi(abattement),
        "revenuNetImposable": arrondi(revenu_net_imposable),
        "parts": parts,
        "quotient": arrondi(quotient),
        "impot": impot,
        "tmi": tmi,
        "tauxEffectif": impot / revenu if revenu > 0 else 0,
    }


def calculer(brut_mensuel, cadre=False, temps_travail=1, pas=None):
    """
    brut_mensuel : brut mensuel temps plein ; temps_travail : fraction (0,8 = 80 %),
    appliquée au brut et au PMSS.
    pas : {"mode": "neutre"} | {"mode": "personnalise", "taux": <en %>}
        | {"mode": "bareme", "enCouple": bool, "enfants": int}
    """
    pas = pas or {"mode": "neutre"}
    quotite = borner(temps_travail, 0.01, 1)
    brut = arrondi(max(0, brut_mensuel or 0) * quotite)
    pmss = PMSS * quotite

    t1 = min(brut, pmss)
    t2 = borner(brut - pmss, 0, 7 * pmss)
    assiette_csg = (1 - ABATTEMENT_CSG) * min(brut, 4 * pmss) + max(0, brut - 4 * pmss)

    lignes = [
        {"id": "vieillessePlafonnee", "groupe": "secu", "libelle": "Vieillesse plafonnée", "assiette": t1},
        {"id": "vieillesseDeplafonnee", "groupe": "secu", "libelle": "Vieillesse déplafonnée", "assiette": brut},
        {"id": "agircArrcoT1", "groupe": "retraite", "libelle": "Agirc-Arrco tranche 1", "assiette": t1},
        {"id": "agircArrcoT2", "groupe": "retraite", "libelle": "Agirc-Arrco tranche 2", "assiette": t2},
        {"id": "cegT1", "groupe": "retraite", "libelle": "CEG tranche 1", "assiette": t1},
        {"id": "cegT2", "groupe": "retraite", "libelle": "CEG tranche 2", "assiette": t2},
        {"id": "cet", "groupe": "retraite", "libelle": "CET", "assiette": t1 + t2 if cadre else 0, "cadreSeulement": True},
        {"id": "apec", "groupe": "retraite", "libelle": "APEC", "assiette": min(brut, 4 * pmss) if cadre else 0, "cadreSeulement": True},
        {"id": "csgDeductible", "groupe": "csg", "libelle": "CSG déductible", "assiette": assiette_csg},
        {"id": "csgNonDeductible", "groupe": "csg", "libelle": "CSG non déductible", "assiette": assiette_csg},
        {"id": "crds", "groupe": "csg", "libelle": "CRDS", "assiette": assiette_csg},
    ]
    for ligne in lignes:
        ligne["taux"] = TAUX[ligne["id"]]
        ligne["montant"] = arrondi(ligne["assiette"] * ligne["taux"])
        ligne["assiette"] = arrondi(ligne["assiette"])

    montants = {ligne["id"]: ligne["montant"] for ligne in lignes}
    cotisations = arrondi(somme(ligne["montant"] for ligne in lignes))
    net_social = arrondi(brut - cotisations)
    net_imposable = arrondi(net_social + montants["csgNonDeductible"] + montants["crds"])

    ir = None
    if pas["mode"] == "personnalise":
        taux = borner(_nombre_ou_zero(pas.get("taux")), 0, 100) / 100
    elif pas["mode"] == "bareme":
        ir = estimer_impot(net_imposable * 12, nombre_de_parts(pas.get("enCouple"), pas.get("enfants")))
        taux = ir["tauxEffectif"]
    else:
        taux = taux_neutre(net_imposable) / 100

    prelevement = arrondi(net_imposable * taux)
    net_apres_impot = arrondi(net_social - prelevement)

    return {
        "brut": brut,
        "pmss": pmss,
        "lignes": lignes,
        "cotisations": cotisations,
        "tauxCotisations": cotisations / brut if brut > 0 else 0,
        "netSocial": net_social,
        "netImposable": net_imposable,
        "tauxPas": taux,
        "prelevement": prelevement,
        "netApresImpot": net_apres_impot,
        "ir": ir,
        "annuel": {
            "brut": arrondi(brut * 12),
            "cotisations": arrondi(cotisations * 12),
            "netSocial": arrondi(net_social * 12),
            "netImposable": arrondi(net_imposable * 12),
            "prelevement": arrondi(prelevement * 12),
            "netApresImpot": arrondi(net_apres_impot * 12),
        },
    }


def brut_pour_net(net_cible, params, cible="netApresImpot"):
    """
    Mode inversé : brut mensuel temps plein nécessaire pour atteindre net_cible (mensuel).
    cible : "netSocial" (avant impôt) ou "netApresImpot". Dichotomie au centime.
    Avec le taux neutre, le net après impôt fait des sauts aux changements de tranche :
    on renvoie alors le plus petit brut trouvé qui atteint la cible. None si inatteignable.
    params : arguments nommés de calculer() hors brut_mensuel.
    """
    if not net_cible > 0:
        return 0

    def net_de(centimes):
        return calculer(brut_mensuel=centimes / 100, **params)[cible]

    bas = 0
    haut = math.ceil(net_cible * 200)
    while net_de(haut) < net_cible:
        bas = haut
        haut *= 2
        if haut > 1e12:
            return None
    while haut - bas > 1:
        milieu = (bas + haut) // 2
        if net_de(milieu) >= net_cible:
            haut = milieu
        else:
            bas = milieu
    return haut / 100


def _nombre_ou_zero(valeur):
    """Number(x) || 0 : NaN, None et valeurs non numériques donnent 0."""
    try:
        n = float(valeur)
    except (TypeError, ValueError):
        return 0
    return 0 if math.isnan(n) else n
