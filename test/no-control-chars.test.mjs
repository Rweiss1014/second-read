// A "\b" written through a script or a template literal can land in a file as an invisible backspace (it happened
// twice, Nov 15 and Nov 16, 2026), which silently turns a word-boundary regex into one that never matches.
// No source file may hold a control character other than tab, newline and carriage return.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'bin', 'public', 'knowledge', 'eval', 'test'];
const EXT = /\.(?:mjs|js|json|html|css|md)$/;
function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/cache|results|node_modules/.test(e.name)) yield* files(p); }
    else if (EXT.test(e.name)) yield p;
  }
}

test('no source file holds a hidden control character (a stray backspace breaks a regex silently)', () => {
  const bad = [];
  for (const r of ROOTS) if (fs.existsSync(r)) for (const f of files(r)) {
    const s = fs.readFileSync(f, 'utf8');
    const i = s.search(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
    if (i >= 0) bad.push(`${f}: line ${s.slice(0, i).split('\n').length}`);
  }
  assert.deepEqual(bad, []);
});
