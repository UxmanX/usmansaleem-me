import { mountShell, fitCanvas, makeLoop, seededRandom, clamp } from '../shared/shell.js';
import { HoneyModel } from './model.mjs?v=material-2';
import { drawDepositedThread, drawSuspendedFilament, drawNozzle } from './render.mjs?v=material-2';

const shell = mountShell({ id: 'honey-plotter', title: 'Honey plotter' });
const stage = document.querySelector('[data-stage]');
const canvas = document.querySelector('#experiment-canvas');
const context = canvas?.getContext('2d');
if (canvas) {
  canvas.setAttribute(
    'aria-label',
    'Glossy honey thread coiling and settling onto a moving amber conveyor. Pull the nozzle to stretch ribbons, hold still to build coils, release to snap back, or use arrow keys to steer and pull; sliders below also work with a keyboard.'
  );
}
const speed = document.querySelector('#belt-speed');
const nozzle = document.querySelector('#nozzle-position');
const speedValue = document.querySelector('#speed-value');
const stageHeading = document.querySelector('.stage-heading');
const stageCue = stageHeading?.querySelector('span:last-child');
const newPatternButton = document.querySelector('#new-pattern');

let seed = crypto.getRandomValues(new Uint32Array(1))[0];
const initialSeed = seed;
const model = new HoneyModel({ seed });

let dimensions, backdrop;
let interactions = 0;
let dragging = false;
let activePointerId = null;
let hoveringNozzle = false;
let keyPulling = false;
let onScreen = true;
let directGrab = false;
let grabOrigin = null;
let lastCueKey = '';
let beltFlecks = [];

const CUES = {
  paused: 'Paused — drag to reshape still',
  stretch: 'Pulled taut — release to snap',
  coil: 'Holding still — coiling tightly',
  rebound: 'Capillary rebound — settling',
  guide: 'Guiding the pour',
  steady: 'Drag nozzle — pull, hold, release',
};

function prefill(seconds = 11) {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) model.step(1 / 60);
}

function stepBounded(frames) {
  const count = clamp(Math.round(frames), 1, 60);
  for (let i = 0; i < count; i++) model.step(1 / 60);
}

function beltY(normY, h) {
  return h * (0.36 + normY * 0.56);
}

function nozzleGeometry(w, h) {
  const collarH = 12;
  const anchorX = model.nozzleX * w;
  const anchorY = collarH - 2;
  const baseNy = clamp(
    h * (0.115 + (model.nozzleY - 0.48) * 0.22) - model.tension * h * 0.015,
    26,
    h * 0.28
  );
  const len = Math.max(14, baseNy - anchorY);
  const angle = model.tilt * 0.5;
  const tipX = anchorX - Math.sin(angle) * len;
  const tipY = anchorY + Math.cos(angle) * len;
  return { collarH, anchorX, anchorY, len, angle, tipX, tipY };
}

function syncHint() {
  if (!stageCue || !stageHeading) return;
  const key = !shell.motion && !dragging && !keyPulling ? 'paused' : model.gestureState;
  if (key === lastCueKey) return;
  lastCueKey = key;
  stageCue.textContent = CUES[key] || CUES.steady;
  stageHeading.dataset.gesture = key;
}

function syncControls() {
  speed.value = String(Math.round(model.speed * 100));
  nozzle.value = String(Math.round(model.nozzle * 100));
  speedValue.textContent =
    model.speed < 0.38 ? 'Slow coils' : model.speed < 0.72 ? 'Loose loops' : 'Long meanders';
  syncHint();
}

function buildBeltFlecks(w, h) {
  const rand = seededRandom(409);
  beltFlecks = [];
  for (let i = 0; i < 30; i++) {
    beltFlecks.push({
      x: rand() * w,
      y: h * (0.37 + rand() * 0.54),
      len: 4 + rand() * 14,
      bright: i % 3 === 0,
    });
  }
}

