import { mountShell, fitCanvas, makeLoop, seededRandom } from '../shared/shell.js';
import { SandModel } from './model.mjs?v=material-2';

const shell = mountShell({ id: 'singing-sand', title: 'Singing sand' });
const canvas = document.querySelector('#experiment-canvas');
const context = canvas?.getContext?.('2d') || null;
const tuning = document.querySelector('#sand-tuning');
const label = document.querySelector('#mode-name');
const names = ['Cross currents', 'Woven paths', 'Petal rhythm', 'Fine harmonics', 'Hidden lattice'];
const GRAIN_COUNT = 6200;
const PLATE_ANGLE = -0.075;
const PLATE_SCALE_RATIO = 0.442;
const KEY_TAPS = [[0, 0], [-0.42, -0.32], [0.46, -0.24], [0.28, 0.44], [-0.36, 0.38]];

const GRAIN_TONES = [
  '#846035', // deep roasted umber (shadowed apron)
  '#a67c46', // warm ochre
  '#c49657', // dry honey silica
  '#dbb171', // warm golden sand
  '#eed196', // sunlit ridge crest
  '#fbf0cf', // bright quartz glint / hopping grain
];

const initialSeed = (globalThis.crypto?.getRandomValues
  ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
  : 202505) || 1;

let model = new SandModel({ seed: initialSeed, count: GRAIN_COUNT });
let dimensions = null;
let backdrop = null;
let geometry = null;
let interactions = 0;
let activePointerId = null;
let keyTapIndex = 0;

// Reusable tone buckets keep per-frame rendering allocation-free.
const toneBuckets = Array.from({ length: GRAIN_TONES.length }, () => new Int32Array(GRAIN_COUNT));
const toneCounts = new Int32Array(GRAIN_TONES.length);
const airborneIndices = new Int32Array(GRAIN_COUNT);

function settle() {
  for (let i = 0; i < 165; i++) model.step(1 / 60);
}

function platePath(c, side) {
  const r = side * 0.018;
  c.beginPath();
  if (typeof c.roundRect === 'function') {
    c.roundRect(-side / 2, -side / 2, side, side, r);
  } else {
    const h = side / 2;
    c.moveTo(-h + r, -h);
    c.lineTo(h - r, -h);
    c.quadraticCurveTo(h, -h, h, -h + r);
    c.lineTo(h, h - r);
    c.quadraticCurveTo(h, h, h - r, h);
    c.lineTo(-h + r, h);
    c.quadraticCurveTo(-h, h, -h, h - r);
    c.lineTo(-h, -h + r);
    c.quadraticCurveTo(-h, -h, -h + r, -h);
    c.closePath();
  }
}

