import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReply } from '../src/checkreply.mjs';
import { normalizeText, quoteOnPage } from '../src/docs.mjs';

const URL = 'https://help.blotato.com/support/faqs';
const page = { url: URL, fetchedAt: '2026-11-15T15:00:00.000Z', via: 'test', text: 'No. CANCELED is a post status, not a publishing failure. Nothing went wrong on the social platform. If you meant the post to go out, open it and schedule it again.' };
const fact = (text, quote) => ({ type: 'fact', text, cite: { url: URL, quote } });

function draft(steps, { next = 'Open the post.', pages = { [URL]: page }, evidence = null, extra = '', proof = 'You will know it worked when it shows as scheduled.', link = `Help page: ${URL}` } = {}) {
  const reply = ['Hi,', '', ...steps.map((s, i) => `${i + 1}. ${s.text}`), '', `Next step: ${next}`, proof, link, extra].filter(l => l !== null).join('\n');
  return { ticket: { id: 'X', text: 'x' }, steps, next, reply, pages, evidence };
}
const good = [
  fact('CANCELED is a status, not a failure.', 'No. CANCELED is a post status, not a publishing failure.'),
  fact('Nothing went wrong on the platform.', 'Nothing went wrong on the social platform.'),
  fact('Open it and schedule it again.', 'If you meant the post to go out, open it and schedule it again.'),
];

test('a reply whose every fact is on the cited page passes', () => {
  const r = checkReply(draft(good));
  assert.equal(r.pass, true, r.problems.join(' | '));
  assert.equal(r.citations.length, 3);
  assert.ok(r.citations.every(c => c.found && c.fetchedAt));
});

test('a quote that is not on the page blocks the reply and says which step', () => {
  const steps = [...good.slice(0, 2), fact('You will get a refund.', 'Refunds are automatic.')];
  const r = checkReply(draft(steps));
  assert.equal(r.pass, false);
  assert.match(r.problems.join(' '), /Step 3 cites "Refunds are automatic\."/);
});

test('a fact with no source, a page that could not be read, or a failed lookup blocks the reply', () => {
  assert.match(checkReply(draft([...good.slice(0, 2), { type: 'fact', text: 'It is fixed now.' }])).problems.join(' '), /Step 3 states a fact with no source/);
  assert.match(checkReply(draft(good, { pages: {} })).problems.join(' '), /could not be read/);
  const ev = [...good.slice(0, 2), { type: 'evidence', text: 'I checked your account.' }];
  assert.match(checkReply(draft(ev, { evidence: { ok: false, summary: 'the lookup failed: HTTP 401' } })).problems.join(' '), /lookup that did not succeed/);
  assert.match(checkReply(draft(ev)).problems.join(' '), /no lookup was made/);
});

// The promise lines a reviewer tried by hand, plus the earlier ones. Each must be blocked on any kind of step.
const PROMISE_LINES = [
  'I promise this fixes it.', 'You will get a full refund.', "We'll have it fixed by Friday.",
  'Your refund will be processed today.', 'I will credit your account.',
  'We will refund you today.', 'This will be fixed by tomorrow.', 'I guarantee it posts.', 'It should be back within 2 hours.',
];
const promiseProblem = /promise|guarantee|refund or credit|outcome nobody has checked|date or time/;

test('promise check: blocks promise lines on an action step, a fact step and an evidence step', () => {
  for (const text of PROMISE_LINES) {
    const asAction = checkReply(draft([...good.slice(0, 2), { type: 'action', text }]));
    const asFact = checkReply(draft([...good.slice(0, 2), fact(text, 'Nothing went wrong on the social platform.')]));
    const asEvidence = checkReply(draft([...good.slice(0, 2), { type: 'evidence', text }], { evidence: { ok: true, summary: 'ok' } }));
    for (const [kind, r] of [['action', asAction], ['fact', asFact], ['evidence', asEvidence]]) {
      assert.equal(r.pass, false, `${kind}: ${text}`);
      assert.match(r.problems.join(' '), promiseProblem, `${kind}: ${text}`);
    }
  }
  // A fact step whose quote is real but whose words promise more: the reviewer's probe.
  const r = checkReply(draft([...good.slice(0, 2), fact('Nothing went wrong, and you will be refunded in 2 days.', 'Nothing went wrong on the social platform.')]));
  assert.equal(r.pass, false);
  assert.match(r.problems.join(' '), /Step 3 makes a refund or credit/);
});

test('promise check: runs on the opening, the next step and every other line, not only on steps', () => {
  assert.match(checkReply(draft(good, { extra: 'I promise this fixes it.' })).problems.join(' '), /The line "I promise this fixes it\." makes a promise/);
  assert.match(checkReply(draft(good, { next: "We'll have it fixed by Friday." })).problems.join(' '), /The line "Next step: We'll have it fixed by Friday\."/);
  assert.match(checkReply(draft(good, { proof: 'You will know it worked when your full refund arrives within 3 days.' })).problems.join(' '), /date or time/);
});

