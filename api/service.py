"""
Couche commune à l'API REST et au serveur MCP : validation des entrées,
appel du moteur (calc.py) et mise en forme des résultats.
Montants en euros, taux exprimés en %.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from . import calc

MONTANT_MAX = 1_000_000

BrutMensuel = Annotated[float, Field(
    gt=0, le=MONTANT_MAX, allow_inf_nan=False,
    description="Salaire brut mensuel temps plein, en euros.",
)]
NetCible = Annotated[float, Field(
    gt=0, le=MONTANT_MAX, allow_inf_nan=False,
    description="Net mensuel visé, en euros (avant ou après impôt selon « cible »).",
)]
Cible = Annotated[Literal["net_apres_impot", "net_social"], Field(
    description="Net visé par net_cible : après prélèvement à la source (défaut) ou avant impôt.",
)]
Cadre = Annotated[bool, Field(description="Statut cadre : ajoute les cotisations CET et APEC.")]
TempsPct = Annotated[float, Field(
    ge=1, le=100, allow_inf_nan=False,
    description="Temps de travail en % (100 = temps plein) ; proratise le brut et le PMSS.",
)]
PasMode = Annotated[Literal["neutre", "personnalise", "estimation"], Field(
    description=(
        "Taux du prélèvement à la source : grille du taux neutre, taux personnalisé (taux_perso) "
        "ou estimation par le barème de l'impôt sur le revenu (marie, enfants)."
    ),
)]
TauxPerso = Annotated[float | None, Field(
    ge=0, le=100, allow_inf_nan=False,
    description="Taux de prélèvement personnalisé en %, obligatoire si pas_mode = personnalise.",
)]
Marie = Annotated[bool, Field(description="Marié ou pacsé (2 parts). Uniquement si pas_mode = estimation.")]
Enfants = Annotated[int, Field(ge=0, le=20, description="Enfants à charge. Uniquement si pas_mode = estimation.")]

CIBLES = {"net_apres_impot": "netApresImpot", "net_social": "netSocial"}


class EntreeInvalide(ValueError):
    """Entrée valide en forme mais sans résultat possible (net inatteignable)."""


class DemandeCalcul(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    brut_mensuel: BrutMensuel | None = None
    net_cible: NetCible | None = None
    cible: Cible = "net_apres_impot"
    cadre: Cadre = False
    temps_pct: TempsPct = 100
    pas_mode: PasMode = "neutre"
    taux_perso: TauxPerso = None
    marie: Marie = False
    enfants: Enfants = 0

    @model_validator(mode="after")
    def verifier_coherence(self):
        # PydanticCustomError plutôt que ValueError : le message sort sans préfixe « Value error, ».
        if (self.brut_mensuel is None) == (self.net_cible is None):
            raise PydanticCustomError("coherence", "renseigner exactement un des deux champs brut_mensuel ou net_cible")
        if self.pas_mode == "personnalise" and self.taux_perso is None:
            raise PydanticCustomError("coherence", "taux_perso est obligatoire quand pas_mode vaut « personnalise »")
        if self.pas_mode != "personnalise" and self.taux_perso is not None:
            raise PydanticCustomError("coherence", "taux_perso n'est accepté que si pas_mode vaut « personnalise »")
        if self.pas_mode != "estimation" and (self.marie or self.enfants):
            raise PydanticCustomError("coherence", "marie et enfants ne sont acceptés que si pas_mode vaut « estimation »")
        return self


def pct(fraction):
    return round(fraction * 100, 4)


def calculer_salaire(demande: DemandeCalcul) -> dict[str, Any]:
    pas = {"mode": "neutre"}
    if demande.pas_mode == "personnalise":
        pas = {"mode": "personnalise", "taux": demande.taux_perso}
    elif demande.pas_mode == "estimation":
        pas = {"mode": "bareme", "enCouple": demande.marie, "enfants": demande.enfants}
    params = {"cadre": demande.cadre, "temps_travail": demande.temps_pct / 100, "pas": pas}

    brut = demande.brut_mensuel
    if brut is None:
        brut = calc.brut_pour_net(demande.net_cible, params, CIBLES[demande.cible])
        if brut is None:
            raise EntreeInvalide("net_cible inatteignable avec ce taux de prélèvement")

    r = calc.calculer(brut, **params)
    ir = r["ir"]
    sens_direct = demande.brut_mensuel is not None
    return {
        "sens": "brut_vers_net" if sens_direct else "net_vers_brut",
        "parametres": demande.model_dump(exclude_none=True, exclude={"cible"} if sens_direct else None),
        "brut_mensuel_temps_plein": brut,
        "brut_mensuel": r["brut"],
        "pmss_mensuel": calc.arrondi(r["pmss"]),
        "cotisations": r["cotisations"],
        "taux_cotisations": pct(r["tauxCotisations"]),
        "net_social": r["netSocial"],
        "net_imposable": r["netImposable"],
        "taux_pas": pct(r["tauxPas"]),
        "montant_pas": r["prelevement"],
        "net_apres_impot": r["netApresImpot"],
        "annuels": {
            "brut": r["annuel"]["brut"],
            "cotisations": r["annuel"]["cotisations"],
            "net_social": r["annuel"]["netSocial"],
            "net_imposable": r["annuel"]["netImposable"],
            "montant_pas": r["annuel"]["prelevement"],
            "net_apres_impot": r["annuel"]["netApresImpot"],
        },
        "cotisations_detail": [
            {
                "id": l["id"],
                "groupe": l["groupe"],
                "libelle": l["libelle"],
                "assiette": l["assiette"],
                "taux": pct(l["taux"]),
                "montant": l["montant"],
                "cadre_seulement": l.get("cadreSeulement", False),
            }
            for l in r["lignes"]
        ],
        "tmi": pct(ir["tmi"]) if ir else None,
        "impot_estime": {
            "parts": ir["parts"],
            "revenu_imposable_annuel": r["annuel"]["netImposable"],
            "abattement_frais_pro": ir["abattement"],
            "revenu_net_imposable": ir["revenuNetImposable"],
            "quotient": ir["quotient"],
            "impot_annuel": ir["impot"],
            "tmi": pct(ir["tmi"]),
            "taux_effectif": pct(ir["tauxEffectif"]),
        } if ir else None,
    }


def _tranches(bareme):
    """[(seuil, taux), …] → [{"de", "a", "taux"}, …] ; « de » inclus, « a » exclu, None pour la dernière."""
    return [
        {"de": seuil, "a": bareme[i + 1][0] if i + 1 < len(bareme) else None, "taux": taux}
        for i, (seuil, taux) in enumerate(bareme)
    ]


def tranche_taux_neutre(net_imposable_mensuel: float) -> dict[str, Any]:
    taux = calc.taux_neutre(net_imposable_mensuel)
    tranche = next(t for t in reversed(_tranches(calc.GRILLE_TAUX_NEUTRE)) if net_imposable_mensuel >= t["de"])
    return {"net_imposable_mensuel": net_imposable_mensuel, "taux_pas": taux, "tranche": tranche}


ASSIETTES = {
    "vieillessePlafonnee": "tranche 1 (brut jusqu'à 1 PMSS)",
    "vieillesseDeplafonnee": "totalité du brut",
    "agircArrcoT1": "tranche 1 (brut jusqu'à 1 PMSS)",
    "agircArrcoT2": "tranche 2 (brut de 1 à 8 PMSS)",
    "cegT1": "tranche 1 (brut jusqu'à 1 PMSS)",
    "cegT2": "tranche 2 (brut de 1 à 8 PMSS)",
    "cet": "tranches 1 et 2 (brut jusqu'à 8 PMSS)",
    "apec": "brut jusqu'à 4 PMSS",
    "csgDeductible": "98,25 % du brut jusqu'à 4 PMSS, 100 % au-delà",
    "csgNonDeductible": "98,25 % du brut jusqu'à 4 PMSS, 100 % au-delà",
    "crds": "98,25 % du brut jusqu'à 4 PMSS, 100 % au-delà",
}


def baremes() -> dict[str, Any]:
    # Libellés et groupes tels que les produit le moteur : un calcul cadre à 0 € les liste tous.
    lignes = calc.calculer(0, cadre=True)["lignes"]
    frais_pro = calc.ABATTEMENT_FRAIS_PRO
    return {
        "annee": 2026,
        "unites": {"montants": "euros", "taux": "%"},
        "pmss_mensuel": calc.PMSS,
        "smic": {
            "horaire_brut": calc.SMIC["horaireBrut"],
            "mensuel_brut": calc.SMIC["mensuelBrut"],
            "mensuel_net": calc.SMIC["mensuelNet"],
        },
        "cotisations_salariales": [
            {
                "id": l["id"],
                "groupe": l["groupe"],
                "libelle": l["libelle"],
                "taux": pct(l["taux"]),
                "assiette": ASSIETTES[l["id"]],
                "cadre_seulement": l.get("cadreSeulement", False),
            }
            for l in lignes
        ],
        "abattement_csg": pct(calc.ABATTEMENT_CSG),
        "grille_taux_neutre": {
            "base": "net imposable mensuel, métropole ; « de » inclus, « a » exclu",
            "tranches": _tranches(calc.GRILLE_TAUX_NEUTRE),
        },
        "bareme_ir": {
            "base": "revenu net imposable annuel par part (revenus 2025) ; « de » inclus, « a » exclu",
            "tranches": [{**t, "taux": pct(t["taux"])} for t in _tranches(calc.BAREME_IR)],
            "abattement_frais_pro": {"taux": pct(frais_pro["taux"]), "min": frais_pro["min"], "max": frais_pro["max"]},
            "parts": {"seul": 1, "couple": 2, "enfants_1_et_2": 0.5, "par_enfant_suivant": 1},
        },
    }
