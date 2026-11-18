// The exam: run made-up customer messages through the desk and count what it did with each one.
//
//   node eval/run.mjs                 both sets (dev and test)
//   node eval/run.mjs --set dev       only the messages the playbook was tuned on
//   node eval/run.mjs --set test      only the held-out messages nobody tuned on
//   node eval/run.mjs --set dev2      the second, harder exam: the part that may be tuned on
//   node eval/run.mjs --set test2     the second exam's held-out part (run rarely; never open the file)
//   node eval/run.mjs --show wrong    also print every message it got wrong
//
// The reader (src/reader.mjs), off by default:
//   --reader claude-cli|anthropic     pick-or-abstain with a model (claude-cli: the signed-in Claude Code CLI)
//   --model haiku|sonnet|<full id>    the reader's model (default sonnet, the chosen one)
//   --refuter off|on|new [--refuter-model m]   (default new)  the refuter on each verified pick (on), or only on picks the matcher
//                                     would not have made itself (new)
//   --prompt pick-r2                  which pick prompt (default: PICK_VERSION in src/reader.mjs)
//   --k 5                             candidates from each script retriever (matcher, BM25)
//   --concurrency 5                   model calls at once while the verdicts are gathered
//   --slice 60                        a fixed, evenly spaced slice of the set (the same rows every run)
//   --cache <dir>                     verdict cache (default eval/reader-cache/<set>); --cache-only 1 makes no live call
//
// The composer (src/composer.mjs), off by default; it runs after the reader, on messages still handed over:
//   --composer claude-cli|anthropic   compose from any help page, every step quoted, then a second read
//   --writer-model haiku|sonnet|<id>  the writer's model (default sonnet)
//   --second on|off [--second-model m]  the second read (default on, the writer's model)
//   --passages 16 --pages 5 --per-page 4   how many passages the script retrieves, from how many pages
//   --expand on|off [--expand-model m]     the search step: a fast model writes queries in the pages' words (default on, haiku)
//   --gaps reader|all                 which coverage gaps block a draft (default reader)
//   --top-pages 3                     every quote from the N best-ranked pages (0: any page shown; default 3)
//   --composer-cache <dir>            (default eval/composer-cache/<set>); --composer-cache-only 1 makes no live call
//
// Held-out sets (any set whose name starts with "test") print the summary tables only: no row is printed, and no
// per-row file is written for them (results/latest.json gets the totals only). The one exception is --blind-out,
// which seals the rows in a folder for an independent checker that returns totals only.
//
// It uses sample account data and the local copy of the help pages, so it makes no network calls
// and never touches a real account. Each message has the outcome a careful person would choose:
//   answer       the help pages answer it; the reply must rest on the right page
//   escalate     a person has to decide (money taken, staff-only actions, real bugs)
//   docs-silent  the help pages do not answer it; the desk must not guess
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDesk, handleTicket } from '../src/desk.mjs';
import { findPromises } from '../src/checkreply.mjs';
import { routeMessage, ROUTER } from '../knowledge/playbook.mjs';
import { createReader, PICK_VERSION, REFUTE_VERSION } from '../src/reader.mjs';
import { createComposer } from '../src/composer.mjs';
import { normalizeText } from '../src/docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const which = opt('set', 'both');
const show = opt('show', '');
const readerBackend = opt('reader', 'off');
const slice = Number(opt('slice', 0));
const concurrency = Math.max(1, Number(opt('concurrency', 5)));
const readerEnv = (set) => readerBackend === 'off' ? {} : {
  SUPPORT_DESK_READER: readerBackend,
  SUPPORT_DESK_READER_MODEL: opt('model', 'sonnet'),
  SUPPORT_DESK_REFUTER: opt('refuter', 'new'),
  ...(opt('refuter-model') ? { SUPPORT_DESK_REFUTER_MODEL: opt('refuter-model') } : {}),
  SUPPORT_DESK_READER_K: opt('k', '5'),
  ...(opt('prompt') ? { SUPPORT_DESK_READER_PROMPT: opt('prompt') } : {}),
  SUPPORT_DESK_READER_CACHE: path.resolve(opt('cache', path.join(here, 'reader-cache', set))),
  ...(opt('cache-only') === '1' ? { SUPPORT_DESK_READER_CACHE_ONLY: '1' } : {}),
};
const composerBackend = opt('composer', 'off');
const composerEnv = (set) => composerBackend === 'off' ? {} : {
  SUPPORT_DESK_COMPOSER: composerBackend,
  SUPPORT_DESK_COMPOSER_MODEL: opt('writer-model', 'sonnet'),
  SUPPORT_DESK_SECOND_READ: opt('second', 'on'),
  ...(opt('second-model') ? { SUPPORT_DESK_SECOND_READ_MODEL: opt('second-model') } : {}),
  ...(opt('write-prompt') ? { SUPPORT_DESK_COMPOSER_PROMPT: opt('write-prompt') } : {}),
  ...(opt('second-prompt') ? { SUPPORT_DESK_SECOND_READ_PROMPT: opt('second-prompt') } : {}),
  ...(opt('passages') ? { SUPPORT_DESK_COMPOSER_PASSAGES: opt('passages') } : {}),
  ...(opt('pages') ? { SUPPORT_DESK_COMPOSER_PAGES: opt('pages') } : {}),
  ...(opt('per-page') ? { SUPPORT_DESK_COMPOSER_PER_PAGE: opt('per-page') } : {}),
  ...(opt('expand') ? { SUPPORT_DESK_COMPOSER_EXPAND: opt('expand') } : {}),
  ...(opt('top-pages') !== undefined ? { SUPPORT_DESK_COMPOSER_TOP_PAGES: opt('top-pages') } : {}),
  ...(opt('expand-model') ? { SUPPORT_DESK_COMPOSER_EXPAND_MODEL: opt('expand-model') } : {}),
  SUPPORT_DESK_COMPOSER_GAPS: opt('gaps', 'reader'),
  SUPPORT_DESK_COMPOSER_CACHE: path.resolve(opt('composer-cache', path.join(here, 'composer-cache', set))),
  ...(opt('composer-cache-only') === '1' ? { SUPPORT_DESK_COMPOSER_CACHE_ONLY: '1' } : {}),
  ...(opt('over-saved') === '1' ? { SUPPORT_DESK_COMPOSE_OVER_SAVED: '1' } : {}),
};
const heldOut = (name) => /^test/.test(name);
// The same evenly spaced rows every run, so a slice result can be compared run to run.
const sliceOf = (rows, n) => !n || n >= rows.length ? rows : Array.from({ length: n }, (_, i) => rows[Math.floor(i * rows.length / n)]);

