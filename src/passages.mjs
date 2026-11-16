// Passages from ANY cached help page, ranked by a plain lexical method (BM25). No embeddings, no service.
//
// Used by the composer (src/composer.mjs): when no saved entry answers a message, a model may write a few short
// steps from the passages this script finds, and every step must quote a sentence that is on the page.
//
// A page is split into units, each one citable on its own:
//   - a heading ("## Generating an API key ends your free trial immediately");
//   - a sentence of a paragraph or of a list item (list markers left out);
//   - a table row (its cells, as the checker reads them: the pipes become spaces);
//   - a short code block (600 characters or less);
//   - a piece of text between HTML tags (GitBook writes some tables in HTML).
// Every unit keeps its exact text, its page URL and its heading path. A unit is citable only if its text, after
// the checker's own normalization (src/docs.mjs normalizeText), is on the page: the same test the script checker
// runs on every quote. Units that fail it (none should) are shown to nobody.
// Units are grouped into passages: one section (the text under the deepest heading), split after about 150 words.
import { cleanText, normalizeText, pageUrl } from './docs.mjs';
import { contentStems } from './match.mjs';

// Pages left out of retrieval. "start-with-an-ai-agent/llm" is a single-document dump of the API pages for agents
// (523,000 characters): every sentence on it also lives on its own topic page, which is the one to link a customer to.
export const SKIP_PAGES = new Set(['https://help.blotato.com/start-with-an-ai-agent/llm']);

