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

test('an action step may not promise anything', () => {
  for (const text of ['We will refund you today.', 'This will be fixed by tomorrow.', 'I guarantee it posts.', 'It should be back within 2 hours.']) {
    const r = checkReply(draft([...good.slice(0, 2), { type: 'action', text }]));
    assert.equal(r.pass, false, text);
    assert.match(r.problems.join(' '), /promise/);
  }
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
