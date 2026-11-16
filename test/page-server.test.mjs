// The page server's additions for the round 2 look: the practice game carries where each help
// sentence sits on its page, and the first page shows the app's mark only when its picture exists.
// Every earlier route and JSON shape stays the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/server.mjs';
import { ROOT } from '../src/config.mjs';
import { PRACTICE } from '../knowledge/practice.mjs';

async function withServer(fn) {
  const server = createServer({ env: { ...process.env, BLOTATO_MOCK: '1', DOCS_OFFLINE: '1' } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise(r => server.close(r)); }
}

test('practice keeps every original field and adds the page context of each quote', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/practice`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.title, PRACTICE.title);
    assert.equal(j.decisions.length, PRACTICE.decisions.length);
    j.decisions.forEach((d, i) => {
      const o = PRACTICE.decisions[i];
      assert.equal(d.ticket, o.ticket);
      assert.deepEqual(d.choices, o.choices);
      assert.equal(d.source.url, o.source.url);
      assert.equal(d.source.quote, o.source.quote);
      assert.ok('page' in d.source);
      if (d.source.page?.found) {
        const [s, e] = d.source.page.mark;
        assert.ok(e > s, 'the mark has a length');
      }
    });
  });
});

test('the first page has no leftover placeholders, and the mark appears only when its file exists', async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(!html.includes('<!--app-mark-->') && !html.includes('<!--app-icon-->'));
    const has = fs.existsSync(path.join(ROOT, 'public', 'art', 'app-mark.webp'));
    assert.equal(html.includes('/art/app-mark.webp'), has);
    if (has) assert.match(html, /<img class="brand-mark"[^>]*width="34" height="34"/);
  });
});

test('the earlier routes still answer', async () => {
  await withServer(async (base) => {
    for (const p of ['/api/state', '/api/art', '/app.js', '/app.css']) assert.equal((await fetch(base + p)).status, 200, p);
    assert.equal((await fetch(`${base}/favicon.ico`)).status, 204);
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  });
});

// Round 3 additions: a reason for every hand-over, and text files sent gzipped.
test('a ticket result says why the route chose what it chose, with near candidates by title', async () => {
  await withServer(async (base) => {
    const others = await (await fetch(`${base}/api/ticket`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Can you send me the email address of the other customer who runs the @catsofnyc account?' }) })).json();
    assert.equal(others.route.decision, 'guard');
    assert.equal(others.route.guard, 'others-data');
    const nonsense = await (await fetch(`${base}/api/ticket`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Banana phone purple. Does it work on Tuesdays?' }) })).json();
    assert.equal(nonsense.route.decision, 'abstain');
    assert.ok(Array.isArray(nonsense.route.candidates));
    for (const c of nonsense.route.candidates) assert.ok('id' in c && 'title' in c && 'phrasing' in c);
  });
});

test('text files go out gzipped when asked, and plain when not', async () => {
  const http = await import('node:http');
  const zlib = await import('node:zlib');
  await withServer(async (base) => {
    const get = (p, headers) => new Promise((res, rej) => http.get(base + p, { headers }, (r) => { const b = []; r.on('data', c => b.push(c)); r.on('end', () => res({ h: r.headers, body: Buffer.concat(b) })); }).on('error', rej));
    const z = await get('/app.js', { 'accept-encoding': 'gzip' });
    assert.equal(z.h['content-encoding'], 'gzip');
    const plain = await get('/app.js', {});
    assert.equal(plain.h['content-encoding'], undefined);
    assert.equal(zlib.gunzipSync(z.body).toString(), plain.body.toString());
  });
});