const ABBREV = /\b(?:e\.g|i\.e|etc|vs|approx|incl|min|max|no|fig)\.$/i;
// Sentences of one paragraph: split after . ! or ? when the next character can start a sentence.
export function sentencesOf(text) {
  const out = [];
  let cur = '';
  const parts = String(text).split(/(?<=[.!?])\s+(?=["'(\[`*_]?[A-Z0-9])/);
  for (const p of parts) {
    cur = cur ? `${cur} ${p}` : p;
    if (ABBREV.test(cur)) continue;
    out.push(cur); cur = '';
  }
  if (cur) out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

export let PHRASE_BONUS = 4;
export const setPhraseBonus = (x) => { PHRASE_BONUS = x; };
const rawWordsOf = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []);
const GITBOOK_TAG =/^\s*\{%.*%\}\s*$/;
const words = (s) => (String(s).match(/\S+/g) || []).length;

// One page -> { url, title, headings, units: [{ text, display, kind, path }], sections: [{ path, units }] }
export function splitPage(page) {
  const url = pageUrl(page.url);
  const lines = String(page.text || '').split(/\r?\n/);
  const norm = normalizeText(page.text);
  const units = [];
  const headings = [];
  let title = '';
  let path = [];
  const stack = [];
  let para = [];
  let inCode = false; let code = [];
  let tableHead = null;
  const push = (raw, kind, display) => {
    const text = cleanText(raw);
    if (!text || !/[a-z0-9]/i.test(text)) return;
    const ok = norm.includes(normalizeText(text));
    units.push({ text, display: display ? display.trim() : text, kind, path: path.slice(), citable: ok, table: kind === 'row' ? tableHead : undefined });
  };
  const pushProse = (raw, kind) => {
    // Text between HTML tags is cited piece by piece, so every piece stays on the page word for word.
    for (const seg of String(raw).split(/<[^>]+>/)) for (const s of sentencesOf(seg.replace(/\s+/g, ' ').trim())) push(s, kind);
  };
  const flush = () => { if (para.length) pushProse(para.join(' '), 'sentence'); para = []; };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) { const body = code.join('\n'); if (body.length <= 600 && body.trim()) push(body, 'code', body); code = []; inCode = false; }
      else { flush(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (GITBOOK_TAG.test(line)) { flush(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush(); tableHead = null;
      const level = h[1].length; const text = cleanText(h[2].replace(/<[^>]+>/g, ''));
      if (level === 1 && !title) title = text;
      stack.length = level - 1; stack[level - 1] = text;
      path = [...stack].filter(Boolean);
      headings.push({ level, text });
      push(h[2], 'heading');
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flush();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;   // the |---| separator row
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      const display = cells.join(' | ');
      if (!tableHead) { tableHead = display; push(line, 'row', display); }
      else push(line, 'row', display);
      continue;
    }
    if (!line.trim() || /^\s*\*\*\*\s*$/.test(line) || /^\s*---\s*$/.test(line)) { flush(); tableHead = null; continue; }
    const li = line.match(/^\s*(?:[-*+]|\d{1,3}[.)])\s+(.*)$/);
    if (li) { flush(); tableHead = null; pushProse(li[1], 'item'); continue; }
    para.push(line.trim());
  }
  flush();
  // Sections: consecutive units with the same heading path; split long ones after about 150 words.
  const sections = [];
  let cur = null;
  for (const u of units) {
    const key = u.path.join(' > ');
    if (!cur || cur.key !== key || (cur.words > 150 && u.kind !== 'row')) { cur = { key, path: u.path, units: [], words: 0 }; sections.push(cur); }
    cur.units.push(u); cur.words += words(u.text);
  }
  return { url, title: title || url.split('/').pop(), headings, units, sections };
}

// A BM25 index over every passage of every cached page.
//   pages: { url: { url, text } } (src/docs.mjs readCacheDir)
// retrieve(message, { passages, pages, perPage }) -> { passages: [...], pageTitles }
export function buildPassageIndex(pages, { skip = SKIP_PAGES } = {}) {
  const docs = [];
  const byUrl = new Map();
  for (const p of Object.values(pages)) {
    const url = pageUrl(p.url);
    if (skip.has(url)) continue;
    const sp = splitPage(p);
    byUrl.set(url, { ...sp, page: p });
    sp.sections.forEach((s, i) => {
      if (!s.units.some(u => u.citable)) return;
      // The heading path is part of what a passage is about: an FAQ's question is its heading.
      const head = [sp.title, ...s.path].join(' ');
      const text = [head, head, ...s.units.map(u => u.text)].join(' ');
      const tf = new Map(); for (const w of contentStems(text)) tf.set(w, (tf.get(w) || 0) + 1);
      docs.push({ id: `${url}#${i}`, url, index: i, section: s, tf, len: [...tf.values()].reduce((a, b) => a + b, 0) });
    });
  }
  const avg = docs.reduce((a, d) => a + d.len, 0) / (docs.length || 1);
  const df = new Map(); for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length; const k1 = 1.2; const b = 0.75;
  const idf = (w) => { const n = df.get(w) || 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); };

  // Exact wording the customer pasted (an error text, a field name, a label in quotes) is the strongest clue there
  // is: a passage that holds a run of four of its words in order gets a bonus per run.
  function phrases(text) {
    const pasted = [...String(text).matchAll(/"([^"\n]{8,300})"|“([^”\n]{8,300})”|`([^`\n]{4,300})`|'([^'\n]{12,300})'/g)].map(m => m[1] || m[2] || m[3] || m[4]);
    const grams = new Set();
    for (const p of pasted) {
      const w = rawWordsOf(p);
      if (w.length < 4) { if (w.length >= 2 && p.length >= 8) grams.add(w.join(' ')); continue; }
      for (let i = 0; i + 4 <= w.length; i++) grams.add(w.slice(i, i + 4).join(' '));
    }
    return [...grams];
  }
  for (const d of docs) d.flat = ` ${rawWordsOf(d.section.units.map(u => u.text).join(' ')).join(' ')} `;
  function score(text, { phraseBonus = PHRASE_BONUS } = {}) {
    const q = [...new Set(contentStems(text))];
    const grams = phraseBonus ? phrases(text) : [];
    const out = [];
    for (const d of docs) {
      let s = 0;
      for (const w of q) { const f = d.tf.get(w); if (!f) continue; s += idf(w) * f * (k1 + 1) / (f + k1 * (1 - b + b * d.len / avg)); }
      if (grams.length) { let hit = 0; for (const g of grams) if (d.flat.includes(` ${g} `)) hit++; s += phraseBonus * Math.min(hit, 6); }
      if (s > 0) out.push({ d, s });
    }
    return out.sort((x, y) => y.s - x.s);
  }

  // The top passages, from at most `maxPages` pages, `limit` in all. A page's best passage brings its page in;
  // the page's next best passages follow while room is left, so one page cannot fill the list on its own
  // (at most `perPage` from each).
  // With `queries` (search queries in the help pages' own words, src/composer.mjs), the message's ranking and each
  // query's ranking are fused by reciprocal rank (each list's top 50; the message counts 1, each query `w`).
  function fuse(message, queries, w) {
    const lists = [score(message), ...queries.map(q => score(q, { phraseBonus: 0 }))];
    const sc = new Map();
    lists.forEach((l, li) => l.slice(0, 50).forEach(({ d }, rank) => { const x = sc.get(d.id) || { d, s: 0 }; x.s += (li === 0 ? 1 : w) / (10 + rank); sc.set(d.id, x); }));
    return [...sc.values()].sort((a, b) => b.s - a.s);
  }
  function retrieve(message, { limit = 12, maxPages = 4, perPage = 4, queries = [], w = 0.5 } = {}) {
    const ranked = queries.length ? fuse(message, queries, w) : score(message);
    const pagesIn = [];
    const picked = [];
    const count = new Map();
    for (const { d, s } of ranked) {
      if (picked.length >= limit) break;
      if (!pagesIn.includes(d.url)) { if (pagesIn.length >= maxPages) continue; pagesIn.push(d.url); }
      if ((count.get(d.url) || 0) >= perPage) continue;
      count.set(d.url, (count.get(d.url) || 0) + 1);
      picked.push({ ...d, score: s });
    }
    // Shown in page order, then section order, so a page reads top to bottom.
    picked.sort((x, y) => pagesIn.indexOf(x.url) - pagesIn.indexOf(y.url) || x.index - y.index);
    return { passages: picked, pages: pagesIn.map(u => byUrl.get(u)) };
  }

  return { retrieve, score, byUrl, size: docs.length };
}

// Number the citable units of the retrieved passages S1, S2, ... and render the model's view of them.
// Returns { text, sentences: Map(id -> { id, text, url, path, kind }) }.
export function numberPassages(retrieved) {
  const sentences = new Map();
  const blocks = [];
  let n = 0;
  const byPage = new Map();
  for (const p of retrieved.passages) { if (!byPage.has(p.url)) byPage.set(p.url, []); byPage.get(p.url).push(p); }
  for (const [url, ps] of byPage) {
    const page = retrieved.pages.find(x => x.url === url);
    const lines = [`<page url="${url}" title="${page?.title || ''}">`];
    if (page?.headings?.length) lines.push(`Headings on this page: ${page.headings.filter(h => h.level >= 2 && h.level <= 3).map(h => h.text).slice(0, 40).join(' | ')}`);
    for (const p of ps) {
      lines.push(`<passage section="${p.section.path.filter(Boolean).join(' > ')}">`);
      let lastTable = null;
      for (const u of p.section.units) {
        if (!u.citable) continue;
        if (u.kind === 'row' && u.table && u.table !== lastTable && u.display !== u.table) lines.push(`(table columns: ${u.table})`);
        if (u.kind === 'row') lastTable = u.table;
        const id = `S${++n}`;
        sentences.set(id, { id, text: u.text, url, path: u.path, kind: u.kind });
        const shown = u.kind === 'heading' ? `[heading] ${u.display}` : u.kind === 'row' ? `[table row] ${u.display}` : u.kind === 'code' ? `[code] ${u.display.replace(/\n/g, ' ')}` : u.display;
        lines.push(`${id}: ${shown}`);
      }
      lines.push('</passage>');
    }
    lines.push('</page>');
    blocks.push(lines.join('\n'));
  }
  return { text: blocks.join('\n\n'), sentences };
}

// The full text of the section a unit sits in (for the second reader): the heading path and every unit under it.
export function sectionText(index, url, path) {
  const page = index.byUrl.get(url);
  if (!page) return '';
  const key = path.join(' > ');
  const units = page.units.filter(u => u.path.join(' > ') === key || u.path.join(' > ').startsWith(`${key} > `));
  return [`${page.title} (${url})`, `Section: ${path.filter(Boolean).join(' > ')}`, ...units.map(u => u.kind === 'row' ? `| ${u.display} |` : u.kind === 'heading' ? `## ${u.display}` : u.display)].join('\n');
}
