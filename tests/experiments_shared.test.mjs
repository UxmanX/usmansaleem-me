import test from 'node:test';
import assert from 'node:assert/strict';

const expected = ['liquid-identity', 'wet-ink', 'honey-plotter', 'singing-sand', 'pin-art'];

test('review navigation reaches exactly the five proposed experiments and loops without skipping one', async () => {
  let api;
  try { api = await import('../experiments/shared/core.mjs'); }
  catch (error) { assert.fail(`Experiment review navigation is not implemented: ${error.message}`); }
  assert.deepEqual(api.EXPERIMENTS.map(item => item.id), expected);
  assert.equal(new Set(api.EXPERIMENTS.map(item => item.id)).size, 5);
  let id = expected[0];
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const links = api.neighbours(id);
    seen.push(id);
    assert.equal(api.neighbours(links.next.id).previous.id, id);
    id = links.next.id;
  }
  assert.deepEqual(seen, expected);
  assert.equal(id, expected[0]);
  assert.throws(() => api.neighbours('not-a-prototype'), /Unknown experiment/);
});
