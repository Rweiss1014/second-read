// The support desk: one ticket at a time, a whole shift, and the morning note.
import fs from 'node:fs';
import { deskPaths, isMock } from './config.mjs';
import { loadKey } from './env.mjs';
import { createLogger, newRunId } from './log.mjs';
import { createClient, listPosts } from './api.mjs';
import { createDocs } from './docs.mjs';
import { diagnose, renderEscalation, renderDocEdit, nice } from './diagnose.mjs';
import { checkReply, freshState, defaultChecksDir } from './checkreply.mjs';
import { readFailures, recordFailure, ensureFailuresFile, unknownId } from './failures.mjs';
import { explain } from './explain.mjs';
import { citedPages } from './entries.mjs';
import { TICKETS, PLAYBOOK, ENTRY_BY_ID, ROUTER } from '../knowledge/playbook.mjs';
import { createReader } from './reader.mjs';
import { createComposer } from './composer.mjs';
import path from 'node:path';
import { MOCK_NOW, createMockApi } from './mock.mjs';

// The desk's clock. Sample mode always uses the sample world's own fixed clock, so replies to the sample
// tickets read the same on every run. A real account uses the real clock (or one passed in, for tests).
export function openDesk({ env = process.env, run = newRunId(), fetchImpl, mockApi, now, readerCall, composerCall, composerPages } = {}) {
  const paths = deskPaths(env);
  fs.mkdirSync(paths.dir, { recursive: true });
  ensureFailuresFile(paths.failures);
  const mock = isMock(env);
  const logger = createLogger({ dir: paths.logs, run, key: mock ? undefined : loadKey({ env }), mock });
  // SUPPORT_DESK_MOCK_CLOCK=now (the public site): the sample world's clock is the real hour, so a sample post
  // "scheduled for" a time is always in the future for the visitor (Nov 18, 2026: the 504 example showed a time
  // already past). The words that hold those times are checked as words ({evidence}), so nothing loses its check.
  // Otherwise (tests, the exam, the local page) it stays fixed at MOCK_NOW, so replies read the same on every run.
  const sampleNow = env.SUPPORT_DESK_MOCK_CLOCK === 'now' ? Math.floor(Date.now() / 3600000) * 3600000 : MOCK_NOW;
  const client = createClient({ env, logger, fetchImpl, mockApi: mockApi || (mock && sampleNow !== MOCK_NOW ? createMockApi({ now: () => sampleNow }) : undefined) });
  const docs = createDocs({ cacheDir: paths.docsCache, env, logger, fetchImpl });
  const clock = mock ? () => sampleNow : (now || Date.now);
  // The reader (src/reader.mjs): off unless SUPPORT_DESK_READER names a backend. Its verdict cache lives in the
  // desk folder unless SUPPORT_DESK_READER_CACHE says where.
  const reader = createReader({ router: ROUTER, env, call: readerCall, cacheDir: env.SUPPORT_DESK_READER_CACHE || path.join(paths.dir, 'reader-cache') });
  // The composer (src/composer.mjs): off unless SUPPORT_DESK_COMPOSER names a backend. It retrieves from every page in
  // the docs cache. Its verdict cache lives in the desk folder unless SUPPORT_DESK_COMPOSER_CACHE says where.
  const composer = createComposer({ router: ROUTER, env, call: composerCall, pages: composerPages, docsCacheDir: paths.docsCache, cacheDir: env.SUPPORT_DESK_COMPOSER_CACHE || path.join(paths.dir, 'composer-cache') });
  return { env, paths, checksDir: defaultChecksDir(env), mock, logger, client, docs, run, now: clock, relativeTimes: mock && sampleNow !== MOCK_NOW, reader, composer, agent: env.SUPPORT_AGENT_NAME || 'Support', close: () => docs.close() };
}