function paintMetalPlate(c, w, h, x, y, side) {
  c.fillStyle = '#201f1b';
  c.fillRect(0, 0, w, h);

  // Soft warm desk-lamp ambience behind the upper-left corner of the plate.
  const lamp = c.createRadialGradient(
    x - side * 0.24, y - side * 0.28, side * 0.04,
    x - side * 0.08, y - side * 0.08, side * 0.82
  );
  lamp.addColorStop(0, 'rgba(130, 108, 74, 0.14)');
  lamp.addColorStop(0.55, 'rgba(72, 62, 46, 0.05)');
  lamp.addColorStop(1, 'rgba(32, 31, 27, 0)');
  c.fillStyle = lamp;
  c.fillRect(0, 0, w, h);

  c.save();
  c.translate(x, y);
  c.rotate(PLATE_ANGLE);

  // Layered ambient + contact shadow grounding the thick steel plate on the bench.
  c.save();
  c.shadowColor = 'rgba(0, 0, 0, 0.64)';
  c.shadowBlur = side * 0.082;
  c.shadowOffsetX = side * 0.02;
  c.shadowOffsetY = side * 0.048;
  platePath(c, side);
  c.fillStyle = '#0e100d';
  c.fill();
  c.restore();

  // Extruded dark-steel slab thickness along bottom/right edges.
  const thickness = Math.max(3.5, side * 0.0095);
  c.save();
  c.translate(thickness * 0.35, thickness);
  platePath(c, side);
  const edgeGrad = c.createLinearGradient(-side / 2, side / 2, side / 2, -side / 2);
  edgeGrad.addColorStop(0, '#2a2a23');
  edgeGrad.addColorStop(0.5, '#131612');
  edgeGrad.addColorStop(1, '#090b08');
  c.fillStyle = edgeGrad;
  c.fill();
  c.restore();

  // Dark blued/anodized brushed steel face lit obliquely from upper-left.
  const metal = c.createLinearGradient(-side / 2, -side / 2, side / 2, side / 2);
  metal.addColorStop(0, '#5a5547');
  metal.addColorStop(0.035, '#3b3a32');
  metal.addColorStop(0.32, '#2d302a');
  metal.addColorStop(0.76, '#20231e');
  metal.addColorStop(1, '#171a16');
  platePath(c, side);
  c.fillStyle = metal;
  c.fill();

  // Clipped surface finish: directional brushed hairlines, subtle center sheen & stray dust.
  c.save();
  platePath(c, side - 2.5);
  c.clip();

  const sheen = c.createRadialGradient(
    -side * 0.28, -side * 0.30, side * 0.02,
    -side * 0.10, -side * 0.12, side * 0.85
  );
  sheen.addColorStop(0, 'rgba(232, 208, 162, 0.10)');
  sheen.addColorStop(0.42, 'rgba(186, 166, 128, 0.03)');
  sheen.addColorStop(1, 'rgba(8, 10, 8, 0.14)');
  c.fillStyle = sheen;
  c.fillRect(-side / 2, -side / 2, side, side);

  // Subtle radial machining glint hinting at the hidden shaker mount beneath the center.
  const hub = c.createRadialGradient(0, 0, side * 0.008, 0, 0, side * 0.26);
  hub.addColorStop(0, 'rgba(224, 202, 160, 0.038)');
  hub.addColorStop(0.35, 'rgba(10, 12, 9, 0.03)');
  hub.addColorStop(1, 'rgba(0, 0, 0, 0)');
  c.fillStyle = hub;
  c.fillRect(-side / 2, -side / 2, side, side);

  const random = seededRandom(32 + (initialSeed & 255));
  for (let i = 0; i < 1850; i++) {
    c.fillStyle = i % 3 === 0 ? 'rgba(232, 214, 174, 0.038)' : 'rgba(4, 9, 5, 0.088)';
    const bx = -side / 2 + random() * side * 0.42;
    const by = (random() - 0.5) * side;
    const bw = side * (0.14 + random() * 0.86);
    c.fillRect(bx, by, bw, 0.45);
  }

  // Sparse residual fine quartz dust caught in the brushed metal finish.
  for (let i = 0; i < 420; i++) {
    c.fillStyle = i % 4 ? 'rgba(184, 144, 84, 0.20)' : 'rgba(236, 210, 152, 0.28)';
    const rx = (random() - 0.5) * side * 0.92;
    const ry = (random() - 0.5) * side * 0.92;
    const s = random() * 0.85 + 0.35;
    c.fillRect(rx, ry, s, s * 0.78);
  }
  c.restore();

  // Chamfered steel rim catching warm top-left grazing light and deep bottom-right bevel.
  const bevel = c.createLinearGradient(-side / 2, -side / 2, side / 2, side / 2);
  bevel.addColorStop(0, 'rgba(216, 195, 152, 0.62)');
  bevel.addColorStop(0.38, 'rgba(136, 125, 102, 0.34)');
  bevel.addColorStop(0.7, 'rgba(40, 43, 36, 0.52)');
  bevel.addColorStop(1, 'rgba(10, 12, 9, 0.76)');
  platePath(c, side - 0.5);
  c.lineWidth = 1.15;
  c.strokeStyle = bevel;
  c.stroke();

  // Four countersunk machined corner fasteners with subtle per-screw slot angles.
  const screwAngles = [-0.32, 0.54, 0.24, -0.68];
  let screwIdx = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const px = sx * side * 0.452;
      const py = sy * side * 0.452;
      const wellR = side * 0.0145;
      const headR = side * 0.0102;

      c.beginPath();
      c.arc(px, py, wellR, 0, Math.PI * 2);
      c.fillStyle = 'rgba(7, 9, 7, 0.62)';
      c.fill();
      c.strokeStyle = 'rgba(184, 168, 134, 0.22)';
      c.lineWidth = 0.7;
      c.stroke();

      const headGrad = c.createLinearGradient(px - headR, py - headR, px + headR, py + headR);
      headGrad.addColorStop(0, '#6a6353');
      headGrad.addColorStop(0.45, '#2b2e28');
      headGrad.addColorStop(1, '#121511');
      c.beginPath();
      c.arc(px, py, headR, 0, Math.PI * 2);
      c.fillStyle = headGrad;
      c.fill();
      c.strokeStyle = 'rgba(190, 174, 138, 0.42)';
      c.lineWidth = 0.65;
      c.stroke();

      const sa = screwAngles[screwIdx++];
      const dx = Math.cos(sa) * headR * 0.66;
      const dy = Math.sin(sa) * headR * 0.66;
      c.beginPath();
      c.moveTo(px - dx, py - dy);
      c.lineTo(px + dx, py + dy);
      c.strokeStyle = '#090b08';
      c.lineWidth = Math.max(1.0, side * 0.0024);
      c.stroke();
    }
  }

  c.restore();
}

