import { mountShell, fitCanvas, makeLoop } from '../shared/shell.js';
import { createLiquidModel } from './liquid-model.js?v=material-2';
import { createWebGLRenderer } from './render-webgl.js?v=material-2';
import { createCanvasRenderer } from './render-canvas.js?v=material-2';

const debug = new URLSearchParams(location.search).has('debug');
const shell = mountShell({ id: 'liquid-identity', title: 'Liquid Identity' });
const model = createLiquidModel({ seed: 17 });
let canvas = document.getElementById('experiment-canvas');
let renderer;
let view;
let ready = false;
let frames = 0;
let drag = null;
let keyboard = null;
let loop;
let observer;
const interactions = { drags: 0, taps: 0, plays: 0, resets: 0, keyboard: 0 };

function measure() {
  const size = fitCanvas(canvas);
  const scale = Math.min(size.width / (model.bounds.width + 0.24), size.height / (model.bounds.height + 0.3));
  view = { ...size, scale, ox: (size.width - model.bounds.width * scale) / 2, oy: (size.height - model.bounds.height * scale) / 2 };
}

function magnet() {
  const pulse = model.snapPulse;
  if (!model.pointer.active && pulse <= 0.01) return null;
  return {
    x: view.ox + model.pointer.x * view.scale,
    y: view.oy + model.pointer.y * view.scale,
    r: model.params.grabRadius * view.scale,
    strength: model.pointer.active ? 0.48 : 0,
    tension: model.tension,
    pulse,
  };
}

function draw() {
  // A lost WebGL context draws nothing; webglcontextlost swaps in the Canvas renderer.
  if (!renderer || renderer.gl?.isContextLost()) return;
  renderer.render(model, view, magnet());
  frames += 1;
  if (!ready) {
    ready = true;
    shell.markReady({ rendering: renderer.kind });
  }
}

// A canvas cannot switch context types after WebGL has claimed it.
function useCanvasFallback() {
  const replacement = canvas.cloneNode(true);
  canvas.replaceWith(replacement);
  canvas = replacement;
  renderer = createCanvasRenderer(canvas);
  if (!renderer) throw new Error('No canvas renderer is available');
  measure();
}

// Shows the static monogram and stops drawing when no renderer is usable.
function fail(error) {
  ready = false;
  renderer = null;
  loop?.dispose();
  observer?.disconnect();
  delete document.body.dataset.ready;
  delete document.body.dataset.renderer;
  shell.setStatus('The interactive liquid is unavailable. The resting US monogram is shown.');
  console.error('Liquid Identity could not start:', error);
}

// The lost canvas stays WebGL-bound, so recovery moves to a fresh Canvas 2D element.
function recoverFromContextLoss(event) {
  event.preventDefault();
  const lost = canvas;
  const hadFocus = document.activeElement === lost;
  loop.stop();
  ready = false;
  delete document.body.dataset.ready;
  drag = null;
  keyboard = null;
  model.hoverLeave();
  model.pointerUp();
  try {
    useCanvasFallback();
    canvas.dataset.fallback = 'true';
    observer.unobserve(lost);
    observer.observe(canvas);
    bindInput();
    draw();
    if (hadFocus) canvas.focus({ preventScroll: true });
    loop.setEnabled(shell.motion);
  } catch (error) {
    fail(error);
  }
}

function advanceStill(seconds) {
  for (let t = 0; t < seconds; t += 1 / 60) model.step(1 / 60);
}

function localPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left - view.ox) / view.scale, y: (event.clientY - rect.top - view.oy) / view.scale };
}

function release(event, cancelled = false) {
  if (!drag || event.pointerId !== drag.id) return;
  const last = drag;
  drag = null;
  model.pointerUp();
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!cancelled && last.distance < 6) {
    interactions.taps += 1;
    const p = localPoint(event);
    model.poke(p.x, p.y);
  }
  // Finish a finite release pose for taps, drags and cancellation; keep RAF paused.
  if (!shell.motion) advanceStill(0.25);
  draw();
}

