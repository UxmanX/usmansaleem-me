import test from 'node:test';
import assert from 'node:assert/strict';
const lib = await import('../experiments/singing-sand/model.mjs').catch(() => null);

test('loose grains converge toward nodal target contours', () => {
  assert.ok(lib?.SandModel, 'SandModel must implement nodal particle attraction');
  const model = new lib.SandModel({ seed: 42, count: 600 });
  const before = model.meanDistance();
  for (let i = 0; i < 180; i++) model.step(1 / 60);
  assert.ok(model.meanDistance() < before * 0.25, 'particles must reach nodes, not only update a counter');
  assert.equal(model.grains.length, 600);
  assert.ok(model.grains.every(g => Number.isFinite(g.x + g.y) && Math.abs(g.x) <= 1 && Math.abs(g.y) <= 1));
});

test('tuning replaces nodal targets and physically redistributes settled grains', () => {
  const model = new lib.SandModel({ seed: 8, count: 600 });
  for (let i = 0; i < 180; i++) model.step(1 / 60);
  const before = model.grains.map(g => ({ x: g.x, y: g.y }));
  assert.equal(typeof model.setMode, 'function', 'tuning needs to change the nodal field');
  model.setMode(2);
  const initialError = model.meanDistance();
  assert.ok(initialError > 0.02);
  for (let i = 0; i < 180; i++) model.step(1 / 60);
  assert.ok(model.meanDistance() < initialError * 0.1);
  const movement = model.grains.reduce((s, g, i) => s + Math.hypot(g.x - before[i].x, g.y - before[i].y), 0) / 600;
  assert.ok(movement > 0.025, 'mode changes must move grains, not merely relabel patterns');
});

test('a fingertip excites nearby grains and zero time preserves the resting field', () => {
  const model = new lib.SandModel({ seed: 12, count: 400 });
  for (let i = 0; i < 180; i++) model.step(1 / 60);
  const before = model.grains.map(g => ({ x: g.x, y: g.y }));
  assert.equal(typeof model.scatter, 'function');
  model.scatter(0.1, 0.1);
  const displaced = model.grains.filter((g, i) => Math.hypot(g.x - before[i].x, g.y - before[i].y) > 0.005);
  assert.ok(displaced.length > 10, 'pointer must physically scatter grains');
  assert.ok(model.meanDistance() > 0.005);
  const frozen = JSON.stringify(model.grains); model.step(0);
  assert.equal(JSON.stringify(model.grains), frozen);
  for (let i = 0; i < 200; i++) model.step(1 / 60);
  assert.ok(model.meanDistance() < 0.001, 'excited grains settle back to nodes');
  assert.ok(model.grains.every(g => Math.abs(g.x) <= 1 && Math.abs(g.y) <= 1));
});
