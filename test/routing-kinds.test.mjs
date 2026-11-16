// Regression tests for the kinds of wrong answer found after the first 106 FAQ entries went in.
// Every message here was written for these tests (none is from eval/), and each kind has messages on several
// topics, plus look-alikes that must still be answered, so a fix that only fits one message fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBOOK, routeMessage } from '../knowledge/playbook.mjs';
import { createRouter } from '../src/route.mjs';
import { validateShape } from '../src/entries.mjs';
import { needsPerson, DEFAULT_SIGNALS } from '../src/signals.mjs';
import { hasTerm, allStems } from '../src/match.mjs';

const answered = (r) => r.decision === 'answer' || r.decision === 'partial';
const show = (m, r) => `${m}\n  -> ${r.decision} ${r.entry?.id || ''} (${r.reason})`;

function expectAll(list, check, label) {
  const bad = [];
  for (const m of list) { const r = routeMessage(m); if (!check(r)) bad.push(show(m, r)); }
  assert.deepEqual(bad, [], `${label}:\n${bad.join('\n')}`);
}
const answersWith = (pairs, label) => {
  const bad = [];
  for (const [id, m] of pairs) { const r = routeMessage(m); if (!(answered(r) && r.entry?.id === id)) bad.push(`expected ${id}: ${show(m, r)}`); }
  assert.deepEqual(bad, [], `${label}:\n${bad.join('\n')}`);
};

test('default signals: a repeat failure, an outage or a disputed count goes to a person on ANY entry, listed or not', () => {
  expectAll([
    'My Pinterest account says it needs reconnecting, I reconnect, and it comes back. This is the fourth day in a row.',
    'The Schedule button has been grey for me three mornings in a row now, what is going on?',
    'Is Blotato down? None of my TikTok and Threads posts went out this morning.',
    'Is there an outage right now? Scheduled posts on all 5 of my accounts are erroring.',
    'It says I hit the 10 posts limit for my YouTube channel but I only posted 3 there today.',
    "I've only scheduled two posts this week and it tells me my queue is full.",
    'The help page says 400 MB is the max, but the error says my 120 MB file is too big. Which is right?',
    'My Instagram story keeps coming back as a feed post. How do I post it as a story?',
  ], (r) => r.decision === 'needs-person' || r.decision === 'guard', 'should go to a person');
});

test('default signals: an ordinary repeat ("3 times a day", "every time I plan") is not a failure, and the entry still answers', () => {
  answersWith([
    ['hashtag-count', 'I post 3 times a day on Instagram, how many hashtags should I use?'],
    ['scheduling-horizon', 'Every time I plan my content I wonder: how far in advance can I schedule posts?'],
    ['connected-account-limit', 'I have 3 accounts connected right now. How many social accounts can I connect on Creator?'],
    ['plan-credits-per-month', 'I generate videos every day. How many AI credits do I get each month on Starter?'],
    ['edit-video-with-prompts', 'I asked the agent four times to trim my clip and it only writes captions. Can the AI agent edit my video with prompts?'],
  ], 'should still answer');
});

test('default signals: an entry can opt out with needs_person_if.ignore, and the validator checks the names', () => {
  const entry = PLAYBOOK.find(e => e.id === 'scheduling-horizon');
  const text = 'Three days in a row I picked a date next year. How far ahead can I schedule?';
  const helpers = { hasTerm, allStems };
  assert.ok(needsPerson(text, entry.needs_person_if, helpers, { defaults: true }).some(h => h.signal === 'retried' && h.byDefault));
  assert.ok(!needsPerson(text, { ...entry.needs_person_if, ignore: ['retried'] }, helpers, { defaults: true }).some(h => h.signal === 'retried'));
  assert.ok(!needsPerson(text, entry.needs_person_if, helpers).some(h => h.signal === 'retried'), 'without defaults only listed signals fire');
  assert.ok(DEFAULT_SIGNALS.includes('many-accounts'));
  const bad = { ...entry, needs_person_if: { signals: ['tried-steps'], ignore: ['tried-steps', 'no-such-signal'] } };
  const problems = validateShape([bad]).join('\n');
  assert.match(problems, /"tried-steps" in "needs_person_if.ignore" is not a default signal/);
  assert.match(problems, /"no-such-signal" in "needs_person_if.ignore" is not a default signal/);
});