function resize() {
  if (!context || !canvas) return;
  dimensions = fitCanvas(canvas);
  const { width: w, height: h, dpr } = dimensions;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  backdrop = document.createElement('canvas');
  backdrop.width = canvas.width;
  backdrop.height = canvas.height;
  const bg = backdrop.getContext('2d');
  bg.scale(dpr, dpr);

  // Warm sunlit amber studio backdrop behind the conveyor.
  const amber = bg.createLinearGradient(0, 0, 0, h);
  amber.addColorStop(0, '#f1b258');
  amber.addColorStop(0.35, '#da7c24');
  amber.addColorStop(1, '#9c4314');
  bg.fillStyle = amber;
  bg.fillRect(0, 0, w, h);

  // Soft overhead studio key light behind the pour zone.
  const keyLight = bg.createRadialGradient(
    w * 0.22,
    h * 0.06,
    12,
    w * 0.24,
    h * 0.24,
    Math.max(w * 0.45, 220)
  );
  keyLight.addColorStop(0, 'rgba(255, 232, 168, 0.34)');
  keyLight.addColorStop(0.55, 'rgba(255, 206, 124, 0.08)');
  keyLight.addColorStop(1, 'rgba(255, 196, 110, 0)');
  bg.fillStyle = keyLight;
  bg.fillRect(0, 0, w, h * 0.36);

  // Machined bronze gantry track along the top edge signaling horizontal travel.
  const railH = 10;
  const rail = bg.createLinearGradient(0, 0, 0, railH);
  rail.addColorStop(0, '#3a2310');
  rail.addColorStop(0.48, '#664322');
  rail.addColorStop(1, '#331e0d');
  bg.fillStyle = rail;
  bg.fillRect(0, 0, w, railH);
  bg.fillStyle = 'rgba(255, 224, 160, 0.34)';
  bg.fillRect(0, railH, w, 1);

  // Engraved gantry scale ticks over the nozzle travel span (0.08..0.62) and home detent (0.18).
  const tickStart = w * 0.08;
  const tickEnd = w * 0.62;
  const tickCount = Math.max(12, Math.round((tickEnd - tickStart) / 22));
  for (let i = 0; i <= tickCount; i++) {
    const tx = tickStart + ((tickEnd - tickStart) * i) / tickCount;
    bg.fillStyle = 'rgba(255, 226, 166, 0.16)';
    bg.fillRect(tx, railH - 4, 1, 3);
  }
  bg.fillStyle = 'rgba(255, 228, 162, 0.58)';
  bg.fillRect(w * 0.18 - 1, railH - 5, 2, 5);

  // Satin caramel-amber travelling conveyor deck.
  const beltTop = h * 0.34;
  const beltHeight = h * 0.615;
  const belt = bg.createLinearGradient(0, beltTop, 0, beltTop + beltHeight);
  belt.addColorStop(0, '#c97b2f');
  belt.addColorStop(0.035, '#e9a34f');
  belt.addColorStop(0.56, '#dfa050');
  belt.addColorStop(0.89, '#c27d31');
  belt.addColorStop(0.97, '#895121');
  belt.addColorStop(1, '#5e3212');
  bg.fillStyle = belt;
  bg.fillRect(0, beltTop, w, beltHeight);

  // Subtle top bevel & underside roller shadow.
  bg.fillStyle = 'rgba(255, 228, 166, 0.52)';
  bg.fillRect(0, beltTop, w, 1.2);
  bg.fillStyle = 'rgba(72, 34, 9, 0.24)';
  bg.fillRect(0, beltTop - 2, w, 2);
  bg.fillStyle = 'rgba(58, 26, 6, 0.34)';
  bg.fillRect(0, beltTop + beltHeight, w, 3);

  // Fine deterministic brushed belt texture.
  const random = seededRandom(129);
  for (let i = 0; i < 4200; i++) {
    bg.fillStyle = i % 2 ? 'rgba(92, 42, 11, 0.042)' : 'rgba(255, 236, 174, 0.10)';
    bg.fillRect(random() * w, h * (0.355 + random() * 0.565), random() * 10 + 1.5, 0.6);
  }

  buildBeltFlecks(w, h);
  render();
}

