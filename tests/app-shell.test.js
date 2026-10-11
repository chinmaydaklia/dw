import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

test('service worker caches every app file so the app works offline', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const files = [...walk(path.join(root, 'js')), ...walk(path.join(root, 'css')), ...walk(path.join(root, 'icons')), ...walk(path.join(root, 'vendor')).filter(f => /\.js$/.test(f))]
    .map(f => './' + path.relative(root, f).split(path.sep).join('/'));
  for (const f of files) assert.ok(sw.includes(`'${f}'`), 'missing from sw.js SHELL: ' + f);
  const store = fs.readFileSync(path.join(root, 'js/app/store.js'), 'utf8');
  const v = /APP_VERSION = '([^']+)'/.exec(store)[1];
  assert.ok(sw.includes(`VERSION = '${v}'`), 'sw.js VERSION must match APP_VERSION');
});
