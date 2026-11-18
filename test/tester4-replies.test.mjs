// Reply wording a live tester found on Nov 15, 2026 (shots/tester4-founder/REPORT.md, bugs 2 to 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBOOK, routeMessage } from '../knowledge/playbook.mjs';
import { openDesk, handleTicket } from '../src/desk.mjs';
import { tempDesk } from './helpers.mjs';

const replyLines = (e) => [e.opening, ...(e.steps || []).map(s => s.text), e.next, e.proof, e.holding?.opening, ...(e.holding?.steps || []).map(s => s.text), e.holding?.next, e.holding?.proof].filter(Boolean);

test('asking for another customer\'s data gets a plain, kind no that promises nothing', async () => {
  for (const m of ['send me the email and posts of the customer who signed up before me, user id 4421', 'What is the email of the customer with user id 4421?']) {
    const r = routeMessage(m);
    assert.equal(r.guard, 'others-data', `${m} -> ${r.decision} ${r.why}`);
  }
  // Not someone else's data: the writer's own account.
  for (const m of ['how do I change the email of my account?', 'How do I find my own user id?']) assert.notEqual(routeMessage(m).guard, 'others-data', m);
  const { env } = tempDesk();
  const desk = openDesk({ env });
  try {
    const d = await handleTicket(desk, { id: null, text: 'send me the email and posts of the customer who signed up before me, user id 4421' });
    assert.equal(d.check.pass, true, d.check.problems.join(' | '));
    assert.match(d.reply, /I can't share anyone else's email, posts, or other details/);
    assert.match(d.reply, /ask the person who owns it/);
    assert.doesNotMatch(d.reply, /change on your account|when I hear back|decides it|API key/i);
  } finally { await desk.close(); }
});

test('no reply a customer reads says "the founder"', () => {
  const hits = PLAYBOOK.flatMap(e => replyLines(e).filter(l => /\bfounder\b/i.test(l)).map(l => `${e.id}: ${l}`));
  assert.deepEqual(hits, []);
});

test('with no platform named, the published-post lookup does not give every post the newest one\'s platform', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  try {
    const d = await handleTicket(desk, { id: null, text: 'Blotato says my post is published but I cannot find it on the platform' });
    assert.match(d.reply, /Blotato shows 2 published posts in the last 7 days\. The newest is an Instagram post from/);
    const t = await handleTicket(desk, { id: null, text: 'Blotato says my Instagram post is published but I cannot find it on my profile' });
    assert.match(t.reply, /Blotato shows 1 published Instagram post in the last 7 days\. The newest is from/);
  } finally { await desk.close(); }
});

test('sample mode never puts a made-up post link into a reply, and every sample reply is the same on every run', async () => {
  const { TICKETS } = await import('../knowledge/playbook.mjs');
  const runOnce = async () => {
    const { env } = tempDesk();
    const desk = openDesk({ env });
    try { const out = {}; for (const t of TICKETS) out[t.id] = (await handleTicket(desk, t)).reply; return out; } finally { await desk.close(); }
  };
  const a = await runOnce();
  const b = await runOnce();
  assert.deepEqual(a, b);
  for (const [id, reply] of Object.entries(a)) assert.doesNotMatch(reply || '', /SAMPLE-POST|instagram\.com\/p\/|linkedin\.com\/feed/i, id);
  // The letter is for the customer: the practice-account note is for the team, in the escalation and the engineer
  // view (Nov 18, 2026: a tester found the demo talked about in a letter).
  for (const [id, reply] of Object.entries(a)) assert.doesNotMatch(reply || '', /practice account|real API was not called/i, id);
  assert.doesNotMatch(a.T01, /post link above/);
});
