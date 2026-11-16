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