test('a request after a clause break inside a question is still a request', () => {
  expectAll([
    'How long do drafts stay saved, and can you restore the one I lost yesterday?',
    'What does CANCELED mean, and could you put my posts back on the schedule?',
    'Why did my Facebook Page disconnect, and can you reconnect it?',
    'Which plan has 40 accounts, and will you switch my account to it today?',
    'Where is my API key, and can you regenerate it?',
    'Why is my post stuck, and can you push it out now?',
  ], (r) => r.decision === 'guard' && r.guard === 'staff-action', 'should be the staff-action guard');
  answersWith([
    ['cancel-subscription', 'How can you cancel a subscription before it renews?'],
    ['update-email', 'Where can you change the email address on your account?'],
  ], '"can you" governed by the question word is still a question');
});

test('docs-silent: a named item (payment method, feature, tool, language, file type, identifier) the entry never mentions is not answered', () => {
  expectAll([
    'Can I pay for my plan with Venmo?',
    'Do you accept Apple Pay when I upgrade?',
    'Can Blotato schedule a poll on LinkedIn?',
    'Can I add alt text to the images in my carousel?',
    'Can I write my posts in Japanese with the AI?',
    'Can I upload a GIF and schedule it to X?',
    'Does Blotato show analytics for my TikTok posts?',
    'Can I connect Zapier to send new posts to Blotato?',
    'Where do I find the channel id for my YouTube account?',
    'Can I bulk upload my posts from a Notion database?',
    'Can I connect my Blotato posts to Klaviyo?',
  ], (r) => !answered(r), 'should not be answered');
  const r = routeMessage('Can I pay for my plan with Venmo?');
  if (r.silent) assert.equal(r.silent.term, 'venmo');
});

test('docs-silent: when the entry does name the item, an honest paraphrase is still answered', () => {
  answersWith([
    ['supported-platforms', 'does blotato work with reddit or tumblr'],
    ['own-video-as-source', 'can I use a video I edited in CapCut as a source?'],
    ['heygen-with-blotato', 'how do I use HeyGen together with Blotato?'],
    ['english-spanish-content', 'can I make posts in spanish and english?'],
    ['csv-bulk-upload', 'can I upload a csv with my content calendar?'],
    ['cloud-storage-media', 'can I publish files straight from my Google Drive?'],
    ['connect-chatgpt-codex', 'how do I connect ChatGPT to Blotato?'],
    // Mastodon is named by the entry, and the FAQ says the list of platforms is complete.
    ['supported-platforms', 'Can Blotato post to my Mastodon server?'],
  ], 'should still answer');
});

test('docs-silent: a question for a number is not answered by an entry whose steps give no number', () => {
  expectAll([
    'How many drafts can I keep in the AI Agent at once?',
    'How many times can I reschedule the same post?',
    'How long does a published post stay in Posts > Published?',
    'How many brand voices can I save?',
    'How many sources can I add to the Sources library?',
  ], (r) => !answered(r), 'should not be answered');
  answersWith([
    ['hashtag-count', 'how many hashtags is best on tiktok?'],
    ['connected-account-limit', 'how many social accounts can I hook up on agency?'],
    ['scheduling-horizon', 'how far ahead can I schedule a post?'],
    ['max-upload-size', 'what is the maximum file size I can upload on Creator?'],
  ], 'the entry gives the number, so it answers');
});

