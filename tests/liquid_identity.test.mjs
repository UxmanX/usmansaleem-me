// Liquid Identity — material motion model tests.
// Run: node --test tests/liquid_identity.test.mjs
// The model is DOM-free so it can be exercised without a browser.
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

// Occupancy raster of discs around each particle, in model space.
function rasterize(xs, ys, count, bounds, cell = 0.02, radius = 0.035) {
  const cols = Math.ceil(bounds.width / cell);
  const rows = Math.ceil(bounds.height / cell);
  const grid = new Uint8Array(cols * rows);
  const r = Math.ceil(radius / cell);
  for (let i = 0; i < count; i += 1) {
    const cx = Math.floor(xs[i] / cell);
    const cy = Math.floor(ys[i] / cell);
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
        if ((dx * dx + dy * dy) * cell * cell <= radius * radius) grid[gy * cols + gx] = 1;
      }
    }
  }
  return grid;
}

function iou(a, b) {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] && b[i]) inter += 1;
    if (a[i] || b[i]) union += 1;
  }
  return union ? inter / union : 1;
}

function homeRaster(m) {
  return rasterize(m.homeX, m.homeY, m.count, m.bounds);
}

function liveRaster(m) {
  return rasterize(m.x, m.y, m.count, m.bounds);
}

test('home targets trace an authored, readable US monogram', () => {
  const m = createLiquidModel({ seed: 3 });
  const { width, height } = m.bounds;
  assert.ok(m.count >= 300, `enough liquid to read as a mark (got ${m.count})`);
  let left = 0;
  let right = 0;
  for (let i = 0; i < m.count; i += 1) {
    assert.ok(m.homeX[i] > 0 && m.homeX[i] < width, 'home x inside bounds');
    assert.ok(m.homeY[i] > 0 && m.homeY[i] < height, 'home y inside bounds');
    if (m.homeX[i] < width / 2) left += 1; else right += 1;
  }
  assert.ok(left > m.count * 0.3 && right > m.count * 0.3, 'both letters carry liquid');

  const { U, S } = m.letterBoxes;
  const inBox = (box, fx0, fy0, fx1, fy1) => {
    let n = 0;
    const x0 = box.x + box.w * fx0;
    const x1 = box.x + box.w * fx1;
    const y0 = box.y + box.h * fy0;
    const y1 = box.y + box.h * fy1;
    for (let i = 0; i < m.count; i += 1) {
      if (m.homeX[i] >= x0 && m.homeX[i] <= x1 && m.homeY[i] >= y0 && m.homeY[i] <= y1) n += 1;
    }
    return n;
  };
  // U: two arms and a closed bowl, open between the arms at the top.
  assert.ok(inBox(U, 0, 0, 0.3, 0.5) > 10, 'U left arm');
  assert.ok(inBox(U, 0.7, 0, 1, 0.5) > 10, 'U right arm');
  assert.ok(inBox(U, 0.35, 0.8, 0.65, 1) > 5, 'U bowl closes at bottom');
  assert.equal(inBox(U, 0.38, 0, 0.62, 0.55), 0, 'U is open between the arms');
  // S: top, spine and bottom strokes; the counters stay open.
  assert.ok(inBox(S, 0.3, 0, 0.8, 0.2) > 5, 'S top stroke');
  assert.ok(inBox(S, 0.3, 0.4, 0.7, 0.6) > 5, 'S spine');
  assert.ok(inBox(S, 0.2, 0.8, 0.7, 1) > 5, 'S bottom stroke');
  assert.equal(inBox(S, 0.62, 0.3, 0.95, 0.38), 0, 'S upper-right counter open');
  assert.equal(inBox(S, 0.05, 0.62, 0.38, 0.7), 0, 'S lower-left counter open');
});

