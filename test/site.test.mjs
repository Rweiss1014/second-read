// The free public site: no model call, ever. The reader and the composer answer from saved verdicts only.
// A message with no saved verdict takes the normal hand-over path. No key, no network, no model CLI is used here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.mjs';
import { openDesk, handleTicket } from '../src/desk.mjs';
import { createServer } from '../src/server.mjs';
import { tempDesk } from './helpers.mjs';

const URL_ = 'https://help.blotato.com/test-pages/lantern-widgets';
const PAGE = '# Lantern widgets\n\nLantern widgets show a small glowing badge on your calendar.\n\n## How many lantern widgets can a workspace hold?\n\nEach workspace can hold up to 7 lantern widgets. Open Settings > Widgets to add one.\n';
const MSG = 'How many lantern widgets can one workspace hold, and where do I add them?';
const pages = { [URL_]: { url: URL_, fetchedAt: '2026-11-16T01:00:00.000Z', via: 'test fixture', text: PAGE } };

test('cache-only env: a brand-new question that reaches the reader and composer never calls a model, and is handed over', async () => {
  const { env } = tempDesk();
  let calls = 0;
  const call = async () => { calls++; throw new Error('a model was called'); };
  const siteEnv = { ...env, SUPPORT_DESK_READER: 'claude-cli', SUPPORT_DESK_READER_CACHE_ONLY: '1', SUPPORT_DESK_COMPOSER: 'claude-cli', SUPPORT_DESK_COMPOSER_CACHE_ONLY: '1', SUPPORT_DESK_CLAUDE_BIN: '/nonexistent/none' };
  const desk = openDesk({ env: siteEnv, readerCall: call, composerCall: call, composerPages: pages });
  try {
    const r = await handleTicket(desk, { text: MSG });
    assert.equal(calls, 0, 'no model call was made');
    assert.notEqual(r.outcome, 'reply', 'the message was handed over, not answered');
    assert.ok(desk.composer && desk.reader, 'both were on, so this proves the cache-only switch and not an absent model');
  } finally { await desk.close(); }
});

test('the real backends are never reached in cache-only mode: no key, no CLI on PATH, no network', async () => {
  const { env } = tempDesk();
  const net = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (...a) => { net.push(String(a[0])); throw new Error('no network in this test'); };
  const oldPath = process.env.PATH; const oldKey = process.env.ANTHROPIC_API_KEY;
  process.env.PATH = ''; delete process.env.ANTHROPIC_API_KEY;
  const desk = openDesk({ env: { ...env, SUPPORT_DESK_READER: 'anthropic', SUPPORT_DESK_READER_CACHE_ONLY: '1', SUPPORT_DESK_COMPOSER: 'claude-cli', SUPPORT_DESK_COMPOSER_CACHE_ONLY: '1' }, composerPages: pages });
  try {
    const r = await handleTicket(desk, { text: MSG });
    assert.notEqual(r.outcome, 'reply');
    assert.deepEqual(net, []);
  } finally { process.env.PATH = oldPath; if (oldKey) process.env.ANTHROPIC_API_KEY = oldKey; globalThis.fetch = realFetch; await desk.close(); }
});

// The function itself, run in this process on top of a built netlify/site-data (built here from the repo's own caches).
test('the Netlify function: sample data only, cached composed question works, a new question is handed over, nothing leaves the machine', async (t) => {
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-site.mjs')], { encoding: 'utf8' });
  if (built.status !== 0) return t.skip('no help-page cache on this machine to build the site data from');
  const oldPath = process.env.PATH; const oldKey = process.env.ANTHROPIC_API_KEY;
  process.env.PATH = ''; delete process.env.ANTHROPIC_API_KEY;
  const { default: handler, SITE_ENV, config } = await import('../netlify/functions/second-read.mjs');
  const realFetch = globalThis.fetch; const outside = [];
  globalThis.fetch = (u, ...a) => { if (!/^http:\/\/127\.0\.0\.1:/.test(String(u))) { outside.push(String(u)); throw new Error('no network'); } return realFetch(u, ...a); };
  const ask = async (body) => (await handler(new Request('https://site.test/api/ticket', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))).json();
  try {
    assert.equal(config.path, '/api/*');
    assert.equal(SITE_ENV.BLOTATO_MOCK, '1');
    assert.equal(SITE_ENV.SUPPORT_DESK_DIR.startsWith('/tmp/'), true);
    assert.ok(!Object.keys(SITE_ENV).some(k => /KEY|TOKEN/i.test(k)), 'no key of any kind');
    const state = await (await handler(new Request('https://site.test/api/state'))).json();
    assert.equal(state.mock, true); assert.ok(state.docs.pages > 100);
    const cached = await ask({ text: 'What size should my YouTube thumbnail be?' });
    assert.equal(cached.path, 'composed'); assert.equal(cached.outcome, 'reply');
    const fresh = await ask({ text: 'How do I bake a sourdough loaf on Mars?' });
    assert.equal(fresh.outcome, 'no-answer');
    const sample = await ask({ id: 'T01' });
    assert.ok(sample.reply);
    const live = await (await handler(new Request('https://site.test/api/ticket/live', { method: 'POST', body: JSON.stringify({ id: 'T01' }), headers: { 'content-type': 'application/json' } }))).text();
    assert.equal(JSON.parse(live.trim().split('\n').at(-1)).t, 'result');
    for (const p of ['/api/practice', '/api/example/stopped', '/api/art']) assert.equal((await handler(new Request('https://site.test' + p))).status, 200, p);
    assert.deepEqual(outside, []);
  } finally { process.env.PATH = oldPath; if (oldKey) process.env.ANTHROPIC_API_KEY = oldKey; globalThis.fetch = realFetch; }
});

test('Blotato help pages are never in the published folder or in git', () => {
  const pub = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? pub(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of pub(path.join(ROOT, 'public'))) assert.ok(!/docs|help\.blotato|_json$/.test(f) || /examples|art|fonts/.test(f), f);
  const ig = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ig, /^netlify\/site-data\/$/m);
  assert.match(ig, /^\.cache\/$/m);
});
