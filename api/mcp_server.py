"""Serveur MCP (streamable HTTP) : expose le calculateur sous forme d'outils."""

from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field, ValidationError

from . import service
from .service import BrutMensuel, Cadre, Cible, Enfants, Marie, NetCible, PasMode, TauxPerso, TempsPct

serveur = MCPServer(
    name="salaire-calc",
    version="1.0.0",
    instructions=(
        "Calculateur de salaire France 2026 (barèmes URSSAF, Agirc-Arrco, taux neutre, barème IR). "
        "Montants mensuels en euros, taux en %."
    ),
)


def _calculer(**entrees) -> dict[str, Any]:
    # Sans ToolError, le SDK remplace le message par une erreur générique : le client ne saurait pas quoi corriger.
    try:
        return service.calculer_salaire(service.DemandeCalcul(**entrees))
    except ValidationError as erreur:
        raise ToolError("; ".join(e["msg"] for e in erreur.errors())) from erreur
    except service.EntreeInvalide as erreur:
        raise ToolError(str(erreur)) from erreur


@serveur.tool(description=(
    "Calcule le salaire net à partir d'un brut mensuel : cotisations salariales détaillées, net social "
    "(avant impôt), net imposable, prélèvement à la source et net après impôt, en mensuel et en annuel."
))
def brut_vers_net(
    brut_mensuel: BrutMensuel,
    cadre: Cadre = False,
    temps_pct: TempsPct = 100,
    pas_mode: PasMode = "neutre",
    taux_perso: TauxPerso = None,
    marie: Marie = False,
    enfants: Enfants = 0,
) -> dict[str, Any]:
    return _calculer(
        brut_mensuel=brut_mensuel, cadre=cadre, temps_pct=temps_pct, pas_mode=pas_mode,
        taux_perso=taux_perso, marie=marie, enfants=enfants,
    )


@serveur.tool(description=(
    "Trouve le plus petit brut mensuel temps plein qui atteint un net mensuel visé (avant ou après impôt), "
    "au centime près, et renvoie le calcul complet correspondant."
))
def net_vers_brut(
    net_cible: NetCible,
    cible: Cible = "net_apres_impot",
    cadre: Cadre = False,
    temps_pct: TempsPct = 100,
    pas_mode: PasMode = "neutre",
    taux_perso: TauxPerso = None,
    marie: Marie = False,
    enfants: Enfants = 0,
) -> dict[str, Any]:
    return _calculer(
        net_cible=net_cible, cible=cible, cadre=cadre, temps_pct=temps_pct, pas_mode=pas_mode,
        taux_perso=taux_perso, marie=marie, enfants=enfants,
    )


@serveur.tool(description=(
    "Donne le taux neutre du prélèvement à la source 2026 (grille métropole, en %) applicable à un net "
    "imposable mensuel, avec les bornes de la tranche."
))
def taux_neutre(
    net_imposable_mensuel: Annotated[float, Field(
        ge=0, le=service.MONTANT_MAX, allow_inf_nan=False, description="Net imposable mensuel, en euros.",
    )],
) -> dict[str, Any]:
    return service.tranche_taux_neutre(net_imposable_mensuel)


@serveur.tool(description=(
    "Renvoie les constantes 2026 utilisées : PMSS, SMIC, taux et assiettes des cotisations salariales, "
    "abattement CSG, grille du taux neutre, barème de l'impôt sur le revenu et règles de parts."
))
def baremes_2026() -> dict[str, Any]:
    return service.baremes()
