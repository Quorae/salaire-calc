/*
 * Moteur de calcul salaire brut → net, barèmes 2026.
 * Fonctions pures, sans DOM : chargé tel quel par le navigateur (window.SalaireCalc)
 * et par Node via require('./calc.js') pour les tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SalaireCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PMSS = 4005;

  const SMIC = { horaireBrut: 12.31, mensuelBrut: 1867.02, mensuelNet: 1477.93 };

  const TAUX = {
    vieillessePlafonnee: 0.069,
    vieillesseDeplafonnee: 0.004,
    agircArrcoT1: 0.0315,
    agircArrcoT2: 0.0864,
    cegT1: 0.0086,
    cegT2: 0.0108,
    cet: 0.0014,
    apec: 0.00024,
    csgDeductible: 0.068,
    csgNonDeductible: 0.024,
    crds: 0.005,
  };

  const ABATTEMENT_CSG = 0.0175;

  // Grille du taux neutre (métropole) : [borne inférieure incluse, taux en %].
  // Chaque tranche court jusqu'à la borne inférieure de la suivante (exclue).
  const GRILLE_TAUX_NEUTRE = [
    [0, 0], [1635, 0.5], [1698, 1.3], [1807, 2.1], [1928, 2.9], [2060, 3.5],
    [2170, 4.1], [2315, 5.3], [2738, 7.5], [3135, 9.9], [3571, 11.9], [4019, 13.8],
    [4690, 15.8], [5624, 17.9], [7037, 20], [8789, 24], [12200, 28], [16523, 33],
    [25937, 38], [55558, 43],
  ];

  // Barème IR 2026 (revenus 2025) par part : [seuil, taux marginal au-delà du seuil].
  const BAREME_IR = [[0, 0], [11600, 0.11], [29579, 0.30], [84577, 0.41], [181917, 0.45]];

  const ABATTEMENT_FRAIS_PRO = { taux: 0.10, min: 504, max: 14555 };

  const arrondi = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const borner = (x, min, max) => Math.min(Math.max(x, min), max);

  function tauxNeutre(netImposableMensuel) {
    let taux = 0;
    for (const [seuil, t] of GRILLE_TAUX_NEUTRE) {
      if (netImposableMensuel >= seuil) taux = t;
      else break;
    }
    return taux;
  }

  function nombreDeParts(enCouple, enfants) {
    const n = Math.max(0, Math.floor(enfants || 0));
    return (enCouple ? 2 : 1) + 0.5 * Math.min(n, 2) + Math.max(0, n - 2);
  }

  // Impôt annuel estimé pour un revenu net imposable (celui de la fiche de paie, avant abattement 10 %).
  // Hors décote et plafonnement du quotient familial.
  function estimerImpot(revenuImposableAnnuel, parts) {
    const revenu = Math.max(0, revenuImposableAnnuel);
    const { taux, min, max } = ABATTEMENT_FRAIS_PRO;
    const abattement = Math.min(borner(revenu * taux, min, max), revenu);
    const revenuNetImposable = revenu - abattement;
    const quotient = revenuNetImposable / parts;

    let impotParPart = 0;
    let tmi = 0;
    BAREME_IR.forEach(([seuil, t], i) => {
      const plafond = i + 1 < BAREME_IR.length ? BAREME_IR[i + 1][0] : Infinity;
      if (quotient > seuil) {
        impotParPart += (Math.min(quotient, plafond) - seuil) * t;
        tmi = t;
      }
    });

    const impot = Math.round(impotParPart * parts);
    return {
      abattement: arrondi(abattement),
      revenuNetImposable: arrondi(revenuNetImposable),
      parts,
      quotient: arrondi(quotient),
      impot,
      tmi,
      tauxEffectif: revenu > 0 ? impot / revenu : 0,
    };
  }

  /*
   * brutMensuel : brut mensuel temps plein ; tempsTravail : fraction (0,8 = 80 %),
   * appliquée au brut et au PMSS.
   * pas : { mode: 'neutre' } | { mode: 'personnalise', taux: <en %> }
   *     | { mode: 'bareme', enCouple: bool, enfants: int }
   */
  function calculer({ brutMensuel, cadre = false, tempsTravail = 1, pas = { mode: 'neutre' } }) {
    const quotite = borner(tempsTravail, 0.01, 1);
    const brut = arrondi(Math.max(0, brutMensuel || 0) * quotite);
    const pmss = PMSS * quotite;

    const t1 = Math.min(brut, pmss);
    const t2 = borner(brut - pmss, 0, 7 * pmss);
    const assietteCsg = (1 - ABATTEMENT_CSG) * Math.min(brut, 4 * pmss) + Math.max(0, brut - 4 * pmss);

    const lignes = [
      { id: 'vieillessePlafonnee', groupe: 'secu', libelle: 'Vieillesse plafonnée', assiette: t1, taux: TAUX.vieillessePlafonnee },
      { id: 'vieillesseDeplafonnee', groupe: 'secu', libelle: 'Vieillesse déplafonnée', assiette: brut, taux: TAUX.vieillesseDeplafonnee },
      { id: 'agircArrcoT1', groupe: 'retraite', libelle: 'Agirc-Arrco tranche 1', assiette: t1, taux: TAUX.agircArrcoT1 },
      { id: 'agircArrcoT2', groupe: 'retraite', libelle: 'Agirc-Arrco tranche 2', assiette: t2, taux: TAUX.agircArrcoT2 },
      { id: 'cegT1', groupe: 'retraite', libelle: 'CEG tranche 1', assiette: t1, taux: TAUX.cegT1 },
      { id: 'cegT2', groupe: 'retraite', libelle: 'CEG tranche 2', assiette: t2, taux: TAUX.cegT2 },
      { id: 'cet', groupe: 'retraite', libelle: 'CET', assiette: cadre ? t1 + t2 : 0, taux: TAUX.cet, cadreSeulement: true },
      { id: 'apec', groupe: 'retraite', libelle: 'APEC', assiette: cadre ? Math.min(brut, 4 * pmss) : 0, taux: TAUX.apec, cadreSeulement: true },
      { id: 'csgDeductible', groupe: 'csg', libelle: 'CSG déductible', assiette: assietteCsg, taux: TAUX.csgDeductible },
      { id: 'csgNonDeductible', groupe: 'csg', libelle: 'CSG non déductible', assiette: assietteCsg, taux: TAUX.csgNonDeductible },
      { id: 'crds', groupe: 'csg', libelle: 'CRDS', assiette: assietteCsg, taux: TAUX.crds },
    ].map((l) => ({ ...l, assiette: arrondi(l.assiette), montant: arrondi(l.assiette * l.taux) }));

    const montantDe = (id) => lignes.find((l) => l.id === id).montant;
    const cotisations = arrondi(lignes.reduce((s, l) => s + l.montant, 0));
    const netSocial = arrondi(brut - cotisations);
    const netImposable = arrondi(netSocial + montantDe('csgNonDeductible') + montantDe('crds'));

    let taux = 0;
    let ir = null;
    if (pas.mode === 'personnalise') {
      taux = borner(Number(pas.taux) || 0, 0, 100) / 100;
    } else if (pas.mode === 'bareme') {
      ir = estimerImpot(netImposable * 12, nombreDeParts(pas.enCouple, pas.enfants));
      taux = ir.tauxEffectif;
    } else {
      taux = tauxNeutre(netImposable) / 100;
    }

    const prelevement = arrondi(netImposable * taux);
    const netApresImpot = arrondi(netSocial - prelevement);

    return {
      brut,
      pmss,
      lignes,
      cotisations,
      tauxCotisations: brut > 0 ? cotisations / brut : 0,
      netSocial,
      netImposable,
      tauxPas: taux,
      prelevement,
      netApresImpot,
      ir,
      annuel: {
        brut: arrondi(brut * 12),
        cotisations: arrondi(cotisations * 12),
        netSocial: arrondi(netSocial * 12),
        netImposable: arrondi(netImposable * 12),
        prelevement: arrondi(prelevement * 12),
        netApresImpot: arrondi(netApresImpot * 12),
      },
    };
  }

  /*
   * Mode inversé : brut mensuel temps plein nécessaire pour atteindre netCible (mensuel).
   * cible : 'netSocial' (avant impôt) ou 'netApresImpot'. Dichotomie au centime.
   * Avec le taux neutre, le net après impôt fait des sauts aux changements de tranche :
   * on renvoie alors le plus petit brut trouvé qui atteint la cible. null si inatteignable.
   */
  function brutPourNet(netCible, params, cible = 'netApresImpot') {
    if (!(netCible > 0)) return 0;
    const netDe = (centimes) => calculer({ ...params, brutMensuel: centimes / 100 })[cible];

    let bas = 0;
    let haut = Math.ceil(netCible * 200);
    while (netDe(haut) < netCible) {
      bas = haut;
      haut *= 2;
      if (haut > 1e12) return null;
    }
    while (haut - bas > 1) {
      const milieu = Math.floor((bas + haut) / 2);
      if (netDe(milieu) >= netCible) haut = milieu;
      else bas = milieu;
    }
    return haut / 100;
  }

  return {
    PMSS,
    SMIC,
    TAUX,
    GRILLE_TAUX_NEUTRE,
    BAREME_IR,
    tauxNeutre,
    nombreDeParts,
    estimerImpot,
    calculer,
    brutPourNet,
  };
});
