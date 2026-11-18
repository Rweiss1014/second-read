// The local page. Plain Node http, static files from public/. Listens on 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { ROOT, deskPaths, isMock } from './config.mjs';
import { openDesk, handleTicket, runShift } from './desk.mjs';
import { readFailures } from './failures.mjs';
import { summarizeLastRun } from './log.mjs';
import { pageUrl, cleanText, quoteOnPage } from './docs.mjs';
import { replyHash } from './checkreply.mjs';
import { TICKETS, ENTRY_BY_ID } from '../knowledge/playbook.mjs';
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

// A quote can sit on its page more than once ("Retry from Posts > Failed." is in the rate-limit row and in the
// TikTok row of the Errors page). `hints` (the reply's other quotes and its title) pick the place the answer is
// about: the block, and the table row, that holds the most of them (Nov 18, 2026: a TikTok answer showed the
// rate-limit row as its proof). With no hints, or a tie, the first place wins, as before.
const HINT_STOP = new Set('the and for with that this from your you are can not but have has was will when then into what which them they their there here only also more must does done been were each'.split(' '));
function hintScore(text, hints) {
  if (!hints?.length || !text) return 0;
  const words = new Set((cleanText(text).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => !HINT_STOP.has(w)));
  let s = 0;
  for (const h of hints) {
    if (findQuote(text, h)) { s += 100; continue; }
    for (const w of new Set((cleanText(h).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(x => !HINT_STOP.has(x)))) if (words.has(w)) s += 1;
  }
  return s;
}
const bestBy = (list, score) => list.reduce((b, x) => (b === null || score(x) > score(b) ? x : b), null);

export function pageContext(page, quote, hints = []) {
  if (!page?.text) return null;
  const lines = page.text.split('\n');
  const title = readable((lines.find(l => /^# /.test(l)) || '').replace(/^# /, '')) || null;
  // Blocks: headings, and runs of lines between blank lines or rules. Each block keeps its raw lines too.
  const blocks = []; let cur = []; let heading = null;
  const fences = []; let fence = null; // fenced code blocks, raw, so a code example can be shown whole
  const flush = () => { if (cur.length) { blocks.push({ heading, text: readable(cur.join('\n')), raw: cur.slice() }); cur = []; } };
  for (const l of lines) {
    if (/^\s*```/.test(l)) { if (fence) { fences.push(fence); fence = null; } else fence = { heading, lines: [] }; continue; } // fence lines (and their language word) are not page text
    if (fence) fence.lines.push(l);
    if (/^#{1,6} /.test(l)) { flush(); heading = readable(l.replace(/^#+ /, '')); continue; }
    if (!l.trim() || /^\*{3,}$|^-{3,}$/.test(l.trim())) { flush(); continue; }
    cur.push(l);
  }
  flush();
  const holding = blocks.map((b, k) => k).filter(k => findQuote(blocks[k].text, quote));
  // In a table block, the score is the best row's (another row's words must not pull the block).
  const blockScore = (k) => { const rows = rowsWith(blocks[k].raw, quote); return rows.length ? Math.max(...rows.map(r => hintScore(r, hints))) : hintScore(blocks[k].text, hints); };
  let i = holding.length > 1 && hints.length ? bestBy(holding, blockScore) : (holding[0] ?? -1);
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
  let where = findQuote(block.text, quote);
  // The row the hints point to, and the quote's place inside that row (not its first place in the table).
  const row = block.raw ? tableRow(block.raw, quote, hints) : null;
  if (row?.text) { const at = block.text.indexOf(row.text); const inRow = at >= 0 ? findQuote(row.text, quote) : null; if (inRow) where = [at + inRow[0], at + inRow[1]]; }
  const w = windowAround(block.text, where);
  const near = (k) => (i >= 0 && blocks[k] && blocks[k].heading === block.heading ? windowAround(blocks[k].text, null).text : null);
  // Added for round 3 (additive): the quote's own setting, so the page can show it whole.
  const extra = {};
  const code = codeAround(fences, quote);
  if (code) extra.code = code;
  if (row) extra.row = { head: row.head, cells: row.cells };
  const list = i >= 0 && where ? listAfter(block, blocks[i + 1], where) : null;
  if (list) extra.list = list;
  return { title, heading: block.heading === title ? null : block.heading, before: near(i - 1), text: w.text, mark: w.mark, after: near(i + 1), found: true, ...extra };
}

// A code example that holds the quote: every line of it (dedented, at most 40), and which lines hold the quote.
function codeAround(fences, quote) {
  for (const f of fences) {
    const raw = f.lines.slice(0, 40);
    for (let k = 0; k < 8; k++) { // the fewest lines that hold the whole quote
      for (let a = 0; a + k < raw.length; a++) {
        const b = a + k;
        if (!findQuote(readable(raw.slice(a, b + 1).join(' ')), quote)) continue;
        const pad = Math.min(...raw.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
        return { lines: raw.map(l => l.slice(pad).replace(/\s+$/, '')), hit: [a, b], more: f.lines.length > raw.length };
      }
    }
  }
  return null;
}

// A table row that holds the quote: the table's header cells and that row's cells.
// With hints, the row that holds the most of them (see pageContext); `text` is the row as readable text.
function tableBody(raw) {
  const rows = (raw || []).filter(l => /^\s*\|/.test(l));
  if (rows.length < 2) return null;
  return rows.filter(l => !/^\s*\|[\s|:-]+\|?\s*$/.test(l));
}
function rowsWith(raw, quote) {
  const body = tableBody(raw);
  return body ? body.slice(1).map(l => readable(l.replace(/\|/g, ' '))).filter(t => findQuote(t, quote)) : [];
}
function tableRow(raw, quote, hints = []) {
  const body = tableBody(raw);
  if (!body) return null;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => readable(c));
  const hits = body.slice(1).filter(l => findQuote(readable(l.replace(/\|/g, ' ')), quote));
  const hit = hits.length > 1 && hints.length ? bestBy(hits, l => hintScore(readable(l.replace(/\|/g, ' ')), hints)) : hits[0];
  return hit ? { head: cells(body[0]), cells: cells(hit), text: readable(hit.replace(/\|/g, ' ')) } : null;
}

// A sentence that ends in a colon and introduces a list: the list's items, as written.
function listAfter(block, next, where) {
  if (!/^\s*:/.test(block.text.slice(where[1], where[1] + 3)) && !/:\s*$/.test(block.text.slice(0, where[1]))) return null;
  if (block.text.slice(where[1]).replace(/^\s*:/, '').trim()) return null; // the colon must end the block
  if (!next?.raw?.length || next.heading !== block.heading) return null;
  const items = next.raw.filter(l => /^\s*(?:[-*]|\d+\.)\s+/.test(l)).map(l => readable(l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '')));
  return items.length && items.length === next.raw.filter(l => l.trim()).length ? items.slice(0, 8) : null;
}

// ---- What the page needs from a result (never the full cached pages).
// r.fresh is where the fresh checker stands on this exact text (see freshState in checkreply.mjs).
function view(r, env, trace) {
  const pages = r.pages || {};
  const ctx = (url, quote) => (url && quote ? pageContext(pages[pageUrl(url)] || pages[url], quote) : null);
  // A step's proof sits where the reply's other quotes from the same page are (its row or section), with the
  // entry's title as a tie-break hint, never just at the quote's first place on the page.
  const quoteOf = (s) => s.cite?.quote ?? s.quote;
  const hintsFor = (s) => [...(r.steps || []).filter(o => o !== s && quoteOf(o) && pageUrl(o.cite?.url ?? o.url ?? '') === pageUrl(s.cite?.url ?? s.url ?? '')).map(quoteOf), r.entry?.title].filter(Boolean);
  const stepCtx = (s) => { const url = s.cite?.url ?? s.url; const q = quoteOf(s); return url && q ? pageContext(pages[pageUrl(url)] || pages[url], q, hintsFor(s)) : null; };
  return {
    fresh: r.fresh,
    // Which path wrote the reply ('saved' or 'composed'), and for a composed one its steps with their quoted
    // sentences, the script checks and the second reader's verdict (src/composer.mjs). Additive: the page may ignore it.
    path: r.path || null,
    composed: r.composed || null,
    mock: isMock(env),
    ticket: r.ticket, entry: r.entry, status: r.status, outcome: r.outcome, seenBefore: r.seenBefore,
    evidence: r.evidence ? { kind: r.evidence.kind, ok: r.evidence.ok, summary: r.evidence.summary, technical: r.evidence.technical || null, calls: r.evidence.calls, searched: r.evidence.searched, status: r.evidence.status, missing: r.evidence.missing } : null,
    steps: (r.steps || []).map(s => ({ type: s.type, text: s.text, url: s.cite?.url ?? s.url, quote: s.cite?.quote ?? s.quote, page: stepCtx(s) })),
    reply: r.reply, next: r.next, check: r.check, refused: r.refused || null,
    escalationText: r.escalationText, docEditText: r.docEditText,
    // Added for the page: the same two notes as data, and where a proposed edit sits on its page.
    escalation: r.escalation || null,
    docEdit: r.docEdit ? { ...r.docEdit, page: r.docEdit.before ? ctx(r.docEdit.article, r.docEdit.before) : (pages[pageUrl(r.docEdit.article)] ? { title: pageContext(pages[pageUrl(r.docEdit.article)], 'x')?.title || null } : null) } : null,
    trace: trace || [],
    // Added for round 3 (additive): why the route chose what it chose, so the page can give the real reason
    // for a hand-over, and the near candidates (by their titles) when the desk did not answer.
    route: r.match ? {
      decision: r.match.decision || null,
      guard: r.match.guard || null,
      why: r.match.why ?? null, // the named reason for a hand-over (main copy); null for an answer or older data
      whyDetail: r.match.whyDetail ?? null,
      reason: r.match.reason || null,
      // score added Nov 16, 2026: the page offers a candidate as "Did they mean" only when it is a near one.
      candidates: (r.match.candidates || []).map(c => ({ id: c.id, title: ENTRY_BY_ID.get(c.id)?.title || null, phrasing: c.phrasing || ENTRY_BY_ID.get(c.id)?.phrasings?.[0] || null, score: c.score ?? null })),
    } : null,
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
      emit({ t: 'search', query: q, results: r.results.length, offline: !!r.offline, saved: !!r.saved, savedAt: r.savedAt || null, pagesSearched: r.pagesSearched || null, error: r.error ? true : undefined, ms: ms(s), at: ms(t0) });
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
  // The composer's model calls (writer, second reader, search words), so the page can say what it is waiting on.
  if (desk.composer?.hooks) desk.composer.hooks.onModel = (e) => emit({ t: 'model', kind: e.kind, phase: e.phase, model: e.model, cached: !!e.cached, ms: e.ms ?? null, at: ms(t0) });
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
          const body = path.basename(file) === 'index.html' ? Buffer.from(indexHtml(file)) : fs.readFileSync(file);
          // Added for round 3 (additive): text files go out gzipped when the browser asks for it.
          const zip = /^\.(?:html|css|js|json|md|txt)$/.test(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
          res.writeHead(200, { 'content-type': TYPES[ext], 'cache-control': long ? 'public, max-age=31536000, immutable' : 'no-cache', ...(zip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}) });
          return res.end(zip ? zlib.gzipSync(body) : body);
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
  console.log(`Second Read is open at http://localhost:${port}${isMock(env) ? '  (practice account: made-up posts, real help pages)' : ''}`);
  return server;
}
