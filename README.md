# Calculateur de salaire brut → net (France, 2026)

Page statique en HTML, CSS et JavaScript, sans dépendance ni étape de build, utilisable hors ligne. Elle calcule le net avant et après impôt à partir du brut, et le brut à partir d'un net visé.

## Lancement

```sh
docker compose up -d --build     # http://<serveur>:8300
```

Le réseau Docker externe `media` doit exister. Sans Docker, ouvrir `index.html` dans un navigateur suffit.

Tests du moteur de calcul (Node 18 ou plus) :

```sh
node test.js
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `calc.js` | Calcul pur, sans DOM : cotisations, taux neutre, barème IR, recherche du brut à partir du net. Chargé par la page et par `test.js`. |
| `app.js` | Interface : lecture du formulaire, affichage, animations. |
| `index.html`, `style.css` | Page et thème. |

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
