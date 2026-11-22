import test from 'node:test';
import assert from 'node:assert/strict';
import { SandModel } from '../experiments/singing-sand/model.mjs';

test('a touch creates a localized disturbance followed by a legible travelling wave', () => {
  const model = new SandModel({ seed: 31, count: 1600 });
  for (let i = 0; i < 180; i++) model.step(1 / 60);

  const rest = model.grains.map(g => ({
    x: g.x,
    y: g.y,
    d: Math.hypot(g.x + 0.65, g.y),
  }));

  model.press(-0.65, 0);
  model.release();

  let nearImm = 0, nearCount = 0, farImm = 0, farCount = 0;
  for (let i = 0; i < model.grains.length; i++) {
    const disp = Math.hypot(model.grains[i].x - rest[i].x, model.grains[i].y - rest[i].y);
    if (rest[i].d < 0.30) { nearImm += disp; nearCount++; }
    if (rest[i].d > 0.72) { farImm += disp; farCount++; }
  }
  assert.ok(nearCount > 20 && farCount > 100);
  assert.ok(nearImm / nearCount > 0.05, 'touch must immediately clear nearby grains');
  assert.ok(farImm / farCount < 0.002, 'far side should not teleport before the wave arrives');

  const bands = [[0, 0.30], [0.35, 0.68], [0.72, 1.15]];
  const peakTime = [0, 0, 0];
  const peakDisp = [0, 0, 0];
  const peakHop = [0, 0, 0];

  for (let f = 1; f <= 120; f++) {
    model.step(1 / 60);
    const t = f / 60;
    for (let b = 0; b < bands.length; b++) {
      const [lo, hi] = bands[b];
      let sumD = 0, sumZ = 0, n = 0;
      for (let i = 0; i < model.grains.length; i++) {
        if (rest[i].d >= lo && rest[i].d < hi) {
          n++;
          sumD += Math.hypot(model.grains[i].x - rest[i].x, model.grains[i].y - rest[i].y);
          sumZ += model.grains[i].z;
        }
      }
      const md = sumD / n;
      const mz = sumZ / n;
      if (md > peakDisp[b]) { peakDisp[b] = md; peakTime[b] = t; }
      if (mz > peakHop[b]) peakHop[b] = mz;
    }
  }

  assert.ok(peakTime[0] < peakTime[1] && peakTime[1] < peakTime[2],
    `wave peak should travel outward sequentially, got ${peakTime.join(', ')}`);
  assert.ok(peakDisp[1] > 0.035 && peakDisp[2] > 0.015,
    `travelling wave should visibly disturb mid and far ridges, got ${peakDisp.join(', ')}`);
  assert.ok(peakHop[1] > 0.04, 'passing crest should briefly hop grains off the steel plate');

  for (let i = 0; i < 120; i++) model.step(1 / 60);
  assert.equal(model.ripples.length, 0);
  assert.ok(model.meanDistance() < 0.001);
  assert.ok(model.grains.every(g => g.z === 0));
});

test('holding a touch damps a local pocket and releasing triggers a rebound wave', () => {
  const model = new SandModel({ seed: 14, count: 1000 });
  for (let i = 0; i < 180; i++) model.step(1 / 60);

  model.press(0.15, -0.1);
  for (let i = 0; i < 24; i++) model.step(1 / 60);
  assert.equal(model.finger.active, true);
  assert.ok(model.finger.hold > 0.35, 'sustained press builds hold tension');

  const ripplesBeforeRelease = model.ripples.length;
  model.release();
  assert.equal(model.finger.active, false);
  assert.equal(model.ripples.length, ripplesBeforeRelease + 1, 'releasing a held press emits a rebound ripple');

  for (let i = 0; i < 200; i++) model.step(1 / 60);
  assert.ok(model.meanDistance() < 0.001, 'pocket refills cleanly after release');
});

test('all five modes are distinct, textured ridges and preserve full-plate coverage across repeated tuning', () => {
  const model = new SandModel({ seed: 19, count: 2400 });
  for (let i = 0; i < 180; i++) model.step(1 / 60);

  const occupancy = grains => {
    const cells = new Set();
    for (const g of grains) {
      const ix = Math.floor(((g.x + 1) * 0.5) * 28);
      const iy = Math.floor(((g.y + 1) * 0.5) * 28);
      cells.add(`${ix},${iy}`);
    }
    return cells.size;
  };

  const freshMode0Cells = occupancy(model.grains);
  const settledModes = [];

  for (let mode = 0; mode < model.modeCount(); mode++) {
    model.setMode(mode);
    for (let i = 0; i < 180; i++) model.step(1 / 60);
    assert.ok(model.meanDistance() < 0.001, `mode ${mode} should settle cleanly`);
    const meanAbsField = model.grains.reduce((s, g) => s + Math.abs(model.fieldAt(g.x, g.y)), 0) / model.grains.length;
    assert.ok(meanAbsField > 0.015 && meanAbsField < 0.35,
      `mode ${mode} should form textured ridges near nodes, got mean |F|=${meanAbsField}`);
    settledModes.push(model.grains.map(g => ({ x: g.x, y: g.y })));
  }

  for (let a = 0; a < settledModes.length; a++) {
    const b = (a + 1) % settledModes.length;
    const travel = settledModes[a].reduce((s, p, i) =>
      s + Math.hypot(p.x - settledModes[b][i].x, p.y - settledModes[b][i].y), 0) / settledModes[a].length;
    assert.ok(travel > 0.05, `adjacent modes ${a} -> ${b} must look distinctly different`);
  }

  for (let step = 0; step < 10; step++) {
    model.setMode(step % model.modeCount());
    for (let i = 0; i < 120; i++) model.step(1 / 60);
  }
  model.setMode(0);
  for (let i = 0; i < 180; i++) model.step(1 / 60);
  const cycledMode0Cells = occupancy(model.grains);
  assert.ok(cycledMode0Cells >= freshMode0Cells * 0.85,
    `repeated tuning should preserve coverage (${cycledMode0Cells} vs ${freshMode0Cells})`);
});

test('seeded simulation is deterministic and zero dt freezes mid-ripple state', () => {
  const run = () => {
    const m = new SandModel({ seed: 77, count: 500 });
    for (let i = 0; i < 60; i++) m.step(1 / 60);
    m.press(-0.2, 0.3);
    for (let i = 0; i < 10; i++) m.step(1 / 60);
    m.drag(0.15, 0.25);
    for (let i = 0; i < 12; i++) m.step(1 / 60);
    m.release();
    for (let i = 0; i < 15; i++) m.step(1 / 60);
    return m;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.grains, b.grains);
  assert.deepEqual(a.ripples, b.ripples);

  const snapshotGrains = JSON.stringify(a.grains);
  const snapshotRipples = JSON.stringify(a.ripples);
  a.step(0);
  assert.equal(JSON.stringify(a.grains), snapshotGrains);
  assert.equal(JSON.stringify(a.ripples), snapshotRipples);
});
