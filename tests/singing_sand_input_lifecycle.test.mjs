import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SandModel } from '../experiments/singing-sand/model.mjs';

// Real app handlers with a minimal drawing-only DOM boundary; real SandModel.
function appFixture() {
  const listeners = new Map();
  const target = (name, extras = {}) => ({
    ...extras,
    addEventListener(type, fn) { listeners.set(`${name}:${type}`, fn); },
    setAttribute() {},
  });
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => gradient : () => {} });
  const canvas = target('canvas', { dataset: {}, width: 600, height: 600,
    getContext: () => context, getBoundingClientRect: () => ({left: 0, top: 0, width: 600, height: 600}),
    setPointerCapture() {},
  });
  const tuning = target('tuning', {value: '0'}), label = {textContent: ''};
  const body = {dataset: {}};
  const document = target('document', { body,
    querySelector: selector => ({'#experiment-canvas': canvas, '#sand-tuning': tuning, '#mode-name': label})[selector],
    createElement: () => ({width: 0, height: 0, getContext: () => context}),
  });
  let motionCallback;
  const shell = {motion: true, setStatus() {}, markReady() {body.dataset.ready = 'true';},
    onMotionChange(fn) {motionCallback = fn;},
  };
  const env = { document, window: target('window'), SandModel,
    mountShell: () => shell, fitCanvas: () => ({width: 600, height: 600, dpr: 1}),
    makeLoop: () => ({setEnabled() {}}), seededRandom: () => () => .5,
    ResizeObserver: class {observe() {}}, URLSearchParams, location: {search: '?debug'},
  };
  const source = fs.readFileSync(new URL('../experiments/singing-sand/app.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(source, env);
  return {canvas, shell, env,
    event: (name, type, detail) => listeners.get(`${name}:${type}`)?.(detail),
    pause() {shell.motion = false; motionCallback(false);},
    snapshot: () => env.window.__experiment.snapshot(),
  };
}

test('foreign lost capture cannot cancel the Sand pointer owner', () => {
  const app = appFixture();
  app.event('canvas', 'pointerdown', {pointerId: 11, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300});
  app.event('canvas', 'lostpointercapture', {pointerId: 99});
  assert.equal(app.canvas.dataset.dragging, 'true', 'capture loss from a different pointer is irrelevant');
  app.event('canvas', 'lostpointercapture', {pointerId: 11});
  assert.equal(app.canvas.dataset.dragging, undefined);
});

test('pausing during a held Sand gesture clears ownership before returning a stable still', () => {
  const app = appFixture();
  app.event('canvas', 'pointerdown', {pointerId: 11, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300});
  assert.equal(app.canvas.dataset.dragging, 'true');
  app.pause();
  assert.equal(app.canvas.dataset.dragging, undefined, 'pause must cancel the held finger');
  const before = app.snapshot();
  app.event('canvas', 'pointermove', {pointerId: 11, clientX: 360, clientY: 310});
  assert.deepEqual(app.snapshot(), before, 'a pointer owned before pause must not reshape the still');
});
