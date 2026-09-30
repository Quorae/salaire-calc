// Tests du moteur de calcul : `node test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./calc.js');

const proche = (reel, attendu, tolerance, message) =>
  assert.ok(Math.abs(reel - attendu) <= tolerance, `${message} : obtenu ${reel}, attendu ${attendu} ± ${tolerance}`);

const ligne = (r, id) => r.lignes.find((l) => l.id === id);

test('SMIC 1 867,02 € brut → net social 1 477,93 € (net SMIC officiel 2026)', () => {
  const r = C.calculer({ brutMensuel: 1867.02 });
  proche(r.netSocial, 1478, 5, 'net social SMIC');
  assert.equal(r.netSocial, C.SMIC.mensuelNet);
});

// Le cahier des charges annonçait ≈ 2 343 € (net social) et ≈ 2 422 € (net imposable).
// Sous le PMSS, toutes les cotisations sont proportionnelles au brut : le net vaut
// 79,16 % du brut, ce que confirme le cas SMIC ci-dessus au centime près.
// 3 000 € donne donc 2 374,79 € ; 2 343 € correspondrait à 78,1 %, un taux forfaitaire
// qui ne se déduit pas des barèmes fournis.
test('3 000 € brut non-cadre à 100 % → net social 2 374,79 €, net imposable 2 460,27 €', () => {
  const r = C.calculer({ brutMensuel: 3000, cadre: false, tempsTravail: 1 });
  assert.equal(r.netSocial, 2374.79);
  assert.equal(r.netImposable, 2460.27);
  proche(r.netSocial / 3000, C.SMIC.mensuelNet / C.SMIC.mensuelBrut, 1e-5, 'ratio net/brut identique au SMIC');
});

test('taux neutre : 2 400 € de net imposable → 5,3 %', () => {
  assert.equal(C.tauxNeutre(2400), 5.3);
});

test('taux neutre : bornes inférieures incluses', () => {
  assert.equal(C.tauxNeutre(1634.99), 0);
  assert.equal(C.tauxNeutre(1635), 0.5);
  assert.equal(C.tauxNeutre(3570.5), 9.9);
  assert.equal(C.tauxNeutre(3571), 11.9);
  assert.equal(C.tauxNeutre(55557.99), 38);
  assert.equal(C.tauxNeutre(55558), 43);
});

test('cadre au-dessus du PMSS : tranche 2, CET et APEC', () => {
  const r = C.calculer({ brutMensuel: 6000, cadre: true });
  assert.equal(ligne(r, 'agircArrcoT1').assiette, 4005);
  assert.equal(ligne(r, 'agircArrcoT2').assiette, 1995);
  assert.equal(ligne(r, 'agircArrcoT2').montant, 172.37);
  assert.equal(ligne(r, 'cegT2').montant, 21.55);
  assert.equal(ligne(r, 'cet').montant, 8.4);
  assert.equal(ligne(r, 'apec').montant, 1.44);

  const nonCadre = C.calculer({ brutMensuel: 6000, cadre: false });
  assert.equal(ligne(nonCadre, 'cet').montant, 0);
  assert.equal(ligne(nonCadre, 'apec').montant, 0);
});

test('tranche 2 plafonnée à 8 PMSS, abattement CSG limité à 4 PMSS', () => {
  const r = C.calculer({ brutMensuel: 40000, cadre: true });
  assert.equal(ligne(r, 'agircArrcoT2').assiette, 7 * 4005);
  assert.equal(ligne(r, 'apec').assiette, 4 * 4005);

  const r2 = C.calculer({ brutMensuel: 20000 });
  assert.equal(ligne(r2, 'csgDeductible').assiette, arrondi(0.9825 * 16020 + (20000 - 16020)));
});

test('temps partiel : brut et PMSS proratisés', () => {
  const r = C.calculer({ brutMensuel: 6000, tempsTravail: 0.5 });
  assert.equal(r.brut, 3000);
  assert.equal(r.pmss, 2002.5);
  assert.equal(ligne(r, 'vieillessePlafonnee').assiette, 2002.5);
  assert.equal(ligne(r, 'agircArrcoT2').assiette, 997.5);
});

test('net imposable = net social + CSG non déductible + CRDS', () => {
  const r = C.calculer({ brutMensuel: 4321.5, cadre: true });
  proche(r.netImposable, r.netSocial + ligne(r, 'csgNonDeductible').montant + ligne(r, 'crds').montant, 0.001, 'net imposable');
});

test('parts de quotient familial', () => {
  assert.equal(C.nombreDeParts(false, 0), 1);
  assert.equal(C.nombreDeParts(true, 0), 2);
  assert.equal(C.nombreDeParts(false, 1), 1.5);
  assert.equal(C.nombreDeParts(true, 2), 3);
  assert.equal(C.nombreDeParts(true, 3), 4);
  assert.equal(C.nombreDeParts(true, 4), 5);
});

test('barème IR : abattement 10 % (min 504, max 14 555), tranches, TMI', () => {
  const celib = C.estimerImpot(30000, 1);
  assert.equal(celib.abattement, 3000);
  assert.equal(celib.impot, Math.round((27000 - 11600) * 0.11));
  assert.equal(celib.tmi, 0.11);

  assert.equal(C.estimerImpot(4000, 1).abattement, 504);
  assert.equal(C.estimerImpot(4000, 1).impot, 0);
  assert.equal(C.estimerImpot(200000, 1).abattement, 14555);

  // 100 000 € pour un couple (2 parts) : quotient 45 000 €, TMI 30 %
  const couple = C.estimerImpot(100000, 2);
  const parPart = (29579 - 11600) * 0.11 + (45000 - 29579) * 0.30;
  assert.equal(couple.impot, Math.round(parPart * 2));
  assert.equal(couple.tmi, 0.30);
});

test('mode barème : le PAS mensuel correspond à 1/12 de l’impôt estimé', () => {
  const r = C.calculer({ brutMensuel: 5000, pas: { mode: 'bareme', enCouple: false, enfants: 0 } });
  proche(r.prelevement, r.ir.impot / 12, 0.01, 'PAS mensuel');
  proche(r.tauxPas, r.ir.impot / r.annuel.netImposable, 1e-6, 'taux effectif');
});

test('mode personnalisé : taux appliqué au net imposable', () => {
  const r = C.calculer({ brutMensuel: 3000, pas: { mode: 'personnalise', taux: 10 } });
  assert.equal(r.prelevement, 246.03);
  assert.equal(r.netApresImpot, arrondi(r.netSocial - 246.03));
});

test('mode inversé : retrouve le brut à partir du net', () => {
  assert.equal(C.brutPourNet(2374.79, {}, 'netSocial'), 3000);

  const params = { cadre: true, tempsTravail: 1, pas: { mode: 'neutre' } };
  const brut = C.brutPourNet(4200, params, 'netApresImpot');
  assert.ok(C.calculer({ ...params, brutMensuel: brut }).netApresImpot >= 4200);
  assert.ok(C.calculer({ ...params, brutMensuel: brut - 0.01 }).netApresImpot < 4200);

  assert.equal(C.brutPourNet(1000, { pas: { mode: 'personnalise', taux: 100 } }), null);
});

function arrondi(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