test('starting droplets are seeded, mildly varied, and assemble into the mark', () => {
  const a = createLiquidModel({ seed: 11 });
  const a2 = createLiquidModel({ seed: 11 });
  const b = createLiquidModel({ seed: 12 });
  assert.deepEqual(Array.from(a.x), Array.from(a2.x), 'same seed, same start');
  let diff = 0;
  for (let i = 0; i < a.count; i += 1) diff += Math.hypot(a.x[i] - b.x[i], a.y[i] - b.y[i]);
  diff /= a.count;
  assert.ok(diff > 0.01, `different seeds give different droplets (${diff.toFixed(4)})`);
  const start = a.metrics();
  assert.ok(start.meanDisplacement > 0.03, 'starts as droplets, not the finished mark');
  assert.ok(start.meanDisplacement < 0.4, 'variation stays mild');
  run(a, 4);
  const end = a.metrics();
  assert.ok(end.meanDisplacement < 0.01, `assembled (mean ${end.meanDisplacement.toFixed(4)})`);
  assert.ok(iou(liveRaster(a), homeRaster(a)) > 0.92, 'assembled liquid reads as the mark');
});

test('dragging genuinely pulls liquid into a thread toward the pointer', () => {
  const m = createLiquidModel({ seed: 5 });
  m.settle();
  const { U } = m.letterBoxes;
  const sx = U.x + U.w * 0.1;
  const sy = U.y + U.h * 0.3;
  const ex = sx - 0.05;
  const ey = sy + 0.45;
  m.pointerDown(sx, sy);
  run(m, 0.5, (i, n) => m.pointerMove(sx + (ex - sx) * (i / n), sy + (ey - sy) * (i / n)));
  m.pointerMove(ex, ey);
  run(m, 0.5);
  const met = m.metrics();
  assert.ok(met.captured >= 10, `liquid captured (${met.captured})`);
  assert.ok(met.meanDisplacement > 0.02, `mark displaced (${met.meanDisplacement.toFixed(4)})`);
  let atPointer = 0;
  let alongThread = 0;
  let farMoved = 0;
  const len = Math.hypot(ex - sx, ey - sy);
  for (let i = 0; i < m.count; i += 1) {
    const d = Math.hypot(m.x[i] - ex, m.y[i] - ey);
    if (d < 0.08) atPointer += 1;
    // projection onto the drag path, excluding both ends
    const t = ((m.x[i] - sx) * (ex - sx) + (m.y[i] - sy) * (ey - sy)) / (len * len);
    const px = sx + (ex - sx) * t;
    const py = sy + (ey - sy) * t;
    if (t > 0.2 && t < 0.8 && Math.hypot(m.x[i] - px, m.y[i] - py) < 0.05) alongThread += 1;
    if (m.homeX[i] > m.bounds.width * 0.6) farMoved = Math.max(farMoved, Math.hypot(m.x[i] - m.homeX[i], m.y[i] - m.homeY[i]));
  }
  assert.ok(atPointer >= 8, `a bead gathers at the pointer (${atPointer})`);
  assert.ok(alongThread >= 3, `a thread links bead and mark (${alongThread})`);
  assert.ok(farMoved < 0.02, `distant S stays put (${farMoved.toFixed(4)})`);
  assert.ok(iou(liveRaster(m), homeRaster(m)) < 0.95, 'the mark visibly changed');
});

test('release reconstructs the authored initials', () => {
  const m = createLiquidModel({ seed: 9 });
  m.settle();
  const { S } = m.letterBoxes;
  const sx = S.x + S.w * 0.5;
  const sy = S.y + S.h * 0.5;
  m.pointerDown(sx, sy);
  run(m, 0.6, (i, n) => m.pointerMove(sx + 0.35 * (i / n), sy - 0.3 * (i / n)));
  assert.ok(m.metrics().meanDisplacement > 0.02, 'drag displaced liquid first');
  m.pointerUp();
  assert.equal(m.metrics().captured, 0, 'release lets go');
  run(m, 4);
  const met = m.metrics();
  assert.ok(met.meanDisplacement < 0.01, `reformed (mean ${met.meanDisplacement.toFixed(4)})`);
  assert.ok(met.kinetic < 1e-4, `came to rest (${met.kinetic})`);
  assert.ok(iou(liveRaster(m), homeRaster(m)) > 0.92, 'reads as US again');
});

test('play splashes the mark into droplets, then it reforms', () => {
  const m = createLiquidModel({ seed: 21 });
  m.settle();
  m.play();
  run(m, 0.35);
  const mid = m.metrics();
  assert.ok(mid.meanDisplacement > 0.04, `splash moved liquid (${mid.meanDisplacement.toFixed(4)})`);
  assert.ok(iou(liveRaster(m), homeRaster(m)) < 0.85, 'splash visibly changes the mark');
  run(m, 4);
  assert.ok(m.metrics().meanDisplacement < 0.01, 'splash reforms');
});