function drawBeltCues(c, w, h) {
  const shift = model.beltOffset * w;
  const spacing = 104;
  const mod = ((shift % spacing) + spacing) % spacing;

  // Embossed conveyor seam ticks translating smoothly with physical beltOffset.
  for (let x = mod - spacing; x < w + spacing; x += spacing) {
    c.fillStyle = 'rgba(86, 39, 10, 0.18)';
    c.fillRect(x, h * 0.905, 26, 1.4);
    c.fillStyle = 'rgba(255, 228, 166, 0.16)';
    c.fillRect(x, h * 0.905 + 1.4, 26, 1);

    c.fillStyle = 'rgba(92, 43, 12, 0.11)';
    c.fillRect(x + spacing * 0.5, h * 0.368, 16, 1);
  }

  // Subtle moving sheen flecks carried along at conveyor speed.
  for (let i = 0; i < beltFlecks.length; i++) {
    const f = beltFlecks[i];
    const fx = (((f.x + shift) % (w + 24)) + (w + 24)) % (w + 24) - 12;
    c.fillStyle = f.bright ? 'rgba(255, 236, 178, 0.15)' : 'rgba(94, 42, 10, 0.08)';
    c.fillRect(fx, f.y, f.len, 0.8);
  }
}

function drawContactPuddle(c, w, h, ex, ey, baseThickness) {
  const fx = model.footX * w * 0.45 + ex * 0.55;
  const fy = beltY(model.footY, h) * 0.45 + ey * 0.55;
  const swell = model.puddle;
  const rx = baseThickness * (1.2 + swell * 2.15);
  const ry = rx * 0.46;

  c.save();
  c.translate(fx + 2, fy + 2.5);
  c.scale(1, ry / Math.max(1, rx));

  const pool = c.createRadialGradient(0, 0, rx * 0.12, 0, 0, rx);
  pool.addColorStop(0, `rgba(248, 172, 34, ${0.26 + swell * 0.24})`);
  pool.addColorStop(0.58, `rgba(176, 86, 10, ${0.20 + swell * 0.18})`);
  pool.addColorStop(0.86, `rgba(92, 38, 6, ${0.14 + swell * 0.12})`);
  pool.addColorStop(1, 'rgba(92, 38, 6, 0)');
  c.fillStyle = pool;
  c.beginPath();
  c.arc(0, 0, rx, 0, Math.PI * 2);
  c.fill();
  c.restore();

  if (swell > 0.28) {
    c.save();
    c.strokeStyle = `rgba(255, 236, 174, ${(swell - 0.24) * 0.42})`;
    c.lineWidth = 1.25;
    c.beginPath();
    c.ellipse(
      fx - rx * 0.16,
      fy - ry * 0.14,
      rx * 0.56,
      ry * 0.48,
      -0.08,
      Math.PI * 1.05,
      Math.PI * 1.85
    );
    c.stroke();
    c.restore();
  }
}

function render() {
  if (!context || !dimensions || !backdrop) return;
  const c = context;
  const { width: w, height: h } = dimensions;
  c.drawImage(backdrop, 0, 0, w, h);

  drawBeltCues(c, w, h);

  const baseThickness = w < 600 ? 6.8 : 10.2;
  const geom = nozzleGeometry(w, h);

  if (model.points.length) {
    const end = model.points[model.points.length - 1];
    const ex = end.x * w;
    const ey = beltY(end.y, h);

    drawContactPuddle(c, w, h, ex, ey, baseThickness);
    drawDepositedThread(c, model, w, h, baseThickness, beltY);
    drawSuspendedFilament(c, model, w, h, geom, ex, ey, baseThickness, beltY);
  }
  drawNozzle(c, model, geom, { dragging, hovering: hoveringNozzle });
  syncHint();
}

