// The free public Second Read: one Netlify Function that runs the app's own request handler for /api/*.
// FREE mode: sample account data, no Blotato key, and no model call, ever. The reader and the composer answer only
// from their saved verdicts; any message they do not know takes the app's normal "hand it to a person" path.
// Nothing customer-written is kept anywhere public: the desk's working folder is /tmp, which a Netlify function
// can write to and which is gone when the instance is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Where the app's files sit: in Netlify's function image (LAMBDA_TASK_ROOT), the project folder (local dev), or
// two folders up from this file (a plain run). The first one that holds knowledge/entries wins.
const here = path.dirname(fileURLToPath(import.meta.url));
const base = [process.env.LAMBDA_TASK_ROOT, process.cwd(), path.resolve(here, '..', '..')]
  .filter(Boolean).find(d => fs.existsSync(path.join(d, 'knowledge', 'entries'))) || path.resolve(here, '..', '..');
process.env.SUPPORT_DESK_ROOT = base; // read by src/config.mjs when it loads, which is why server.mjs is imported below
const data = path.join(base, 'netlify', 'site-data');
const { createServer } = await import('../../src/server.mjs');

// An explicit environment: nothing from the host (no key of any kind) reaches the app.
export const SITE_ENV = {
  BLOTATO_MOCK: '1',
  DOCS_OFFLINE: '1',
  DOCS_CACHE_DIR: path.join(data, 'docs'),
  SUPPORT_DESK_DIR: '/tmp/second-read-desk',
  SUPPORT_DESK_READER: 'claude-cli',
  SUPPORT_DESK_READER_CACHE: path.join(data, 'reader-cache'),
  SUPPORT_DESK_READER_CACHE_ONLY: '1',
  SUPPORT_DESK_COMPOSER: 'claude-cli',
  SUPPORT_DESK_COMPOSER_CACHE: path.join(data, 'composer-cache'),
  SUPPORT_DESK_COMPOSER_CACHE_ONLY: '1',
  SUPPORT_DESK_COMPOSE_OVER_SAVED: '1', // as on the local page: saved help answers are composed too (from saved verdicts); the 12 samples keep theirs
  SUPPORT_DESK_CLAUDE_BIN: '/nonexistent/no-model-here',
};

let port = null;
async function listen() {
  if (port) return port;
  const server = createServer({ env: SITE_ENV });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.unref(); // never keeps a process alive on its own
  port = server.address().port;
  return port;
}

export default async (req) => {
  const p = await listen();
  const url = new URL(req.url);
  const init = { method: req.method, headers: { 'content-type': req.headers.get('content-type') || 'application/json' } };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.text();
  const r = await fetch(`http://127.0.0.1:${p}${url.pathname}${url.search}`, init);
  // Buffered on purpose: a function cannot be relied on to stream. /api/ticket/live then arrives all at once,
  // which the page reads the same way (it reads the lines as they come, or all together).
  const body = Buffer.from(await r.arrayBuffer());
  return new Response(body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/*' };