function bindInput() {
  canvas.addEventListener('pointerdown', event => {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    const p = localPoint(event);
    // The pointer now owns the gesture; a later arrow keyup must not release it.
    keyboard = null;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, counted: false };
    model.pointerDown(p.x, p.y);
    canvas.setPointerCapture(event.pointerId);
    draw();
  });
  canvas.addEventListener('pointermove', event => {
    if (drag) {
      if (drag.id !== event.pointerId) return;
      drag.distance = Math.max(drag.distance, Math.hypot(event.clientX - drag.x, event.clientY - drag.y));
      if (drag.distance >= 6 && !drag.counted) { interactions.drags += 1; drag.counted = true; }
      const p = localPoint(event);
      model.pointerMove(p.x, p.y);
      if (!shell.motion) advanceStill(0.08);
      draw();
      return;
    }
    if (!shell.motion || keyboard || event.pointerType === 'touch') return;
    const p = localPoint(event);
    model.hoverMove(p.x, p.y);
  });
  canvas.addEventListener('pointerleave', () => {
    if (!drag) model.hoverLeave();
  });
  canvas.addEventListener('pointerup', event => release(event));
  canvas.addEventListener('pointercancel', event => release(event, true));
  canvas.addEventListener('lostpointercapture', event => release(event, true));
  // Space and Enter belong to the shared shell, including on a fallback canvas.
  if (canvas.dataset.fallback === 'true') canvas.addEventListener('keydown', event => {
    if (event.code === 'Space' || event.key === 'Enter') {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent('experiment:play'));
    }
  });
  canvas.addEventListener('keydown', event => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (direction && !drag) {
      event.preventDefault();
      if (!keyboard) {
        const { U } = model.letterBoxes;
        keyboard = { x: U.x + U.w * 0.5, y: U.y + U.h * 0.93 };
        model.pointerDown(keyboard.x, keyboard.y);
      }
      keyboard.x += direction[0] * 0.06;
      keyboard.y += direction[1] * 0.06;
      model.pointerMove(keyboard.x, keyboard.y);
      interactions.keyboard += 1;
      if (!shell.motion) advanceStill(0.18);
      draw();
    } else if (event.key === 'Escape') {
      keyboard = null;
      model.hoverLeave();
      model.pointerUp();
      draw();
    }
  });
  canvas.addEventListener('keyup', event => {
    if (event.key.startsWith('Arrow') && keyboard) {
      keyboard = null;
      model.pointerUp();
      draw();
    }
  });
  canvas.addEventListener('blur', () => {
    keyboard = null;
    model.hoverLeave();
    model.pointerUp();
    draw();
  });
}

try {
  if (!shell.motion) model.settle();
  measure();
  try {
    renderer = createWebGLRenderer(canvas, { preserve: debug });
    if (!renderer) throw new Error('WebGL2 unavailable');
    draw();
    canvas.addEventListener('webglcontextlost', recoverFromContextLoss, { once: true });
  } catch {
    useCanvasFallback();
    canvas.dataset.fallback = 'true';
    draw();
  }
  bindInput();
  loop = makeLoop(dt => { model.step(dt); draw(); }, { enabled: shell.motion });
  shell.onMotionChange(enabled => {
    model.hoverLeave();
    model.pointerUp();
    keyboard = null;
    loop.setEnabled(enabled);
    draw();
  });
  document.addEventListener('experiment:play', () => {
    interactions.plays += 1;
    model.play();
    if (!shell.motion) advanceStill(0.35);
    draw();
    shell.setStatus(shell.motion ? 'Liquid splashed. It will find its way back.' : 'Still splash composition. Motion remains paused.');
  });
  document.addEventListener('experiment:reset', () => {
    interactions.resets += 1;
    keyboard = null;
    drag = null;
    model.hoverLeave();
    model.reset();
    if (!shell.motion) model.settle();
    draw();
  });
  observer = new ResizeObserver(() => { measure(); draw(); });
  observer.observe(canvas);
  window.addEventListener('resize', () => { measure(); draw(); });
  if (debug) window.__experiment = {
    id: 'liquid-identity',
    snapshot() {
      return {
        ready, motion: shell.motion, rendering: renderer?.kind ?? null, frames,
        interactions: { ...interactions }, view: { ...view },
        model: { count: model.count, seed: model.seed, ...model.metrics(), letterBoxes: model.letterBoxes },
        ink: renderer?.readInk() ?? null,
      };
    },
  };
} catch (error) {
  fail(error);
}
