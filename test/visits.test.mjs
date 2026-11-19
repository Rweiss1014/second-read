// The site's visit counter: what it keeps, what it drops, and that reading needs the token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVisitsHandler, cleanEvent, isBot, coarseAgent } from '../netlify/visits/handler.mjs';

const TOKEN = 'x'.repeat(48);
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
function memStore() {
  const m = new Map();
  return { m, setJSON: async (k, v) => m.set(k, JSON.stringify(v)), get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    list: async () => ({ blobs: [...m.keys()].map(key => ({ key })) }), delete: async (k) => m.delete(k) };
}
function setup() {
  const s = memStore(); let t = 1_700_000_000_000;
  const h = makeVisitsHandler({ getStore: () => s, token: TOKEN, now: () => t++ });
  const post = (body, ua = CHROME, geo) => h(new Request('https://x.test/api/visit', { method: 'POST', headers: { 'user-agent': ua, 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify(body) }), { geo, ip: '203.0.113.9' });
  const get = (q = '', tok = TOKEN) => h(new Request('https://x.test/api/visits' + q, { headers: tok ? { authorization: 'Bearer ' + tok } : {} }));
  const del = (v) => h(new Request('https://x.test/api/visits?visit=' + v, { method: 'DELETE', headers: { authorization: 'Bearer ' + TOKEN } }));
  return { s, post, get, del };
}
const geo = { city: 'Austin', subdivision: { code: 'TX' }, country: { code: 'US' } };

test('a view is stored with coarse place and agent, and never the IP', async () => {
  const { s, post } = setup();
  const r = await post({ t: 'view', v: 'abcd1234ef', path: '/', ref: 'www.linkedin.com', vp: 'desktop', extra: 'nope' }, CHROME, geo);
  assert.equal(r.status, 204);
  assert.equal(s.m.size, 1);
  const raw = [...s.m.values()][0];
  assert.ok(!raw.includes('203.0.113'), 'no IP');
  const e = JSON.parse(raw);
  assert.deepEqual(e.geo, { city: 'Austin', region: 'TX', country: 'US' });
  assert.deepEqual(e.ua, { browser: 'Chrome', os: 'Windows' });
  assert.equal(e.ref, 'www.linkedin.com');
  assert.equal(e.extra, undefined);
});

test('bots, junk and unknown fields are dropped', async () => {
  const { s, post } = setup();
  await post({ t: 'view', v: 'abcd1234ef' }, 'Mozilla/5.0 (compatible; Googlebot/2.1)');
  await post({ t: 'view', v: 'abcd1234ef' }, 'Mozilla/5.0 HeadlessChrome/142.0');
  await post({ t: 'view', v: 'abcd1234ef' }, '');
  await post({ t: 'hack', v: 'abcd1234ef' });
  await post({ t: 'view', v: 'BAD ID' });
  await post({ t: 'click', v: 'abcd1234ef', what: 'somewhere' });
  await post({ t: 'video', v: 'abcd1234ef', pct: 33 });
  assert.equal(s.m.size, 0);
});

test('reading needs the token, returns events after since, and DELETE removes one visit', async () => {
  const { post, get, del } = setup();
  await post({ t: 'view', v: 'visit-one-1', path: '/' });
  await post({ t: 'click', v: 'visit-one-1', what: 'repo' });
  await post({ t: 'view', v: 'visit-two-2', path: '/app/' });
  assert.equal((await get('', '')).status, 401);
  assert.equal((await get('', 'y'.repeat(48))).status, 401);
  const all = await (await get()).json();
  assert.equal(all.events.length, 3);
  assert.equal(all.events[1].what, 'repo');
  const after = await (await get('?since=' + encodeURIComponent(all.events[0].key))).json();
  assert.equal(after.events.length, 2);
  assert.equal((await (await del('visit-one-1')).json()).deleted, 2);
  assert.equal((await (await get()).json()).events.length, 1);
});

test('coarse agent and bot checks', () => {
  assert.deepEqual(coarseAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'), { browser: 'Safari', os: 'iOS' });
  assert.equal(isBot(CHROME), false);
  assert.equal(cleanEvent({ t: 'video', v: 'abcd1234ef', pct: 50, secs: 99 }, { ua: CHROME, now: 1 }).pct, 50);
});
