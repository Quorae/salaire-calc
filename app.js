/* Interface du calculateur : lit le formulaire, appelle SalaireCalc (calc.js), met à jour l'affichage. */
(function () {
  'use strict';

  const C = window.SalaireCalc;
  const $ = (id) => document.getElementById(id);

  const fmtEur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const fmtEur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const fmtNombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const fmtPct1 = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtPct0 = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });
  const fmtTaux = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const fmtRatio = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtParts = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

  const mouvementReduit = window.matchMedia('(prefers-reduced-motion: reduce)');

  // [min, max, pas] du curseur de montant selon le sens et la période.
  const BORNES_CURSEUR = {
    direct: { mensuel: [500, 15000, 50], annuel: [6000, 180000, 500] },
    inverse: { mensuel: [500, 12000, 50], annuel: [6000, 144000, 500] },
  };

  const LIBELLES_PAS = { neutre: 'Taux neutre', personnalise: 'Taux perso', bareme: 'Taux estimé' };

  const GROUPES = [
    { id: 'secu', libelle: 'Sécurité sociale' },
    { id: 'retraite', libelle: 'Retraite complémentaire' },
    { id: 'csg', libelle: 'CSG / CRDS' },
  ];

  const ECART_DONUT = 0.7; // espace entre segments, en % de la circonférence

  const form = $('form');
  const montant = $('montant');
  const montantRange = $('montant-range');
  const temps = $('temps');
  const tempsRange = $('temps-range');
  const tauxPerso = $('taux-perso');
  const couple = $('couple');
  const enfantsOut = $('enfants');
  const donutCard = $('donut-card');

  let enfants = 0;
  let dernier = null;
  let minuterieLive = 0;

  /* ---------- Lecture ---------- */

  function lireNombre(texte) {
    const n = parseFloat(String(texte).replace(/[\s  €%]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  const borner = (x, min, max) => Math.min(Math.max(x, min), max);
  const arrondi = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const radio = (nom) => form.querySelector(`input[name="${nom}"]:checked`).value;

  function lireEtat() {
    const modePas = radio('pas');
    let pas = { mode: 'neutre' };
    if (modePas === 'personnalise') pas = { mode: modePas, taux: lireNombre(tauxPerso.value) };
    if (modePas === 'bareme') pas = { mode: modePas, enCouple: couple.checked, enfants };

    return {
      sens: radio('sens'),
      periode: radio('periode'),
      cible: radio('cible'),
      cadre: radio('statut') === 'cadre',
      quotite: borner(lireNombre(temps.value) || 100, 1, 100) / 100,
      pas,
      montant: Math.max(0, lireNombre(montant.value)),
    };
  }

  /* ---------- Animation des valeurs ---------- */

  const animations = new WeakMap();

  function animer(noeud, cible, rendre) {
    const precedente = animations.get(noeud);
    if (precedente) cancelAnimationFrame(precedente.raf);
    const depart = precedente ? precedente.valeur : cible;
    const etat = { valeur: depart, raf: 0 };
    animations.set(noeud, etat);

    if (mouvementReduit.matches || depart === cible) {
      etat.valeur = cible;
      rendre(cible);
      return;
    }
    const t0 = performance.now();
    const duree = 450;
    const image = (t) => {
      const k = Math.min(1, (t - t0) / duree);
      etat.valeur = k === 1 ? cible : depart + (cible - depart) * (1 - Math.pow(1 - k, 3));
      rendre(etat.valeur);
      if (k < 1) etat.raf = requestAnimationFrame(image);
    };
    etat.raf = requestAnimationFrame(image);
  }

  function animerTexte(id, valeur, format) {
    const noeud = $(id);
    animer(noeud, valeur, (v) => { noeud.textContent = format(v); });
  }

  const eur = (v) => fmtEur.format(v);
  const eur0 = (v) => fmtEur0.format(v);

  /* ---------- Synchronisation des contrôles ---------- */

  function majSegments() {
    form.querySelectorAll('.seg').forEach((seg) => {
      const entrees = [...seg.querySelectorAll('input[type="radio"]')];
      seg.style.setProperty('--i', Math.max(0, entrees.findIndex((e) => e.checked)));
    });
  }

  function remplissage(curseur) {
    const min = Number(curseur.min);
    const max = Number(curseur.max);
    const p = max > min ? ((Number(curseur.value) - min) / (max - min)) * 100 : 0;
    curseur.style.setProperty('--p', `${p}%`);
  }

  function majCurseurMontant() {
    const [min, max, pas] = BORNES_CURSEUR[radio('sens')][radio('periode')];
    montantRange.min = min;
    montantRange.max = max;
    montantRange.step = pas;
    montantRange.value = borner(lireNombre(montant.value), min, max);
    remplissage(montantRange);
  }

  function ecrireMontant(valeur) {
    montant.value = fmtNombre.format(arrondi(Math.max(0, valeur)));
    majCurseurMontant();
  }

  function majPanneauxPas() {
    const mode = radio('pas');
    form.querySelectorAll('.pas-panel').forEach((p) => { p.hidden = p.dataset.pas !== mode; });
  }

  function majEnfants() {
    enfantsOut.textContent = String(enfants);
    form.querySelector('[data-pas-enfants="-1"]').disabled = enfants <= 0;
    form.querySelector('[data-pas-enfants="1"]').disabled = enfants >= 10;
    const parts = C.nombreDeParts(couple.checked, enfants);
    $('parts').textContent = `${fmtParts.format(parts)} part${parts > 1 ? 's' : ''}`;
  }

  /* ---------- Calcul ---------- */

  function recalculer() {
    const s = lireEtat();
    const params = { cadre: s.cadre, tempsTravail: s.quotite, pas: s.pas };
    const montantMensuel = s.periode === 'annuel' ? s.montant / 12 : s.montant;

    let brutTempsPlein = montantMensuel;
    let inatteignable = false;
    if (s.sens === 'inverse') {
      const trouve = C.brutPourNet(montantMensuel, params, s.cible);
      inatteignable = trouve === null;
      brutTempsPlein = trouve || 0;
    }

    const r = C.calculer({ ...params, brutMensuel: brutTempsPlein });
    dernier = { s, r, brutTempsPlein };
    afficher(s, r, brutTempsPlein, inatteignable);
  }

  /* ---------- Affichage ---------- */

  function afficher(s, r, brutTempsPlein, inatteignable) {
    afficherEntrees(s, r);
    afficherBandeau(s, r, brutTempsPlein, inatteignable);
    afficherHero(s, r);
    afficherTuiles(r);
    afficherDonut(r);
    afficherSmic(s, r);
    afficherImpot(r);
    afficherDetail(s, r);
    annoncer(r);
  }

  function afficherEntrees(s, r) {
    const annuel = s.periode === 'annuel';
    const autre = annuel ? s.montant / 12 : s.montant * 12;
    const autrePeriode = annuel ? '/ mois' : '/ an';
    const partiel = s.quotite < 1;

    let libelle = 'Net souhaité';
    let aide = `soit ${eur0(autre)} ${autrePeriode}`;
    if (s.sens === 'direct') {
      libelle = partiel ? 'Brut temps plein' : 'Salaire brut';
      aide = `soit ${eur0(autre)} brut ${autrePeriode}`;
      if (partiel) aide += ` · versé à ${fmtNombre.format(s.quotite * 100)} % : ${eur(r.brut)} / mois`;
    }
    $('montant-label').textContent = libelle;
    $('montant-hint').textContent = aide;
    $('cible-field').hidden = s.sens !== 'inverse';
  }

  function afficherBandeau(s, r, brutTempsPlein, inatteignable) {
    const bandeau = $('banner');
    bandeau.hidden = s.sens !== 'inverse';
    if (bandeau.hidden) return;

    if (inatteignable) {
      $('banner-brut').textContent = 'Inatteignable';
      $('banner-sub').textContent = 'Aucun brut ne donne ce net avec ce taux de prélèvement.';
      return;
    }
    animerTexte('banner-brut', r.brut, eur);
    let sous = `soit ${eur0(r.annuel.brut)} brut / an`;
    if (s.quotite < 1) sous += ` · ${eur(brutTempsPlein)} en équivalent temps plein`;
    $('banner-sub').textContent = sous;
  }

  function afficherHero(s, r) {
    const entier = $('hero-int');
    const decimales = $('hero-dec');
    animer(entier, r.netApresImpot, (v) => {
      const morceaux = fmtEur.formatToParts(v);
      const i = morceaux.findIndex((m) => m.type === 'decimal');
      entier.textContent = morceaux.slice(0, i).map((m) => m.value).join('');
      decimales.textContent = morceaux.slice(i).map((m) => m.value).join('');
    });
    animerTexte('hero-annuel', r.annuel.netApresImpot, eur0);

    $('chip-cotis').textContent = fmtPct1.format(r.tauxCotisations);
    $('chip-pas-label').textContent = LIBELLES_PAS[s.pas.mode];
    $('chip-pas').textContent = fmtPct1.format(r.tauxPas);
    $('chip-tmi').hidden = !r.ir;
    if (r.ir) $('chip-tmi-val').textContent = fmtPct0.format(r.ir.tmi);
  }

  function afficherTuiles(r) {
    animerTexte('s-net-social', r.netSocial, eur);
    animerTexte('s-net-social-an', r.annuel.netSocial, eur0);
    animerTexte('s-net-imposable', r.netImposable, eur);
    animerTexte('s-net-imposable-an', r.annuel.netImposable, eur0);
    animerTexte('s-pas', r.prelevement, eur);
    animerTexte('s-pas-an', r.annuel.prelevement, eur0);
    $('s-pas-taux').textContent = fmtPct1.format(r.tauxPas);
    animerTexte('s-cotis', r.cotisations, eur);
    animerTexte('s-cotis-an', r.annuel.cotisations, eur0);
    $('s-cotis-taux').textContent = fmtPct1.format(r.tauxCotisations);
  }

  const LIBELLES_DONUT = { net: 'net / brut', cotisations: 'cotisations', impot: 'impôt' };

  function partsDonut(r) {
    const total = r.brut;
    const part = (v) => (total > 0 ? v / total : 0);
    return { net: part(r.netApresImpot), cotisations: part(r.cotisations), impot: part(r.prelevement) };
  }

  function afficherDonut(r) {
    const parts = partsDonut(r);
    let decalage = 0;
    for (const cle of ['net', 'cotisations', 'impot']) {
      const pct = parts[cle] * 100;
      const longueur = pct > ECART_DONUT ? pct - ECART_DONUT : pct;
      const seg = donutCard.querySelector(`.donut-seg[data-cle="${cle}"]`);
      seg.style.strokeDasharray = `${longueur} ${100 - longueur}`;
      seg.style.strokeDashoffset = String(-(decalage + (pct - longueur) / 2));
      decalage += pct;
      $(`l-${cle}-pct`).textContent = fmtPct1.format(parts[cle]);
    }
    animerTexte('l-net', r.netApresImpot, eur);
    animerTexte('l-cotisations', r.cotisations, eur);
    animerTexte('l-impot', r.prelevement, eur);
    animerTexte('l-brut', r.brut, eur);
    majCentreDonut();
  }

  function majCentreDonut() {
    if (!dernier) return;
    const cle = donutCard.dataset.actif || 'net';
    $('donut-pct').textContent = fmtPct0.format(partsDonut(dernier.r)[cle]);
    $('donut-label').textContent = LIBELLES_DONUT[cle];
  }

  function afficherSmic(s, r) {
    const ratio = r.netSocial / C.SMIC.mensuelNet;
    animerTexte('smic-ratio', ratio, (v) => fmtRatio.format(v));
    $('smic-text').textContent =
      `Net avant impôt de ${eur(r.netSocial)}, soit ${fmtPct0.format(ratio)} du SMIC net temps plein (${eur(C.SMIC.mensuelNet)}).`;
    $('gauge-fill').style.transform = `scaleX(${borner(ratio / 4, 0, 1)})`;

    const smicProratise = arrondi(C.SMIC.mensuelBrut * s.quotite);
    const alerte = $('smic-alert');
    alerte.hidden = !(r.brut > 0 && r.brut < smicProratise);
    if (!alerte.hidden) {
      $('smic-alert-text').textContent = s.quotite < 1
        ? `Brut inférieur au SMIC pour ce temps de travail (${eur(smicProratise)}).`
        : `Brut inférieur au SMIC mensuel (${eur(C.SMIC.mensuelBrut)}).`;
    }
  }

  function afficherImpot(r) {
    const carte = $('ir-card');
    carte.hidden = !r.ir;
    if (!r.ir) return;
    const ir = r.ir;
    animerTexte('ir-impot', ir.impot, eur0);
    $('ir-mensuel').textContent = eur(ir.impot / 12);
    $('ir-revenu').textContent = eur0(r.annuel.netImposable);
    $('ir-abattement').textContent = `− ${eur0(ir.abattement)}`;
    $('ir-rni').textContent = eur0(ir.revenuNetImposable);
    $('ir-quotient').textContent = `${eur0(ir.quotient)} × ${fmtParts.format(ir.parts)} part${ir.parts > 1 ? 's' : ''}`;
    $('ir-taux').textContent = fmtPct1.format(ir.tauxEffectif);
    $('tranches').querySelectorAll('li').forEach((li) => {
      li.classList.toggle('actif', Number(li.dataset.tmi) === ir.tmi);
    });
  }

  function afficherDetail(s, r) {
    const lignesHtml = GROUPES.map((g) => {
      const lignes = r.lignes.filter((l) => l.groupe === g.id);
      const entete = `<tr class="groupe"><th scope="rowgroup" colspan="4">${g.libelle}</th></tr>`;
      return entete + lignes.map((l) => {
        const nonApplicable = l.cadreSeulement && !s.cadre;
        const taux = nonApplicable ? '<span class="pill">cadres</span>' : fmtTaux.format(l.taux);
        return `<tr class="${l.montant === 0 ? 'nul' : ''}">
          <td>${l.libelle}</td>
          <td class="num col-assiette">${nonApplicable ? '—' : eur(l.assiette)}</td>
          <td class="num">${taux}</td>
          <td class="num">${eur(l.montant)}</td>
        </tr>`;
      }).join('');
    }).join('');

    $('d-body').innerHTML = lignesHtml;
    $('d-brut').textContent = eur(r.brut);
    $('d-taux').textContent = fmtPct1.format(r.tauxCotisations);
    $('d-total-foot').textContent = eur(r.cotisations);
    $('d-total').textContent = `${eur(r.cotisations)} / mois`;
  }

  function annoncer(r) {
    clearTimeout(minuterieLive);
    minuterieLive = setTimeout(() => {
      $('live').textContent = `Net après impôt : ${eur(r.netApresImpot)} par mois. Net avant impôt : ${eur(r.netSocial)}.`;
    }, 800);
  }

  /* ---------- Évènements ---------- */

  form.addEventListener('submit', (e) => e.preventDefault());

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.type === 'radio') return;

    if (t === montant) {
      majCurseurMontant();
    } else if (t === montantRange) {
      montant.value = fmtNombre.format(Number(montantRange.value));
      remplissage(montantRange);
    } else if (t === temps) {
      tempsRange.value = borner(lireNombre(temps.value), 10, 100);
      remplissage(tempsRange);
    } else if (t === tempsRange) {
      temps.value = tempsRange.value;
      remplissage(tempsRange);
    } else if (t === couple) {
      majEnfants();
    }
    recalculer();
  });

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type !== 'radio') return;
    majSegments();

    // Les bascules conservent le brut courant : seul le montant saisi est converti.
    if (dernier) {
      const facteur = radio('periode') === 'annuel' ? 12 : 1;
      if (t.name === 'periode') {
        const v = lireNombre(montant.value);
        ecrireMontant(t.value === 'annuel' ? v * 12 : v / 12);
      } else if (t.name === 'sens') {
        ecrireMontant(t.value === 'inverse'
          ? dernier.r[radio('cible')] * facteur
          : dernier.brutTempsPlein * facteur);
      } else if (t.name === 'cible') {
        ecrireMontant(dernier.r[t.value] * facteur);
      } else if (t.name === 'pas' && t.value === 'personnalise' && tauxPerso.value.trim() === '') {
        tauxPerso.value = fmtNombre.format(Math.round(dernier.r.tauxPas * 1000) / 10);
      }
    }
    majPanneauxPas();
    recalculer();
  });

  montant.addEventListener('blur', () => { montant.value = fmtNombre.format(Math.max(0, lireNombre(montant.value))); });
  temps.addEventListener('blur', () => {
    temps.value = fmtNombre.format(borner(lireNombre(temps.value) || 100, 1, 100));
    recalculer();
  });
  tauxPerso.addEventListener('blur', () => {
    if (tauxPerso.value.trim() !== '') tauxPerso.value = fmtNombre.format(borner(lireNombre(tauxPerso.value), 0, 100));
  });

  form.querySelectorAll('[data-pas-enfants]').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      enfants = borner(enfants + Number(bouton.dataset.pasEnfants), 0, 10);
      majEnfants();
      recalculer();
    });
  });

  // Survol du donut ou de la légende : met le segment en avant et l'affiche au centre.
  donutCard.querySelectorAll('[data-cle]').forEach((noeud) => {
    noeud.addEventListener('pointerenter', () => {
      donutCard.dataset.actif = noeud.dataset.cle;
      majCentreDonut();
    });
    noeud.addEventListener('pointerleave', () => {
      delete donutCard.dataset.actif;
      majCentreDonut();
    });
  });

  /* ---------- Démarrage ---------- */

  majSegments();
  majPanneauxPas();
  majEnfants();
  majCurseurMontant();
  remplissage(tempsRange);
  recalculer();
})();