test('docs-silent: an entry about one platform does not answer for a platform it never mentions', () => {
  expectAll([
    'How do I set a custom cover image for my YouTube Shorts?',
    'Can I add collaborators to a TikTok post?',
    'Can I remove the Published by label from my LinkedIn posts?',
    'Do I need to fill in the text box for Pinterest pins?',
  ], (r) => !answered(r), 'should not be answered');
  const fb = routeMessage('Why did my Facebook story post as a normal post?');
  assert.ok(!(answered(fb) && fb.entry.id === 'instagram-story-as-feed-post'), show('facebook story', fb));
  answersWith([
    ['reels-cover-image', 'how do I pick a cover photo for my instagram reel?'],
    ['instagram-collaborators', 'how do I tag a collaborator on my IG post?'],
  ], 'same platform, so it answers');
});

test('docs-silent: the check is generic, and naming the item in a phrasing is how an entry claims it', () => {
  const base = PLAYBOOK.find(e => e.id === 'start-paid-subscription');
  const msg = 'Can I pay for Blotato with Venmo?';
  assert.ok(!answered(createRouter(PLAYBOOK).route(msg)));
  const claimed = { ...base, phrasings: [...base.phrasings, 'can I pay with venmo'] };
  const r = createRouter([...PLAYBOOK.filter(e => e.id !== base.id), claimed]).route(msg);
  assert.equal(r.silent, undefined, show(msg, r));
});

test('two close entries: the one the help page gives the question to wins', () => {
  answersWith([
    ['published-not-visible', "It says my TikTok was published but it isn't on my TikTok profile. Did it go out?"],
    ['published-not-visible', "The status is Published but my LinkedIn feed doesn't show the post. Where is it?"],
    ['find-what-i-created', 'where do I find the video I generated last week?'],
    ['connected-account-limit', 'does a linkedin company page count against the number of accounts on my plan?'],
    ['linkedin-company-page', 'With the API, how do I post to our LinkedIn company page and not my profile?'],
  ], 'owner should answer');
  for (const [id, m] of [
    ['find-what-i-created', "Blotato marked my Facebook post as posted, but I can't see it on my Page."],
    ['linkedin-company-page', 'If I add my LinkedIn profile and two company Pages, how many of my 20 accounts does that use?'],
  ]) { const r = routeMessage(m); assert.ok(!(answered(r) && r.entry.id === id), show(m, r)); }
});

test('digits match exactly: an error code, a status or a count is never a one-letter typo of another', async () => {
  const { nearWord, anchorsMet } = await import('../src/match.mjs');
  assert.equal(nearWord('20003', '20005'), false);
  assert.equal(nearWord('20005', '20005'), true);
  assert.equal(nearWord('subscribtion', 'subscription'), true, 'letters still get one-letter typos');
  for (const [msg, anchor] of [['I get error 20003 when posting', '20005'], ['GET /v2/posts returns 404', '401'], ['the call died with a 500', '504'], ['it says 10 posts per day', '20 posts']]) {
    assert.equal(anchorsMet(msg, [[anchor]]).ok, false, `${anchor} must not match "${msg}"`);
    assert.equal(hasTerm(allStems(msg), anchor), false, `phrase ${anchor} must not match "${msg}"`);
  }
  assert.equal(anchorsMet('I get error 20005 when posting', [['20005']]).ok, true);
  const helpers = { hasTerm, allStems };
  assert.equal(needsPerson('my queue says 20 posts', { signals: [], phrases: ['10 posts'] }, helpers).length, 0);
  assert.equal(needsPerson('my queue says 10 posts', { signals: [], phrases: ['10 posts'] }, helpers).length, 1);
  // Near misses: a message about 500 is not blocked by a near miss about 504.
  const entry = PLAYBOOK.find(e => e.id === 'unknown-outcome-resend');
  const withMiss = { ...entry, not_this: [...(entry.not_this || []), 'POST /v2/posts gave a 504999 code'] };
  const r = createRouter([...PLAYBOOK.filter(e => e.id !== entry.id), withMiss]).route('My POST /v2/posts call timed out with a 504. Should I send it again?');
  assert.equal(r.entry?.id, 'unknown-outcome-resend', show('504 vs 504999', r));
});

