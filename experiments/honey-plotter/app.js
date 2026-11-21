import { mountShell, fitCanvas, makeLoop, seededRandom, clamp } from '../shared/shell.js';
import { HoneyModel } from './model.mjs';

const shell = mountShell({ id: 'honey-plotter', title: 'Honey plotter' });
const canvas = document.querySelector('#experiment-canvas');
const context = canvas.getContext('2d');
const speed = document.querySelector('#belt-speed');
const nozzle = document.querySelector('#nozzle-position');
const speedValue = document.querySelector('#speed-value');
let seed = crypto.getRandomValues(new Uint32Array(1))[0];
const initialSeed = seed;
const model = new HoneyModel({ seed });
let dimensions, backdrop, interactions = 0;
let dragging = false;

function prefill(seconds = 13) {
  for (let i = 0; i < seconds * 60; i++) model.step(1 / 60);
}
function syncControls() {
  speed.value = String(Math.round(model.speed * 100));
  nozzle.value = String(Math.round(model.nozzle * 100));
  speedValue.textContent = model.speed < 0.4 ? 'Slow coils' : model.speed < 0.72 ? 'Loose loops' : 'Long meanders';
}
function resize() {
  dimensions = fitCanvas(canvas);
  const { width: w, height: h, dpr } = dimensions;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  backdrop = document.createElement('canvas');
  backdrop.width = canvas.width; backdrop.height = canvas.height;
  const bg = backdrop.getContext('2d'); bg.scale(dpr, dpr);
  const amber = bg.createLinearGradient(0, 0, 0, h);
  amber.addColorStop(0, '#efaa4a'); amber.addColorStop(0.42, '#db7a20'); amber.addColorStop(1, '#ac4d17');
  bg.fillStyle = amber; bg.fillRect(0, 0, w, h);
  // The travelling strip has a soft top bevel and a dark rolled lower edge.
  const belt = bg.createLinearGradient(0, h * 0.34, 0, h * 0.96);
  belt.addColorStop(0, '#d38737'); belt.addColorStop(0.05, '#e79d49'); belt.addColorStop(0.65, '#dda051'); belt.addColorStop(0.92, '#c37f33'); belt.addColorStop(1, '#815024');
  bg.fillStyle = belt; bg.fillRect(0, h * 0.34, w, h * 0.61);
  bg.fillStyle = 'rgba(255,222,151,.45)'; bg.fillRect(0, h * 0.34, w, 1);
  bg.fillStyle = 'rgba(73,37,11,.25)'; bg.fillRect(0, h * 0.95, w, 3);
  const random = seededRandom(129);
  for (let i = 0; i < 6500; i++) {
    bg.fillStyle = i % 2 ? 'rgba(96,44,12,.045)' : 'rgba(255,238,174,.12)';
    bg.fillRect(random() * w, h * (0.35 + random() * 0.57), random() * 9 + 1, 0.5);
  }
  render();
}
function trace(points, offsetX = 0, offsetY = 0) {
  const { width: w, height: h } = dimensions;
  context.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = points[i].x * w + offsetX;
    const y = h * (0.36 + points[i].y * 0.56) + offsetY;
    if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
}
function render() {
  if (!context || !dimensions) return;
  const c = context, { width: w, height: h } = dimensions;
  c.drawImage(backdrop, 0, 0, w, h);
  // Faint registration marks translate with the conveyor, not with the nozzle.
  c.fillStyle = 'rgba(96,46,13,.17)';
  const beltOffset = model.time * (0.035 + model.speed * 0.21) * w % 110;
  for (let x = beltOffset - 110; x < w + 110; x += 110) c.fillRect(x, h * 0.91, 24, 1);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const thickness = w < 600 ? 6.5 : 10;
  if (model.points.length) {
    trace(model.points, 1, 6); c.strokeStyle = 'rgba(87,39,6,.22)'; c.lineWidth = thickness + 5; c.stroke();
    trace(model.points); c.strokeStyle = '#834009'; c.lineWidth = thickness + 1.5; c.stroke();
    c.strokeStyle = '#ae610b'; c.lineWidth = thickness - 1; c.stroke();
    c.strokeStyle = '#e29819'; c.lineWidth = thickness * 0.6; c.stroke();
    trace(model.points, -0.6, -thickness * 0.18); c.strokeStyle = 'rgba(255,225,119,.86)'; c.lineWidth = thickness * 0.22; c.stroke();
    // A narrow, falling stream meets the live end of the deposited thread.
    const end = model.points.at(-1), x = w * 0.18, y = h * (0.10 + (model.nozzle - 0.48) * 0.22);
    const ex = end.x * w, ey = h * (0.36 + end.y * 0.56);
    const stream = (offset = 0) => {
      c.beginPath(); c.moveTo(x + offset, y);
      c.bezierCurveTo(x - 3 + offset, h * 0.4, ex + offset, ey - h * 0.08, ex + offset, ey);
    };
    stream(2); c.strokeStyle = 'rgba(82,40,8,.2)'; c.lineWidth = thickness + 5; c.stroke();
    stream(); c.strokeStyle = '#85440c'; c.lineWidth = thickness + 1; c.stroke();
    c.strokeStyle = '#d89016'; c.lineWidth = thickness - 1.5; c.stroke();
    stream(-1.5); c.strokeStyle = '#ffe09a'; c.lineWidth = thickness * 0.22; c.stroke();
    // Machined brass nozzle with a dark opening.
    const metal = c.createLinearGradient(x - 14, 0, x + 14, 0);
    metal.addColorStop(0, '#67492b'); metal.addColorStop(0.22, '#bdaa79'); metal.addColorStop(0.43, '#f1ddb0'); metal.addColorStop(0.67, '#af9154'); metal.addColorStop(1, '#775329');
    c.fillStyle = metal; c.beginPath(); c.moveTo(x - 17, -1); c.lineTo(x + 17, -1); c.lineTo(x + 10, y); c.quadraticCurveTo(x, y + 5, x - 10, y); c.closePath(); c.fill();
    c.fillStyle = '#75501b'; c.beginPath(); c.ellipse(x, y, 9, 2.7, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#dfa52a'; c.beginPath(); c.ellipse(x, y + 0.5, 3, 2, 0, 0, Math.PI * 2); c.fill();
  }
}
function updateSpeed() {
  model.setSpeed(Number(speed.value) / 100); interactions++; syncControls();
  // While paused, an explicit control renders a complete new still immediately.
  if (!shell.motion) { model.points = []; prefill(13); }
  render();
}
function updateNozzle(value) {
  model.setNozzle(value); interactions++; syncControls();
  if (!shell.motion) { model.points = []; prefill(13); }
  else model.step(1 / 60);
  render();
}
function newPattern() {
  seed = (seed + 1987) >>> 0;
  model.reset(seed);
  const random = seededRandom(seed);
  model.setSpeed(0.15 + random() * 0.7); model.setNozzle(0.3 + random() * 0.4);
  prefill(); syncControls(); interactions++; render();
  shell.setStatus('A fresh pour. Change the belt speed to stretch the coils.');
}
speed.addEventListener('input', updateSpeed);
nozzle.addEventListener('input', () => updateNozzle(Number(nozzle.value) / 100));
document.querySelector('#new-pattern').addEventListener('click', newPattern);
document.addEventListener('experiment:play', newPattern);
document.addEventListener('experiment:reset', () => { seed = initialSeed; model.reset(seed); prefill(); syncControls(); interactions++; render(); });
canvas.addEventListener('pointerdown', event => { dragging = true; canvas.setPointerCapture(event.pointerId); steer(event); });
canvas.addEventListener('pointermove', event => { if (dragging) steer(event); });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointercancel', () => { dragging = false; });
function steer(event) {
  const bounds = canvas.getBoundingClientRect();
  updateNozzle(clamp(((event.clientY - bounds.top) / bounds.height - 0.36) / 0.56, 0.23, 0.77));
}
if (context) {
  prefill(); syncControls(); resize();
  const loop = makeLoop(dt => { model.step(dt); render(); }, { enabled: shell.motion });
  shell.onMotionChange(enabled => loop.setEnabled(enabled));
  new ResizeObserver(resize).observe(canvas);
  shell.markReady({ rendering: 'canvas2d' });
} else shell.setStatus('The honey plotter could not start in this browser. Portfolio links are still available.');
if (new URLSearchParams(location.search).has('debug')) {
  window.__experiment = { id: 'honey-plotter', snapshot: () => ({ motion: shell.motion, ready: document.body.dataset.ready === 'true', interactions, speed: model.speed, nozzle: model.nozzle, phase: model.phase, time: model.time, pointCount: model.points.length, samples: model.points.filter((_, i) => i % 100 === 0).map(p => ({ x: p.x, y: p.y })), tip: { ...model.points.at(-1) } }) };
}