function pointerCoords(event) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const px = event.clientX - bounds.left;
  const py = event.clientY - bounds.top;
  const x = clamp(px / width, 0.08, 0.62);
  const y = clamp((py / height - 0.36) / 0.56, 0.23, 0.77);
  return { px, py, x, y, width, height };
}

function isNearNozzle(px, py, width, height) {
  const { tipX, tipY } = nozzleGeometry(width, height);
  return Math.hypot(px - tipX, py - tipY) <= 58 || (Math.abs(px - tipX) <= 34 && py <= height * 0.42);
}

function handlePointerDown(event) {
  if (!context || event.button !== 0 || activePointerId !== null) return;
  // Pointer takeover invalidates any pending keyboard release before focus changes.
  keyPulling = false;
  activePointerId = event.pointerId;
  dragging = true;
  canvas.focus({ preventScroll: true });
  const info = pointerCoords(event);
  canvas.dataset.grab = 'active';
  try { canvas.setPointerCapture(event.pointerId); } catch { /* Optional pointer capture. */ }

  if (isNearNozzle(info.px, info.py, info.width, info.height) || info.py < info.height * 0.34) {
    directGrab = true;
    grabOrigin = {
      clientX: event.clientX,
      clientY: event.clientY,
      nozzleX: model.nozzleX,
      nozzleY: model.nozzleY,
      width: info.width,
      height: info.height,
    };
    model.grab(model.nozzleX, model.nozzleY);
  } else {
    directGrab = false;
    grabOrigin = null;
    model.grab(info.x, info.y);
  }

  interactions++;
  if (!shell.motion) stepBounded(6);
  syncControls();
  render();
}

function handlePointerMove(event) {
  if (!context || (dragging && event.pointerId !== activePointerId)) return;
  const info = pointerCoords(event);
  const near = isNearNozzle(info.px, info.py, info.width, info.height);

  if (!dragging) {
    if (near !== hoveringNozzle) {
      hoveringNozzle = near;
      canvas.dataset.grab = near ? 'near' : '';
      if (!shell.motion) render();
    }
    return;
  }

  let tx = info.x;
  let ty = info.y;
  if (directGrab && grabOrigin) {
    tx = clamp(
      grabOrigin.nozzleX + (event.clientX - grabOrigin.clientX) / grabOrigin.width,
      0.08,
      0.62
    );
    ty = clamp(
      grabOrigin.nozzleY + (event.clientY - grabOrigin.clientY) / (grabOrigin.height * 0.56),
      0.23,
      0.77
    );
  }

  model.drag(tx, ty);
  interactions++;

  if (!shell.motion) {
    // Bounded still response on paused drag — never wipe or run a full 13s prefill.
    stepBounded(6);
    syncControls();
    render();
  } else {
    syncControls();
  }
}

function clearGesture() {
  const pointerId = activePointerId;
  // Clear ownership first: releasing capture may dispatch lostpointercapture.
  activePointerId = null;
  dragging = false;
  keyPulling = false;
  directGrab = false;
  grabOrigin = null;
  if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) {
    try { canvas.releasePointerCapture(pointerId); } catch { /* Ignore release errors. */ }
  }
  canvas.dataset.grab = hoveringNozzle ? 'near' : '';
}

function releaseGesture() {
  if (!dragging && !keyPulling) return;
  clearGesture();
  model.release();
  interactions++;

  if (!shell.motion) stepBounded(20);
  syncControls();
  render();
}

function handlePointerRelease(event) {
  if (!dragging || event.pointerId !== activePointerId) return;
  if (event.type === 'pointerup' && event.button !== 0) return;
  releaseGesture();
}

function updateSpeed() {
  model.setSpeed(Number(speed.value) / 100);
  interactions++;
  if (!shell.motion) stepBounded(42);
  syncControls();
  render();
}

function updateNozzle(value) {
  model.setNozzle(value);
  interactions++;
  if (!shell.motion) stepBounded(16);
  else model.step(1 / 60);
  syncControls();
  render();
}

