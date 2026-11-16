// Tests added while fixing the replies a fresh checker blocked (Nov 15, 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GIVES_NUMBER } from '../src/signals.mjs';
import { routeMessage } from '../knowledge/playbook.mjs';

test('a numbered-list marker copied with a quote is not a number the entry gives', () => {
  for (const s of [
    "Open Posts > Scheduled. 2. Open the post's actions menu.",
    'Save a source from the AI Agent, not from the Sources page directly: 1. Open the source from the AI Agent sidebar.',
    'Wait for processing to finish. 6. Confirm the source appears in your Sources library.',
  ]) assert.equal(GIVES_NUMBER.test(s), false, s);
  for (const s of [
    'The limit is 25. Posts beyond that wait.',
    'You can add up to 10 images.',
    'Queued scheduled posts 200 1,000 3,000',
  ]) assert.equal(GIVES_NUMBER.test(s), true, s);
});

test('an entry whose quotes hold only list markers still hands over a question for a number', () => {
  for (const m of ['How many times can I reschedule the same post?', 'How many sources can I add to the Sources library?']) {
    const r = routeMessage(m);
    assert.notEqual(r.decision, 'answer', `${m} -> ${r.entry?.id}`);
  }
});
