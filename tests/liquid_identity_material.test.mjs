// Liquid Identity — focused deterministic material & playloop regression tests.
// Run: node --test tests/liquid_identity_material.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiquidModel } from '../experiments/liquid-identity/liquid-model.js';

const DT = 1 / 60;

function run(model, seconds, each) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    if (each) each(i, steps);
    model.step(DT);
  }
}

function evalField(m, px, py) {
  const R2 = m.kernel * m.kernel;
  let f = 0;
  for (let i = 0; i < m.count; i += 1) {
    const r2 = ((m.x[i] - px) ** 2 + (m.y[i] - py) ** 2) / R2;
    if (r2 < 1) f += (1 - r2) ** 3;
  }
  return f;
}

test('settled monogram has smooth pooled density and rounded fluid terminals', () => {
  const m = createLiquidModel({ seed: 17 });
  m.settle();
  const { U, S } = m.letterBoxes;

  // Centerline density along U left arm should be smooth, not lumpy.
  const cx = U.x + m.stroke / 2;
  const uVals = [];
  for (let y = U.y + 0.12; y <= U.y + 0.42; y += 0.01) uVals.push(evalField(m, cx, y));
  const uMean = uVals.reduce((a, b) => a + b, 0) / uVals.length;
  const uMaxDev = Math.max(...uVals.map((v) => Math.abs(v - uMean)));
  assert.ok(uMaxDev / uMean < 0.025, `smooth U stroke interior (rel dev ${(uMaxDev / uMean).toFixed(4)})`);

  // Cross-section should be unimodal (peaking at the centerline, no center trough).
  const fCenter = evalField(m, cx, U.y + 0.28);
  const fSide = evalField(m, cx + 0.02, U.y + 0.28);
  assert.ok(fCenter >= fSide, `unimodal liquid cross-section (${fCenter.toFixed(3)} >= ${fSide.toFixed(3)})`);

  // Top-left terminal of U should be a rounded fluid cap rather than a flat boxy corner.
  const capY = U.y + m.stroke / 2;
  const radii = [];
  for (let a = 0; a <= Math.PI + 1e-6; a += Math.PI / 12) {
    let rf = 0;
    for (let r = 0.02; r <= 0.09; r += 0.001) {
      if (evalField(m, cx + r * Math.cos(a), capY - r * Math.sin(a)) >= m.threshold) rf = r;
    }
    radii.push(rf);
  }
  const rMin = Math.min(...radii);
  const rMax = Math.max(...radii);
  assert.ok(rMin > 0.055 && rMax - rMin < 0.012, `rounded U terminal cap (${rMin.toFixed(3)}..${rMax.toFixed(3)})`);

  // S interior density matches U smoothly around the upper bend.
  const sCx = S.x + S.w / 2;
  const rx = (S.w - m.stroke) / 2;
  const ry = (S.h - m.stroke) / 4;
  const cyU = S.y + m.stroke / 2 + ry;
  const sVals = [];
  for (let deg = 60; deg <= 240; deg += 15) {
    const a = (deg * Math.PI) / 180;
    sVals.push(evalField(m, sCx + rx * Math.cos(a), cyU - ry * Math.sin(a)));
  }
  const sMean = sVals.reduce((a, b) => a + b, 0) / sVals.length;
  assert.ok(Math.abs(sMean - uMean) / uMean < 0.04, `consistent pooled density across U and S (${uMean.toFixed(2)} vs ${sMean.toFixed(2)})`);
});

