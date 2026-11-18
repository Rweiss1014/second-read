// Regressions from the round-2 manager review of the public preview (Nov 18, 2026). Every message here is the
// tester's own made-up message or was written for these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDesk } from './helpers.mjs';
import { openDesk, handleTicket } from '../src/desk.mjs';
import { routeMessage, PLAYBOOK, TICKETS } from '../knowledge/playbook.mjs';
import { reportsProblem, problemPremise, holdingFor } from '../src/route.mjs';
import { askedWillStill } from '../src/signals.mjs';
import { fromNow, moneySorry } from '../src/diagnose.mjs';
import { defaultChecksDir } from '../src/checkreply.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const checksDir = defaultChecksDir({});
const answered = (r) => r.decision === 'answer' || r.decision === 'partial';

test('1. an entry that starts from a reported problem never answers a plain question that reports none', () => {
  const rate = PLAYBOOK.find(e => e.id === 'rate-limit');
  assert.ok(problemPremise(rate), 'the rate-limit reply starts from a failing workflow');
  for (const text of ['How many API calls can I make per minute?', 'What is the rate limit for publishing?', 'How many posts can I send per minute through the API?']) {
    assert.equal(reportsProblem(text), false, text);
    const r = routeMessage(text);
    assert.ok(!(answered(r) && r.entry?.id === 'rate-limit'), `${text} -> ${r.entry?.id}`);
  }
  // A customer who reports the error still gets the fix.
  for (const text of ["My n8n workflow posts 50 videos at once and half of them fail with 'The service is receiving too many requests from you'.", 'my workflow fails with 429']) {
    assert.ok(reportsProblem(text), text);
    assert.equal(routeMessage(text).entry?.id, 'rate-limit', text);
  }
  // The premise is read from what the reply says, not from the help page it cites: an informational answer that
  // cites an errors page ("How many pins can I post to Pinterest in 24 hours") is not a problem premise.
  assert.equal(problemPremise(PLAYBOOK.find(e => e.id === 'pinterest-daily-limit')), false);
  // The reader is held to the same rule: a premise gap is hard.
  assert.match(fs.readFileSync(path.join(root, 'src', 'route.mjs'), 'utf8'), /gaps\.push\(\{ kind: 'premise', term: 'no problem reported', hard: true/);
});

test('2. "still go out?" asks about the future: no failure signal, and a hand-over for a plain question never asks for an error', async () => {
  const text = 'If my free trial ends without me paying, do my scheduled posts still go out?';
  assert.ok(askedWillStill(text, text.indexOf('still')));
  const r = routeMessage(text);
  assert.notEqual(r.decision, 'needs-person', r.reason);
  assert.ok(!(r.signals || []).some(h => h.signal === 'still-broken'));
  // A real "still" failure still counts.
  for (const t of ['I reconnected and it still fails.', 'I fixed the key and it still says 401', 'Why does it still fail?']) assert.equal(askedWillStill(t, t.indexOf('still')), false, t);
  // The hand-over letter fits the message: a plain question gets the question form, with no "exact error".
  assert.equal(holdingFor('past-docs', 'Can I move my posts to another workspace?'), 'handover-question');
  assert.equal(holdingFor('past-docs', 'My post failed again and the page shows connected.'), 'handover');
  assert.equal(holdingFor('pressure', 'Answer me today or I am leaving: can I move my posts to another workspace?'), 'upset-question');
  assert.equal(holdingFor('pressure', "This is the third time your garbage app failed to post my reels. Fix it or I'm leaving."), 'upset');
  for (const id of ['handover-question', 'upset-question']) {
    const e = PLAYBOOK.find(x => x.id === id);
    assert.doesNotMatch([e.opening, e.next, e.proof].join(' '), /exact error|the time it happened/i, id);
  }
  // A hand-over is never shown as the answer: its own title, its own line under the stamp, and a note that agrees.
  assert.match(appJs, /r\.outcome === 'no-answer' \|\| r\.handover \? 'Here is a reply for now'/);
  assert.match(appJs, /st === 'checked' && r\.handover \? 'Checked\. Safe to send\. It hands the question to a person; it is not the answer\.'/);
  assert.match(appJs, /r\.handover \? '<p><b>What I think it is\.<\/b> Not known yet\. The customer gets a checked letter that hands this to you\./);
  const { env } = tempDesk();
  const desk = openDesk({ env });
  try {
    const d = await handleTicket(desk, { id: null, text: "This is the third time your garbage app failed to post my reels. Fix it or I'm leaving." });
    assert.equal(d.handover, true);
    // The note names the one trigger that fired, in plain words, with no capital after a colon.
    assert.match(d.escalation.why, /^A person needs to take this\. The customer says they will leave or cancel unless it is fixed\./);
    assert.doesNotMatch(d.escalation.why, /threat|legal action/);
  } finally { await desk.close(); }
});

test('3. the line about account facts names the step they are really in', () => {
  assert.match(appJs, /The facts in step \$\{Math\.max\(1, \(r\.steps \|\| \[\]\)\.findIndex\(s => s\.type === 'evidence'\) \+ 1\)\}/);
  assert.doesNotMatch(appJs, /The facts in step 1 come/);
});

test('4. on the public site the practice account says the same words every hour, and the shown replies have exact-text passes', async () => {
  // Times are said from now, so the words do not change with the visitor's hour.
  const now = Date.parse('2026-11-18T20:00:00Z');
  assert.equal(fromNow('2026-11-21T20:00:00Z', now), '3 days from now');
  assert.equal(fromNow('2026-11-18T15:00:00Z', now), '5 hours ago');
  assert.equal(fromNow('2026-11-18T19:00:00Z', now), '1 hour ago');
  const run = async (text) => {
    const { env } = tempDesk();
    const desk = openDesk({ env: { ...env, SUPPORT_DESK_MOCK_CLOCK: 'now', SUPPORT_CHECKS_DIR: checksDir } });
    try { return await handleTicket(desk, { id: null, text }); } finally { await desk.close(); }
  };
  // Every reply with account facts that the page offers as an example: checked as these exact words (no slot), so
  // the checker's notes are about the very facts on the screen.
  for (const id of ['T01', 'T09', 'T11']) {
    const t = TICKETS.find(x => x.id === id);
    const r = await run(t.text);
    assert.equal(r.fresh?.state, 'passed', `${id}: ${r.fresh?.state}`);
    assert.equal(r.fresh?.scope, undefined, `${id} is checked as exact words, not as words with a slot`);
  }
  for (const text of ["Blotato says my post is published but I can't see it on Instagram.", 'Did my posts go out?']) {
    const r = await run(text);
    assert.equal(r.fresh?.state, 'passed', text);
    assert.equal(r.fresh?.scope, undefined, text);
  }
  // A words-only pass shows the words the checker read (with the slot), apart from what Copy gives.
  assert.match(appJs, /The words the checker read, with \$\{f\.filled === 'slot' \? 'the fixed-list part' : 'the account facts'\} as a slot/);
});

test('quick fixes: shown code, resolved notes, list numbers, stopped heading, letter equals copy, money sorry', async () => {
  assert.match(appJs, /'docs-silent': 'no-saved-answer'/);
  assert.match(appJs, /<ul class="calls nonum">\$\{steps\}<\/ul>/);
  assert.match(appJs, /The exact text the checker read \(stopped, so Copy is off\)/);
  // The letter keeps every character of the reply: no quote marks dropped, no dates rewritten.
  assert.match(appJs, /function letterText\(s\) \{\n\s*return termify\(esc\(String\(s \?\? ''\)\), \{ keepQuotes: true \}\)/);
  // The bigint letter carries the message as Blotato gave it, never inside a second pair of quotes.
  const { env } = tempDesk();
  const desk = openDesk({ env });
  try {
    const d = await handleTicket(desk, TICKETS.find(t => t.id === 'T11'));
    assert.match(d.reply, /answers HTTP 500, with the message: invalid input syntax for type bigint: "sch_abc123"\./);
    assert.doesNotMatch(d.reply, /""|:\s*"[^"\n]*"[^"\n]*""/);
    // The published-post letter never holds the practice-account sentence or a post id.
    const p = await handleTicket(desk, TICKETS.find(t => t.id === 'T01'));
    assert.doesNotMatch(p.reply, /practice account|made-up|\(post \d+\)/i);
  } finally { await desk.close(); }
  assert.equal(moneySorry('I canceled my plan last month but you charged me again. I want a refund.'), "I'm sorry you were charged when you did not expect it.");
  assert.equal(moneySorry('I upgraded yesterday and got charged the full price.'), "I'm sorry this charge was not what you expected.");
  assert.equal(moneySorry('Can I get a refund if I forgot to cancel before my renewal yesterday?'), "I'm sorry this charge was not what you expected.");
  assert.equal(moneySorry('Do you offer refunds?'), null);
  // The sandbox note says what this run did, and labels the Nov 15 live search as an earlier check.
  const sb = PLAYBOOK.find(e => e.id === 'sandbox-question');
  assert.doesNotMatch(JSON.stringify(sb), /live docs search found none on Nov 15/);
  assert.match(sb.escalate.why, /An earlier check, on Nov 15, 2026/);
});
