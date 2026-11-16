// The local page. Plain Node http, static files from public/. Listens on 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ROOT, deskPaths, isMock } from './config.mjs';
import { openDesk, handleTicket, runShift } from './desk.mjs';
import { readFailures } from './failures.mjs';
import { summarizeLastRun } from './log.mjs';
import { pageUrl, cleanText, quoteOnPage } from './docs.mjs';
import { replyHash } from './checkreply.mjs';
import { TICKETS } from '../knowledge/playbook.mjs';
import { PRACTICE } from '../knowledge/practice.mjs';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

function readBody(req, limit = 10000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad json')); } });
  });
}

// A file under public/, or null. Never leaves the folder.
function publicFile(urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(file).toLowerCase()]) return null;
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}

// ---- The help page around a quote, so the page can show the sentence inside its paragraph.

// Light clean for reading: links become their words, formatting marks go, underscores stay.
const readable = (s) => String(s ?? '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*`\\]/g, '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/^\s*>\s?/gm, '')
  .replace(/\s*\|\s*/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Where a quote sits in readable text, matched the way the checker matches (cleanText, any case).
function findQuote(text, quote) {
  const want = cleanText(quote).toLowerCase();
  if (!want) return null;
  let loose = ''; const map = [];
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '_') continue; loose += c.toLowerCase(); map.push(i); }
  const at = loose.indexOf(want);
  if (at < 0) return null;
  return [map[at], map[at + want.length - 1] + 1];
}

function windowAround(text, mark, before = 200, after = 220) {
  if (!mark) return { text: text.length > 420 ? text.slice(0, 400).replace(/\s+\S*$/, '') + ' ...' : text, mark: null };
  let s = Math.max(0, mark[0] - before); let e = Math.min(text.length, mark[1] + after);
  if (s > 0) { const sp = text.indexOf(' ', s); s = sp >= 0 && sp < mark[0] ? sp + 1 : s; }
  if (e < text.length) { const sp = text.lastIndexOf(' ', e); e = sp > mark[1] ? sp : e; }
  const pre = s > 0 ? '... ' : ''; const post = e < text.length ? ' ...' : '';
  return { text: pre + text.slice(s, e) + post, mark: [mark[0] - s + pre.length, mark[1] - s + pre.length] };
}

