// The n8n flow in examples/n8n is a file people import, so its wiring and its expressions are checked here:
// every connection names a real node, and its steps, run against a real (mock) desk, give the right answer
// for a ticket the desk replies to and for one it hands to a person. This does not run n8n itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from '../src/server.mjs';
import { tempDesk } from './helpers.mjs';

const flow = JSON.parse(fs.readFileSync('examples/n8n/second-read.workflow.json', 'utf8'));
const node = (name) => flow.nodes.find(n => n.name === name);
// n8n expressions are "={{ js }}"; this runs the same js with $json bound, as n8n does for these simple ones.
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
});

test('n8n flow: run against the desk, a how-to gets a draft reply and a billing ticket is handed to a person', async () => {
  const { env } = tempDesk();
  const server = createServer({ env });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const flowFor = async (text) => {
      const ask = node('Ask Second Read').parameters;
      const body = run(ask.jsonBody, { body: { text } });
      const url = ask.url.replace('http://localhost:5610', base);
      const res = await fetch(url, { method: ask.method, headers: { 'content-type': 'application/json' }, body });
      assert.equal(res.status, 200);
      const desk = await res.json();
      const cond = node('Needs a person?').parameters.conditions.conditions[0];
      const toPerson = run(cond.leftValue, desk) === cond.rightValue;
      const out = JSON.parse(run(node(toPerson ? 'Hand over to a person' : 'Draft reply').parameters.responseBody, desk));
      return { desk, toPerson, out };
    };
    const howTo = await flowFor('How do I connect my TikTok account?');
    assert.equal(howTo.toPerson, false);
    assert.equal(howTo.out.outcome, howTo.desk.outcome);
    assert.ok(howTo.out.draftReply.includes('help.blotato.com'), howTo.out.draftReply);

    const billing = await flowFor('I was charged twice this month, please refund one of them.');
    assert.equal(billing.toPerson, true);
    assert.equal(billing.out.outcome, 'escalate');
    assert.ok(billing.out.handover.startsWith('## Escalation'), billing.out.handover);
    assert.ok(billing.out.draftReply.length > 40);
  } finally { server.close(); }
});
