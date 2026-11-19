// The n8n flow in examples/n8n is a file people import, so its wiring and its expressions are checked here:
// every connection names a real node, and its steps, run against a real (mock) desk, give the right answer
// for a ticket the desk replies to and for one it hands to a person. This does not run n8n itself; it was run in
// real n8n 2.48.5 on 2026-11-18 (that run found the localhost and no-answer problems these tests now guard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from '../src/server.mjs';
import { tempDesk } from './helpers.mjs';

const flow = JSON.parse(fs.readFileSync('examples/n8n/second-read.workflow.json', 'utf8'));
const node = (name) => flow.nodes.find(n => n.name === name);
// n8n expressions are "={{ js }}"; this runs the same js with $json bound, as n8n does for these simple ones.
// The IF node's rule, as n8n reads it: string equals / notEquals / notStartsWith, joined by "and" or "or".
const OPS = { equals: (a, b) => a === b, notEquals: (a, b) => a !== b, notStartsWith: (a, b) => !String(a ?? '').startsWith(b) };
const needsPerson = ($json) => {
  const c = node('Needs a person?').parameters.conditions;
  const hits = c.conditions.map(x => { const op = OPS[x.operator.operation]; assert.ok(op, x.operator.operation); return op(run(x.leftValue, $json), x.rightValue); });
  return c.combinator === 'or' ? hits.some(Boolean) : hits.every(Boolean);
};
const run = (expr, $json) => { const m = /^=\{\{([\s\S]*)\}\}$/.exec(expr); assert.ok(m, `not an expression: ${expr}`); return new Function('$json', `return (${m[1]});`)($json); };

