import test from 'node:test';
import assert from 'node:assert/strict';
import { HoneyModel } from '../experiments/honey-plotter/model.mjs';
import {
  threadStyle,
  sampleTrailPoints,
  traceSmoothChunk,
  drawDepositedThread,
  drawSuspendedFilament,
  drawNozzle,
} from '../experiments/honey-plotter/render.mjs';

function detectLoopMetrics(points) {
  const mins = [];
  const maxs = [];
  for (let i = 2; i < points.length - 2; i++) {
    if (points[i].y < points[i - 1].y && points[i].y <= points[i + 1].y) mins.push(points[i]);
    if (points[i].y > points[i - 1].y && points[i].y >= points[i + 1].y) maxs.push(points[i]);
  }
  const n = Math.min(mins.length, maxs.length);
  const heights = [];
  const centers = [];
  for (let i = 0; i < n; i++) {
    heights.push(maxs[i].y - mins[i].y);
    centers.push(0.5 * (maxs[i].y + mins[i].y));
  }
  const pitches = [];
  for (let i = 1; i < maxs.length; i++) pitches.push(maxs[i - 1].x - maxs[i].x);
  return { mins, maxs, heights, centers, pitches };
}

function makeMockCanvasContext() {
  const ops = [];
  const checkFinite = (...vals) => {
    for (const v of vals) {
      assert.ok(Number.isFinite(v), `expected finite canvas coordinate, got ${v}`);
    }
  };
  const grad = () => ({
    addColorStop(stop, color) {
      checkFinite(stop);
      assert.equal(typeof color, 'string');
    },
  });
  return {
    ops,
    lineJoin: 'miter',
    lineCap: 'butt',
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    save() { ops.push('save'); },
    restore() { ops.push('restore'); },
    translate(x, y) { checkFinite(x, y); ops.push('translate'); },
    rotate(a) { checkFinite(a); ops.push('rotate'); },
    beginPath() { ops.push('beginPath'); },
    closePath() { ops.push('closePath'); },
    moveTo(x, y) { checkFinite(x, y); ops.push(['M', x, y]); },
    lineTo(x, y) { checkFinite(x, y); ops.push(['L', x, y]); },
    quadraticCurveTo(cx, cy, x, y) { checkFinite(cx, cy, x, y); ops.push(['Q', cx, cy, x, y]); },
    arc(x, y, r, s, e) { checkFinite(x, y, r, s, e); ops.push('arc'); },
    ellipse(x, y, rx, ry, rot, s, e) { checkFinite(x, y, rx, ry, rot, s, e); ops.push('ellipse'); },
    fillRect(x, y, w, h) { checkFinite(x, y, w, h); ops.push('fillRect'); },
    stroke() { checkFinite(this.lineWidth); ops.push('stroke'); },
    fill() { ops.push('fill'); },
    createLinearGradient(x0, y0, x1, y1) { checkFinite(x0, y0, x1, y1); return grad(); },
    createRadialGradient(x0, y0, r0, x1, y1, r1) { checkFinite(x0, y0, r0, x1, y1, r1); return grad(); },
  };
}

test('steady pour exhibits bounded deterministic per-loop variation in radius, pitch, and wander', () => {
  const a = new HoneyModel({ seed: 42 });
  const b = new HoneyModel({ seed: 42 });
  const c = new HoneyModel({ seed: 101 });

  for (let i = 0; i < 660; i++) {
    a.step(1 / 60);
    b.step(1 / 60);
    c.step(1 / 60);
  }

  assert.deepEqual(a.points, b.points, 'per-loop variation is strictly deterministic for a given seed');
  assert.notDeepEqual(
    a.points.map(p => p.y),
    c.points.map(p => p.y),
    'different seeds produce distinct organic loop trains'
  );

  const metrics = detectLoopMetrics(a.points);
  assert.ok(metrics.heights.length >= 8, 'prefill yields a full train of steady coils');

  const span = arr => Math.max(...arr) - Math.min(...arr);
  assert.ok(span(metrics.heights) > 0.025 && span(metrics.heights) < 0.14, 'bounded loop height variation');
  assert.ok(span(metrics.pitches) > 0.012 && span(metrics.pitches) < 0.08, 'bounded loop pitch variation');
  assert.ok(span(metrics.centers) > 0.012 && span(metrics.centers) < 0.10, 'bounded gentle vertical wander');
});

