import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiquidModel } from '../experiments/liquid-identity/liquid-model.js';

test('pinch release clears the transient pulse even without future steps', () => {
  const m = createLiquidModel({ seed: 17 });
  m.settle();
  const { U } = m.letterBoxes;
  const sx = U.x + U.w * 0.5;
  const sy = U.y + U.h * 0.93;
  m.pointerDown(sx, sy);
  for (let i = 1; i <= 10; i += 1) {
    m.pointerMove(sx, sy + i * 0.05);
    for (let t = 0; t < 0.08; t += 1 / 60) m.step(1 / 60);
  }
  assert.equal(m.snapped, true, 'fixture reaches pinch-off');
  assert.ok(m.snapPulse > 0.5, 'fixture has the orange transient');
  m.pointerUp();
  assert.equal(m.snapPulse, 0, 'released pointer must not retain a frozen pulse');
  assert.equal(m.metrics().captured, 0);
  assert.equal(m.metrics().finite, true);
});

test('new pointer anchor captures only local liquid after keyboard-style pulling', () => {
  const m = createLiquidModel({ seed: 17 });
  m.settle();
  const { U, S } = m.letterBoxes;
  const ux = U.x + U.w * 0.5;
  const uy = U.y + U.h * 0.93;
  m.pointerDown(ux, uy);
  for (let i = 1; i <= 4; i += 1) {
    m.pointerMove(ux, uy + i * 0.06);
    for (let t = 0; t < 0.18; t += 1 / 60) m.step(1 / 60);
  }
  assert.ok(m.metrics().captured > 0, 'old keyboard grip exists');
  const sx = S.x + S.w * 0.5;
  const sy = S.y + S.h * 0.5;
  m.pointerDown(sx, sy);
  const oldLetterCaptured = Array.from(m.grip).filter((g, i) => g > 0 && m.letter[i] === 0).length;
  assert.equal(oldLetterCaptured, 0, 'U must not follow the new S anchor');
  assert.ok(m.metrics().captured > 0, 'new anchor captures S');
  m.pointerMove(sx + 0.08, sy);
  for (let t = 0; t < 0.18; t += 1 / 60) m.step(1 / 60);
  assert.equal(m.snapped, false, 'new local anchor must not immediately pinch');
  m.pointerUp();
  assert.equal(m.metrics().captured, 0);
  assert.equal(m.metrics().finite, true);
});
