// Blotato's own help docs, read through Blotato's public docs MCP server (no key needed):
//   https://help.blotato.com/~gitbook/mcp  tools: searchDocumentation(query), getPage(url)
// Fallback: the same page as Markdown (append .md), as the docs-search page describes.
// Every page is cached with the date it was fetched, so a cited quote can be checked again later.
// Never called: sendFeedback (it sends a report) and askQuestion (an AI answer is not a source).
import fs from 'node:fs';
import path from 'node:path';
import { DOCS_MCP_URL, DOCS_BASE, isDocsOffline } from './config.mjs';

export const pageUrl = (u) => String(u).replace(/[#?].*$/, '').replace(/\.md$/, '').replace(/\/+$/, '');
const slug = (u) => pageUrl(u).replace(/^https?:\/\/[^/]+\//, '').replace(/[^a-z0-9]+/gi, '_') || 'index';

// Markdown and typography are stripped so a quote matches the words, not the formatting.
export function cleanText(s) {
  return String(s ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`\\]/g, '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export const normalizeText = (s) => cleanText(s).toLowerCase();

export function createDocs({ cacheDir, env = process.env, logger, fetchImpl = globalThis.fetch } = {}) {
  const offline = isDocsOffline(env);
  let clientPromise = null;
  const fileFor = (u) => path.join(cacheDir, `${slug(u)}.json`);

  async function mcp() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
        const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
        const c = new Client({ name: 'support-desk', version: '0.1.0' });
        await c.connect(new StreamableHTTPClientTransport(new URL(DOCS_MCP_URL)));
        return c;
      })().catch(e => { clientPromise = null; throw e; });
    }
    return clientPromise;
  }

  function readCache(u) {
    try { return JSON.parse(fs.readFileSync(fileFor(u), 'utf8')); } catch { return null; }
  }

  // Returns { url, text, fetchedAt, via } or null when the page cannot be read from anywhere.
  async function getPage(u, { refresh = false } = {}) {
    const url = pageUrl(u);
    const cached = readCache(url);
    if (cached && (!refresh || offline)) return cached;
    if (offline) return null;
    let text = null; let via = null;
    try {
      const c = await mcp();
      const r = await c.callTool({ name: 'getPage', arguments: { url } });
      text = (r.content || []).map(x => x.text || '').join('\n');
      if (r.isError || !text.trim()) text = null; else via = 'docs MCP getPage';
    } catch { text = null; }
    if (!text) {
      try {
        const res = await fetchImpl(`${url}.md`, { headers: { accept: 'text/markdown' }, signal: AbortSignal.timeout(20000) });
        const t = await res.text();
        if (res.ok && !/^# Page Not Found/m.test(t)) { text = t; via = 'public .md page'; }
      } catch { /* fall through */ }
    }
    logger?.write({ action: 'docs-page', path: url, ok: !!text, via, error: text ? undefined : 'could not read page' });
    if (!text) return cached || null;
    const page = { url, fetchedAt: new Date().toISOString(), via, text };
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(fileFor(url), JSON.stringify(page, null, 1));
    return page;
  }

  // Returns [{ title, url, excerpt }]. Search rank is not proof of relevance (the docs say so too).
  async function search(query) {
    if (offline) return { offline: true, results: [] };
    try {
      const c = await mcp();
      const r = await c.callTool({ name: 'searchDocumentation', arguments: { query } });
      const results = (r.content || []).map(x => {
        const t = x.text || '';
        return { title: t.match(/^Title: (.*)$/m)?.[1] || '', url: pageUrl(t.match(/^Link: (\S+)$/m)?.[1] || ''), excerpt: t.replace(/^Title:.*\nLink:.*\nContent: /, '').replace(/\s+/g, ' ').slice(0, 280) };
      }).filter(x => x.url);
      logger?.write({ action: 'docs-search', path: DOCS_MCP_URL, ok: true, results: results.length });
      return { offline: false, results };
    } catch (e) {
      logger?.write({ action: 'docs-search', path: DOCS_MCP_URL, ok: false, error: 'docs MCP search failed' });
      return { offline: false, error: 'The docs search could not be reached.', results: [] };
    }
  }

  async function close() { if (clientPromise) { try { (await clientPromise).close(); } catch { /* ignore */ } clientPromise = null; } }

  return { getPage, search, close, readCache, offline, base: DOCS_BASE };
}

// The help center's index (https://help.blotato.com/llms.txt): every page it lists, as page urls.
// The index is a public text file, so it is read with a plain GET. The pages themselves go through getPage.
export const HELP_INDEX_URL = 'https://help.blotato.com/llms.txt';
export function parseHelpIndex(text, base = 'https://help.blotato.com') {
  const urls = [];
  for (const m of String(text || '').matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    const u = pageUrl(m[1]);
    if (u.startsWith(base) && !urls.includes(u)) urls.push(u);
  }
  return urls;
}
export async function readHelpIndex({ fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(HELP_INDEX_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`The help index answered HTTP ${res.status}.`);
  return parseHelpIndex(await res.text());
}

// Every page in the cache, as { url, text, fetchedAt, via }.
export function readCacheDir(cacheDir) {
  const out = {};
  let files = [];
  try { files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json')); } catch { return out; }
  for (const f of files) {
    try { const p = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8')); if (p?.url) out[pageUrl(p.url)] = p; } catch { /* skip a broken file */ }
  }
  return out;
}

// Is this exact quote on this page? (After stripping formatting.)
export function quoteOnPage(quote, page) {
  if (!page?.text) return false;
  return normalizeText(page.text).includes(normalizeText(quote));
}