test('state stays finite and bounded under hostile input', () => {
  const m = createLiquidModel({ seed: 1 });
  const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  m.pointerMove(NaN, NaN);
  m.pointerDown(Infinity, -Infinity);
  m.pointerDown(1e9, -1e9);
  m.step(10);
  m.step(-1);
  m.step(NaN);
  for (let i = 0; i < 900; i += 1) {
    if (i % 50 === 0) m.pointerUp();
    if (i % 50 === 1) m.pointerDown(rand() * 4 - 1.5, rand() * 4 - 1.5);
    m.pointerMove(rand() * 6 - 3, rand() * 6 - 3);
    if (i % 97 === 0) m.play();
    m.step(rand() * 0.2);
  }
  const met = m.metrics();
  assert.equal(met.finite, true, 'all state finite');
  const { width, height, margin } = m.bounds;
  for (let i = 0; i < m.count; i += 1) {
    assert.ok(Number.isFinite(m.x[i]) && Number.isFinite(m.y[i]), 'finite position');
    assert.ok(m.x[i] >= -margin && m.x[i] <= width + margin, 'x bounded');
    assert.ok(m.y[i] >= -margin && m.y[i] <= height + margin, 'y bounded');
    assert.ok(Math.hypot(m.vx[i], m.vy[i]) <= m.maxSpeed + 1e-6, 'speed capped');
  }
  m.pointerUp();
  run(m, 5);
  assert.ok(m.metrics().meanDisplacement < 0.01, 'recovers from abuse');
});

test('rendering kernel and threshold draw the authored stroke width', () => {
  const m = createLiquidModel({ seed: 2 });
  m.settle();
  const R = m.kernel;
  const field = (px, py) => {
    let f = 0;
    for (let i = 0; i < m.count; i += 1) {
      const r2 = ((m.x[i] - px) ** 2 + (m.y[i] - py) ** 2) / (R * R);
      if (r2 < 1) f += (1 - r2) ** 3;
    }
    return f;
  };
  const { U } = m.letterBoxes;
  const cx = U.x + m.stroke / 2;
  const y = U.y + U.h * 0.35;
  let inside = 0;
  for (let d = -0.15; d <= 0.15; d += 0.0025) if (field(cx + d, y) > m.threshold) inside += 0.0025;
  assert.ok(Math.abs(inside - m.stroke) < 0.02, `drawn stroke ${inside.toFixed(3)} vs authored ${m.stroke}`);
  assert.ok(m.threshold < 1, 'a single stray particle still shows as a small bead');
});

test('a tap pokes a local ripple into the liquid, then it settles', () => {
  const m = createLiquidModel({ seed: 8 });
  m.settle();
  const { U } = m.letterBoxes;
  const px = U.x + U.w * 0.5;
  const py = U.y + U.h * 0.95;
  m.poke(px, py);
  run(m, 0.25);
  let near = 0;
  let far = 0;
  for (let i = 0; i < m.count; i += 1) {
    const d = Math.hypot(m.x[i] - m.homeX[i], m.y[i] - m.homeY[i]);
    if (Math.hypot(m.homeX[i] - px, m.homeY[i] - py) < 0.12) near = Math.max(near, d);
    if (m.homeX[i] > m.bounds.width * 0.6) far = Math.max(far, d);
  }
  assert.ok(near > 0.03, `liquid near the tap moved (${near.toFixed(4)})`);
  assert.ok(far < 0.005, `distant liquid did not (${far.toFixed(4)})`);
  m.poke(NaN, 1);
  run(m, 4);
  assert.ok(m.metrics().meanDisplacement < 0.01, 'settles back');
});

test('reset returns to a fresh seeded droplet start; settle shows the still mark', () => {
  const m = createLiquidModel({ seed: 4 });
  m.settle();
  assert.ok(m.metrics().meanDisplacement < 1e-9, 'settle = exact authored mark (reduced motion still)');
  m.reset(99);
  assert.ok(m.metrics().meanDisplacement > 0.03, 'reset scatters into new starting droplets');
  run(m, 4);
  assert.ok(m.metrics().meanDisplacement < 0.01, 'and reassembles');
});
