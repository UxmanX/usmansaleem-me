import { mountShell, fitCanvas, makeLoop, seededRandom } from '../shared/shell.js';
import { SandModel } from './model.mjs';

const shell = mountShell({ id: 'singing-sand', title: 'Singing sand' });
const canvas = document.querySelector('#experiment-canvas');
const context = canvas.getContext('2d');
const tuning = document.querySelector('#sand-tuning');
const label = document.querySelector('#mode-name');
const names = ['Cross currents', 'Woven paths', 'Petal rhythm', 'Fine harmonics', 'Hidden lattice'];
const initialSeed = crypto.getRandomValues(new Uint32Array(1))[0];
let model = new SandModel({ seed: initialSeed, count: 4600 });
let dimensions, backdrop, geometry, interactions = 0, dragging = false;
const angle = -0.085;

function settle() { for (let i = 0; i < 150; i++) model.step(1 / 60); }
function platePath(c, side) { c.beginPath(); c.roundRect(-side / 2, -side / 2, side, side, side * 0.018); }
function resize() {
  dimensions = fitCanvas(canvas);
  const { width: w, height: h, dpr } = dimensions;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  geometry = { x: w / 2, y: h / 2, side: Math.min(w, h) * 0.805 };
  const { x, y, side } = geometry;
  backdrop = document.createElement('canvas'); backdrop.width = canvas.width; backdrop.height = canvas.height;
  const c = backdrop.getContext('2d'); c.scale(dpr, dpr);
  c.fillStyle = '#201f1b'; c.fillRect(0, 0, w, h);
  c.translate(x, y); c.rotate(angle);
  // A dark, thick metal plate lit obliquely by a warm desk lamp.
  c.save(); c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = side * 0.07; c.shadowOffsetX = side * 0.018; c.shadowOffsetY = side * 0.044;
  platePath(c, side); c.fillStyle = '#121310'; c.fill(); c.restore();
  c.translate(0, 4); platePath(c, side); c.fillStyle = '#101310'; c.fill(); c.translate(0, -4);
  const metal = c.createLinearGradient(-side / 2, -side / 2, side / 2, side / 2);
  metal.addColorStop(0, '#696354'); metal.addColorStop(0.025, '#403e34'); metal.addColorStop(0.35, '#393a32'); metal.addColorStop(0.85, '#282b26'); metal.addColorStop(1, '#1e231e');
  platePath(c, side); c.fillStyle = metal; c.fill(); c.lineWidth = 1; c.strokeStyle = '#857961'; c.stroke();
  c.save(); platePath(c, side - 3); c.clip();
  const random = seededRandom(32);
  for (let i = 0; i < 1600; i++) {
    c.fillStyle = i % 3 === 0 ? 'rgba(225,208,167,.045)' : 'rgba(3,10,4,.08)';
    c.fillRect(-side / 2 + random() * side * 0.5, (random() - 0.5) * side, side * (0.1 + random() * 0.9), 0.4);
  }
  // Sparse residual grains keep the plate a material rather than a clean diagram.
  for (let i = 0; i < 950; i++) {
    c.fillStyle = i % 4 ? 'rgba(191,153,91,.28)' : 'rgba(238,213,158,.38)';
    c.fillRect((random() - 0.5) * side * 0.94, (random() - 0.5) * side * 0.94, random() * 1.1 + 0.35, 0.8);
  }
  c.restore();
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const px = sx * side * 0.455, py = sy * side * 0.455;
    c.beginPath(); c.arc(px, py, side * 0.01, 0, Math.PI * 2); c.fillStyle = '#1c211b'; c.fill(); c.strokeStyle = '#8a826c'; c.lineWidth = 0.8; c.stroke();
    c.beginPath(); c.moveTo(px - side * 0.005, py + 1); c.lineTo(px + side * 0.005, py - 1); c.strokeStyle = '#0b100c'; c.stroke();
  }
  render();
}
function render() {
  if (!context || !dimensions) return;
  const c = context, { width: w, height: h } = dimensions, { x, y, side } = geometry;
  c.drawImage(backdrop, 0, 0, w, h);
  c.save(); c.translate(x, y); c.rotate(angle);
  const scale = side * 0.438;
  const colors = ['#ae854b', '#cea165', '#e2bd7e', '#f5dca3'];
  for (let batch = 0; batch < 4; batch++) {
    c.fillStyle = colors[batch];
    for (let i = batch; i < model.grains.length; i += 4) {
      const g = model.grains[i];
      const jitter = (0.00035 + model.energy * 0.003) * Math.sin(i * 3.37 + model.time * 31);
      const px = (g.x + jitter) * scale, py = (g.y - jitter * 0.6) * scale;
      const size = (0.55 + g.shade * 0.8) * Math.max(0.8, side / 500);
      c.fillRect(px, py, size, size * (0.72 + g.shade * 0.45));
    }
  }
  c.restore();
}
function updateTuning(value) {
  model.setMode(value); interactions++;
  tuning.value = String(model.mode); label.textContent = names[model.mode]; tuning.setAttribute('aria-valuetext', names[model.mode]);
  if (!shell.motion) settle();
  render(); shell.setStatus(`${names[model.mode]}. The grains are finding a new pattern.`);
}
function scatter(event) {
  const bounds = canvas.getBoundingClientRect();
  const dx = event.clientX - bounds.left - geometry.x, dy = event.clientY - bounds.top - geometry.y;
  const px = (dx * Math.cos(angle) + dy * Math.sin(angle)) / (geometry.side * 0.438);
  const py = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / (geometry.side * 0.438);
  if (Math.abs(px) > 1 || Math.abs(py) > 1) return;
  model.scatter(px, py); interactions++; render();
}
tuning.addEventListener('input', () => updateTuning(Number(tuning.value)));
document.addEventListener('experiment:play', () => updateTuning((model.mode + 1) % names.length));
document.addEventListener('experiment:reset', () => {
  model = new SandModel({ seed: initialSeed, count: 4600 }); settle();
  tuning.value = '0'; label.textContent = names[0]; tuning.setAttribute('aria-valuetext', names[0]); interactions++; render();
});
canvas.addEventListener('pointerdown', event => { dragging = true; canvas.setPointerCapture(event.pointerId); scatter(event); });
canvas.addEventListener('pointermove', event => { if (dragging) scatter(event); });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointercancel', () => { dragging = false; });
if (context) {
  settle(); resize();
  const loop = makeLoop(dt => { model.step(dt); render(); }, { enabled: shell.motion });
  shell.onMotionChange(enabled => loop.setEnabled(enabled));
  new ResizeObserver(resize).observe(canvas);
  shell.markReady({ rendering: 'canvas2d' });
} else shell.setStatus('The sand plate could not start in this browser. Portfolio links are still available.');
if (new URLSearchParams(location.search).has('debug')) {
  window.__experiment = { id: 'singing-sand', snapshot: () => ({ motion: shell.motion, ready: document.body.dataset.ready === 'true', interactions, mode: model.mode, pattern: names[model.mode], time: model.time, grainCount: model.grains.length, energy: model.energy, distanceToNodes: model.meanDistance(), samples: model.grains.filter((_, i) => i % 100 === 0).map(g => ({ x: g.x, y: g.y, tx: g.tx, ty: g.ty })) }) };
}
