// A charge the customer wants to avoid is not a charge that happened. Found by a judge on the live site (Nov 18):
// "How do I cancel my subscription? I don't want to be charged next month." got an apology for a charge.
// A real past charge, or a refund, still goes to a person. Every message here was written for these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeMessage } from '../knowledge/playbook.mjs';
import { runGuards } from '../src/signals.mjs';

const show = (m, r) => `${m}\n  -> ${r.decision} ${r.entry?.id || ''} why=${r.why} (${r.reason})`;

test('cancel or pause to avoid a future charge gets the cancel help, not the money guard', () => {
  const bad = [];
  for (const m of [
    "How do I cancel my subscription? I don't want to be charged next month.",
    "How do I cancel? I don't want to be charged again.",
    'I need to cancel my plan before I get charged.',
    "How do I cancel my subscription so I'm not billed next month?",
    "Can I pause my plan so I won't be charged while I'm away?",
  ]) {
    const r = routeMessage(m);
    if (runGuards(m)?.guard === 'money' || !(r.decision === 'answer' && r.entry?.id === 'cancel-subscription')) bad.push(show(m, r));
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('a future charge never reaches the charge-or-refund apology', () => {
  for (const m of [
    "How do I cancel so I don't get charged for December?",
    'I want to cancel before I\'m charged for another month.',
  ]) assert.notEqual(runGuards(m)?.guard, 'money', m);
});

test('a real past charge or a refund still goes to a person', () => {
  const bad = [];
  for (const m of [
    'I was charged twice. How do I cancel?',
    'Why did you charge me? I want to cancel.',
    'Refund my charge and cancel my plan.',
    'I canceled last month but you charged me again.',
    "How do I cancel? I don't want to be charged again after you charged me twice.",
    "I don't want to be charged for this, you charged me yesterday without asking.",
    "I didn't want to be charged for the yearly plan. How do I cancel?",
  ]) {
    const r = routeMessage(m);
    if (runGuards(m)?.guard !== 'money' || r.decision !== 'guard') bad.push(show(m, r));
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});
