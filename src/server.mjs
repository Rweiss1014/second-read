// The local page. Plain Node http, one HTML file. Listens on 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, deskPaths, isMock } from './config.mjs';
import { openDesk, handleTicket, runShift } from './desk.mjs';
import { readFailures } from './failures.mjs';
import { summarizeLastRun } from './log.mjs';
import { TICKETS } from '../knowledge/playbook.mjs';
import { PRACTICE } from '../knowledge/practice.mjs';

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

function readBody(req, limit = 10000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad json')); } });
  });
}

// What the page needs from a result (never the full cached pages).
function view(r) {
  return {
    ticket: r.ticket, entry: r.entry, status: r.status, outcome: r.outcome, seenBefore: r.seenBefore,
    evidence: r.evidence ? { kind: r.evidence.kind, ok: r.evidence.ok, summary: r.evidence.summary, calls: r.evidence.calls, searched: r.evidence.searched } : null,
    steps: (r.steps || []).map(s => ({ type: s.type, text: s.text, url: s.cite?.url, quote: s.cite?.quote })),
    reply: r.reply, next: r.next, check: r.check, refused: r.refused || null,
    escalationText: r.escalationText, docEditText: r.docEditText,
  };
}

function docsState(env) {
  const dir = deskPaths(env).docsCache;
  let pages = [];
  try { pages = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* none yet */ }
  const dates = pages.map(p => p.fetchedAt).sort();
  return { pages: pages.length, oldest: dates[0] || null, newest: dates[dates.length - 1] || null, via: [...new Set(pages.map(p => p.via))] };
}

export function createServer({ env = process.env } = {}) {
  const html = () => fs.readFileSync(path.join(ROOT, 'public', 'index.html'));
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(html()); }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const p = deskPaths(env);
        return json(res, 200, { mock: isMock(env), readOnly: true, docs: docsState(env), failures: readFailures(p.failures).length, tickets: TICKETS.map(({ id, kind, from, text }) => ({ id, kind, from, text })) });
      }
      if (req.method === 'POST' && url.pathname === '/api/ticket') {
        const body = await readBody(req);
        const t = body.id ? TICKETS.find(x => x.id === body.id) : { id: null, text: String(body.text || '').slice(0, 2000) };
        if (!t || !t.text.trim()) return json(res, 400, { error: 'Pick a sample ticket or paste a message.' });
        const desk = openDesk({ env });
        try { return json(res, 200, view(await handleTicket(desk, t))); } finally { await desk.close(); }
      }
      if (req.method === 'POST' && url.pathname === '/api/shift') {
        const desk = openDesk({ env });
        try {
          const results = await runShift(desk);
          return json(res, 200, { handoff: fs.readFileSync(desk.paths.handoff, 'utf8'), results: results.map(r => ({ id: r.ticket.id, status: r.status, pass: r.check.pass })) });
        } finally { await desk.close(); }
      }
      if (req.method === 'GET' && url.pathname === '/api/handoff') {
        let text = 'No shift has run yet. Press "Run the whole shift".';
        try { text = fs.readFileSync(deskPaths(env).handoff, 'utf8'); } catch { /* none */ }
        return json(res, 200, { text });
      }
      if (req.method === 'GET' && url.pathname === '/api/practice') return json(res, 200, PRACTICE);
      if (req.method === 'GET' && url.pathname === '/api/logs') return json(res, 200, { text: summarizeLastRun(deskPaths(env).logs).text });
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, e.message === 'too large' ? 413 : e.message === 'bad json' ? 400 : 500, { error: e.message });
    }
  });
}

export async function startServer({ port = 5610, env = process.env } = {}) {
  const server = createServer({ env });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  console.log(`Support Desk on http://localhost:${port}${isMock(env) ? '  (sample account data, no account connected)' : ''}`);
  return server;
}
