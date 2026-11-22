import test from 'node:test';
import assert from 'node:assert/strict';
import { HoneyModel } from '../experiments/honey-plotter/model.mjs';

test('grabbing and dragging quickly exhibits viscous lag and stretches filament into thin ribbons', () => {
  const model = new HoneyModel({ seed: 42 });
  for (let i = 0; i < 180; i++) model.step(1 / 60);

  const steadyR = model.points.at(-1).r;
  const steadyWaist = model.filamentProfile().waist;

  model.grab(0.18, 0.48);
  let peakTension = 0;
  let minWaist = Infinity;
  let minRibbonR = Infinity;
  for (let i = 0; i < 28; i++) {
    const t = i / 27;
    model.drag(0.18 + t * 0.36, 0.48 + t * 0.22);
    model.step(1 / 60);
    peakTension = Math.max(peakTension, model.tension);
    minWaist = Math.min(minWaist, model.filamentProfile().waist);
    minRibbonR = Math.min(minRibbonR, model.points.at(-1).r);
  }

  assert.equal(model.grabbed, true);
  assert.ok(model.nozzleX > 0.25 && model.nozzleX < 0.54, 'damped viscous resistance lags target');
  assert.ok(model.footX < model.nozzleX, 'touchdown foot trails moving nozzle');
  assert.ok(peakTension > 0.65, 'rapid drag raises filament tension');
  assert.ok(minWaist < steadyWaist * 0.7, 'suspended filament necks visibly thinner under tension');
  assert.ok(minRibbonR < steadyR * 0.7, 'deposited honey thins into taut ribbon');
  assert.equal(model.gestureState, 'stretch');
});

test('pausing and holding the nozzle steady builds tight glossy coils and swells the contact puddle', () => {
  const model = new HoneyModel({ seed: 42 });
  for (let i = 0; i < 180; i++) model.step(1 / 60);

  const steadyR = model.points.at(-1).r;
  const steadyPuddle = model.puddle;

  model.grab(0.18, 0.48);
  for (let i = 0; i < 65; i++) model.step(1 / 60);

  const tip = model.points.at(-1);
  assert.ok(model.dwell > 0.75, 'holding builds dwell coiling state');
  assert.ok(model.tension < 0.15, 'stationary hold relaxes stretch tension');
  assert.ok(model.puddle > steadyPuddle + 0.2, 'contact puddle swells under stationary coils');
  assert.ok(tip.r > steadyR * 1.15, 'stationary coils deposit thicker glossy thread');
  assert.ok(tip.pile > 0.7, 'pile buildup reflects tight stacked coils');
  assert.equal(model.gestureState, 'coil');
});

test('releasing a displaced pull triggers deterministic capillary snap-back and settles to steady flow', () => {
  const runSequence = () => {
    const m = new HoneyModel({ seed: 77 });
    for (let i = 0; i < 120; i++) m.step(1 / 60);
    m.grab(0.18, 0.48);
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      m.drag(0.18 + t * 0.36, 0.48 + t * 0.20);
      m.step(1 / 60);
    }
    const displacedY = m.nozzleY;
    m.release();
    const initialRebound = m.rebound;
    const initialBead = m.bead;
    const stateAtRelease = m.gestureState;

    let maxWhip = 0;
    let maxBeadR = 0;
    for (let i = 0; i < 120; i++) {
      m.step(1 / 60);
      maxWhip = Math.max(maxWhip, Math.abs(m.filamentProfile().whip));
      maxBeadR = Math.max(maxBeadR, m.points.at(-1).r);
    }
    return { m, displacedY, initialRebound, initialBead, stateAtRelease, maxWhip, maxBeadR };
  };

  const a = runSequence();
  const b = runSequence();

  assert.equal(a.m.grabbed, false);
  assert.equal(a.stateAtRelease, 'rebound');
  assert.ok(a.initialRebound > 0.4, 'release injects capillary rebound energy');
  assert.ok(a.initialBead > 0.35, 'release forms capillary recoil bead');
  assert.ok(a.maxWhip > 0.25, 'suspended filament exhibits transverse recoil wave');
  assert.ok(a.maxBeadR > 1.05, 'capillary bead swells landing thread during snap-back');
  assert.ok(Math.abs(a.m.nozzleX - a.m.restX) < 0.015, 'nozzle returns smoothly to horizontal rest');
  assert.ok(Math.abs(a.m.nozzleY - a.displacedY) < 0.05, 'vertical pour track is preserved');
  assert.equal(a.m.gestureState, 'steady');
  assert.deepEqual(a.m.points, b.m.points, 'gesture physics remain deterministic across runs');
});

