// The support desk: one ticket at a time, a whole shift, and the morning note.
import fs from 'node:fs';
import { deskPaths, isMock } from './config.mjs';
import { loadKey } from './env.mjs';
import { createLogger, newRunId } from './log.mjs';
import { createClient, listPosts } from './api.mjs';
import { createDocs } from './docs.mjs';
import { diagnose, renderEscalation, renderDocEdit, nice } from './diagnose.mjs';
import { checkReply, freshState } from './checkreply.mjs';
import { readFailures, recordFailure, ensureFailuresFile, unknownId } from './failures.mjs';
import { explain } from './explain.mjs';
import { matchEntry, TICKETS, PLAYBOOK } from '../knowledge/playbook.mjs';

export function openDesk({ env = process.env, run = newRunId(), fetchImpl, mockApi } = {}) {
  const paths = deskPaths(env);
  fs.mkdirSync(paths.dir, { recursive: true });
  ensureFailuresFile(paths.failures);
  const mock = isMock(env);
  const logger = createLogger({ dir: paths.logs, run, key: mock ? undefined : loadKey({ env }), mock });
  const client = createClient({ env, logger, fetchImpl, mockApi });
  const docs = createDocs({ cacheDir: paths.docsCache, env, logger, fetchImpl });
  return { env, paths, mock, logger, client, docs, run, agent: env.SUPPORT_AGENT_NAME || 'Support', close: () => docs.close() };
}

// The words that triggered the match (an error string, a status), so known-failures records the error, not the customer.
function signal(entry, text) {
  for (const re of [...(entry?.any || []), ...(entry?.all || [])]) { const m = text.match(re); if (m) return m[0]; }
  return '';
}

export async function handleTicket(desk, ticket, { requireReview = false } = {}) {
  const { paths, logger } = desk;
  logger.write({ action: 'ticket', ticket: ticket.id || 'pasted' });

  // 1. Known failures first.
  const known = readFailures(paths.failures);
  const entry = matchEntry(ticket.text);
  const seenBefore = entry ? known.filter(f => f.id === entry.id || f.id === `blocked-${entry.id}`) : known.filter(f => f.id === unknownId(ticket.text));

  // 2. Diagnose from the docs and the account, 3. check the reply.
  const d = await diagnose(ticket, desk);
  const check = checkReply(d, { reviewsDir: paths.reviews, requireReview });

  // 4. Mistakes teach: record what happened.
  let recorded;
  if (!entry) {
    recorded = recordFailure(paths.failures, { id: unknownId(ticket.text), title: 'A question the playbook could not answer', why: 'No playbook entry matched, so the desk wrote no reply. It ran a docs search for a person to read.', fix: 'Get the answer from the founder, add it to the help docs (see the proposed edit), then add a playbook entry.', source: 'docs MCP searchDocumentation' });
  } else if (!check.pass) {
    recorded = recordFailure(paths.failures, { id: `blocked-${entry.id}`, title: `A reply about "${entry.title}" was blocked`, why: check.problems[0], fix: 'Fix the playbook step or its citation, then run the ticket again. Never send the blocked version.' });
  } else {
    const src = entry.steps.find(s => s.cite)?.cite.url;
    recorded = recordFailure(paths.failures, { id: entry.id, title: entry.title, matched: signal(entry, ticket.text) || undefined, fix: `Answered with the "${entry.id}" playbook entry. Next step given to the customer: ${entry.next}`, source: src });
  }
  logger.write({ action: 'ticket-done', ticket: ticket.id || 'pasted', entry: entry?.id || null, outcome: d.outcome, checked: check.pass, ok: check.pass || !entry, error: check.pass ? undefined : check.problems[0] });

  // Two checkers. The script's check is above. The fresh checker's verdict (if any) is read from the saved copy.
  const fresh = check.pass ? freshState(paths.reviews, d) : null;
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
export async function morning(desk, { now = Date.now() } = {}) {
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

// Refresh every page the playbook cites, through the docs MCP server.
export async function refreshDocs(desk) {
  const urls = new Set();
  for (const e of PLAYBOOK) {
    for (const s of e.steps) if (s.cite) urls.add(s.cite.url);
    for (const c of [...(e.escalate?.causes || []), ...(e.escalate?.ruledOut || [])]) if (c?.cite) urls.add(c.cite.url);
    if (e.docEdit) urls.add(e.docEdit.article);
  }
  const out = [];
  for (const u of urls) { const p = await desk.docs.getPage(u, { refresh: true }); out.push({ url: u, ok: !!p, via: p?.via, fetchedAt: p?.fetchedAt }); }
  return out;
}
