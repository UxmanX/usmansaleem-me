import test from 'node:test';
import assert from 'node:assert/strict';
const lib = await import('../experiments/honey-plotter/model.mjs').catch(() => null);

test('viscous thread deposits new samples while conveyor carries old samples downstream', () => {
  assert.ok(lib?.HoneyModel, 'HoneyModel must implement material deposition');
  const model = new lib.HoneyModel({ seed: 42 });
  for (let i = 0; i < 60; i++) model.step(1 / 60);
  assert.ok(model.points.length > 50, 'a continuous thread is deposited');
  const first = model.points[0];
  const before = first.x;
  model.step(1 / 60);
  assert.ok(first.x > before, 'existing deposited material moves with conveyor');
  assert.ok(model.points.every(p => Number.isFinite(p.x + p.y)), 'all deposited points are finite');
});

test('speed stretches coiling topology and nozzle steers newly deposited material', () => {
  const slow = new lib.HoneyModel({ seed: 42 });
  const fast = new lib.HoneyModel({ seed: 42 });
  assert.equal(typeof slow.setSpeed, 'function', 'speed needs a bounded material control');
  slow.setSpeed(0); fast.setSpeed(1);
  for (let i = 0; i < 480; i++) { slow.step(1 / 60); fast.step(1 / 60); }
  const span = m => Math.max(...m.points.map(p => p.y)) - Math.min(...m.points.map(p => p.y));
  assert.ok(span(slow) > span(fast) * 2, 'slow flow coils more broadly');
  assert.ok(fast.points[0].x > slow.points[0].x, 'fast belt carries material farther');
  slow.setNozzle(0.8);
  for (let i = 0; i < 120; i++) slow.step(1 / 60);
  const newMean = slow.points.slice(-100).reduce((s, p) => s + p.y, 0) / 100;
  assert.ok(newMean > 0.65, 'nozzle moves the actual deposited thread');
});

test('new pattern resets material deterministically and stopped time does not move it', () => {
  const model = new lib.HoneyModel({ seed: 42 });
  model.step(0.02);
  assert.equal(typeof model.reset, 'function');
  model.reset(93);
  assert.equal(model.points.length, 0);
  model.step(0.02);
  const twin = new lib.HoneyModel({ seed: 93 }); twin.step(0.02);
  assert.deepEqual(model.points, twin.points);
  const before = JSON.stringify(model.points); model.step(0);
  assert.equal(JSON.stringify(model.points), before);
  for (let i = 0; i < 6000; i++) model.step(0.05);
  assert.ok(model.points.length <= 2600, 'memory stays bounded');
});
