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

// The retry rule (Nov 15, 2026, second round of checker blocks): five replies told the customer to retry after
// checking only Blotato's own Posts lists, when the first attempt may already be live on the platform.
import { checkReply, findUncheckedRetries, retryInstruction } from '../src/checkreply.mjs';
import { validateShape } from '../src/entries.mjs';

const PS = 'https://help.blotato.com/start-with-an-ai-agent/publishing-status';
const psPage = { url: PS, fetchedAt: '2026-11-15T15:00:00.000Z', via: 'test', text: 'Check the Scheduled, Published, and Failed filters in Posts for the same destination and content. Open any returned platform URL and check the intended account on the platform. Retry a temporary failure only after checking for an existing post. Do not submit a replacement while the original outcome is unknown.' };
const f = (text, quote) => ({ type: 'fact', text, cite: { url: PS, quote } });
const LISTS = f('Check the Scheduled, Published and Failed filters in Posts for this post.', 'Check the Scheduled, Published, and Failed filters in Posts for the same destination and content.');
const PLATFORM = f('Open the post on the platform and check the account it was meant for.', 'Open any returned platform URL and check the intended account on the platform.');
const RETRY_LATER = f('If the post is not there, retry it.', 'Retry a temporary failure only after checking for an existing post.');
function reply(steps, next = 'Look for the post first.') {
  const text = ['Hi,', '', ...steps.map((s, i) => `${i + 1}. ${s.text}`), '', `Next step: ${next}`, 'You will know it worked when the post shows once.', `Help page: ${PS}`].join('\n');
  return { ticket: { id: 'R', text: 'x' }, steps, next, reply: text, pages: { [PS]: psPage }, evidence: null };
}
const lines = (steps, next = 'Look for the post first.') => [...steps.map((t, i) => ({ name: `step ${i + 1}`, text: t, step: true })), { name: 'next', text: next }];

test('retry rule: a retry after checking only Blotato\'s lists blocks the reply', () => {
  const r = checkReply(reply([LISTS, RETRY_LATER, f('Do not send a copy yet.', 'Do not submit a replacement while the original outcome is unknown.')]), { checksDir: null });
  assert.equal(r.pass, false);
  assert.match(r.problems.join(' '), /check the platform itself/);
  // The same retry in the Next step line, too.
  const n = checkReply(reply([LISTS, f('Do not send a copy yet.', 'Do not submit a replacement while the original outcome is unknown.'), LISTS], 'If it is not under Published, retry it from Posts > Failed.'), { checksDir: null });
  assert.match(n.problems.join(' '), /Next step: If it is not under Published, retry it/);
});

test('retry rule: a retry passes once an earlier step has the customer check the platform itself', () => {
  const r = checkReply(reply([LISTS, PLATFORM, RETRY_LATER], 'If the post is not on the platform, retry it from Posts > Failed.'), { checksDir: null });
  assert.equal(r.pass, true, r.problems.join(' | '));
  // A later platform check does not make an earlier retry safe.
  assert.equal(findUncheckedRetries(lines(['Retry it now.', 'Check your Instagram account for the post.'])).length, 1);
  // The same sentence may check first: "Check your TikTok account, and if it is not there, retry."
  assert.equal(findUncheckedRetries(lines(['Check your TikTok account for the post, and if it is not there, retry from Posts > Failed.'])).length, 0);
  // An earlier sentence of the same line counts too, but a check after the retry never does.
  assert.equal(findUncheckedRetries(lines(['Check your TikTok account for the post. If it is not there, retry from Posts > Failed.'])).length, 0);
  assert.equal(findUncheckedRetries(lines(['If it is not under Published, retry it. Then check your TikTok account.'])).length, 1);
});

test('retry rule: these are retry instructions', () => {
  for (const s of ['If the post is not there, retry it.', 'Wait a few minutes and try again.', 'Before you post it again, check the Failed filter.', 'Resend the request.',
    'Shorten the text, then retry.', 'Wait 24 hours and try again.', 'Add the field, then send it again.', 'Repost it from the Failed tab.', 'Publish the pin again.'])
    assert.ok(retryInstruction(s), s);
});

test('retry rule: a "don\'t", a noun, Blotato\'s own retries and a non-post retry are not retry instructions', () => {
  for (const s of ['Please do not post it again yet.', 'Blotato retries the post 2 times.', 'Blotato exhausted its retry loop.', 'A resend can make a copy.',
    'Sending it again unchanged often fails the same way.', 'Retrying the same media without changes will not help.', 'Retry the authorization from Accounts.',
    'After you reconnect it, publish the automation again.', 'For a read, retry after a delay.', 'Do not retry checkout.', 'Space out your posts instead of retrying in a rapid loop.'])
    assert.equal(retryInstruction(s), null, s);
});

test('retry rule: check-entries runs it on every entry, holding replies included', () => {
  const entry = { id: 'x-retry', kind: 'technical', title: 'X', phrasings: ['a b', 'c d', 'e f', 'g h', 'i j'], needs_person_if: { signals: ['tried-steps'] },
    opening: 'Hello.', steps: [LISTS, RETRY_LATER, PLATFORM], next: 'Look first.', proof: 'You will know it worked when the post shows once.' };
  assert.match(validateShape([entry]).join(' '), /x-retry, step 2: tells the customer to retry/);
  assert.doesNotMatch(validateShape([{ ...entry, steps: [LISTS, PLATFORM, RETRY_LATER] }]).join(' '), /tells the customer to retry/);
});