const readSet = (name) => fs.readFileSync(path.join(here, `tickets.${name}.jsonl`), 'utf8').trim().split(/\r?\n/).map(l => JSON.parse(l));
const norm = (u) => String(u || '').replace(/\.md$/, '').replace(/\/$/, '').toLowerCase();

// What the desk did, in the exam's words.
function outcomeOf(r) {
  if (!r.entry) return 'handed-over';            // no playbook entry: no reply written, a person gets it with the docs search
  if (r.check && !r.check.pass) return 'blocked'; // the script checker stopped its own reply
  if (r.outcome === 'reply') return 'answer';
  if (r.outcome === 'escalate') return 'escalate';
  return 'docs-silent';
}

// right: what a careful person would do.  safe: not the best outcome, but a person sees it and nothing untrue was said.
// wrong: the customer would get an answer that is not the right one.
// A row may name entries that must never answer it (wrong_entries): the right page is not enough when two entries
// quote the same page ("connect my TikTok account so I can schedule videos" must not get the scheduling entry).
function grade(t, got, citedUrls, entryId = null) {
  if (got === 'answer' && entryId && (t.wrong_entries || []).includes(entryId)) return 'wrong';
  const rightPage = citedUrls.some(u => norm(u) === norm(t.source_url));
  if (t.expected === 'answer') {
    if (got === 'answer') return rightPage ? 'right' : 'wrong';
    return 'safe';
  }
  if (t.expected === 'escalate') {
    if (got === 'escalate') return 'right';
    if (got === 'answer') return 'wrong';
    return 'safe';
  }
  // docs-silent
  if (got === 'docs-silent' || got === 'handed-over') return 'right';
  if (got === 'answer') return 'wrong';
  return 'safe';
}

