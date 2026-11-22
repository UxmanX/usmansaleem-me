import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = 'material-2';
const routes = ['liquid-identity', 'wet-ink', 'honey-plotter', 'singing-sand', 'pin-art'];

test('every changed material entry and local module reference is cache coherent', async () => {
  const failures = [];
  for (const route of routes) {
    const dir = path.join(root, 'experiments', route);
    const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
    if (!html.includes(`src="./app.js?v=${version}"`)) failures.push(`${route}: entry script is not versioned`);
    const sheet = route === 'liquid-identity' ? 'liquid.css' : 'style.css';
    if (!html.includes(`href="./${sheet}?v=${version}"`)) failures.push(`${route}: stylesheet is not versioned`);
    for (const name of await fs.readdir(dir)) {
      if (!/\.(?:mjs|js)$/.test(name)) continue;
      const text = await fs.readFile(path.join(dir, name), 'utf8');
      for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g)) {
        const reference = match[1];
        if (!reference.endsWith(`?v=${version}`)) failures.push(`${route}/${name}: ${reference} can load a stale module`);
        const local = reference.split('?')[0];
        await fs.access(path.resolve(dir, local));
      }
    }
  }
  const gallery = await fs.readFile(path.join(root, 'experiments/index.html'), 'utf8');
  for (const route of routes) {
    if (!gallery.includes(`previews/${route}.png?v=${version}`)) failures.push(`gallery: stale ${route} preview reference`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});