function newPattern() {
  clearGesture();
  seed = (seed + 1987) >>> 0;
  model.reset(seed);
  const random = seededRandom(seed);
  model.setSpeed(0.15 + random() * 0.7);
  model.setNozzle(0.3 + random() * 0.4);
  prefill(11);
  syncControls();
  interactions++;
  render();
  shell.setStatus('A fresh pour. Drag the nozzle to stretch ribbons or pause to coil.');
}

function resetPattern() {
  clearGesture();
  seed = initialSeed;
  model.reset(seed);
  prefill(11);
  syncControls();
  interactions++;
  render();
}

speed.addEventListener('input', updateSpeed);
nozzle.addEventListener('input', () => updateNozzle(Number(nozzle.value) / 100));
newPatternButton.addEventListener('click', newPattern);
document.addEventListener('experiment:play', newPattern);
document.addEventListener('experiment:reset', resetPattern);

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', handlePointerRelease);
canvas.addEventListener('pointercancel', handlePointerRelease);
canvas.addEventListener('lostpointercapture', handlePointerRelease);
canvas.addEventListener('blur', () => {
  if (keyPulling && activePointerId === null) releaseGesture();
});
window.addEventListener('blur', () => releaseGesture());
canvas.addEventListener('pointerleave', () => {
  if (!dragging && hoveringNozzle) {
    hoveringNozzle = false;
    canvas.dataset.grab = '';
    if (!shell.motion) render();
  }
});

canvas.addEventListener('keydown', event => {
  if (dragging && event.key.startsWith('Arrow')) {
    event.preventDefault();
    return;
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    const delta = event.key === 'ArrowUp' ? -0.05 : 0.05;
    updateNozzle(clamp(model.nozzle + delta, 0.23, 0.77));
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const stepX = event.key === 'ArrowRight' ? 0.14 : -0.10;
    const base = keyPulling ? model.targetX : model.nozzleX;
    keyPulling = true;
    model.drag(clamp(base + stepX, 0.08, 0.62), model.nozzleY);
    interactions++;
    if (!shell.motion) stepBounded(10);
    syncControls();
    render();
  }
});

canvas.addEventListener('keyup', event => {
  if (keyPulling && activePointerId === null && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    releaseGesture();
  }
});

if (context) {
  prefill(11);
  syncControls();
  resize();
  const loop = makeLoop(
    dt => {
      model.step(dt);
      if (dragging) nozzle.value = String(Math.round(model.nozzle * 100));
      render();
    },
    { enabled: shell.motion && onScreen }
  );
  const syncLoop = () => loop.setEnabled(shell.motion && onScreen);
  shell.onMotionChange(() => {
    syncLoop();
    syncHint();
  });
  new ResizeObserver(resize).observe(canvas);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      entries => {
        onScreen = entries.some(entry => entry.isIntersecting);
        syncLoop();
      },
      { threshold: 0.01 }
    ).observe(stage || canvas);
  }
  shell.markReady({ rendering: 'canvas2d' });
} else {
  shell.setStatus('The honey plotter could not start in this browser. Portfolio links are still available.');
}

if (new URLSearchParams(location.search).has('debug')) {
  window.__experiment = {
    id: 'honey-plotter',
    snapshot: () => ({
      motion: shell.motion,
      ready: document.body.dataset.ready === 'true',
      interactions,
      speed: model.speed,
      nozzle: model.nozzle,
      nozzleX: model.nozzleX,
      nozzleY: model.nozzleY,
      footX: model.footX,
      footY: model.footY,
      grabbed: model.grabbed,
      tension: model.tension,
      dwell: model.dwell,
      rebound: model.rebound,
      puddle: model.puddle,
      gestureState: model.gestureState,
      phase: model.phase,
      time: model.time,
      pointCount: model.points.length,
      samples: model.points.filter((_, i) => i % 100 === 0).map(p => ({ x: p.x, y: p.y, r: p.r })),
      tip: model.points.length ? { ...model.points[model.points.length - 1] } : null,
    }),
  };
}