async function runSet(name) {
  const tickets = sliceOf(readSet(name), slice);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-desk-eval-'));
  const env = { ...process.env, BLOTATO_MOCK: '1', DOCS_OFFLINE: '1', SUPPORT_DESK_DIR: dir, BLOTATO_API_KEY: '', ...readerEnv(name), ...composerEnv(name) };
  const desk = openDesk({ env });
  // Gather the reader's and the composer's verdicts first, a few at a time (they land in the caches); the desk then
  // reads them in order.
  const t0 = Date.now();
  if (desk.reader || desk.composer) {
    const warm = desk.reader ? createReader({ router: ROUTER, env }) : null;
    const warmC = desk.composer ? createComposer({ router: ROUTER, env, docsCacheDir: desk.paths.docsCache }) : null;
    let next = 0;
    const worker = async () => { while (next < tickets.length) { const t = tickets[next++]; const r0 = routeMessage(t.message); const r1 = warm ? await warm.decide(t.message, r0) : r0; if (warmC) await warmC.compose(t.message, r1); } };
    await Promise.all(Array.from({ length: concurrency }, worker));
    if (warm) desk.readerWarm = { stats: warm.stats, wallMs: Date.now() - t0 };
    if (warmC) desk.composerWarm = { stats: warmC.stats, wallMs: Date.now() - t0 };
  }
  const rows = [];
  for (const t of tickets) {
    let r, error = null;
    try { r = await handleTicket(desk, { text: t.message }); } catch (e) { error = String(e.message || e); }
    const got = error ? 'crashed' : outcomeOf(r);
    const cited = error ? [] : (r.steps || []).filter(s => s.cite).map(s => s.cite.url);
    const promises = !error && r.reply ? findPromises(r.reply) : [];
    // Not part of the grade: did a wrong answer quote the label's own sentence, word for word, from another page?
    const quotes = error ? [] : (r.steps || []).flatMap(s => s.cites || (s.cite ? [s.cite] : [])).map(c => normalizeText(c.quote || ''));
    const lq = normalizeText(t.source_quote || '');
    const labelQuoted = !!lq && lq.length >= 20 && quotes.some(q => q.includes(lq) || (q.length >= 30 && lq.includes(q)));
    const co = r?.composer && r.composer.backend !== 'off' ? r.composer : null;
    rows.push({
      id: t.id, kind: t.kind, voice: t.voice, topic: t.topic, expected: t.expected, got,
      entry: r?.entry?.id || null,
      why: r?.match?.why ?? null,
      reader: r?.reader?.backend && r.reader.backend !== 'off' ? { pick: r.reader.pick, verified: r.reader.verified, problem: r.reader.problem, skipped: r.reader.skipped, error: r.reader.error, refuter: r.reader.refuter?.verdict || null, candidates: r.reader.candidates } : null,
      composer: co ? { state: co.state || null, skipped: co.skipped || null, problem: co.problem || null, error: co.error || null, answerable: co.answerable, reason: co.reason, pages: [...new Set((co.passages || []).map(p => p.url))], steps: (co.steps || []).map(st => ({ text: st.text, quotes: st.quotes.map(q => ({ id: q.id, url: q.url, text: q.text })) })), asked: co.asked, second: co.secondReadResult ? { verdict: co.secondReadResult.verdict, objections: co.secondReadResult.objections } : null } : null,
      path: r?.path || null,
      cited,
      labelQuoted,
      grade: error ? 'wrong' : grade(t, got, cited, r?.entry?.id || r?.match?.entry?.id || null),
      adversarial: /^adv-/.test(t.topic),
      promises: promises.length,
      message: t.message, error,
    });
  }
  const readerInfo = desk.reader ? { config: desk.reader.config, warm: desk.readerWarm } : null;
  await desk.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
  rows.readerInfo = readerInfo;
  rows.composerInfo = desk.composer ? { config: desk.composer.config, warm: desk.composerWarm } : null;
  return rows;
}