export async function handleTicket(desk, ticket, { requireReview = false } = {}) {
  const { paths, logger, checksDir } = desk;
  logger.write({ action: 'ticket', ticket: ticket.id || 'pasted' });

  // 1. Known failures first (read before this ticket is recorded).
  const known = readFailures(paths.failures);

  // 2. Route and diagnose from the docs and the account, 3. check the reply.
  const d = await diagnose(ticket, desk);
  if (d.path === 'composed') return composedResult(desk, ticket, d, known, { requireReview });
  const entry = d.entry ? ENTRY_BY_ID.get(d.entry.id) : null;
  const seenBefore = entry ? known.filter(f => f.id === entry.id || f.id === `blocked-${entry.id}`) : known.filter(f => f.id === unknownId(ticket.text));
  const check = checkReply(d, { reviewsDir: paths.reviews, requireReview, checksDir });

  // 4. Mistakes teach: record what happened. "Matched words" are the entry's own anchor words or phrasing,
  // never the customer's text.
  let recorded;
  if (!entry) {
    recorded = recordFailure(paths.failures, { id: unknownId(ticket.text), title: 'A question the playbook could not answer', why: `No entry the desk trusts matched, so it wrote no reply. ${d.match?.reason || ''} It ran a docs search for a person to read.`.replace(/\s+/g, ' '), fix: 'Get the answer from the founder, add it to the help docs (see the proposed edit), then add an entry in knowledge/entries/.', source: 'docs MCP searchDocumentation' });
  } else if (!check.pass) {
    recorded = recordFailure(paths.failures, { id: `blocked-${entry.id}`, title: `A reply about "${entry.title}" was blocked`, why: check.problems[0], fix: 'Fix the entry step or its citation, then run the ticket again. Never send the blocked version.' });
  } else {
    const src = d.steps.find(s => s.cite)?.cite.url;
    const how = d.match?.decision === 'answer' || d.match?.decision === 'guard' ? `Answered with the "${entry.id}" entry.` : `Matched "${entry.id}", handed to a person (${d.match?.decision}).`;
    recorded = recordFailure(paths.failures, { id: entry.id, title: entry.title, matched: d.match?.words || undefined, fix: `${how} Next step given to the customer: ${d.next}`, source: src });
  }
  logger.write({ action: 'ticket-done', ticket: ticket.id || 'pasted', entry: entry?.id || null, outcome: d.outcome, checked: check.pass, ok: check.pass || !entry, error: check.pass ? undefined : check.problems[0] });

  // Two checkers. The script's check is above. The fresh checker's verdict (if any) is read from the saved copy.
  const fresh = check.pass ? freshState(paths.reviews, d, { checksDir }) : null;
  return {
    ...d,
    check,
    fresh,
    seenBefore,
    recorded: recorded?.entry?.id,
    escalationText: renderEscalation(d.escalation),
    docEditText: renderDocEdit(d.docEdit),
    status: statusLine(entry, check, d.outcome, fresh),
  };
}

// A composed reply (src/composer.mjs). It is never a saved, pre-checked reply, so it never reads the fresh-checker
// store: its state is `checked-live` (the script's checks passed now; the second read passed these exact words, now or in an earlier run) or `script-checked`
// (the second read is off). The script checker still runs on the exact text, here, before anything is shown.
function composedResult(desk, ticket, d, known, { requireReview }) {
  const { paths, logger, checksDir } = desk;
  const check = checkReply(d, { reviewsDir: null, checksDir: null, requireReview: false });
  const pages = [...new Set(d.steps.flatMap(s => (s.cites || []).map(c => c.url)))];
  const id = `composed-${pages[0] ? pages[0].replace(/^https?:\/\/[^/]+\//, '').replace(/[^a-z0-9]+/gi, '-') : 'none'}`;
  const seenBefore = known.filter(f => f.id === id);
  const sr = d.composer?.secondReadResult;
  const recorded = recordFailure(paths.failures, check.pass
    ? { id, title: 'Answered with a reply composed from the help pages', fix: `Composed ${d.composed.steps.length} step(s), every one quoting ${pages.join(', ')}; the script checks passed${sr ? `, and the second reader (${sr.model}) passed it` : ''}. Not a saved reply: if this question repeats, write an entry for it.`, source: pages[0] }
    : { id: `blocked-${id}`, title: 'A composed reply was blocked', why: check.problems[0], fix: 'Nothing was sent. A person answers this one.' });
  logger.write({ action: 'ticket-done', ticket: ticket.id || 'pasted', entry: 'composed', path: 'composed', outcome: d.outcome, checked: check.pass, ok: check.pass, error: check.pass ? undefined : check.problems[0] });
  // requireReview asks for a saved fresh-checker pass, which a composed text never has: say so, never claim one.
  const fresh = { state: check.pass ? d.composer?.state || 'script-checked' : 'blocked', path: 'composed', saved: false, checkedAt: check.pass && sr ? sr.at || new Date().toISOString() : null, reused: !!sr?.cached, checker: sr ? `second reader (${sr.model}, ${sr.version})` : null, objections: sr?.objections || [] };
  const status = !check.pass ? 'blocked' : `composed reply: ${fresh.state === 'checked-live' ? `the script checks and the second reader passed it${sr?.cached ? ' (its verdict on these exact words, from an earlier run)' : ' just now'}` : 'the script checks passed; the second read is off'} (not a saved, pre-checked reply)${requireReview ? '; a saved fresh-checker pass is required and a composed text has none, so it is not cleared to send' : ''}`;
  return { ...d, check, fresh, seenBefore, recorded: recorded?.entry?.id, escalationText: '', docEditText: '', status };
}