test('paused bounded micro-steps reshape a still composition without wiping history or advancing at dt=0', () => {
  const model = new HoneyModel({ seed: 19 });
  for (let i = 0; i < 180; i++) model.step(1 / 60);
  const countBefore = model.points.length;

  // Stopped time never mutates state.
  const frozenBefore = JSON.stringify({
    time: model.time,
    beltOffset: model.beltOffset,
    nozzleX: model.nozzleX,
    nozzleY: model.nozzleY,
    tip: model.points.at(-1),
  });
  model.step(0);
  model.step(-0.05);
  const frozenAfter = JSON.stringify({
    time: model.time,
    beltOffset: model.beltOffset,
    nozzleX: model.nozzleX,
    nozzleY: model.nozzleY,
    tip: model.points.at(-1),
  });
  assert.equal(frozenAfter, frozenBefore, 'zero or negative dt keeps still frozen');

  // Bounded paused drag (3 frames per move) + release (20 frames) visibly updates the still.
  model.grab(0.18, 0.48);
  for (let move = 1; move <= 6; move++) {
    model.drag(0.18 + move * 0.055, 0.48 + move * 0.03);
    for (let k = 0; k < 3; k++) model.step(1 / 60);
  }
  assert.ok(model.points.length > countBefore, 'paused drag appends to existing thread instead of wiping');
  assert.ok(model.nozzleX > 0.24, 'bounded paused drag visibly displaces nozzle');
  const stretchedX = model.nozzleX;

  model.release();
  for (let k = 0; k < 20; k++) model.step(1 / 60);
  assert.ok(model.nozzleX < stretchedX, 'bounded paused release shows snap-back progress');

  const settledStill = JSON.stringify(model.points.at(-1));
  model.step(0);
  assert.equal(JSON.stringify(model.points.at(-1)), settledStill, 'remains still after paused gesture');
});

test('extreme inputs and prolonged stepping keep all state strictly finite and bounded', () => {
  const model = new HoneyModel({ seed: 999 });
  model.setSpeed(Number.NaN);
  model.setNozzle(Number.POSITIVE_INFINITY);
  model.grab(Number.NEGATIVE_INFINITY, Number.NaN);
  model.step(Number.NaN);
  model.step(10);

  for (let i = 0; i < 3000; i++) {
    if (i % 40 === 0) model.drag(i % 80 === 0 ? 99 : -99, i % 80 === 0 ? -42 : 42);
    if (i % 40 === 20) model.release();
    model.step(0.05);
  }

  const scalars = [
    model.speed,
    model.nozzle,
    model.nozzleX,
    model.nozzleY,
    model.velX,
    model.velY,
    model.footX,
    model.footY,
    model.footVelX,
    model.footVelY,
    model.tension,
    model.dwell,
    model.rebound,
    model.whipAmp,
    model.bead,
    model.puddle,
    model.tilt,
    model.beltOffset,
    model.time,
  ];
  assert.ok(scalars.every(Number.isFinite), 'all physical state scalars stay finite');
  assert.ok(model.nozzleX >= 0.08 && model.nozzleX <= 0.62, 'nozzleX stays inside gantry limits');
  assert.ok(model.nozzleY >= 0.23 && model.nozzleY <= 0.77, 'nozzleY stays inside belt limits');
  assert.ok(model.tension >= 0 && model.tension <= 1, 'tension stays normalized');
  assert.ok(model.dwell >= 0 && model.dwell <= 1, 'dwell stays normalized');
  assert.ok(model.rebound >= 0 && model.rebound <= 1, 'rebound stays normalized');
  assert.ok(model.points.length <= 2600, 'deposited history stays memory-bounded');
  assert.ok(
    model.points.every(
      p =>
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Number.isFinite(p.born) &&
        Number.isFinite(p.r) &&
        p.r >= 0.3 &&
        p.r <= 1.6 &&
        Number.isFinite(p.pile) &&
        Number.isFinite(p.gloss)
    ),
    'all deposited samples remain finite and within material bounds'
  );
});