function tally(rows) {
  const n = rows.length;
  const count = (f) => rows.filter(f).length;
  const by = (key) => {
    const out = {};
    for (const r of rows) { (out[r[key]] ||= { n: 0, right: 0, safe: 0, wrong: 0 })[r.grade]++; out[r[key]].n++; }
    return out;
  };
  return {
    n,
    right: count(r => r.grade === 'right'),
    safe: count(r => r.grade === 'safe'),
    wrong: count(r => r.grade === 'wrong'),
    answersGiven: count(r => r.got === 'answer'),
    answersRight: count(r => r.got === 'answer' && r.grade === 'right'),
    promisesInReplies: count(r => r.promises > 0),
    crashed: count(r => r.got === 'crashed'),
    composed: count(r => r.path === 'composed'),
    composedRight: count(r => r.path === 'composed' && r.grade === 'right'),
    composedWrong: count(r => r.path === 'composed' && r.grade === 'wrong'),
    wrongLabelQuoted: count(r => r.grade === 'wrong' && r.labelQuoted),
    byExpected: by('expected'),
    byKind: by('kind'),
    adversarial: by('adversarial').true || { n: 0, right: 0, safe: 0, wrong: 0 },
  };
}

const pct = (a, b) => b ? `${Math.round((a / b) * 100)}%` : 'n/a';

function report(name, rows) {
  const t = tally(rows);
  const L = [];
  L.push(`### ${name.startsWith('test') ? 'Held-out set (never tuned on)' : 'Tuning set'} [${name}]${slice ? ` (fixed slice of ${t.n})` : ''}: ${t.n} messages`);
  L.push('');
  const ri = rows.readerInfo;
  if (!ri) L.push('Reader: off (the matcher alone).');
  else {
    const c = ri.config; const s = ri.warm.stats;
    const live = s.live.pick + s.live.refute; const cached = s.cached.pick + s.cached.refute;
    const modelSec = (s.liveMs + s.cachedMs) / 1000 / (s.reached || 1);
    L.push(`Reader: ${c.backend}, model ${c.model}, prompt ${c.prompt}${c.refuter ? `, refuter ${c.refuterModel} (${REFUTE_VERSION}${c.refuter === 'new' ? ', only on picks the matcher would not make' : ', every pick'})` : ', no refuter'}, k ${c.k}. Messages that reached it: ${s.reached} of ${t.n}. Model calls: ${live} live, ${cached} from the cache, ${s.errors} errors. Model time per message that reached it: ${modelSec.toFixed(1)} s (from the call records); wall time to gather: ${(ri.warm.wallMs / 1000).toFixed(0)} s at ${concurrency} at once.`);
  }
  const ci = rows.composerInfo;
  if (!ci) L.push('Composer: off.');
  else {
    const c = ci.config; const s = ci.warm.stats;
    const live = s.live.write + s.live.second + s.live.expand; const cached = s.cached.write + s.cached.second + s.cached.expand;
    const modelSec = (s.liveMs + s.cachedMs) / 1000 / (s.reached || 1);
    L.push(`Composer: ${c.backend}, writer ${c.writerModel} (${c.writePrompt}), ${c.secondRead ? `second read ${c.secondModel} (${c.secondPrompt})` : 'no second read'}, ${c.expand ? `search step ${c.expandModel}` : 'no search step'}, passages ${c.limit} from up to ${c.maxPages} pages (${c.perPage} per page), quotes from the top ${c.topPages || 'any'} page(s), gaps ${c.gapRule}. Messages that reached it: ${s.reached} of ${t.n}. Writer said not answerable: ${s.declined}; rejected by the script: ${s.unverified}; objected by the second read: ${s.objected}; signals: ${s.signals}; composed and sent: ${s.answered}. Model calls: ${live} live (${s.live.expand} search, ${s.live.write} writer, ${s.live.second} second read), ${cached} from the cache, ${s.errors} errors. Model time per message that reached it: ${modelSec.toFixed(1)} s; wall time to gather: ${(ci.warm.wallMs / 1000).toFixed(0)} s at ${concurrency} at once.`);
    L.push(`Composed replies: ${t.composed} (right ${t.composedRight}, wrong ${t.composedWrong}). Script rejections by kind: ${Object.entries(s.problems).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`);
  }
  L.push(`Answers among messages that should be answered: ${(t.byExpected.answer || { right: 0 }).right} right of ${(t.byExpected.answer || { n: 0 }).n}.`);
  L.push('');
  L.push(`| | Count | Share |`);
  L.push(`|---|---|---|`);
  L.push(`| Right: what a careful person would do | ${t.right} | ${pct(t.right, t.n)} |`);
  L.push(`| Safe: handed to a person, nothing untrue said | ${t.safe} | ${pct(t.safe, t.n)} |`);
  L.push(`| Wrong: the customer would get the wrong answer | ${t.wrong} | ${pct(t.wrong, t.n)} |`);
  L.push('');
  L.push(`When the desk did write an answer, it was the right one ${t.answersRight} of ${t.answersGiven} times (${pct(t.answersRight, t.answersGiven)}).`);
  L.push(`Replies holding a promise: ${t.promisesInReplies}. Crashes: ${t.crashed}.`);
  L.push(`Not in the grade: wrong answers that quote the label's own sentence word for word, from another page: ${t.wrongLabelQuoted} of ${t.wrong}.`);
  L.push('');
  L.push(`| Should have been | Messages | Right | Safe | Wrong |`);
  L.push(`|---|---|---|---|---|`);
  for (const k of ['answer', 'escalate', 'docs-silent']) { const b = t.byExpected[k] || { n: 0, right: 0, safe: 0, wrong: 0 }; L.push(`| ${k} | ${b.n} | ${b.right} | ${b.safe} | ${b.wrong} |`); }
  L.push(`| trick messages (inside the rows above) | ${t.adversarial.n} | ${t.adversarial.right} | ${t.adversarial.safe} | ${t.adversarial.wrong} |`);
  L.push('');
  return { text: L.join('\n'), tally: t };
}

