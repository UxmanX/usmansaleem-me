import { EXPERIMENTS, neighbours } from './core.mjs';
export { EXPERIMENTS, neighbours } from './core.mjs';

export const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const lerp = (start, end, amount) => start + (end - start) * amount;
export function seededRandom(seed = 12345) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

const ARROW = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';

export function mountShell({ id, title }) {
  const links = neighbours(id);
  const host = document.querySelector('[data-review-nav]') || document.body.insertBefore(document.createElement('header'), document.body.firstChild);
  host.classList.add('review-nav');
  host.innerHTML = `
    <a class="review-brand" href="../../" aria-label="Usman Saleem, current portfolio">Usman Saleem<span class="review-brand-dot" aria-hidden="true"></span></a>
    <nav class="review-choices" aria-label="Choose a landing-page experiment">
      <a class="review-index" href="../">All experiments</a>
      <label class="sr-only" for="experiment-select">Experiment</label>
      <select id="experiment-select">${EXPERIMENTS.map(item => `<option value="${item.id}"${item.id === id ? ' selected' : ''}>${item.title}</option>`).join('')}</select>
      <button class="review-open" type="button" aria-label="Open selected experiment">Open</button>
      <a class="review-next" href="../${links.next.id}/" aria-label="Next experiment: ${links.next.title}" title="Next: ${links.next.title}">${ARROW}</a>
    </nav>
    <div class="review-actions"></div>`;
  const actions = host.querySelector('.review-actions');
  const controls = [
    ['play-experiment', 'Try it', 'Give the material a nudge'],
    ['reset-experiment', 'Reset', 'Restore the starting composition'],
    ['motion-toggle', 'Pause motion', 'Toggle the animation'],
  ];
  for (const [controlId, text, label] of controls) {
    if (document.getElementById(controlId)) continue;
    const button = document.createElement('button');
    button.id = controlId;
    button.type = 'button';
    button.textContent = text;
    button.title = label;
    button.className = 'review-control';
    actions.append(button);
  }
  const status = document.querySelector('[data-status]') || document.body.appendChild(document.createElement('span'));
  if (!status.hasAttribute('data-status')) status.className = 'sr-only';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let enabled = !preference.matches;
  let stored = null;
  try { stored = sessionStorage.getItem('usman-experiments-motion'); } catch { /* Optional browser storage. */ }
  if (!preference.matches && stored === 'off') enabled = false;
  const callbacks = new Set();
  function paintControl() {
    const button = document.getElementById('motion-toggle');
    button.textContent = enabled ? 'Pause motion' : 'Resume motion';
    button.setAttribute('aria-pressed', String(enabled));
    document.body.dataset.motion = enabled ? 'on' : 'off';
  }
  function setMotion(value, { persist = true } = {}) {
    enabled = Boolean(value);
    if (persist) {
      try { sessionStorage.setItem('usman-experiments-motion', enabled ? 'on' : 'off'); } catch { /* Optional browser storage. */ }
    }
    paintControl();
    document.dispatchEvent(new CustomEvent('experiment:motion', { detail: { enabled } }));
    callbacks.forEach(callback => callback(enabled));
    status.textContent = enabled ? 'Motion resumed.' : 'Motion paused. Controls remain available.';
  }
  document.getElementById('motion-toggle').addEventListener('click', () => setMotion(!enabled));
  document.getElementById('reset-experiment').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('experiment:reset'));
    status.textContent = 'Starting composition restored.';
  });
  document.getElementById('play-experiment').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('experiment:play'));
  });
  host.querySelector('.review-open').addEventListener('click', () => {
    const item = EXPERIMENTS.find(experiment => experiment.id === host.querySelector('#experiment-select').value);
    if (item) location.href = `../${item.id}/`;
  });
  preference.addEventListener('change', event => {
    if (event.matches) setMotion(false, { persist: false });
  });
  paintControl();
  const canvas = document.getElementById('experiment-canvas');
  if (canvas && !canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
  if (canvas) canvas.addEventListener('keydown', event => {
    if (event.code === 'Space' || event.key === 'Enter') {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent('experiment:play'));
    }
  });
  return {
    get motion() { return enabled; },
    setMotion,
    onMotionChange(callback) { callbacks.add(callback); return () => callbacks.delete(callback); },
    markReady({ rendering = 'canvas2d' } = {}) {
      document.body.dataset.ready = 'true';
      document.body.dataset.renderer = rendering;
      document.body.dataset.experiment = id;
      status.textContent = `${title || links.current.title} is ready. ${links.current.gesture}`;
    },
    setStatus(message) { status.textContent = message; },
  };
}

/** Set backing resolution. Return CSS dimensions; callers own context transforms. */
export function fitCanvas(canvas, maxDpr = 2) {
  const box = canvas.getBoundingClientRect();
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  return { width, height, dpr, pixelWidth, pixelHeight };
}

/** Calls step(dtSeconds, nowMilliseconds); pauses in hidden tabs. */
export function makeLoop(step, { enabled = true } = {}) {
  let requested = Boolean(enabled), frame = 0, previous = 0, disposed = false;
  function tick(now) {
    frame = 0;
    if (!requested || document.hidden || disposed) return;
    const dt = previous ? Math.min(0.04, (now - previous) / 1000) : 1 / 60;
    previous = now;
    step(dt, now);
    if (requested && !document.hidden && !disposed) frame = requestAnimationFrame(tick);
  }
  function sync() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    if (requested && !document.hidden && !disposed) frame = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', sync);
  sync();
  return {
    start() { requested = true; sync(); },
    stop() { requested = false; sync(); },
    setEnabled(value) { requested = Boolean(value); sync(); },
    get running() { return requested && !document.hidden && !disposed; },
    drawOnce() { step(0, performance.now()); },
    dispose() { requested = false; disposed = true; sync(); document.removeEventListener('visibilitychange', sync); },
  };
}

export function observeStage(canvas, onChange) {
  const observer = new ResizeObserver(() => onChange(fitCanvas(canvas)));
  observer.observe(canvas);
  return () => observer.disconnect();
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image: ${src}`));
    image.src = src;
  });
}

export function downloadCanvas(canvas, filename = 'usman-experiment.png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('The image could not be exported.')); return; }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve(blob);
    }, 'image/png');
  });
}
