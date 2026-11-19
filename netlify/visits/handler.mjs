// Visit counter for the public site: a tiny first-party beacon posts to /api/visit, and the owner reads /api/visits.
// What is kept per event: the time, a random per-tab visit id, the page path, the referrer's host, a phone/desktop
// size class, what was clicked or how much of the walkthrough was watched, a coarse place (city, region, country,
// from Netlify's own geo lookup) and a coarse browser and OS family. Never the IP address, never a cookie, never
// a fingerprint. Bots are dropped by user agent.
//
//   POST   /api/visit                    one event (JSON, sent with navigator.sendBeacon). Always answers 204.
//   GET    /api/visits?since=<key>       events after <key>, oldest first. Needs  Authorization: Bearer <VISITS_TOKEN>
//   DELETE /api/visits?visit=<id>        removes every event of one visit (for test visits). Same token.
import crypto from 'node:crypto';

const BOT = /bot|crawl|spider|slurp|preview|fetch|curl|wget|python|httpclient|okhttp|go-http|java\/|node-fetch|undici|axios|headless|phantom|puppeteer|playwright|lighthouse|pagespeed|monitor|uptime|scan|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|slack|skype|vkshare|redditbot|linkedinbot|twitterbot|bingpreview|google-inspectiontool|gptbot|claude|anthropic|perplexity|bytespider/i;
const TYPES = new Set(['view', 'click', 'video', 'leave']);
const WHAT = new Set(['app', 'repo', 'resume', 'resume-pdf', 'n8n', 'n8n-github', 'linkedin', 'emdesigns', 'video']);
const ID = /^[a-z0-9-]{8,40}$/;

export function coarseAgent(ua = '') {
  const os = /iphone|ipad|ipod/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows'
    : /mac os x|macintosh/i.test(ua) ? 'Mac' : /cros/i.test(ua) ? 'ChromeOS' : /linux/i.test(ua) ? 'Linux' : 'other';
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /firefox|fxios/i.test(ua) ? 'Firefox'
    : /chrome|crios|chromium/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'other';
  return { browser, os };
}

export const isBot = (ua) => !ua || BOT.test(ua);

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

// The event as stored: only whitelisted fields, each one short.
export function cleanEvent(body, { ua, geo, now }) {
  if (!body || typeof body !== 'object' || !TYPES.has(body.t) || !ID.test(String(body.v || ''))) return null;
  const e = { ts: now, v: body.v, t: body.t, path: clip(body.path, 80).replace(/[^\w\-/.#]/g, '') || '/' };
  if (body.t === 'view') {
    e.ref = clip(body.ref, 80).toLowerCase().replace(/[^a-z0-9.\-]/g, '');
    e.vp = ['phone', 'tablet', 'desktop'].includes(body.vp) ? body.vp : '';
  }
  if (body.t === 'click') { if (!WHAT.has(body.what)) return null; e.what = body.what; }
  if (body.t === 'video') { const p = Number(body.pct); if (![25, 50, 75, 100].includes(p)) return null; e.pct = p; e.secs = Math.max(0, Math.min(3600, Math.round(Number(body.secs) || 0))); }
  if (body.t === 'leave') e.secs = Math.max(0, Math.min(86400, Math.round(Number(body.secs) || 0)));
  const g = geo || {};
  e.geo = { city: clip(g.city, 60), region: clip(g.subdivision?.code || g.subdivision?.name, 40), country: clip(g.country?.code || g.country?.name, 40) };
  e.ua = coarseAgent(ua);
  return e;
}

const keyFor = (e) => `${String(e.ts).padStart(15, '0')}-${e.v}-${crypto.randomBytes(3).toString('hex')}`;

function tokenOk(req, token) {
  if (!token || token.length < 32) return false;
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const none = (why = '') => new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'x-visit': why } });

// getStore is injected so tests can use an in-memory store; on Netlify it is @netlify/blobs' getStore.
export function makeVisitsHandler({ getStore, token, now = () => Date.now() }) {
  const store = () => getStore('visits');
  return async (req, context = {}) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/visit') {
      if (req.method !== 'POST') return none();
      const ua = req.headers.get('user-agent') || '';
      if (isBot(ua)) return none('bot');
      const text = await req.text();
      if (text.length > 2000) return none('big');
      let body; try { body = JSON.parse(text); } catch { return none('json'); }
      const e = cleanEvent(body, { ua, geo: context.geo, now: now() });
      if (!e) return none('dropped');
      await store().setJSON(keyFor(e), e);
      return none('kept');
    }
    // /api/visits: the owner's read and delete.
    if (!tokenOk(req, typeof token === 'function' ? token() : token)) return json({ error: 'not allowed' }, 401);
    if (req.method === 'GET') {
      const since = url.searchParams.get('since') || '';
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
      const { blobs } = await store().list();
      const keys = blobs.map(b => b.key).filter(k => k > since).sort().slice(0, limit);
      const events = [];
      for (const key of keys) { const e = await store().get(key, { type: 'json' }); if (e) events.push({ key, ...e }); }
      return json({ events, last: keys.length ? keys[keys.length - 1] : since, more: keys.length === limit });
    }
    if (req.method === 'DELETE') {
      const v = url.searchParams.get('visit') || '';
      if (!ID.test(v)) return json({ error: 'visit id needed' }, 400);
      const { blobs } = await store().list();
      const keys = blobs.map(b => b.key).filter(k => k.includes(`-${v}-`));
      for (const key of keys) await store().delete(key);
      return json({ deleted: keys.length });
    }
    return json({ error: 'GET or DELETE' }, 405);
  };
}
