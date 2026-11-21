import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERIMENTS } from '../experiments/shared/core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('each review page is a complete static landing page with local resources and a stable identity', async () => {
  const failures = [];
  for (const item of EXPERIMENTS) {
    const directory = path.join(root, 'experiments', item.id);
    let html;
    try { html = await fs.readFile(path.join(directory, 'index.html'), 'utf8'); }
    catch { failures.push(`${item.id}: index.html missing`); continue; }
    if (!/<main\b/.test(html)) failures.push(`${item.id}: semantic main missing`);
    if ((html.match(/<h1\b/g) || []).length !== 1) failures.push(`${item.id}: expected exactly one h1`);
    if (!/Usman Saleem/.test(html)) failures.push(`${item.id}: identity missing`);
    if (!/id=["']experiment-canvas["']/.test(html)) failures.push(`${item.id}: interactive canvas missing`);
    if (!/Usman_Saleem_MEng_Resume\.pdf/.test(html)) failures.push(`${item.id}: résumé link missing`);
    if (!/<meta\b[^>]*name=["']robots["'][^>]*noindex/.test(html)) failures.push(`${item.id}: review page should be noindex`);
    const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
    for (const reference of references) {
      if (/^(?:data:|https?:|mailto:|tel:|#)/.test(reference)) continue;
      const clean = decodeURIComponent(reference.split(/[?#]/)[0]);
      const target = clean.startsWith('/') ? path.join(root, clean) : path.resolve(directory, clean);
      try { await fs.access(target); }
      catch { failures.push(`${item.id}: missing local resource ${reference}`); }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});