test('a tracked deposited loop ages from point.born with widening, slumping, and softened gloss', () => {
  const model = new HoneyModel({ seed: 42 });
  for (let i = 0; i < 180; i++) model.step(1 / 60);

  const tracked = model.points.slice(-110);
  const measure = pts => {
    const ys = pts.map(p => p.y);
    const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    return {
      spanY: Math.max(...ys) - Math.min(...ys),
      meanR: mean(pts.map(p => p.r)),
      meanGloss: mean(pts.map(p => p.gloss)),
      meanPile: mean(pts.map(p => p.pile)),
      meanAge: mean(pts.map(p => model.pointAge(p))),
      meanSettle: mean(pts.map(p => model.settleOf(p))),
    };
  };

  const fresh = measure(tracked);
  for (let i = 0; i < 360; i++) model.step(1 / 60);
  const aged = measure(tracked);

  assert.ok(aged.meanAge > fresh.meanAge + 5.9, 'pointAge derives real conveyor dwell time from point.born');
  assert.ok(aged.meanSettle > 0.6 && fresh.meanSettle < 0.16, 'settleOf advances smoothly with point.born age');
  assert.ok(aged.spanY < fresh.spanY * 0.94 && aged.spanY > fresh.spanY * 0.6, 'aged loop slumps gently without flattening out');
  assert.ok(aged.meanR > fresh.meanR * 1.14, 'older honey widens noticeably onto the warm belt');
  assert.ok(aged.meanGloss < fresh.meanGloss - 0.12, 'older honey softens its fresh specular gloss');
  assert.ok(aged.meanPile > fresh.meanPile + 0.12, 'older honey develops a deeper settling cushion');
  assert.ok(model.points.every(p => p.r >= 0.32 && p.r <= 1.58 && p.gloss >= 0.4 && p.gloss <= 1), 'settled attributes remain strictly bounded');

  // Verify non-finite born guard and zero-dt pause immutability.
  assert.ok(Number.isFinite(model.settleOf({ born: Number.NaN })));
  const frozen = JSON.stringify(model.points);
  model.step(0);
  assert.equal(JSON.stringify(model.points), frozen, 'paused dt=0 does not age or slump still samples');
});

test('settling render optics soften rim, broaden highlights, lower cast shadow, and stay C1 finite', () => {
  const fresh = threadStyle({ settle: 0, gloss: 0.86, pile: 0.2, width: 10 });
  const settled = threadStyle({ settle: 0.75, gloss: 0.58, pile: 0.42, width: 12.2 });

  assert.ok(settled.rimAlpha < fresh.rimAlpha - 0.15, 'rim softens with age to read liquid rather than wire');
  assert.ok(settled.specAlpha < fresh.specAlpha - 0.25, 'specular intensity softens as honey flattens');
  assert.ok(settled.specWidth > fresh.specWidth * 1.4, 'specular highlight broadens as surface curvature relaxes');
  assert.ok(settled.shadowOy < fresh.shadowOy * 0.65, 'cast shadow sits closer to the belt as rope slumps');
  assert.ok(settled.skirtWidth > fresh.skirtWidth * 1.25, 'meniscus pooling skirt widens with age');
  assert.ok(Object.values(fresh).every(Number.isFinite) && Object.values(settled).every(Number.isFinite));

  // Verify C1 midpoint chunk joins align end-to-start with zero positional gap.
  const model = new HoneyModel({ seed: 42 });
  for (let i = 0; i < 660; i++) model.step(1 / 60);
  const beltY = (ny, h) => h * (0.36 + ny * 0.56);
  const pts = sampleTrailPoints(model, 1280, 340, beltY);

  const c1 = makeMockCanvasContext();
  traceSmoothChunk(c1, pts, 0, 8, 0, 0, 0);
  const lastQ = c1.ops.filter(op => Array.isArray(op)).at(-1);

  const c2 = makeMockCanvasContext();
  traceSmoothChunk(c2, pts, 8, 16, 0, 0, 0);
  const firstM = c2.ops.filter(op => Array.isArray(op))[0];

  assert.equal(firstM[0], 'M');
  assert.ok(
    Math.abs(lastQ[3] - firstM[1]) < 1e-9 && Math.abs(lastQ[4] - firstM[2]) < 1e-9,
    'adjacent chunks join seamlessly at exact midpoint'
  );

  // Execute full render pipeline on steady, stretched, and minimal (2-point) states.
  const ctx = makeMockCanvasContext();
  const geom = { collarH: 12, anchorX: 230, anchorY: 10, len: 30, angle: 0.05, tipX: 228, tipY: 40 };
  const tip = model.points.at(-1);
  drawDepositedThread(ctx, model, 1280, 340, 10.2, beltY);
  drawSuspendedFilament(ctx, model, 1280, 340, geom, tip.x * 1280, beltY(tip.y, 340), 10.2, beltY);
  drawNozzle(ctx, model, geom, { dragging: false, hovering: false });
  drawNozzle(ctx, model, geom, { dragging: true, hovering: true });
  assert.ok(ctx.ops.length > 100, 'full render executes cleanly with strictly finite geometry');

  const tiny = new HoneyModel({ seed: 7 });
  tiny.step(1 / 60);
  const tinyCtx = makeMockCanvasContext();
  drawDepositedThread(tinyCtx, tiny, 320, 200, 6.8, beltY);
  drawSuspendedFilament(tinyCtx, tiny, 320, 200, geom, 60, 120, 6.8, beltY);
  assert.ok(tinyCtx.ops.length > 10, 'short nascent trail renders cleanly on narrow viewports');
});
