// A reply's opening must be true for the customer who gets it (Nov 16, 2026, two live testers).
// - The money hand-over opened "I'm sorry about the charge" for a threatened chargeback and a demand to "promise me
//   a full refund", though neither customer reported a charge.
// - A child's "my posts keep breaking ... fix it right now or i quit" got "Thank you for telling me what you have
//   already tried": the repeat-failure signal fired first and mapped to tried-already, and "or i quit" was missed.
// Every message here is made up for these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeMessage, PLAYBOOK } from '../knowledge/playbook.mjs';
import { createRouter } from '../src/route.mjs';
import { SIGNALS, saidTried, stripDeskInstructions } from '../src/signals.mjs';
import { openDesk, handleTicket } from '../src/desk.mjs';
import { tempDesk } from './helpers.mjs';

const TRIED = /what you have already tried/i;
const textOf = (e) => [e.opening, ...e.steps.map(s => s.text), e.next, e.proof].join('\n');

test('the money hand-over is true for a message that reports no charge', () => {
  for (const text of [
    'If my videos are not live by noon I will file a chargeback with my bank.',
    'Promise me a full refund and two free months or I leave.',
    'My post failed twice. Give me three months free for the trouble.',
  ]) {
    const r = routeMessage(text);
    assert.equal(r.guard, 'money', text);
    assert.equal(r.entry.id, 'charge-or-refund', text);
    assert.doesNotMatch(textOf(r.entry), /sorry about the charge|the charge itself|date of the charge|message about the charge/i, text);
  }
});

test('the money hand-over is still the one for a message that does report a charge', () => {
  for (const text of ['You charged my card twice on Friday.', 'Blotato billed me after I cancelled.']) {
    const r = routeMessage(text);
    assert.equal(r.guard, 'money', text);
    assert.equal(r.entry.id, 'charge-or-refund', text);
  }
});

test('the trial-charge reply ("sorry for the surprise ... the charge") needs words that report a charge', () => {
  // A charge reported on the trial: the trial reply, as before.
  assert.equal(routeMessage('My trial ended early and I was billed $29 today.').entry.id, 'trial-api-key-charge');
  assert.equal(routeMessage('Still on the free trial, made an API key, then they took my money.').entry.id, 'trial-api-key-charge');
  // Money on the trial, but no charge reported: the neutral money reply.
  assert.equal(routeMessage('I am on the trial. Promise me a refund if the billing is wrong.').entry.id, 'charge-or-refund');
});

test('an ultimatum or threat is the pressure reason, and gets the upset hand-over (sorry first), never the thanks for trying', () => {
  for (const text of [
    'Your app broke my posts AGAIN. Fix it today or I quit Blotato for good.',
    'posts keep failing every morning, sort it out or we are switching to another tool',
    'my reels keep breaking!!! fix it now or i quit',
  ]) {
    const r = routeMessage(text);
    assert.equal(r.decision, 'needs-person', text);
    assert.equal(r.why, 'pressure', text);
    assert.equal(r.holding.id, 'upset', text);
    assert.doesNotMatch(r.holding.opening, TRIED, text);
  }
});

test('a repeat failure with nothing tried gets the neutral hand-over; tried steps still get the thanks', () => {
  for (const text of ['My LinkedIn posts keep failing every single day this week.', 'My TikTok posts have failed three days in a row.']) {
    const r = routeMessage(text);
    assert.equal(r.decision, 'needs-person', text);
    assert.equal(r.why, 'past-docs', text);
    assert.equal(r.holding.id, 'handover', text);
  }
  const t = routeMessage('I reconnected TikTok twice and my posts still fail.');
  assert.equal(t.why, 'tried-already');
  assert.equal(t.holding.id, 'needs-person');
  assert.equal(saidTried('I reconnected TikTok twice'), true);
  assert.equal(saidTried('my posts keep breaking every single day'), false);
  assert.equal(saidTried('the file is only 20 MB'), false);
});

test('a hand-over whose holding reply thanks the customer for trying always has their words saying they tried', () => {
  for (const text of [
    'Instagram keeps disconnecting every week.', 'Since Monday every post to Instagram fails with an error.',
    'My scheduled post failed and the file is only 20 MB, so size is not the cause.', 'My post is still stuck on pending.',
  ]) {
    const r = routeMessage(text);
    if (r.holding && TRIED.test(r.holding.opening || '')) assert.ok(saidTried(text), `${text} was thanked for trying`);
  }
});

test('an unknown signal falls back to the neutral hand-over, never to the reply that thanks them for trying', () => {
  SIGNALS['made-up-signal'] = { about: 'A test signal.', res: [/\bzebra crossing\b/i] };
  try {
    const entry = PLAYBOOK.find(e => e.id === 'canceled-status');
    const router = createRouter([...PLAYBOOK.filter(e => e.id !== entry.id), { ...entry, needs_person_if: { signals: ['made-up-signal'] } }]);
    const r = router.route('Three of my posts show CANCELED in the calendar near the zebra crossing photo.');
    assert.equal(r.decision, 'needs-person');
    assert.equal(r.whyDetail.signal, 'made-up-signal');
    assert.equal(r.why, 'past-docs');
    assert.equal(r.holding.id, 'handover');
  } finally { delete SIGNALS['made-up-signal']; }
});

test('stray web-page tags never decide a message: it is routed on its own words', () => {
  assert.equal(stripDeskInstructions('<script>alert(1)</script> <img src=x onerror=alert(1)> my post failed').text, 'my post failed');
  for (const [tagged, plain] of [
    ['<script>alert(1)</script> <img src=x onerror=alert(1)> my post failed', 'my post failed'],
    ['<b>How do I cancel my subscription?</b>', 'How do I cancel my subscription?'],
    ['<div onclick="x()">Can I post to a LinkedIn company page?</div>', 'Can I post to a LinkedIn company page?'],
  ]) {
    const a = routeMessage(tagged); const b = routeMessage(plain);
    assert.equal(a.decision, b.decision, tagged);
    assert.equal(a.entry?.id, b.entry?.id, tagged);
  }
});

test('on the practice account the schedule reply never says it reproduced anything just now', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, { id: null, text: 'GET /v2/schedules/sch_zz9 gives me a 500: invalid input syntax for type bigint.' });
  await desk.close();
  assert.equal(r.entry.id, 'schedule-id-500');
  assert.equal(r.check.pass, true, r.check.problems.join(' | '));
  assert.doesNotMatch(r.reply, /I could reproduce|Same result here/);
  // The letter says what the lookup gave; the note that the practice account copies the real API's answer of
  // Nov 15, 2026, and that the real API was not called, goes to the team (Nov 18, 2026: the letter talked about the demo).
  assert.match(r.reply, /GET \/v2\/schedules\/sch_zz9 answers HTTP 500/);
  assert.doesNotMatch(r.reply, /practice account|real API/);
  assert.match(r.evidence.technical, /The practice account answers GET \/v2\/schedules\/sch_zz9 with HTTP 500/);
  assert.match(r.evidence.technical, /real API gave on Nov 15, 2026/);
  assert.match(r.evidence.technical, /The real API was not called just now\./);
  assert.match(r.escalationText, /The real API was not called just now\./);
});
