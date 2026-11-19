// Builds the data the free public site's function carries: netlify/site-data/ (git-ignored).
// The saved verdicts (reader and composer, merged into one folder each) and the help-page cache. netlify.toml's
// included_files puts them inside the function bundle ONLY; public/ (the published folder) never holds them.
//   node scripts/build-site.mjs [--docs <folder with the cached help pages>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const docsArg = args.includes('--docs') ? args[args.indexOf('--docs') + 1] : null;
const out = path.join(root, 'netlify', 'site-data');

const docsSrc = [docsArg, process.env.DOCS_CACHE_DIR, path.join(root, '.cache', 'docs'), path.join(root, '..', 'repo', '.cache', 'docs')]
  .filter(Boolean).map(d => path.resolve(d)).find(d => { try { return fs.readdirSync(d).some(f => f.endsWith('.json')); } catch { return false; } });
if (!docsSrc) { console.error('No help-page cache found. Run `node bin/support-desk.mjs docs --all` first, or pass --docs <folder>.'); process.exit(1); }

fs.rmSync(path.join(root, 'netlify', 'site-data'), { recursive: true, force: true });
// The published folder, dist/ (git-ignored): public/ copied, with the header mark and favicon written into index.html
// the way src/server.mjs indexHtml() does for the local page. public/ itself is never changed.
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
{
  const mark = fs.existsSync(path.join(root, 'public', 'art', 'app-mark.webp'));
  const f = path.join(dist, 'index.html');
  let html = fs.readFileSync(f, 'utf8');
  html = html.replace('<!--app-mark-->', mark ? '<img class="brand-mark" src="/art/app-mark.webp" alt="" width="34" height="34" decoding="async">' : '');
  html = html.replace('<!--app-icon-->', mark ? '<link rel="icon" href="/art/app-mark.webp" type="image/webp">' : '');
  fs.writeFileSync(f, html);
}
// Saved verdicts: the committed eval caches (hash-named files, no message text), plus desk/ if a local one exists.
const merge = (kind) => {
  const dest = path.join(out, `${kind}-cache`); fs.mkdirSync(dest, { recursive: true });
  const dirs = [path.join(root, 'desk', `${kind}-cache`), path.join(root, '..', 'repo', 'desk', `${kind}-cache`)];
  const evalDir = path.join(root, 'eval', `${kind}-cache`);
  try { for (const d of fs.readdirSync(evalDir)) if (!/^test/.test(d)) dirs.push(path.join(evalDir, d)); } catch { /* none */ }
  let n = 0;
  for (const d of dirs) { let fl = []; try { fl = fs.readdirSync(d).filter(f => /^[0-9a-f]{64}\.json$/.test(f)); } catch { continue; } for (const f of fl) { fs.copyFileSync(path.join(d, f), path.join(dest, f)); n++; } }
  return fs.readdirSync(dest).length;
};
const reader = merge('reader'); const composer = merge('composer');
const docs = path.join(out, 'docs'); fs.mkdirSync(docs, { recursive: true });
let pages = 0;
for (const f of fs.readdirSync(docsSrc)) if (f.endsWith('.json')) { fs.copyFileSync(path.join(docsSrc, f), path.join(docs, f)); pages++; }
fs.mkdirSync(out, { recursive: true });
console.log(`Built ${path.relative(root, out)}: ${reader} reader verdicts, ${composer} composer verdicts, ${pages} help pages (from ${docsSrc}).`);
