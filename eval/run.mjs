// The exam: run made-up customer messages through the desk and count what it did with each one.
//
//   node eval/run.mjs                 both sets (dev and test)
//   node eval/run.mjs --set dev       only the messages the playbook was tuned on
//   node eval/run.mjs --set test      only the held-out messages nobody tuned on
//   node eval/run.mjs --set dev2      the second, harder exam: the part that may be tuned on
//   node eval/run.mjs --set test2     the second exam's held-out part (run rarely; never open the file)
//   node eval/run.mjs --show wrong    also print every message it got wrong
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

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const which = opt('set', 'both');
const show = opt('show', '');

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
function grade(t, got, citedUrls) {
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
  const tickets = readSet(name);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-desk-eval-'));
  const env = { ...process.env, BLOTATO_MOCK: '1', DOCS_OFFLINE: '1', SUPPORT_DESK_DIR: dir, BLOTATO_API_KEY: '' };
  const desk = openDesk({ env });
  const rows = [];
  for (const t of tickets) {
    let r, error = null;
    try { r = await handleTicket(desk, { text: t.message }); } catch (e) { error = String(e.message || e); }
    const got = error ? 'crashed' : outcomeOf(r);
    const cited = error ? [] : (r.steps || []).filter(s => s.cite).map(s => s.cite.url);
    const promises = !error && r.reply ? findPromises(r.reply) : [];
    rows.push({
      id: t.id, kind: t.kind, voice: t.voice, topic: t.topic, expected: t.expected, got,
      entry: r?.entry?.id || null,
      grade: error ? 'wrong' : grade(t, got, cited),
      adversarial: /^adv-/.test(t.topic),
      promises: promises.length,
      message: t.message, error,
    });
  }
  await desk.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
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
    byExpected: by('expected'),
    byKind: by('kind'),
    adversarial: by('adversarial').true || { n: 0, right: 0, safe: 0, wrong: 0 },
  };
}

const pct = (a, b) => b ? `${Math.round((a / b) * 100)}%` : 'n/a';

function report(name, rows) {
  const t = tally(rows);
  const L = [];
  L.push(`### ${name.startsWith('test') ? 'Held-out set (never tuned on)' : 'Tuning set'} [${name}]: ${t.n} messages`);
  L.push('');
  L.push(`| | Count | Share |`);
  L.push(`|---|---|---|`);
  L.push(`| Right: what a careful person would do | ${t.right} | ${pct(t.right, t.n)} |`);
  L.push(`| Safe: handed to a person, nothing untrue said | ${t.safe} | ${pct(t.safe, t.n)} |`);
  L.push(`| Wrong: the customer would get the wrong answer | ${t.wrong} | ${pct(t.wrong, t.n)} |`);
  L.push('');
  L.push(`When the desk did write an answer, it was the right one ${t.answersRight} of ${t.answersGiven} times (${pct(t.answersRight, t.answersGiven)}).`);
  L.push(`Replies holding a promise: ${t.promisesInReplies}. Crashes: ${t.crashed}.`);
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
  out[s] = { tally: rep.tally, rows: rows.map(({ message, ...rest }) => rest) };
  parts.push(rep.text);
  if (show) for (const r of rows.filter(r => r.grade === show)) console.log(`[${s}] ${r.id} expected ${r.expected}, got ${r.got}${r.entry ? ` (${r.entry})` : ''}: ${r.message.slice(0, 160)}`);
}
fs.mkdirSync(path.join(here, 'results'), { recursive: true });
fs.writeFileSync(path.join(here, 'results', 'latest.json'), JSON.stringify(out, null, 1));
console.log(parts.join('\n'));
