// Regressions from two testers who used the free public site on Nov 18, 2026 (a hiring manager and a careful
// first-timer). Every message here was written for these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeMessage } from '../knowledge/playbook.mjs';
import { actionsAsked } from '../src/coverage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const answered = (r) => r.decision === 'answer' || r.decision === 'partial';

test('the action asked must be one the entry speaks about: connect is not schedule, upload is not "a post failed"', () => {
  for (const [m, wrong] of [
    ['How do I connect my TikTok account so I can schedule videos?', 'schedule-many-videos'],
    ['My YouTube video failed to upload', 'post-failed-no-error-text'],
    ['how can I hook up my instagram so I can schedule reels', 'schedule-many-videos'],
  ]) {
    const r = routeMessage(m);
    assert.ok(!(answered(r) && r.entry?.id === wrong), `${m} -> ${r.decision} ${r.entry?.id}`);
  }
  // The right entry still answers when the action is its own.
  const c = routeMessage('How do I connect my TikTok account?');
  assert.equal(c.decision, 'answer'); assert.equal(c.entry.id, 'connect-social-accounts');
  // A noun is not an action: "the connection" or "reconnect" asks nothing about connecting.
  assert.deepEqual(actionsAsked('is something broken with the connection, do I need to reconnect YouTube?'), []);
  assert.deepEqual(actionsAsked('How do I delete a scheduled post?'), ['delete']);
  assert.deepEqual(actionsAsked('my video failed to upload'), ['upload']);
});

test('no /s+/ regex anywhere: it strips every letter s ("the de k tru t matched")', () => {
  const bad = [];
  for (const dir of ['src', 'bin', 'knowledge', 'public', 'scripts', 'eval', 'netlify/functions']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (!/\.(m?js)$/.test(f)) continue;
      const text = fs.readFileSync(path.join(root, dir, f), 'utf8');
      if (/(^|[^\\a-z])\/s\+\/g/m.test(text)) bad.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the page never echoes the extracted item back, and says what really happened when only saved answers were checked', () => {
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /say nothing about/i);
  assert.match(app, /This demo has no checked answer for this one yet, so a person on the team will take it\./);
  assert.match(app, /'Checked its saved answers'/);
});

test('a money hand-over note says it is a billing question, quotes the customer, and never guesses a cause', async () => {
  const { tempDesk } = await import('./helpers.mjs');
  const { openDesk, handleTicket } = await import('../src/desk.mjs');
  const { env } = tempDesk();
  const desk = openDesk({ env });
  try {
    for (const text of ['I canceled my plan last month but you charged me again. I want a refund.', 'I was still on my free trial, I made an API key to try n8n, and now I\'ve been charged. Why?', 'you billed me twice for the upgrade']) {
      const r = await handleTicket(desk, { text });
      assert.equal(r.match?.why ?? r.route?.why, 'money', text);
      assert.equal(r.escalation.asked, text);
      assert.deepEqual(r.escalation.causes, [], text);
      assert.match(r.escalation.why, /billing question for a person/);
      assert.doesNotMatch(r.escalationText, /duplicate/i);
    }
  } finally { await desk.close(); }
});

test('a proof shows the row the answer is about, not the first place its sentence appears on the page', async () => {
  const { pageContext } = await import('../src/server.mjs');
  const page = { text: [
    '# Errors', '', '## Rate limits', '',
    '| Error | Fix |', '| --- | --- |',
    '| Exceeded rate limits | Wait an hour. Retry from Posts > Failed. |',
    '| Some other error | Check the account. |', '',
    '## TikTok', '',
    '| Error | Fix |', '| --- | --- |',
    '| Please update your TikTok app | Update the TikTok app on the phone. Retry from Posts > Failed. If it persists, reconnect TikTok. |',
  ].join('\n') };
  const q = 'Retry from Posts > Failed.';
  assert.match(pageContext(page, q).row.cells[0], /rate limits/i, 'with no hints, the first place, as before');
  const p = pageContext(page, q, ['Update the TikTok app on the phone.', 'TikTok: update the app']);
  assert.equal(p.heading, 'TikTok');
  assert.match(p.row.cells[0], /update your TikTok app/);
  assert.match(p.text.slice(p.mark[0] - 40, p.mark[1]), /phone\. Retry from Posts > Failed\./);
});

test('the page: list numbers are left out of proofs, and a checked money reply says a person takes the money part', () => {
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const m = app.match(/^const unlist = (.*);$/m);
  assert.ok(m, 'unlist is defined');
  const unlist = eval(m[1]);
  assert.equal(unlist('Open the AI Agent. 3. Select New draft. 4. Click Save.'), 'Open the AI Agent. Select New draft. Click Save.');
  assert.equal(unlist('Version 2.5 works. Wait 2 minutes.'), 'Version 2.5 works. Wait 2 minutes.');
  assert.match(app, /Checked\. Safe to send\. A person takes the money part\./);
});

test('a list number right before the lit sentence is left out too, and a sentence that ends in a number keeps it', () => {
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const unlist = eval(app.match(/^const unlist = (.*);$/m)[1]);
  const unlistBefore = eval(app.match(/^const unlistBefore = (.*);$/m)[1]); // direct eval: it sees unlist above
  assert.equal(unlistBefore('Go to Settings > Billing 2. ', 'Click "View Billing Portal"'), 'Go to Settings > Billing ');
  assert.equal(unlistBefore('The limit is 10. ', 'that is per day'), 'The limit is 10. ');
  assert.equal(unlist('The limit is 25.'), 'The limit is 25.');
});