// "Ready to send" only when the fresh checker passed this exact text. Before that, the script check passed and
// the reply waits for the fresh check.
function statusLine(entry, check, outcome, fresh) {
  if (!entry) return 'refused: no documented answer';
  if (!check.pass) return 'blocked';
  const what = outcome === 'no-answer' ? 'holding reply' : 'reply';
  const where = fresh?.state === 'passed' ? 'cleared to send (the fresh checker passed this exact text)' : 'script check passed, waiting on the fresh check';
  return `${what}: ${where}${outcome === 'reply' ? '' : ' + escalated'}`;
}

export async function runShift(desk, tickets = TICKETS, opts) {
  const results = [];
  for (const t of tickets) results.push(await handleTicket(desk, t, opts));
  fs.writeFileSync(desk.paths.handoff, renderShiftHandoff(results, desk));
  desk.logger.write({ action: 'shift-done', tickets: results.length });
  return results;
}

export function renderShiftHandoff(results, { mock, run } = {}) {
  const cleared = results.filter(r => r.check.pass && r.fresh?.state === 'passed');
  const waiting = results.filter(r => r.check.pass && r.fresh?.state !== 'passed');
  const blocked = results.filter(r => r.entry && !r.check.pass);
  const esc = results.filter(r => r.escalation);
  const edits = results.filter(r => r.docEdit);
  const line = (r) => `${r.ticket.id || 'pasted'} (${r.entry?.kind || 'unknown'})`;
  const freshWord = { none: 'not run yet', 'passed-saved': 'passed the saved copy, not this text', stale: 'its verdict is for an older text', blocked: 'blocked' };
  let next = 'Send the cleared replies.';
  if (blocked.length) next = `Fix the blocked reply for ${line(blocked[0])} first: ${blocked[0].check.problems[0]}`;
  else if (waiting.length) next = `Get a fresh-checker verdict for ${waiting.map(r => r.ticket.id || 'pasted').join(', ')}: run each with --save-reply, then start the reply-checker subagent on the packet it writes.${esc.length ? ` Send the ${esc.length} escalation packet(s) to the founder.` : ''}`;
  else if (esc.length) next = `Send the ${esc.length} escalation packet(s) to the founder, then the cleared replies.`;
  return [
    '# Shift handoff',
    '',
    `Written ${new Date().toUTCString()} (${run || 'run'}).${mock ? ' Account data is sample data, no account connected.' : ''}`,
    '',
    `## Tickets (${results.length})`,
    ...results.map(r => `- ${line(r)}: ${(r.entry?.title || 'no playbook entry').replace(/[.?!]$/, '')}. Status: ${r.status}.`),
    '',
    `## Cleared to send: the fresh checker passed this exact text (${cleared.length})`,
    ...(cleared.length ? cleared.map(r => `- ${line(r)}. Next step for the customer: ${r.next}`) : ['- none']),
    '',
    `## Script check passed, waiting on the fresh check (${waiting.length})`,
    ...(waiting.length ? waiting.map(r => `- ${line(r)}. Fresh checker: ${freshWord[r.fresh?.state] || 'not run yet'}.`) : ['- none']),
    '',
    `## Blocked by the checker (${blocked.length})`,
    ...(blocked.length ? blocked.map(r => `- ${line(r)}: ${r.check.problems.join(' ')}`) : ['- none']),
    '',
    `## Waiting on the founder (${esc.length})`,
    ...(esc.length ? esc.map(r => `- ${line(r)}: ${r.escalation.why}`) : ['- none']),
    '',
    `## Help-doc edits proposed (${edits.length})`,
    ...(edits.length ? edits.map(r => `- ${r.docEdit.article}: ${r.docEdit.kind === 'new' ? `new entry "${r.docEdit.heading}"` : 'change an example'}`) : ['- none']),
    '',
    '## Next step',
    next,
    '',
  ].join('\n');
}

