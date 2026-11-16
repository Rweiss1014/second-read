// Fast routing-only view of a set: what the router decides for each message, and how the exam would grade it.
// Same grading as eval/run.mjs, without building replies (so it runs in a second and can sweep settings).
//   node eval/sim.mjs --set dev2 [--show wrong|safe|right|all] [--file path.jsonl]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEntries } from '../src/entries.mjs';
import { createRouter } from '../src/route.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const norm = (u) => String(u || '').replace(/\.md$/, '').replace(/\/$/, '').toLowerCase();

export function readSet(nameOrFile) {
  if (/^test2?$/.test(nameOrFile)) throw new Error('The held-out sets are run only through eval/run.mjs.');
  const file = /[\/.]/.test(nameOrFile) ? nameOrFile : path.join(here, `tickets.${nameOrFile}.jsonl`);
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}

export function outcome(r) {
  if (!r.entry) return 'handed-over';
  if (r.decision === 'answer' && !r.entry.escalate && !r.entry.noDocAnswer && !r.entry.guard) {
    // The submission lookup needs an id in the message; without one the script checker blocks the reply.
    if (r.entry.lookup === 'submission' && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(r.text)) return 'blocked';
    return 'answer';
  }
  if (r.decision === 'answer' && r.entry.noDocAnswer && !r.entry.escalate) return 'docs-silent';
  return 'escalate';
}
export function grade(t, got, urls) {
  const rightPage = urls.some(u => norm(u) === norm(t.source_url));
  if (t.expected === 'answer') return got === 'answer' ? (rightPage ? 'right' : 'wrong') : 'safe';
  if (t.expected === 'escalate') return got === 'escalate' ? 'right' : got === 'answer' ? 'wrong' : 'safe';
  return got === 'docs-silent' || got === 'handed-over' ? 'right' : got === 'answer' ? 'wrong' : 'safe';
}
export function simulate(router, tickets) {
  return tickets.map(t => {
    const r = router.route(t.message);
    const got = outcome(r);
    const urls = got === 'answer' ? (r.entry.steps || []).filter(s => s.cite).map(s => s.cite.url) : [];
    return { t, r, got, grade: grade(t, got, urls) };
  });
}
export function tally(rows) {
  const c = (f) => rows.filter(f).length;
  const by = {};
  for (const x of rows) { const b = (by[x.t.expected] ||= { n: 0, right: 0, safe: 0, wrong: 0 }); b.n++; b[x.grade]++; }
  const adv = rows.filter(x => /^adv-/.test(x.t.topic));
  return { n: rows.length, right: c(x => x.grade === 'right'), safe: c(x => x.grade === 'safe'), wrong: c(x => x.grade === 'wrong'), answers: c(x => x.got === 'answer'), answersRight: c(x => x.got === 'answer' && x.grade === 'right'), by, adv: { n: adv.length, right: adv.filter(x => x.grade === 'right').length, safe: adv.filter(x => x.grade === 'safe').length, wrong: adv.filter(x => x.grade === 'wrong').length } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
  const tickets = readSet(opt('file', opt('set', 'dev2')));
  const router = createRouter(loadEntries().entries);
  const rows = simulate(router, tickets);
  const show = opt('show', '');
  for (const x of rows.filter(x => show === 'all' || x.grade === show)) {
    console.log(`${x.t.id} [${x.t.expected}/${x.t.trap || '-'}] got ${x.got} via ${x.r.entry?.id || '-'} ${x.r.decision} score=${x.r.score ?? ''} gap=${x.r.margin ?? ''} why=${x.r.why || ''}\n   src=${x.t.source_url}\n   ${x.t.message.slice(0, 400)}`);
  }
  console.log(JSON.stringify(tally(rows)));
}