function resize() {
  if (!context) return;
  dimensions = fitCanvas(canvas);
  const { width: w, height: h, dpr } = dimensions;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  geometry = { x: w / 2, y: h / 2, side: Math.min(w, h) * 0.805 };
  const { x, y, side } = geometry;

  const offscreen = document.createElement('canvas');
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const offCtx = offscreen.getContext('2d');
  if (offCtx) {
    offCtx.scale(dpr, dpr);
    paintMetalPlate(offCtx, w, h, x, y, side);
    backdrop = offscreen;
  } else {
    backdrop = null;
  }
  render();
}

function render() {
  if (!context || !dimensions || !geometry) return;
  const c = context;
  const { width: w, height: h } = dimensions;
  const { x, y, side } = geometry;

  if (backdrop) {
    c.drawImage(backdrop, 0, 0, w, h);
  } else {
    paintMetalPlate(c, w, h, x, y, side);
  }

  const scale = side * PLATE_SCALE_RATIO;
  const unit = Math.max(0.78, side / 480);
  const grains = model.grains;
  const count = grains.length;
  const motionOn = shell.motion;
  const time = model.time;
  const energy = model.energy;

  c.save();
  c.translate(x, y);
  c.rotate(PLATE_ANGLE);

  // Layer 1: Subtle metallic flexure wave glints on the steel plate.
  if (model.ripples.length > 0 || model.finger.active) {
    c.save();
    platePath(c, side - 3);
    c.clip();

    for (let r = 0; r < model.ripples.length; r++) {
      const rip = model.ripples[r];
      const life = Math.max(0, 1 - rip.age / rip.maxAge);
      const alpha = life * life * Math.min(1, rip.strength);
      if (alpha < 0.015) continue;

      const rx = rip.x * scale;
      const ry = rip.y * scale;
      const rad = rip.radius * scale;
      const band = Math.max(8, rip.width * scale * 0.9);
      const r0 = Math.max(0, rad - band);
      const r1 = rad + band;

      const waveGrad = c.createRadialGradient(rx, ry, r0, rx, ry, r1);
      waveGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      waveGrad.addColorStop(0.28, `rgba(7, 8, 6, ${(0.14 * alpha).toFixed(3)})`);
      waveGrad.addColorStop(0.54, `rgba(244, 218, 166, ${(0.095 * alpha).toFixed(3)})`);
      waveGrad.addColorStop(0.76, `rgba(255, 238, 198, ${(0.042 * alpha).toFixed(3)})`);
      waveGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      c.fillStyle = waveGrad;
      c.beginPath();
      c.arc(rx, ry, r1, 0, Math.PI * 2);
      c.fill();
    }

    if (model.finger.active) {
      const fx = model.finger.x * scale;
      const fy = model.finger.y * scale;
      const fr = 0.19 * scale;
      const hold = model.finger.hold;
      const touchGrad = c.createRadialGradient(fx, fy, 0, fx, fy, fr);
      touchGrad.addColorStop(0, 'rgba(7, 8, 6, 0.24)');
      touchGrad.addColorStop(0.68, `rgba(232, 196, 134, ${(0.055 + hold * 0.055).toFixed(3)})`);
      touchGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      c.fillStyle = touchGrad;
      c.beginPath();
      c.arc(fx, fy, fr, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  // Layer 2: Soft contact shadow & warm cohesive sand bed beneath dense ridges.
  const shadowOffX = 1.25 * unit;
  const shadowOffY = 1.55 * unit;
  const bedSize = 3.25 * unit;
  const shadowSize = 2.65 * unit;

  c.fillStyle = 'rgba(10, 9, 7, 0.27)';
  for (let i = 0; i < count; i += 2) {
    const g = grains[i];
    if (g.crest < 0.42 || g.z > 0.05) continue;
    const px = g.x * scale;
    const py = g.y * scale;
    c.fillRect(px + shadowOffX, py + shadowOffY, shadowSize, shadowSize * 0.88);
  }

  c.fillStyle = 'rgba(182, 134, 68, 0.16)';
  for (let i = 1; i < count; i += 2) {
    const g = grains[i];
    if (g.crest < 0.44 || g.z > 0.08) continue;
    const px = g.x * scale;
    const py = g.y * scale;
    c.fillRect(px - bedSize * 0.35, py - bedSize * 0.35, bedSize, bedSize * 0.9);
  }

  // Classify grains into directional-lit quartz tones + airborne hop list.
  toneCounts.fill(0);
  let airborneCount = 0;

  for (let i = 0; i < count; i++) {
    const g = grains[i];
    if (g.z > 0.015) {
      airborneIndices[airborneCount++] = i;
    }
    const lampBias = (-g.x - g.y) * 0.11;
    const lit = g.shade * 0.50 + g.crest * 0.40 + lampBias + g.z * 0.85;
    let bucket = Math.floor(lit * GRAIN_TONES.length);
    if (bucket < 0) bucket = 0;
    else if (bucket >= GRAIN_TONES.length) bucket = GRAIN_TONES.length - 1;
    toneBuckets[bucket][toneCounts[bucket]++] = i;
  }

  // Layer 3: Crisp ground shadows cast by airborne grains hopping off the steel.
  const liftScale = side * 0.026;
  if (airborneCount > 0) {
    c.fillStyle = 'rgba(7, 6, 5, 0.42)';
    for (let k = 0; k < airborneCount; k++) {
      const g = grains[airborneIndices[k]];
      const lift = g.z * liftScale;
      const sx = g.x * scale + lift * 0.62;
      const sy = g.y * scale + lift * 0.82;
      const gs = (0.85 + g.size * 0.95) * unit;
      c.fillRect(sx, sy, gs, gs * 0.8);
    }
  }

  // Layer 4: Multi-grade quartz grains batched cleanly by real-time lit tone.
  for (let b = 0; b < GRAIN_TONES.length; b++) {
    const len = toneCounts[b];
    if (!len) continue;
    c.fillStyle = GRAIN_TONES[b];
    const bucket = toneBuckets[b];
    for (let k = 0; k < len; k++) {
      const i = bucket[k];
      const g = grains[i];
      let jx = 0;
      let jy = 0;
      if (motionOn) {
        const hum = (0.00024 * (1.2 - g.crest * 0.85) + energy * 0.0022) * g.invMass;
        const osc = Math.sin(g.phase + i * 1.13 + time * 29);
        jx = hum * osc;
        jy = -hum * 0.65 * Math.cos(g.phase + time * 24);
      }
      const lift = g.z > 0 ? g.z * liftScale : 0;
      const px = (g.x + jx) * scale - lift * 0.22;
      const py = (g.y + jy) * scale - lift;
      const hopBoost = 1 + g.z * 0.3;
      const wGrain = (0.72 + g.size * 1.08 + g.crest * 0.24) * unit * hopBoost;
      const hGrain = wGrain * (0.72 + g.shade * 0.44);
      c.fillRect(px, py, wGrain, hGrain);
    }
  }

  c.restore();
}

function plateCoords(event, { clampInside = false } = {}) {
  if (!geometry) return null;
  const bounds = canvas.getBoundingClientRect();
  const dx = event.clientX - bounds.left - geometry.x;
  const dy = event.clientY - bounds.top - geometry.y;
  const cos = Math.cos(PLATE_ANGLE);
  const sin = Math.sin(PLATE_ANGLE);
  const invScale = 1 / (geometry.side * PLATE_SCALE_RATIO);
  const px = (dx * cos + dy * sin) * invScale;
  const py = (-dx * sin + dy * cos) * invScale;
  if (!clampInside && (Math.abs(px) > 1.03 || Math.abs(py) > 1.03)) return null;
  return {
    x: Math.max(-0.98, Math.min(0.98, px)),
    y: Math.max(-0.98, Math.min(0.98, py)),
  };
}

function updateTuning(value) {
  model.setMode(value);
  interactions++;
  tuning.value = String(model.mode);
  label.textContent = names[model.mode];
  tuning.setAttribute('aria-valuetext', names[model.mode]);
  if (!shell.motion) settle();
  render();
  shell.setStatus(`${names[model.mode]}. The grains are finding a new pattern.`);
}

function tapPlateAt(x, y, announce = false) {
  model.scatter(x, y, { strength: 1.0, ripple: true });
  interactions++;
  if (!shell.motion) settle();
  render();
  if (announce) {
    shell.setStatus(shell.motion
      ? 'A ripple travels across the plate and settles back into the pattern.'
      : 'The grains have settled back into the pattern. Motion remains still.');
  }
}

function endDrag() {
  if (activePointerId === null && !model.finger.active) return;
  activePointerId = null;
  if (canvas) delete canvas.dataset.dragging;
  model.release();
  if (!shell.motion) settle();
  render();
}

tuning.addEventListener('input', () => updateTuning(Number(tuning.value)));

document.addEventListener('experiment:play', () => {
  updateTuning((model.mode + 1) % names.length);
});

document.addEventListener('experiment:reset', () => {
  activePointerId = null;
  if (canvas) delete canvas.dataset.dragging;
  model = new SandModel({ seed: initialSeed, count: GRAIN_COUNT });
  settle();
  tuning.value = '0';
  label.textContent = names[0];
  tuning.setAttribute('aria-valuetext', names[0]);
  interactions++;
  render();
});

if (canvas) {
  canvas.setAttribute(
    'aria-label',
    'Warm sand grains gathering along nodal ridges on a dark steel plate. Touch or drag to ripple the grains, use arrow keys to tap or tune, or adjust the tuning below.'
  );

  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (activePointerId !== null && activePointerId !== event.pointerId) return;
    const pt = plateCoords(event, { clampInside: false });
    if (!pt) return;
    activePointerId = event.pointerId;
    canvas.dataset.dragging = 'true';
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Optional capture. */ }
    model.press(pt.x, pt.y);
    interactions++;
    render();
  });

  canvas.addEventListener('pointermove', event => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    const pt = plateCoords(event, { clampInside: true });
    if (!pt) return;
    model.drag(pt.x, pt.y);
    interactions++;
    render();
  });

  canvas.addEventListener('pointerup', event => {
    if (event.pointerId === activePointerId) endDrag();
  });

  canvas.addEventListener('pointercancel', event => {
    if (event.pointerId === activePointerId) endDrag();
  });

  canvas.addEventListener('lostpointercapture', event => {
    if (event.pointerId === activePointerId) endDrag();
  });

  // Keyboard parity on the plate canvas: left/right tunes, up/down sends a ripple.
  canvas.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      updateTuning(Math.min(names.length - 1, model.mode + 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      updateTuning(Math.max(0, model.mode - 1));
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const [tx, ty] = KEY_TAPS[keyTapIndex++ % KEY_TAPS.length];
      tapPlateAt(tx, ty, true);
    }
  });
}

window.addEventListener('blur', endDrag);

if (context) {
  settle();
  resize();
  const loop = makeLoop(dt => {
    model.step(dt);
    render();
  }, { enabled: shell.motion });
  shell.onMotionChange(enabled => {
    if (!enabled) endDrag();
    loop.setEnabled(enabled);
    if (!enabled) render();
  });
  new ResizeObserver(resize).observe(canvas);
  shell.markReady({ rendering: 'canvas2d' });
} else {
  shell.setStatus('The sand plate could not start in this browser. Portfolio links are still available.');
}

if (new URLSearchParams(location.search).has('debug')) {
  window.__experiment = {
    id: 'singing-sand',
    snapshot: () => ({
      motion: shell.motion,
      ready: document.body.dataset.ready === 'true',
      interactions,
      mode: model.mode,
      pattern: names[model.mode],
      time: model.time,
      grainCount: model.grains.length,
      energy: model.energy,
      ripples: model.ripples.length,
      liftedGrains: model.grains.filter(g => g.z > 0.015).length,
      distanceToNodes: model.meanDistance(),
      samples: model.grains
        .filter((_, i) => i % 100 === 0)
        .map(g => ({ x: g.x, y: g.y, tx: g.tx, ty: g.ty })),
    }),
  };
}
