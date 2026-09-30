"""
API REST et serveur MCP du calculateur, protégés par jeton Bearer (variable API_TOKEN).
Lancement : uvicorn api.main:app --host 0.0.0.0 --port 8000
"""

import hmac
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from mcp.server.transport_security import TransportSecuritySettings

from . import service
from .mcp_server import serveur as serveur_mcp
from .service import DemandeCalcul


def lire_jeton() -> str:
    jeton = os.environ.get("API_TOKEN", "").strip()
    if not jeton:
        sys.exit(
            "Démarrage refusé : la variable d'environnement API_TOKEN est absente ou vide. "
            "Renseignez-la dans .env (voir .env.example)."
        )
    return jeton


class AuthBearer:
    """
    Middleware ASGI : toute requête HTTP exige « Authorization: Bearer <jeton> », sauf GET /api/health.
    Refus par défaut, pour qu'une route ajoutée plus tard ne soit jamais publique par oubli.
    """

    def __init__(self, app, jeton: str):
        self.app = app
        self.jeton = jeton.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or (scope["method"] == "GET" and scope["path"] == "/api/health"):
            return await self.app(scope, receive, send)

        fourni = self._jeton_fourni(scope)
        if fourni is not None and hmac.compare_digest(fourni, self.jeton):
            return await self.app(scope, receive, send)

        if fourni is None:
            detail, entete = "Authentification requise : en-tête « Authorization: Bearer <jeton> ».", 'Bearer realm="salaire-calc"'
        else:
            detail, entete = "Jeton invalide.", 'Bearer realm="salaire-calc", error="invalid_token"'
        reponse = JSONResponse({"detail": detail}, status_code=401, headers={"WWW-Authenticate": entete})
        await reponse(scope, receive, send)

    @staticmethod
    def _jeton_fourni(scope) -> bytes | None:
        for nom, valeur in scope["headers"]:
            if nom == b"authorization":
                schema, _, jeton = valeur.partition(b" ")
                jeton = jeton.strip()
                return jeton if schema.lower() == b"bearer" and jeton else None
        return None


def creer_app(jeton: str) -> FastAPI:
    # La protection DNS rebinding du SDK n'accepte que Host = localhost, or l'API est jointe via nginx
    # sous le nom public du serveur. Le jeton Bearer, qu'une page tierce ne peut pas fournir, couvre ce risque.
    app_mcp = serveur_mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    @asynccontextmanager
    async def cycle_de_vie(_app):
        async with serveur_mcp.session_manager.run():
            yield

    app = FastAPI(
        title="salaire-calc",
        description="Calcul de salaire brut ↔ net, France 2026. Montants en euros, taux en %.",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=cycle_de_vie,
    )
    app.add_middleware(AuthBearer, jeton=jeton)
    # Route /mcp exacte (un Mount imposerait /mcp/ et une redirection).
    app.router.routes.extend(app_mcp.routes)

    @app.exception_handler(RequestValidationError)
    async def entree_invalide(_request: Request, exc: RequestValidationError):
        # loc = ("body", <champ>) ; un entier y est une position dans le JSON, pas un champ.
        erreurs = [
            {"champ": ".".join(p for p in e["loc"] if isinstance(p, str) and p != "body"), "message": e["msg"]}
            for e in exc.errors()
        ]
        return JSONResponse({"detail": "Requête invalide.", "erreurs": erreurs}, status_code=400)

    @app.exception_handler(service.EntreeInvalide)
    async def calcul_impossible(_request: Request, exc: service.EntreeInvalide):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.post("/api/calc")
    def calculer(demande: DemandeCalcul):
        return service.calculer_salaire(demande)

    @app.get("/api/baremes")
    def baremes():
        return service.baremes()

    return app


app = creer_app(lire_jeton())
