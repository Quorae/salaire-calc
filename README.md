# Calculateur de salaire brut → net (France, 2026)

[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

Page statique en HTML, CSS et JavaScript, sans dépendance ni étape de build, utilisable hors ligne. Elle calcule le net avant et après impôt à partir du brut, et le brut à partir d'un net visé.

Le même calcul est disponible en API REST et en serveur MCP, protégés par un jeton.

## Lancement

```sh
cp .env.example .env             # puis y mettre un jeton : openssl rand -hex 32
docker compose up -d --build     # http://<serveur>:8300
```

Deux conteneurs tournent. `web` (nginx) sert la page et relaie `/api/` et `/mcp` vers `api` (FastAPI, port 8000). Le port de `api` n'est pas publié, et ce conteneur n'est relié qu'à nginx, par un réseau privé. Le réseau Docker externe `media` doit exister. L'API refuse de démarrer si `API_TOKEN` est absent ou vide.

Sans Docker, ouvrir `index.html` dans un navigateur suffit pour la page.

Tests du moteur de calcul (Node 18 ou plus, Python 3.12 ou plus, sans dépendance) :

```sh
node test.js
python3 -m unittest api.test_calc     # ou python3 -m pytest api/test_calc.py
```

Les deux suites vérifient les mêmes cas de référence.

## API REST

Toutes les routes exigent l'en-tête `Authorization: Bearer <jeton>`, sauf `GET /api/health`. Sans jeton ou avec un jeton faux, la réponse est un 401 en JSON. Les montants sont en euros, les taux en %.

| Route | Rôle |
|---|---|
| `GET /api/health` | Renvoie `{"status": "ok"}`, sans jeton. |
| `POST /api/calc` | Calcul brut → net ou net → brut. |
| `GET /api/baremes` | Constantes 2026 : PMSS, SMIC, cotisations, grille du taux neutre, barème IR. |
| `GET /api/openapi.json` | Schéma OpenAPI. |

Corps de `POST /api/calc` :

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `brut_mensuel` | nombre | | Brut mensuel temps plein. |
| `net_cible` | nombre | | Net mensuel visé. Le brut est alors recherché au centime près. |
| `cible` | `net_apres_impot` ou `net_social` | `net_apres_impot` | Net visé par `net_cible`. |
| `cadre` | booléen | `false` | Ajoute CET et APEC. |
| `temps_pct` | nombre, de 1 à 100 | `100` | Proratise le brut et le PMSS. |
| `pas_mode` | `neutre`, `personnalise` ou `estimation` | `neutre` | Taux du prélèvement à la source. |
| `taux_perso` | nombre, de 0 à 100 | | Obligatoire en mode `personnalise`. |
| `marie` | booléen | `false` | Mode `estimation` seulement. |
| `enfants` | entier, de 0 à 20 | `0` | Mode `estimation` seulement. |

Il faut renseigner exactement un des deux champs `brut_mensuel` et `net_cible`. Un champ inconnu, un type faux (`"3000"` au lieu de `3000`), une valeur hors bornes ou une option qui ne correspond pas au mode choisi donnent un 400 avec la liste des erreurs. Un net inatteignable, avec un taux personnalisé de 100 %, donne aussi un 400.

La réponse contient `net_social`, `net_imposable`, `taux_pas`, `montant_pas` et `net_apres_impot`, les montants annuels dans `annuels` et le détail des cotisations dans `cotisations_detail`. En mode `estimation`, elle donne aussi la TMI (`tmi`) et le calcul de l'impôt (`impot_estime`). Ces deux champs valent `null` dans les autres modes.

```sh
BASE=http://<serveur>:8300
TOKEN=<jeton du fichier .env>

curl -s $BASE/api/health

curl -s -X POST $BASE/api/calc \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"brut_mensuel": 3000}'
# "net_social": 2374.79, "net_imposable": 2460.27, "taux_pas": 5.3, "montant_pas": 130.39, "net_apres_impot": 2244.4…

curl -s -X POST $BASE/api/calc \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"net_cible": 4200, "cadre": true, "pas_mode": "estimation", "marie": true, "enfants": 2}'
# "brut_mensuel_temps_plein": 5452.54, "net_apres_impot": 4200.0, "tmi": 11.0…

curl -s $BASE/api/baremes -H "Authorization: Bearer $TOKEN"
```

## Serveur MCP

Le serveur MCP répond en streamable HTTP sur `$BASE/mcp`, avec le même jeton Bearer. Il ne garde pas de session et répond en JSON.

| Outil | Rôle |
|---|---|
| `brut_vers_net(brut_mensuel, cadre, temps_pct, pas_mode, taux_perso, marie, enfants)` | Même calcul que `POST /api/calc` avec `brut_mensuel`. |
| `net_vers_brut(net_cible, cible, cadre, temps_pct, pas_mode, taux_perso, marie, enfants)` | Même calcul avec `net_cible`. |
| `taux_neutre(net_imposable_mensuel)` | Taux neutre applicable et bornes de sa tranche. |
| `baremes_2026()` | Mêmes constantes que `GET /api/baremes`. |

Ajout dans Claude Code :

```sh
claude mcp add --transport http salaire-calc $BASE/mcp --header "Authorization: Bearer $TOKEN"
```

Test à la main :

```sh
curl -s -X POST $BASE/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `calc.js` | Calcul pur, sans DOM : cotisations, taux neutre, barème IR, recherche du brut à partir du net. Chargé par la page et par `test.js`. |
| `app.js` | Interface : lecture du formulaire, affichage, animations. |
| `index.html`, `style.css` | Page et thème. |
| `api/calc.py` | Portage Python de `calc.js`, avec les mêmes barèmes et les mêmes arrondis. |
| `api/service.py` | Validation des entrées et mise en forme des résultats, communes à l'API et au MCP. |
| `api/main.py` | Application FastAPI : contrôle du jeton, routes REST, montage du MCP sur `/mcp`. |
| `api/mcp_server.py` | Outils MCP. |
| `nginx.conf`, `Dockerfile`, `Dockerfile.api`, `docker-compose.yml` | Conteneurs `web` et `api`. |

## Barèmes utilisés

- **PMSS 2026** : 4 005 € par mois, proratisé au temps de travail, comme le brut.
- **SMIC** (depuis le 1er juin 2026) : 12,31 €/h, 1 867,02 € brut, 1 477,93 € net par mois.
- **Cotisations salariales** :
  - vieillesse plafonnée 6,90 % (T1), déplafonnée 0,40 % ;
  - Agirc-Arrco 3,15 % (T1) et 8,64 % (T2, de 1 à 8 PMSS) ;
  - CEG 0,86 % (T1) et 1,08 % (T2) ;
  - pour les cadres seulement : CET 0,14 % (T1 + T2) et APEC 0,024 % (jusqu'à 4 PMSS).
- **CSG et CRDS** : CSG déductible 6,80 %, CSG non déductible 2,40 %, CRDS 0,50 %. L'assiette est de 98,25 % du brut jusqu'à 4 PMSS, puis de 100 % au-delà.
- **Net imposable** = net social + CSG non déductible + CRDS.
- **Taux neutre** : grille 2026 de la métropole, appliquée au net imposable mensuel.
- **Barème IR 2026** (revenus 2025) : 0 % jusqu'à 11 600 €, puis 11 %, 30 %, 41 % et 45 % (seuils à 29 579 €, 84 577 € et 181 917 €).
  - Abattement de 10 % pour frais professionnels, au minimum 504 € et au maximum 14 555 €.
  - Parts : 1 pour une personne seule, 2 pour un couple marié ou pacsé. Chacun des deux premiers enfants ajoute une demi-part, chaque enfant suivant une part entière.
  - Le taux effectif est l'impôt divisé par le net imposable annuel.

## Limites

L'estimation ne couvre pas l'Alsace-Moselle, les heures supplémentaires, les primes, la mutuelle ni la prévoyance. En mode barème IR, elle ne compte que ce salaire (pas d'autre revenu dans le foyer) et n'applique ni décote ni plafonnement du quotient familial. Avec le taux neutre, le net après impôt fait un petit saut à chaque changement de tranche : en mode inversé, le brut affiché est le plus petit qui atteint le net visé.

## Sources

- URSSAF (urssaf.fr) : PMSS, taux de cotisations de sécurité sociale, CSG et CRDS.
- Agirc-Arrco (agirc-arrco.fr) : taux de retraite complémentaire, CEG et CET.
- BOFiP, BOI-BAREME-000037 (bofip.impots.gouv.fr) : grille du taux neutre du prélèvement à la source.
- Loi de finances pour 2026 et impots.gouv.fr : barème de l'impôt sur le revenu.
- service-public.fr : montants du SMIC.