test('follow-on: "I already did X, and now Y" is a new question and goes to a person', () => {
  expectAll([
    'My POST /v2/posts got a 504, so I resent it and now there are 2 posts on LinkedIn.',
    'The post was stuck in progress. I deleted it and now the calendar shows it twice.',
    'Instagram said the account needed reconnecting. We reconnected and now every post says unauthorized.',
    'After I reposted the reel, there are two copies on my profile. Which one do I delete?',
    'I changed my email and now the magic link never arrives.',
    'I upgraded to Creator and now my old drafts are gone.',
  ], (r) => r.decision === 'needs-person' || r.decision === 'guard', 'should go to a person');
  answersWith([
    ['unknown-outcome-resend', 'My POST /v2/posts call for an Instagram post timed out with a 504. Should I send it again?'],
    ['connected-account-limit', 'I upgraded to Creator last week. How many social accounts can I connect now?'],
  ], 'asking before acting, or nothing new is wrong');
});

test('quoted or pasted error text is not a request, but a real request next to it still is', () => {
  expectAll([
    'Facebook shows "Please notice the user must reauthorize the app to continue posting". What does that mean?',
    'I get this error: Please reconnect your account to continue. Why does it say that?',
    "TikTok says 'Please delete some drafts before uploading more'. What is that about?",
    'The API returned `please retry the request later` with a 429. What should my workflow do?',
    'The message says “Kindly remove the watermark and try again” on my TikTok upload. What does it mean?',
  ], (r) => r.decision !== 'guard', 'quoted text must not be read as a request');
  expectAll([
    'It says "token expired". Can you reset my key?',
    'Error: invalid page. Please remove the old Facebook page from my account.',
    'how do i stop markdown, and also please clean the asterisks out of the posts already scheduled',
    'Post this to my Instagram right now please: "Summer sale starts today!"',
  ], (r) => r.decision === 'guard' && r.guard === 'staff-action', 'a real request is still a request');
});

test('money: paid but did not get it, or credits asked back, goes to a person', () => {
  expectAll([
    "I bought 500 credits and paid, but my balance didn't go up. Where do I check it?",
    'We paid for Creator but the app still stops us at 20 accounts.',
    'please give back the 120 credits, the render failed halfway',
    'Can you restore my lost credits from the failed video?',
  ], (r) => r.decision === 'guard' && r.guard === 'money', 'should be the money guard');
  answersWith([['how-to-buy-credits', 'how do I buy more credits?']], 'buying credits ahead of time is a how-to');
});

test('still broken: "still shows up", "Still 401", a bare "Same error." after a retry', () => {
  expectAll([
    'I turned on Disable Markdown and the asterisks still show up in my LinkedIn posts.',
    'Still 401. I pasted the key again from Settings. Same error.',
    'I generated a new key and connected it again. Same result.',
  ], (r) => r.decision === 'needs-person' || r.decision === 'guard', 'should go to a person');
});

test('named items match exactly: "video" is not "vimeo"', () => {
  const r = routeMessage('If I cancel my subscription, can I still open my old videos?');
  assert.ok(!r.silent, show('videos', r));
  assert.ok(!answered(routeMessage('Can I remix a Vimeo link instead of a YouTube video?')) || routeMessage('Can I remix a Vimeo link instead of a YouTube video?').entry.id !== 'remix-youtube-video');
});

test('number questions: the customer\'s own count is a where-to-look question; a documented table row answers a limit', () => {
  answersWith([
    ['what-uses-credits', 'how do I see how many credits I have left?'],
    ['scheduled-queue-limit', 'how many scheduled posts can I have in my queue on Agency?'],
  ], 'should answer');
  expectAll(['How long does a post stay in progress before it fails?'], (r) => !answered(r), 'no documented duration');
});