test('promise check: guarantees, dates and outcomes nobody can know', () => {
  for (const text of ['This is guaranteed to work.', 'Your post will publish by tomorrow.', 'This will definitely work now.', 'It should be resolved in 3 days.',
    'It will be fixed on Monday.', 'That solves it.', 'You will get your money back.', "We'll reimburse you.", 'It will never happen again, it always works.', 'I assure you it never happens again.']) {
    const r = checkReply(draft([...good.slice(0, 2), { type: 'action', text }]));
    assert.equal(r.pass, false, text);
    assert.match(r.problems.join(' '), promiseProblem, text);
  }
});

test('promise check: a faithful quote of the docs may say "will", but promise words beyond the quote still block', () => {
  // A test page (not Blotato's words) whose own sentence contains a promise-shaped "will ... within".
  const docPage = { ...page, text: `${page.text} Approved refunds will be processed within 5-10 business days.` };
  const quote = 'Approved refunds will be processed within 5-10 business days.';
  const faithful = checkReply(draft([...good.slice(0, 2), fact('Approved refunds will be processed within 5-10 business days.', quote)], { pages: { [URL]: docPage } }));
  assert.equal(faithful.pass, true, faithful.problems.join(' | '));
  const stretched = checkReply(draft([...good.slice(0, 2), fact('Your refund will be processed within 2 days.', quote)], { pages: { [URL]: docPage } }));
  assert.equal(stretched.pass, false);
  assert.match(stretched.problems.join(' '), /"within 2 days"/);
  // The same sentence with no quote behind it (an action step) is our promise, so it blocks.
  assert.equal(checkReply(draft([...good.slice(0, 2), { type: 'action', text: quote }], { pages: { [URL]: docPage } })).pass, false);
});

test('promise check: plain lines that are not promises still pass', () => {
  const steps = [...good.slice(0, 2), { type: 'action', text: 'I am passing your question to the team, and I will reply here when I hear back.' }];
  const r = checkReply(draft(steps, { extra: 'The id from the docs example will not work there.', proof: 'You will know it worked when the post shows as scheduled.' }));
  assert.equal(r.pass, true, r.problems.join(' | '));
});

test('voice: no em dash, no "simply", no easy-sounding "just", no hype; 3 to 5 steps; one next step', () => {
  assert.match(checkReply(draft(good, { extra: 'It is simply a status.' })).problems.join(' '), /"simply"/);
  assert.match(checkReply(draft(good, { extra: 'Nothing broke — promise.' })).problems.join(' '), /em dash/);
  assert.match(checkReply(draft(good, { extra: 'Just click Save.' })).problems.join(' '), /"just"/);
  assert.match(checkReply(draft(good, { extra: 'A game-changer.' })).problems.join(' '), /hype/);
  assert.match(checkReply(draft(good.slice(0, 2))).problems.join(' '), /2 steps/);
  assert.match(checkReply(draft(good, { extra: 'Next step: and another.' })).problems.join(' '), /exactly one "Next step:"/);
});

test('Blotato\'s response contract: the reply says what proves success (or what is open) and links a help page', () => {
  assert.match(checkReply(draft(good, { proof: null })).problems.join(' '), /proves success/);
  assert.match(checkReply(draft(good, { link: null })).problems.join(' '), /no link to a help page/);
  assert.equal(checkReply(draft(good, { proof: 'Still open: the charge itself.' })).pass, true);
});

test('no reply at all is never a pass', () => {
  const r = checkReply({ ticket: { id: 'X', text: 'x' }, reply: null });
  assert.equal(r.pass, false);
});

test('quotes match the words, not the Markdown around them', () => {
  assert.equal(normalizeText('Go to [Settings > Billing](https://x.y) and click **View**'), 'go to settings > billing and click view');
  assert.equal(quoteOnPage('Include the key in the `blotato-api-key` header', { text: 'Include the key in the `blotato-api-key` header of each request.' }), true);
  assert.equal(quoteOnPage('Include the key in a header', { text: 'Include the key in the `blotato-api-key` header.' }), false);
  assert.equal(quoteOnPage('anything', null), false);
});

test('the send gate clears only the saved reply text the fresh checker passed', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { clearedToSend, replyHash } = await import('../src/checkreply.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-gate-'));
  assert.match(clearedToSend(dir, 'T1').why, /No saved reply/);
  fs.writeFileSync(path.join(dir, 'T1.reply.txt'), 'Hi,\n1. a\n');
  assert.match(clearedToSend(dir, 'T1').why, /No fresh-checker verdict/);
  fs.writeFileSync(path.join(dir, 'T1.json'), JSON.stringify({ verdict: 'pass', replySha256: replyHash('something else') }));
  assert.match(clearedToSend(dir, 'T1').why, /different version/);
  fs.writeFileSync(path.join(dir, 'T1.json'), JSON.stringify({ verdict: 'block', replySha256: replyHash('Hi,\n1. a\n'), findings: ['step 1 overstates'] }));
  assert.match(clearedToSend(dir, 'T1').why, /step 1 overstates/);
  fs.writeFileSync(path.join(dir, 'T1.json'), JSON.stringify({ verdict: 'pass', replySha256: replyHash('Hi,\n1. a\n') }));
  assert.equal(clearedToSend(dir, 'T1').ok, true);
});
