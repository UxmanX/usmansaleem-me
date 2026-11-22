import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SandModel } from '../experiments/singing-sand/model.mjs';

// Real app and model; only the DOM/drawing/RAF boundaries are substituted.
function fixture(motion = false) {
  const listeners = new Map();
  const target = (name, extras = {}) => ({ ...extras,
    addEventListener(type, fn) { listeners.set(`${name}:${type}`, fn); },
    setAttribute() {},
  });
  const gradient = {addColorStop() {}};
  const context = new Proxy({}, {get: (_, key) => key.startsWith('create') ? () => gradient : () => {}});
  const canvas = target('canvas', {dataset: {}, width: 600, height: 600,
    getContext: () => context, getBoundingClientRect: () => ({left: 0, top: 0, width: 600, height: 600}),
    setPointerCapture() {},
  });
  const tuning = target('tuning', {value: '0'}), label = {textContent: ''}, body = {dataset: {}};
  const document = target('document', {body,
    querySelector: s => ({'#experiment-canvas': canvas, '#sand-tuning': tuning, '#mode-name': label})[s],
    createElement: () => ({getContext: () => context}),
  });
  let callback, loopStep;
  const enabledCalls = [];
  const shell = {motion, status: '', setStatus(s) {this.status = s;},
    markReady() {body.dataset.ready = 'true';}, onMotionChange(fn) {callback = fn;},
  };
  const env = {document, window: target('window'), SandModel,
    mountShell: () => shell, fitCanvas: () => ({width: 600, height: 600, dpr: 1}),
    makeLoop(fn, {enabled}) {loopStep = fn; enabledCalls.push(enabled); return {setEnabled(v) {enabledCalls.push(v);}};},
    seededRandom: () => () => .5, ResizeObserver: class {observe() {}},
    URLSearchParams, location: {search: '?debug'},
  };
  const source = fs.readFileSync(new URL('../experiments/singing-sand/app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(source, env);
  return {canvas, shell, enabledCalls,
    event: (name, type, detail) => listeners.get(`${name}:${type}`)?.(detail),
    snapshot: () => env.window.__experiment.snapshot(),
    pause() {shell.motion = false; callback(false);},
    frame: () => loopStep(1 / 60),
  };
}

function assertSettled(app, before) {
  const after = app.snapshot();
  assert.equal(after.ripples, 0, 'completed still-mode gesture must not leave an age-zero ripple');
  assert.ok(Math.abs(after.time - before.time - 165 / 60) < 1e-10, 'settlement is finite and synchronous');
  assert.equal(after.motion, false);
  assert.ok(app.enabledCalls.every(v => v === false), 'still-mode gesture must never enable RAF');
  assert.ok(after.energy < .02, 'the scatter impulse must decay rather than freeze');
}

for (const key of ['ArrowUp', 'ArrowDown']) test(`reduced-motion ${key} completes as a settled still`, () => {
  const app = fixture(), before = app.snapshot();
  app.event('canvas', 'keydown', {key, preventDefault() {}});
  assertSettled(app, before);
  assert.match(app.shell.status, /settled.*still/i);
  assert.doesNotMatch(app.shell.status, /travels/);
});

for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
  test(`reduced-motion drag settles on ${ending}`, () => {
    const app = fixture(), before = app.snapshot();
    app.event('canvas', 'pointerdown', {pointerId: 11, pointerType: 'touch', button: 0, clientX: 300, clientY: 300});
    app.event('canvas', 'pointermove', {pointerId: 11, clientX: 370, clientY: 320});
    assert.equal(app.canvas.dataset.dragging, 'true', 'a held finger may keep its static impression');
    app.event(ending === 'blur' ? 'window' : 'canvas', ending, {pointerId: 11});
    assertSettled(app, before);
    assert.equal(app.canvas.dataset.dragging, undefined);
    const settled = app.snapshot();
    app.event('canvas', 'pointermove', {pointerId: 11, clientX: 400, clientY: 320});
    app.event('canvas', 'pointerup', {pointerId: 11});
    assert.deepEqual(app.snapshot(), settled, 'released owner and duplicate release cannot disturb the still');
  });
}

test('normal motion preserves the tap ripple and dragged release rebound', () => {
  const app = fixture(true), before = app.snapshot();
  app.event('canvas', 'keydown', {key: 'ArrowUp', preventDefault() {}});
  assert.equal(app.snapshot().time, before.time);
  assert.equal(app.snapshot().ripples, 1);
  assert.match(app.shell.status, /ripple travels/);
  app.event('canvas', 'pointerdown', {pointerId: 11, pointerType: 'touch', button: 0, clientX: 300, clientY: 300});
  app.event('canvas', 'pointermove', {pointerId: 11, clientX: 370, clientY: 320});
  const held = app.snapshot();
  app.event('canvas', 'pointerup', {pointerId: 11});
  assert.equal(app.snapshot().time, held.time, 'animated release must not synchronously settle');
  assert.equal(app.snapshot().ripples, held.ripples + 1, 'normal dragged release still emits rebound');
});

test('pausing an existing ripple preserves a resumable frozen frame', () => {
  const app = fixture(true);
  app.event('canvas', 'keydown', {key: 'ArrowUp', preventDefault() {}});
  app.frame();
  const before = app.snapshot();
  app.pause();
  assert.equal(app.snapshot().time, before.time);
  assert.equal(app.snapshot().ripples, before.ripples);
  assert.equal(app.snapshot().motion, false);
});

test('mobile caption reserves space beyond the canvas focus outline', () => {
  const css = fs.readFileSync(new URL('../experiments/singing-sand/style.css', import.meta.url), 'utf8');
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?\.plate-caption\{[^}]*margin-top:10px/);
});