test('n8n flow: every connection points at a node that exists, and the webhook answers through a respond node', () => {
  const names = new Set(flow.nodes.map(n => n.name));
  for (const [from, c] of Object.entries(flow.connections)) {
    assert.ok(names.has(from), from);
    for (const branch of c.main) for (const to of branch) assert.ok(names.has(to.node), to.node);
  }
  assert.equal(node('Support message in').parameters.responseMode, 'responseNode');
  assert.equal(flow.nodes.filter(n => n.type === 'n8n-nodes-base.respondToWebhook').length, 2);
  assert.ok(!flow.nodes.some(n => /blotato\.com|gmail|slack|email|send/i.test(n.type)), 'the flow must not send anything itself');
  // Newer n8n (Node 17+) looks up "localhost" as ::1, and Second Read listens on 127.0.0.1: the call is refused.
  assert.match(node('Ask Second Read').parameters.url, /^http:\/\/127\.0\.0\.1:5610\//);
});

test('n8n flow: only a reply the fresh checker passed is a plain draft; everything else goes to a person', () => {
  const cleared = 'reply: cleared to send (the fresh checker passed this exact text)';
  assert.equal(needsPerson({ outcome: 'reply', status: cleared }), false);
  assert.equal(needsPerson({ outcome: 'escalate', status: cleared + ' + escalated' }), true);
  assert.equal(needsPerson({ outcome: 'no-answer', status: 'holding reply: cleared to send (x) + escalated' }), true);
  assert.equal(needsPerson({ outcome: 'no-answer', status: 'refused: no documented answer', reply: null }), true);
  assert.equal(needsPerson({ outcome: 'reply', status: 'blocked' }), true);
  assert.equal(needsPerson({ outcome: 'reply', status: 'blocked: the fresh checker stopped this exact text (a saved example)' }), true);
  assert.equal(needsPerson({ outcome: 'reply', status: 'reply: script check passed, waiting on the fresh check' }), true);
  assert.equal(needsPerson({ outcome: 'reply', status: 'composed reply: the script checks and the second reader passed it just now (not a saved, pre-checked reply)' }), true, 'a composed reply has no fresh-checker pass (AGENTS.md)');
  assert.equal(needsPerson({}), true);
  const noDraft = JSON.parse(run(node('Hand over to a person').parameters.responseBody, { outcome: 'no-answer', reply: null, escalationText: '## Escalation', status: 'refused: no documented answer' }));
  assert.equal(noDraft.draftReply, null);
  assert.match(noDraft.note, /No draft/);
  assert.equal(noDraft.handover, '## Escalation');
  // The note never offers a draft as a holding reply unless the fresh checker cleared it (AGENTS.md).
  const noteFor = ($json) => JSON.parse(run(node('Hand over to a person').parameters.responseBody, $json)).note;
  const esc = '## Escalation';
  assert.match(noteFor({ reply: 'Hi', escalationText: esc, status: 'reply: cleared to send (x) + escalated' }), /may send the draft as a holding reply. Pass the hand-over note on/);
  assert.match(noteFor({ reply: 'Hi', escalationText: esc, status: 'holding reply: cleared to send (x) + escalated' }), /holding reply/);
  for (const status of ['reply: script check passed, waiting on the fresh check + escalated', 'blocked', 'blocked: the fresh checker stopped this exact text (a saved example)', 'composed reply: the script checks and the second reader passed it just now (not a saved, pre-checked reply); a saved fresh-checker pass is required and a composed text has none, so it is not cleared to send', 'composed reply: the script checks and the second reader passed it just now (not a saved, pre-checked reply)']) {
    for (const escalationText of [esc, '']) {
      const note = noteFor({ reply: 'Hi', escalationText, status });
      assert.doesNotMatch(note, /may send/, status);
      assert.match(note, /^Do not send this draft/, status);
      assert.equal(/hand-over note/.test(note), !!escalationText, status);
    }
  }
});

test('n8n flow: run against the desk, an unchecked how-to, a billing ticket and an off-topic one all reach a person', async () => {
  const { env } = tempDesk();
  const server = createServer({ env });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const flowFor = async (text) => {
      const ask = node('Ask Second Read').parameters;
      const body = run(ask.jsonBody, { body: { text } });
      const url = ask.url.replace('http://127.0.0.1:5610', base);
      assert.ok(url.startsWith(base), url);
      const res = await fetch(url, { method: ask.method, headers: { 'content-type': 'application/json' }, body });
      assert.equal(res.status, 200);
      const desk = await res.json();
      const toPerson = needsPerson(desk);
      const out = JSON.parse(run(node(toPerson ? 'Hand over to a person' : 'Draft reply').parameters.responseBody, desk));
      return { desk, toPerson, out };
    };
    // This temporary desk holds no fresh-checker passes, so its how-to reply is "waiting on the fresh check": it
    // goes to a person with the draft, never back as a plain draft. (The cleared path is the rule test above, and the
    // real n8n run on 2026-11-18, where saved passes exist.)
    const howTo = await flowFor('How do I connect my TikTok account?');
    assert.equal(howTo.desk.outcome, 'reply');
    assert.doesNotMatch(howTo.desk.status, /^reply: cleared to send/);
    assert.equal(howTo.toPerson, true);
    assert.equal(howTo.out.outcome, 'reply');
    assert.ok(howTo.out.draftReply.includes('help.blotato.com'), howTo.out.draftReply);
    assert.match(howTo.out.note, /^Do not send this draft yet/);

    const billing = await flowFor('I was charged twice this month, please refund one of them.');
    assert.equal(billing.toPerson, true);
    assert.equal(billing.out.outcome, 'escalate');
    assert.ok(billing.out.handover.startsWith('## Escalation'), billing.out.handover);
    assert.ok(billing.out.draftReply.length > 40);
    // No saved passes on this desk, so the billing draft is unchecked: the note must not offer it as a holding reply.
    assert.doesNotMatch(billing.desk.status, /cleared to send/);
    assert.match(billing.out.note, /^Do not send this draft yet.*hand-over note/);

    const offTopic = await flowFor("What's your favorite pizza topping?");
    assert.equal(offTopic.toPerson, true);
    assert.equal(offTopic.out.outcome, 'no-answer');
    assert.equal(offTopic.out.draftReply, null);
    assert.ok(offTopic.out.handover.startsWith('## Escalation'), offTopic.out.handover);
  } finally { server.close(); }
});
