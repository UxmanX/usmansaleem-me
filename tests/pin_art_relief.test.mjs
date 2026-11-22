import test from 'node:test';
import assert from 'node:assert/strict';
import { PinField, buildPortraitRelief } from '../experiments/pin-art/model.mjs';

test('coupled pin field propagates a travelling mechanical wave and rebounds past source before settling', () => {
  const w = 61, h = 71;
  const source = Float32Array.from({ length: w * h }, (_, i) => {
    const x = i % w, y = Math.floor(i / w);
    return 0.14 + 0.65 * Math.sin((x / w) * Math.PI) * Math.sin((y / h) * Math.PI);
  });
  const pins = new PinField(w, h, source);
  const cx = 30, cy = 35, r = 7;
  pins.press(cx, cy, r);

  // Immediately after press: pins strictly outside radius are untouched
  const idxNear = cy * w + (cx + r + 4);
  const idxFar = cy * w + (cx + r + 9);
  assert.equal(pins.z[idxNear], source[idxNear], 'pins outside initial press radius stay untouched before stepping');
  assert.equal(pins.z[idxFar], source[idxFar], 'distant pins stay untouched before stepping');

  let peakNear = 0, peakFar = 0, tNear = 0, tFar = 0, peakOvershoot = 0;
  for (let step = 1; step <= 360; step++) {
    pins.step(1 / 60);
    const dNear = Math.abs(pins.z[idxNear] - source[idxNear]);
    const dFar = Math.abs(pins.z[idxFar] - source[idxFar]);
    const over = pins.z[cy * w + cx] - source[cy * w + cx];
    if (dNear > peakNear) { peakNear = dNear; tNear = step; }
    if (dFar > peakFar) { peakFar = dFar; tFar = step; }
    if (over > peakOvershoot) peakOvershoot = over;
  }

  assert.ok(peakNear > 0.02, `expected measurable travelling wave at r+4, got ${peakNear}`);
  assert.ok(peakFar > 0.005, `expected travelling wave to reach r+9, got ${peakFar}`);
  assert.ok(tFar > tNear, `wave should arrive at r+9 (step ${tFar}) after r+4 (step ${tNear})`);
  assert.ok(peakOvershoot > 0.08, `expected crisp underdamped rebound overshoot, got ${peakOvershoot}`);
  assert.ok(pins.snapshot().displacement < 1e-5, 'field settles cleanly back to portrait');
});

test('stroke carves a continuous trail and release boosts elastic spring-back safely', () => {
  const w = 45, h = 55;
  const source = new Float32Array(w * h).fill(0.62);
  const pins = new PinField(w, h, source);
  pins.stroke(10, 27, 34, 27, 4, { hold: 0.25, stagger: 0.15 });

  // Every midpoint along the stroke segment should be cleanly depressed (no discrete dots/gaps)
  for (let x = 10; x <= 34; x += 2) {
    assert.ok(pins.z[27 * w + x] < 0.2, `expected continuous stroke depression at x=${x}`);
  }
  // Release clears hold and imparts positive upward velocity inside the pocket
  pins.release(22, 27, 8, 2.5);
  assert.equal(pins.hold[27 * w + 22], 0, 'release clears local pin hold');
  assert.ok(pins.v[27 * w + 22] > 0.2, 'release imparts upward spring-back velocity');

  // Guard non-finite inputs on stroke/release
  pins.stroke(NaN, 0, Infinity, 10, -2);
  pins.release(NaN, Infinity, -5, Infinity);
  for (let i = 0; i < 600; i++) pins.step(1 / 60);
  assert.ok(pins.z.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  assert.ok(pins.snapshot().displacement < 1e-5);
});

test('buildPortraitRelief suppresses background bokeh spikes while raising coherent facial relief', () => {
  const w = 45, h = 58;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Default bright neutral pavement background + noisy foliage & yellow bokeh patches near top
      let R = 228, G = 228, B = 230;
      if (y < 10) {
        // Dark greenish foliage bokeh along top edge
        R = 108 + (x % 5) * 6;
        G = 124 + (x % 5) * 6;
        B = 82 + (x % 5) * 4;
      } else if (x < 9 && y < 18) {
        // Bright yellow-orange bokeh blob in upper-left corner
        R = 232; G = 186; B = 118;
      }
      // Centered synthetic portrait silhouette: dark hair crown, warm skin face with recessed dark eyes & bright nose, cool navy torso
      const dx = (x - w / 2) / 11;
      const dy = (y - h * 0.46) / 16;
      const inHead = dx * dx + dy * dy < 1;
      const inShoulders = y > h * 0.74 && Math.abs(x - w / 2) < 18;
      if (inShoulders) {
        R = 24; G = 38; B = 72;
      }
      if (inHead) {
        if (y < h * 0.30) {
          R = 32; G = 26; B = 25; // hair
        } else {
          R = 148; G = 104; B = 84; // warm skin
          // Brighter nose bridge in center
          if (Math.abs(x - w / 2) <= 2 && Math.abs(y - h * 0.48) <= 4) {
            R = 166; G = 120; B = 98;
          }
          // Darker eye recesses flanking nose
          if ((Math.abs(x - (w / 2 - 4)) <= 1.5 || Math.abs(x - (w / 2 + 4)) <= 1.5) && Math.abs(y - h * 0.42) <= 1.5) {
            R = 68; G = 46; B = 40;
          }
        }
      }
      rgba[i] = R; rgba[i + 1] = G; rgba[i + 2] = B; rgba[i + 3] = 255;
    }
  }

  const { heights, albedo, fg } = buildPortraitRelief(rgba, w, h);
  assert.equal(heights.length, w * h);
  assert.ok(heights.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  assert.ok(albedo.every(v => Number.isFinite(v) && v >= 0 && v <= 1));

  // Top foliage bokeh and corner yellow bokeh stay quiet near baseplate height
  let maxTopBokeh = 0;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < w; x++) maxTopBokeh = Math.max(maxTopBokeh, heights[y * w + x]);
  }
  let maxCornerBokeh = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 7; x++) maxCornerBokeh = Math.max(maxCornerBokeh, heights[y * w + x]);
  }
  assert.ok(maxTopBokeh < 0.20, `top foliage bokeh must not form dominant spikes (got ${maxTopBokeh})`);
  assert.ok(maxCornerBokeh < 0.20, `upper-left yellow bokeh must stay near baseplate (got ${maxCornerBokeh})`);

  // Coherent 3D facial hierarchy: nose projects proudest > eye recess > flat background
  const noseZ = heights[Math.round(h * 0.48) * w + Math.floor(w / 2)];
  const eyeZ = heights[Math.round(h * 0.42) * w + Math.floor(w / 2) - 4];
  const bgZ = heights[2 * w + 2];
  assert.ok(noseZ > eyeZ + 0.08, `nose (${noseZ}) should project proud of recessed eye (${eyeZ})`);
  assert.ok(eyeZ > bgZ + 0.25, `subject face (${eyeZ}) should rise cleanly above background (${bgZ})`);
  assert.ok(fg[Math.round(h * 0.48) * w + Math.floor(w / 2)] > 0.9, 'center face detected as foreground');
  assert.ok(fg[2 * w + 2] < 0.1, 'top bokeh detected as background');
});
