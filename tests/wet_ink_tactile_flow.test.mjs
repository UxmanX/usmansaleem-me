import test from 'node:test';
import assert from 'node:assert/strict';
import { InkField } from '../experiments/wet-ink/model.mjs';

test('stationary ink drop blooms radially without concentric bullseye rings', () => {
  const w = 64, h = 64;
  const src = new Float32Array(w * h).fill(0.75);
  const field = new InkField(w, h, src);
  const cx = 32, cy = 32;
  field.stir(cx, cy, 0, 0, 20);

  // Orange pigment decreases monotonically outward (no sine-ring bullseye oscillations)
  let prev = field.orange[cy * w + cx];
  assert.ok(prev > 0.35, 'ink drop deposits rich signal-orange core');
  for (let r = 1; r <= 18; r++) {
    const val = field.orange[cy * w + (cx + r)];
    assert.ok(val <= prev + 1e-6, `drop profile must not oscillate into rings at r=${r}: ${val} > ${prev}`);
    prev = val;
  }

  // Surface-tension drop pushes fluid radially outward in all four cardinal directions
  assert.ok(field.u[cy * w + (cx + 6)] > 0, 'pushes right');
  assert.ok(field.u[cy * w + (cx - 6)] < 0, 'pushes left');
  assert.ok(field.v[(cy + 6) * w + cx] > 0, 'pushes down');
  assert.ok(field.v[(cy - 6) * w + cx] < 0, 'pushes up');
  // Gently parts underlying black ink at the fresh drop core
  assert.ok(field.ink[cy * w + cx] < src[cy * w + cx], 'fresh orange drop parts dark ink');
});

test('moving drag generates a symmetric twin-eddy dipole wake and preserves crisp edges under MacCormack advection', () => {
  const w = 72, h = 72;
  const src = Float32Array.from({ length: w * h }, (_, i) => ((i % w) % 8 < 4 ? 0.85 : 0.2));
  const field = new InkField(w, h, src);
  const cx = 36, cy = 36, r = 18;
  field.stir(cx, cy, 10, 0, r);

  // Center moves forward with drag; both flanks counter-curl backward (dipole eddies)
  assert.ok(field.u[cy * w + cx] > 10, 'center moves along drag direction');
  assert.ok(field.u[(cy - 10) * w + cx] < 0, 'upper flank curls back into counter-eddy');
  assert.ok(field.u[(cy + 10) * w + cx] < 0, 'lower flank curls back into counter-eddy');
  // Cross-stream lateral flow ahead of stylus parts symmetrically
  assert.ok(field.v[(cy - 4) * w + (cx + 4)] < 0, 'upper leading edge parts upward');
  assert.ok(field.v[(cy + 4) * w + (cx + 4)] > 0, 'lower leading edge parts downward');
  assert.ok(
    Math.abs(field.v[(cy - 4) * w + (cx + 4)] + field.v[(cy + 4) * w + (cx + 4)]) < 1e-4,
    'straight stroke dipole wake is symmetric'
  );

  // Clamped MacCormack stays strictly bounded inside [0.2, 0.85] with zero overshoot
  for (let k = 0; k < 40; k++) field.step(1 / 60);
  assert.ok(field.ink.every(v => Number.isFinite(v) && v >= 0.0 && v <= 0.85 + 1e-5));
  assert.ok(field.orange.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
});

test('wet meniscus rises on stir, dries cleanly to zero, and reform unwinds displaced ink back to exact baseline', () => {
  const w = 64, h = 64;
  // Crisp vertical ink bar at x = 24
  const src = Float32Array.from({ length: w * h }, (_, i) => {
    const x = i % w, y = Math.floor(i / w);
    return x >= 22 && x <= 26 && y >= 18 && y <= 46 ? 0.92 : 0.08;
  });
  const field = new InkField(w, h, src);
  assert.equal(field.snapshot().wetness, 0, 'resting print begins dry');

  // Drag the ink bar rightward (+x)
  for (let s = 0; s < 5; s++) {
    field.stir(24 + s * 3, 32, 8, 0, 14, 0.4);
    field.step(1 / 60);
  }
  field.endStroke();
  for (let k = 0; k < 12; k++) field.step(1 / 60);
  assert.ok(field.snapshot().wetness > 0.01, 'disturbed ink becomes wet');

  const inkComX = () => {
    let sx = 0, sw = 0;
    for (let y = 24; y <= 40; y++) {
      for (let x = 10; x <= 54; x++) {
        const weight = Math.max(0, field.ink[y * w + x] - 0.1);
        sx += x * weight;
        sw += weight;
      }
    }
    return sw > 0 ? sx / sw : 0;
  };
  const shiftedCom = inkComX();
  assert.ok(shiftedCom > 25.5, `drag must transport ink bar right, got COM=${shiftedCom}`);

  // Start reform: energy zeroes immediately while liquid unwind pulls ink physically back left
  field.reform();
  assert.equal(field.snapshot().energy, 0);
  for (let k = 0; k < 18; k++) field.step(1 / 60);
  const midCom = inkComX();
  assert.ok(midCom < shiftedCom - 0.5, `reform unwind must pull ink back toward origin: ${midCom} < ${shiftedCom}`);
  assert.equal(field.snapshot().energy, 0);

  // Interrupting reform hands control immediately back to live touch
  field.stir(32, 32, 0, 0, 12);
  assert.equal(field.recovering, false);
  assert.ok(field.snapshot().energy > 0);

  // Full reform completes cleanly to exact baseline with dry matte surface
  field.reform();
  for (let k = 0; k < 180; k++) field.step(1 / 60);
  const done = field.snapshot();
  assert.equal(done.displacement, 0);
  assert.equal(done.orangeDisplacement, 0);
  assert.equal(done.wetness, 0);
  assert.equal(done.energy, 0);
});