export function pageContext(page, quote) {
  if (!page?.text) return null;
  const lines = page.text.split('\n');
  const title = readable((lines.find(l => /^# /.test(l)) || '').replace(/^# /, '')) || null;
  // Blocks: headings, and runs of lines between blank lines or rules.
  const blocks = []; let cur = []; let heading = null;
  const flush = () => { if (cur.length) { blocks.push({ heading, text: readable(cur.join('\n')) }); cur = []; } };
  for (const l of lines) {
    if (/^\s*```/.test(l)) continue; // code fence lines (and their language word) are not page text
    if (/^#{1,6} /.test(l)) { flush(); heading = readable(l.replace(/^#+ /, '')); continue; }
    if (!l.trim() || /^\*{3,}$|^-{3,}$/.test(l.trim())) { flush(); continue; }
    cur.push(l);
  }
  flush();
  let i = blocks.findIndex(b => findQuote(b.text, quote));
  let block;
  if (i >= 0) block = blocks[i];
  else {
    // The quote runs across blocks (a list, a table): use the section as one block.
    const sections = new Map();
    for (const b of blocks) sections.set(b.heading, (sections.has(b.heading) ? sections.get(b.heading) + ' ' : '') + b.text);
    const hit = [...sections].find(([, t]) => findQuote(t, quote));
    if (!hit) return { title, heading: null, before: null, text: null, mark: null, after: null, found: false };
    block = { heading: hit[0], text: hit[1] };
  }
  const w = windowAround(block.text, findQuote(block.text, quote));
  const near = (k) => (i >= 0 && blocks[k] && blocks[k].heading === block.heading ? windowAround(blocks[k].text, null).text : null);
  return { title, heading: block.heading === title ? null : block.heading, before: near(i - 1), text: w.text, mark: w.mark, after: near(i + 1), found: true };
}

// ---- What the page needs from a result (never the full cached pages).
// r.fresh is where the fresh checker stands on this exact text (see freshState in checkreply.mjs).
function view(r, env, trace) {
  const pages = r.pages || {};
  const ctx = (url, quote) => (url && quote ? pageContext(pages[pageUrl(url)] || pages[url], quote) : null);
  return {
    fresh: r.fresh,
    mock: isMock(env),
    ticket: r.ticket, entry: r.entry, status: r.status, outcome: r.outcome, seenBefore: r.seenBefore,
    evidence: r.evidence ? { kind: r.evidence.kind, ok: r.evidence.ok, summary: r.evidence.summary, calls: r.evidence.calls, searched: r.evidence.searched, status: r.evidence.status, missing: r.evidence.missing } : null,
    steps: (r.steps || []).map(s => ({ type: s.type, text: s.text, url: s.cite?.url ?? s.url, quote: s.cite?.quote ?? s.quote, page: ctx(s.cite?.url ?? s.url, s.cite?.quote ?? s.quote) })),
    reply: r.reply, next: r.next, check: r.check, refused: r.refused || null,
    escalationText: r.escalationText, docEditText: r.docEditText,
    // Added for the page: the same two notes as data, and where a proposed edit sits on its page.
    escalation: r.escalation || null,
    docEdit: r.docEdit ? { ...r.docEdit, page: r.docEdit.before ? ctx(r.docEdit.article, r.docEdit.before) : (pages[pageUrl(r.docEdit.article)] ? { title: pageContext(pages[pageUrl(r.docEdit.article)], 'x')?.title || null } : null) } : null,
    trace: trace || [],
  };
}

function docsState(env) {
  const dir = deskPaths(env).docsCache;
  let pages = [];
  try { pages = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* none yet */ }
  const dates = pages.map(p => p.fetchedAt).sort();
  return { pages: pages.length, oldest: dates[0] || null, newest: dates[dates.length - 1] || null, via: [...new Set(pages.map(p => p.via))] };
}

// The desk, with every read it makes reported as it happens. Nothing about the work changes.
function tracedDesk(desk, emit) {
  const t0 = performance.now();
  const ms = (s) => Math.round(performance.now() - s);
  const docs = {
    ...desk.docs,
    getPage: async (u, opts) => {
      const s = performance.now(); const url = pageUrl(u);
      const cached = !!desk.docs.readCache(url);
      const p = await desk.docs.getPage(u, opts);
      emit({ t: 'page', url, ok: !!p, via: p?.via || null, fetchedAt: p?.fetchedAt || null, fromCache: cached && !opts?.refresh, title: p ? pageContext(p, 'x')?.title : null, ms: ms(s), at: ms(t0) });
      return p;
    },
    search: async (q) => {
      const s = performance.now();
      const r = await desk.docs.search(q);
      emit({ t: 'search', query: q, results: r.results.length, offline: !!r.offline, ms: ms(s), at: ms(t0) });
      return r;
    },
  };
  const client = {
    ...desk.client,
    get: async (p) => {
      const s = performance.now();
      try {
        const r = await desk.client.get(p);
        emit({ t: 'call', method: 'GET', path: '/v2' + p, status: r.status, requestId: r.requestId, upstreamRequestId: r.upstreamRequestId || r.data?.reqId || null, ms: ms(s), at: ms(t0) });
        return r;
      } catch (e) {
        emit({ t: 'call', method: 'GET', path: '/v2' + p, status: e.status || null, requestId: e.requestId || null, error: e.message, ms: ms(s), at: ms(t0) });
        throw e;
      }
    },
  };
  return { ...desk, docs, client };
}

async function runTicket(env, body, emit = () => {}) {
  const t = body.id ? TICKETS.find(x => x.id === body.id) : { id: null, text: String(body.text || '').slice(0, 2000) };
  if (!t || !t.text.trim()) { const e = new Error('Pick a sample message or paste one.'); e.code = 400; throw e; }
  const desk = openDesk({ env });
  const trace = [];
  try {
    const r = await handleTicket(tracedDesk(desk, (ev) => { trace.push(ev); emit(ev); }), t);
    return view(r, env, trace);
  } finally { await desk.close(); }
}

// A reply the fresh checker stopped, kept as an example: the first T07 reply (Nov 15, 2026).
// The verdict is read from examples/ and only shown if its hash matches this exact text.
async function stoppedExample(env) {
  const ex = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'examples', 'stopped-example.json'), 'utf8'));
  const verdict = JSON.parse(fs.readFileSync(path.join(ROOT, ex.verdictFile), 'utf8'));
  const matches = verdict.replySha256 === replyHash(ex.reply);
  const desk = openDesk({ env });
  const trace = [];
  const pages = {};
  try {
    const d = tracedDesk(desk, (ev) => trace.push(ev));
    for (const u of new Set(ex.steps.filter(s => s.url).map(s => pageUrl(s.url)))) pages[u] = await d.docs.getPage(u);
  } finally { await desk.close(); }
  const citations = ex.steps.map((s, i) => s.url ? { step: i + 1, url: s.url, quote: s.quote, found: quoteOnPage(s.quote, pages[pageUrl(s.url)]), fetchedAt: pages[pageUrl(s.url)]?.fetchedAt, via: pages[pageUrl(s.url)]?.via } : null).filter(Boolean);
  const r = {
    ticket: ex.ticket, entry: ex.entry, outcome: 'reply', status: matches ? 'blocked: the fresh checker stopped this exact text (a saved example)' : 'saved example: the verdict does not match this text',
    steps: ex.steps, reply: ex.reply, next: ex.next, pages,
    check: { pass: true, problems: [], citations, review: { verdict: verdict.verdict, checkedAt: verdict.checkedAt } },
    fresh: matches ? { state: 'blocked', name: `${ex.ticket.id} (first version)`, why: verdict.findings[0], findings: verdict.findings, checkedAt: verdict.checkedAt, checker: verdict.checker } : { state: 'stale', name: ex.ticket.id },
    seenBefore: [], escalationText: '', docEditText: '',
  };
  return { ...view(r, env, trace), example: { about: ex.about, builtFrom: ex.builtFrom, verdictFile: ex.verdictFile, replySha256: verdict.replySha256, hashMatches: matches, plain: ex.plain } };
}

function artSlots() {
  try { return fs.readdirSync(path.join(PUBLIC, 'art')).filter(f => /^[a-z0-9-]+\.webp$/.test(f)).map(f => f.replace(/\.webp$/, '')); } catch { return []; }
}

// The practice game, plus where each help-page sentence sits on its page (added for the page; the
// original fields are unchanged). The page uses it to show the whole sentence, never a cut one.
async function practiceView(env) {
  const desk = openDesk({ env });
  try {
    return {
      ...PRACTICE,
      decisions: PRACTICE.decisions.map(d => {
        let page = null;
        try { const p = desk.docs.readCache(pageUrl(d.source.url)); page = p ? pageContext(p, d.source.quote) : null; } catch { page = null; }
        return { ...d, source: { ...d.source, page } };
      }),
    };
  } finally { await desk.close(); }
}

// The first page, with the app's mark in the header only when its picture exists. A missing
// picture leaves nothing behind, and nothing moves when it loads (its size is set here).
function indexHtml(file) {
  let html = fs.readFileSync(file, 'utf8');
  const mark = artSlots().includes('app-mark');
  html = html.replace('<!--app-mark-->', mark ? '<img class="brand-mark" src="/art/app-mark.webp" alt="" width="34" height="34" decoding="async">' : '');
  html = html.replace('<!--app-icon-->', mark ? '<link rel="icon" href="/art/app-mark.webp" type="image/webp">' : '');
  return html;
}

export function createServer({ env = process.env } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204, { 'cache-control': 'max-age=86400' }); return res.end(); }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const p = deskPaths(env);
        return json(res, 200, { mock: isMock(env), readOnly: true, docs: docsState(env), failures: readFailures(p.failures).length, tickets: TICKETS.map(({ id, kind, from, text }) => ({ id, kind, from, text })) });
      }
      if (req.method === 'GET' && url.pathname === '/api/art') return json(res, 200, { slots: artSlots() });
      if (req.method === 'POST' && url.pathname === '/api/ticket') {
        const body = await readBody(req);
        try { return json(res, 200, await runTicket(env, body)); } catch (e) { if (e.code === 400) return json(res, 400, { error: e.message }); throw e; }
      }
      // The same work, reported as it happens: one JSON object per line, the result last.
      if (req.method === 'POST' && url.pathname === '/api/ticket/live') {
        const body = await readBody(req);
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        const send = (ev) => res.write(JSON.stringify(ev) + '\n');
        send({ t: 'start', at: 0 });
        try { send({ t: 'result', result: await runTicket(env, body, send) }); }
        catch (e) { send({ t: 'error', message: e.code === 400 ? e.message : 'The desk could not finish this one.', detail: e.code === 400 ? undefined : e.message }); }
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/api/example/stopped') return json(res, 200, await stoppedExample(env));
      if (req.method === 'POST' && url.pathname === '/api/shift') {
        const desk = openDesk({ env });
        try {
          const results = await runShift(desk);
          return json(res, 200, { handoff: fs.readFileSync(desk.paths.handoff, 'utf8'), results: results.map(r => ({ id: r.ticket.id, status: r.status, pass: r.check.pass })) });
        } finally { await desk.close(); }
      }
      if (req.method === 'GET' && url.pathname === '/api/handoff') {
        let text = 'No shift has run yet. Press "Run all 12 sample messages".';
        try { text = fs.readFileSync(deskPaths(env).handoff, 'utf8'); } catch { /* none */ }
        return json(res, 200, { text });
      }
      if (req.method === 'GET' && url.pathname === '/api/practice') return json(res, 200, await practiceView(env));
      if (req.method === 'GET' && url.pathname === '/api/logs') return json(res, 200, { text: summarizeLastRun(deskPaths(env).logs).text });
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const file = publicFile(url.pathname);
        if (file) {
          const ext = path.extname(file).toLowerCase();
          const long = ext === '.woff2';
          res.writeHead(200, { 'content-type': TYPES[ext], 'cache-control': long ? 'public, max-age=31536000, immutable' : 'no-cache' });
          if (path.basename(file) === 'index.html') return res.end(indexHtml(file));
          return res.end(fs.readFileSync(file));
        }
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      if (res.headersSent) return res.end();
      json(res, e.message === 'too large' ? 413 : e.message === 'bad json' ? 400 : 500, { error: e.message });
    }
  });
}

export async function startServer({ port = 5610, env = process.env } = {}) {
  const server = createServer({ env });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  console.log(`Support Desk is open at http://localhost:${port}${isMock(env) ? '  (practice account: made-up posts, real help pages)' : ''}`);
  return server;
}