const sets = which === 'both' ? ['dev', 'test'] : [which];
const out = {};
const parts = [];
for (const s of sets) {
  const rows = await runSet(s);
  const rep = report(s, rows);
  // A held-out set keeps its totals only: no row is printed and no row is written anywhere.
  out[s] = heldOut(s) ? { tally: rep.tally } : { tally: rep.tally, rows: rows.map(({ message, ...rest }) => rest) };
  // --blind-out <dir>: for an independent checker that reports totals only. The rows go to a sealed folder that
  // the builder never opens; nothing about them is printed. (Nov 16, 2026: the page-match grader undercounts.)
  const blind = opt('blind-out');
  if (blind && heldOut(s)) { fs.mkdirSync(blind, { recursive: true }); fs.writeFileSync(path.join(blind, `${s}.rows.json`), JSON.stringify(rows)); console.log(`[${s}] ${rows.length} rows sealed in ${blind} (not printed)`); }
  parts.push(rep.text);
  if (show && !heldOut(s)) for (const r of rows.filter(r => r.grade === show || (show === 'answers' && r.got === 'answer'))) console.log(`[${s}] ${r.id} expected ${r.expected}, got ${r.got}${r.entry ? ` (${r.entry})` : ''}${r.why ? ` why ${r.why}` : ''}${r.reader ? ` reader ${JSON.stringify({ pick: r.reader.pick, problem: r.reader.problem, refuter: r.reader.refuter })}` : ''}: ${r.message.slice(0, 160)}`);
}
fs.mkdirSync(path.join(here, 'results'), { recursive: true });
fs.writeFileSync(path.join(here, 'results', 'latest.json'), JSON.stringify(out, null, 1));
console.log(parts.join('\n'));