// What broke overnight: failed posts in the last 24 hours, each explained. Read-only.
export async function morning(desk, { now = desk.now ? desk.now() : Date.now() } = {}) {
  const since = new Date(now - 864e5).toISOString();
  let failed = [];
  let error = null;
  try { failed = await listPosts(desk.client, { since, until: new Date(now).toISOString(), status: ['failed'] }); }
  catch (e) { error = e.message; }
  const lines = [
    `# Morning note: what broke overnight (${new Date(now).toDateString()})`,
    '',
    desk.mock ? '(Sample data, no account connected.)' : '',
    error ? `I could not read the post list: ${error}` : failed.length ? `${failed.length} post${failed.length === 1 ? '' : 's'} failed in the last 24 hours.` : 'Nothing failed in the last 24 hours.',
    '',
    ...failed.map(f => { const x = explain(f.state?.errorMessage); return `- ${nice(f.platform)}, ${new Date(f.postTime).toUTCString().replace(' GMT', ' UTC')}: ${x.title}.\n  Exact error: "${x.raw}"\n  Next: ${x.next}\n  Source: ${x.source}`; }),
    '',
    `Problems on file: ${readFailures(desk.paths.failures).length}. Last shift: HANDOFF.md.`,
    '',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === ''));
  fs.writeFileSync(desk.paths.morning, lines.join('\n'));
  desk.logger.write({ action: 'morning', ok: !error, failed: failed.length, error: error || undefined });
  return { failed, error, text: lines.join('\n') };
}

// Read every page in Blotato's help index into the cache, politely: one page at a time, a short pause between
// pages, and a stop after several errors in a row. Only getPage is used. Pages already cached are skipped
// unless refresh is set.
export async function cacheAllDocs(desk, { refresh = false, pauseMs = 400, maxErrorsInRow = 5, urls, onPage = () => {} } = {}) {
  const { readHelpIndex } = await import('./docs.mjs');
  const list = urls || await readHelpIndex();
  const out = { total: list.length, cached: 0, skipped: 0, failed: [], stopped: false };
  let inRow = 0;
  for (const u of list) {
    if (!refresh && desk.docs.readCache(u)) { out.skipped++; onPage({ url: u, ok: true, skipped: true }); continue; }
    const before = desk.docs.readCache(u)?.fetchedAt;
    const p = await desk.docs.getPage(u, { refresh: true });
    const ok = !!p && p.fetchedAt !== before;
    if (ok) { out.cached++; inRow = 0; } else { out.failed.push(u); inRow++; }
    onPage({ url: u, ok, via: p?.via });
    if (inRow >= maxErrorsInRow) { out.stopped = true; break; }
    await new Promise(r => setTimeout(r, pauseMs));
  }
  return out;
}

// Refresh every page the playbook cites, through the docs MCP server.
export async function refreshDocs(desk) {
  const urls = new Set();
  for (const e of PLAYBOOK) for (const u of citedPages(e)) urls.add(u);
  const out = [];
  for (const u of urls) { const p = await desk.docs.getPage(u, { refresh: true }); out.push({ url: u, ok: !!p, via: p?.via, fetchedAt: p?.fetchedAt }); }
  return out;
}
