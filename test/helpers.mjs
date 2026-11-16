// Test helpers: a temporary desk folder and an offline docs cache built from the playbook's own quotes.
// The tests prove the desk's logic. They do not prove Blotato's live docs; "support-desk docs" does that.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLAYBOOK } from '../knowledge/playbook.mjs';
import { pageUrl } from '../src/docs.mjs';

export function tempDesk({ extraPages = {}, drop = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-desk-test-'));
  const cache = path.join(dir, 'docs-cache');
  fs.mkdirSync(cache, { recursive: true });
  const pages = {};
  const add = (url, quote) => { const u = pageUrl(url); pages[u] = (pages[u] || `# Test copy of ${u}\n`) + `\nSome words before. ${quote} Some words after.\n`; };
  for (const e of PLAYBOOK) {
    for (const s of [...e.steps, ...(e.holding?.steps || [])]) if (s.cite) add(s.cite.url, s.cite.quote);
    for (const c of [...(e.escalate?.causes || []), ...(e.escalate?.ruledOut || [])]) if (c?.cite) add(c.cite.url, c.cite.quote);
    if (e.docEdit) add(e.docEdit.article, e.docEdit.before || '');
  }
  Object.assign(pages, extraPages);
  for (const [u, text] of Object.entries(pages)) {
    if (drop.includes(u)) continue;
    const slug = u.replace(/^https?:\/\/[^/]+\//, '').replace(/[^a-z0-9]+/gi, '_');
    fs.writeFileSync(path.join(cache, `${slug}.json`), JSON.stringify({ url: u, fetchedAt: '2026-11-15T15:00:00.000Z', via: 'test fixture', text }));
  }
  const env = { BLOTATO_MOCK: '1', DOCS_OFFLINE: '1', SUPPORT_DESK_DIR: path.join(dir, 'desk'), DOCS_CACHE_DIR: cache, SUPPORT_CHECKS_DIR: path.join(dir, 'checks') };
  return { dir, cache, env, pages };
}