test('progressive drag necks under rising tension, pinches off a bead, and recoils the root', () => {
  const m = createLiquidModel({ seed: 7 });
  m.settle();
  const { U } = m.letterBoxes;
  const sx = U.x + U.w * 0.5;
  const sy = U.y + U.h * 0.90;

  // Stage 1: medium pull builds filament tension and localized neck strain without snapping.
  m.pointerDown(sx, sy);
  run(m, 0.4, (i, n) => m.pointerMove(sx, sy + 0.34 * (i / n)));
  m.pointerMove(sx, sy + 0.34);
  run(m, 0.2);
  const mid = m.metrics();
  assert.equal(mid.snapped, false, 'medium pull stays bridged');
  assert.ok(mid.tension > 0.45 && mid.tension < 0.95, `filament tension rises cleanly (${mid.tension.toFixed(3)})`);
  assert.ok(mid.maxStrain > 0.4, `neck strain highlights stretched waist (${mid.maxStrain.toFixed(3)})`);
  const midCaptured = mid.captured;

  // Stage 2: deep pull past yield distance triggers clean pinch-off and bead detachment.
  const ey = sy + 0.56;
  run(m, 0.35, (i, n) => m.pointerMove(sx, sy + 0.34 + 0.22 * (i / n)));
  m.pointerMove(sx, ey);
  run(m, 0.25);
  const snapped = m.metrics();
  assert.equal(snapped.snapped, true, 'deep pull pinches off cleanly');
  assert.ok(snapped.pinchCount >= 1, `pinch-off event recorded (${snapped.pinchCount})`);
  assert.ok(snapped.captured < midCaptured && snapped.captured >= 10, `neck recoiled while bead stayed captured (${snapped.captured} < ${midCaptured})`);
  let beadAtHand = 0;
  for (let i = 0; i < m.count; i += 1) {
    if (Math.hypot(m.x[i] - m.pointer.x, m.y[i] - m.pointer.y) < 0.08) beadAtHand += 1;
  }
  assert.ok(beadAtHand >= 10, `detached rolling bead tracks pointer (${beadAtHand})`);
});

test('release slingshots liquid back with a localized coalescence ripple, then settles cleanly', () => {
  const m = createLiquidModel({ seed: 13 });
  m.settle();
  const { S } = m.letterBoxes;
  const sx = S.x + S.w * 0.5;
  const sy = S.y + S.h * 0.5;

  m.pointerDown(sx, sy);
  run(m, 0.45, (i, n) => m.pointerMove(sx + 0.36 * (i / n), sy + 0.24 * (i / n)));
  m.pointerMove(sx + 0.36, sy + 0.24);
  run(m, 0.2);

  const ripplesBefore = m.metrics().mergeRippleCount;
  m.pointerUp();

  let peakEnergy = 0;
  let uDisturbed = 0;
  run(m, 0.9, () => {
    const met = m.metrics();
    if (met.meanEnergy > peakEnergy) peakEnergy = met.meanEnergy;
    for (let i = 0; i < m.count; i += 1) {
      if (m.letter[i] === 0) {
        uDisturbed = Math.max(uDisturbed, Math.hypot(m.x[i] - m.homeX[i], m.y[i] - m.homeY[i]));
      }
    }
  });
  const afterWave = m.metrics();
  assert.ok(afterWave.mergeRippleCount > ripplesBefore, `coalescence impact triggered merge ripples (${afterWave.mergeRippleCount - ripplesBefore})`);
  assert.ok(peakEnergy > 0.03, `merge shimmer energy peaked (${peakEnergy.toFixed(4)})`);
  assert.ok(uDisturbed < 0.005, `distant U stayed undisturbed during S merge (${uDisturbed.toFixed(5)})`);

  run(m, 2.5);
  const rest = m.metrics();
  assert.ok(rest.meanDisplacement < 0.003, `reconstructed cleanly (${rest.meanDisplacement.toFixed(5)})`);
  assert.ok(rest.meanEnergy < 0.005, `surface shimmer faded cleanly (${rest.meanEnergy.toFixed(5)})`);
  assert.equal(rest.phase, 'rest', 'returned to rest phase');
});

test('subtle hover approach draws a gentle local meniscus swell and recovers on leave', () => {
  const m = createLiquidModel({ seed: 19 });
  m.settle();
  const { U } = m.letterBoxes;
  const hx = U.x + U.w * 0.1 + 0.055;
  const hy = U.y + U.h * 0.3;

  m.hoverMove(hx, hy);
  run(m, 0.45);
  const hovered = m.metrics();
  assert.ok(hovered.maxDisplacement > 0.004 && hovered.maxDisplacement < 0.03,
    `hover induces subtle local swell (${hovered.maxDisplacement.toFixed(4)})`);
  assert.ok(hovered.meanEnergy > 0.002, `hover wakes subtle meniscus glint (${hovered.meanEnergy.toFixed(4)})`);

  let farMoved = 0;
  for (let i = 0; i < m.count; i += 1) {
    if (m.letter[i] === 1) farMoved = Math.max(farMoved, Math.hypot(m.x[i] - m.homeX[i], m.y[i] - m.homeY[i]));
  }
  assert.equal(farMoved, 0, 'hover near U does not perturb S');

  m.hoverLeave();
  run(m, 1.0);
  const settled = m.metrics();
  assert.ok(settled.maxDisplacement < 0.001, `hover relaxes cleanly on leave (${settled.maxDisplacement.toFixed(5)})`);
});
