// Regressions from the fresh tester of the public preview (Nov 18, 2026, evening). Every message here was written
// for these tests or is the tester's own made-up message.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDesk } from './helpers.mjs';
import { openDesk, handleTicket } from '../src/desk.mjs';
import { routeMessage, TICKETS } from '../knowledge/playbook.mjs';
import { consequenceAsked } from '../src/coverage.mjs';
import { describedError } from '../src/route.mjs';
import { upsetWhat, renderEscalation } from '../src/diagnose.mjs';
import { accountTemplate } from '../src/checkreply.mjs';
import { createDocs } from '../src/docs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const answered = (r) => r.decision === 'answer' || r.decision === 'partial';
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
// The saved help pages, read from where the site build copies them from (site.test.mjs rebuilds netlify/site-data while
// the suite runs, so that folder is not read here).
const savedDocs = [process.env.DOCS_CACHE_DIR, path.join(root, '.cache', 'docs'), path.join(root, '..', 'repo', '.cache', 'docs')].find(d => d && fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.json')));

test('1. "See the fixed reply" shows only for the saved stopped example; any other stopped reply gets no button that swaps in another customer', () => {
  // One place makes the button, and it is the example branch.
  assert.equal(appJs.split('id="fixed-btn"').length - 1, 1);
  assert.match(appJs, /if \(st === 'stopped' && r\.example\) \{\s*\/\/[^\n]*\n\s*actions = `<button type="button" class="btn" id="fixed-btn">/);
  assert.match(appJs, /\} else if \(st === 'stopped'\) \{[\s\S]{0,400}will not let you copy a reply a check stopped/);
});

test('2. a consequence question is not answered by how-to steps: "will my API key still work if I cancel?" goes to a person', () => {
  for (const m of [
    'If I cancel my subscription, will my API key still work?',
    'If I cancel, will my API key keep working?',
    'What happens to my scheduled posts if I downgrade?',
    'Will I lose my brand kits if I cancel my plan?',
  ]) {
    const r = routeMessage(m);
    assert.ok(!(answered(r) && r.entry?.id === 'cancel-subscription') && !(answered(r) && r.entry?.id === 'change-plan'), `${m} -> ${r.decision} ${r.entry?.id}`);
  }
  const r = routeMessage('If I cancel my subscription, will my API key still work?');
  assert.equal(r.decision, 'abstain');
  assert.equal(r.whyDetail.kind, 'consequence');
  assert.equal(r.whyDetail.item, 'api key');
  // The plain how-to still gets its answer, and a plain question with "will" is not a consequence question.
  assert.equal(routeMessage('How do I cancel my subscription?').entry?.id, 'cancel-subscription');
  assert.equal(consequenceAsked('Will my post go out at 9 am?'), null);
  assert.equal(consequenceAsked('Will I be prorated if I change plans?'), null);
  assert.equal(consequenceAsked('Does my API key still work after I regenerate it?'), 'api key');
});

test('3. an entry for a failure with no error text does not answer a customer who gives the error in their own words', () => {
  const r = routeMessage('Why did my X post fail? It says the text is too long.');
  assert.ok(!(answered(r) && r.entry?.id === 'post-failed-no-error-text'), `${r.decision} ${r.entry?.id}`);
  for (const m of ['It says the caption is too long', 'the video is too large', 'Instagram says my reel exceeds the limit']) assert.ok(describedError(m), m);
  // "It just says failed" names only the state: the symptom entry still fits.
  assert.equal(describedError('My video won\'t post. It just says failed.'), null);
  assert.equal(routeMessage('My video won\'t post. It just says failed.').entry?.id, 'post-failed-no-error-text');
  // Its reply no longer names other platforms as the example, so an X customer is not told to check Instagram.
  const x = routeMessage('My X post failed and I do not know why.');
  if (answered(x) && x.entry?.id === 'post-failed-no-error-text') for (const s of x.entry.steps) assert.ok(!/instagram|tiktok/i.test(s.text), s.text);
});

test('4. offline, the test-mode answer rests on a real search of the saved pages, and every line says so; no saved page mentions an API test mode', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, TICKETS.find(t => t.id === 'T12'));
  await desk.close();
  assert.equal(r.check.pass, true);
  assert.ok(r.evidence.searched.length && r.evidence.searched.every(q => q.saved && q.ran));
  assert.doesNotMatch(JSON.stringify(r), /nothing was searched|search was offline|skipped \(offline\)/);
  // The claim in step 1 ("the top results do not cover a test mode") holds for the pages the site ships: none of them
  // speaks of an API test mode, a dry run, a staging environment or a test key.
  const docsDir = savedDocs;
  if (docsDir) {
    for (const f of fs.readdirSync(docsDir)) {
      const t = JSON.parse(fs.readFileSync(path.join(docsDir, f), 'utf8')).text || '';
      assert.doesNotMatch(t, /\btest mode\b|\bdry[- ]run\b|\bstaging\b|\btest (?:api )?key\b|\bsandbox (?:mode|account)\b|\b(?:api|developer) sandbox\b/i, f); // "sandbox environment" there is Claude's own sandbox
    }
  }
  // The headline credits the check that really stopped a reply: the script check, or the second checker.
  assert.match(appJs, /stopped: stoppedBy\(r\) === 'script' \? 'The script check stopped it' : 'A second checker stopped it'/);
  assert.match(appJs, /'script-stopped': \{ word: 'STOPPED', top: 'SCRIPT CHECK'/);
});

test('5. no line claims the docs are silent: the reasons name the desk\'s saved answers, never the help pages', () => {
  const sources = ['src/route.mjs', 'src/diagnose.mjs', 'public/app.js', 'knowledge/entries/rest-api.json'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  for (const bad of [/docs may be silent/i, /docs have no answer/i, /goes past what the help pages cover/i, /None of Blotato\\?'s help pages answers this/, /The docs do not answer this/, /and none of them answers it/]) assert.doesNotMatch(sources, bad);
  for (const m of ['How do I connect my TikTok account so I can schedule videos?', 'If I cancel my subscription, will my API key still work?']) {
    const r = routeMessage(m);
    assert.doesNotMatch(r.reason, /docs/i, r.reason);
  }
});

test('6. the engineer trace tells one story: a search of the saved pages is reported as that, with its results', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, { id: null, text: 'Can I sync my Blotato calendar with Outlook?' });
  await desk.close();
  assert.equal(r.evidence.kind, 'docs-search');
  assert.match(r.evidence.summary, /^Searched the saved copies of the help pages/);
  assert.match(r.evidence.calls.join('\n'), /^searched the saved copies of the help pages for "/m);
  assert.doesNotMatch(r.escalationText, /offline|skipped|nothing was searched/);
  // The page says the same: "Searched the saved copies" with a count, never "skipped" next to a search.
  assert.doesNotMatch(appJs, /skipped: this copy runs without the network/);
  assert.match(appJs, /Searched the saved copies of the help pages/);
  // And the saved search itself: results from the saved pages, marked saved.
  if (!savedDocs) return;
  const docs = createDocs({ cacheDir: savedDocs, env: { DOCS_OFFLINE: '1' } });
  return docs.search('How do I post to Pinterest?').then(s => { assert.equal(s.saved, true); assert.ok(s.results.some(x => /pinterest/.test(x.url))); });
});

test('7. "Do you offer an annual plan discount?" gets the yearly answer, quoted from the Billing & Credits page', () => {
  const r = routeMessage('Do you offer an annual plan discount?');
  assert.equal(r.decision, 'answer'); assert.equal(r.entry.id, 'yearly-plan-discount');
  assert.ok(r.entry.steps.some(s => /17%/.test(s.cite.quote)));
});

test('9. an upset customer hears sorry and what failed, in the desk\'s own words; the refund letter asks only for what is missing', async () => {
  assert.equal(upsetWhat('This is the third time your garbage app failed to post my reels. Fix it or I\'m leaving.'), 'your reels failed to post, and not for the first time');
  assert.equal(upsetWhat('Fix this garbage right now or I quit'), 'you are dealing with this');
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, { id: null, text: 'This is the third time your garbage app failed to post my reels. Fix it or I\'m leaving.' });
  const money = await handleTicket(desk, { id: null, text: 'I canceled my plan last month but you charged me again. I want a refund.' });
  await desk.close();
  assert.match(r.reply, /I'm sorry your reels failed to post, and not for the first time\. I can see how frustrating that is/);
  assert.doesNotMatch(r.reply, /garbage/);
  assert.equal(r.check.pass, true, r.check.problems.join(' '));
  // Checked as words: the slot goes back to "{what}".
  assert.match(accountTemplate(r), /I'm sorry \{what\}\./);
  assert.doesNotMatch(money.reply, /If a payment is part of this/);
});

test('10. the bigint letter is a letter to the customer: the demo note goes to the team and the engineer view', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, TICKETS.find(t => t.id === 'T11'));
  await desk.close();
  assert.doesNotMatch(r.reply, /practice account|real API was not called/i);
  assert.match(r.reply, /Here is what the lookup gave: GET \/v2\/schedules\/sch_abc123 answers HTTP 500/);
  assert.match(r.evidence.technical, /The practice account answers/);
  assert.match(r.escalationText, /The practice account answers/);
});

test('10b. on the public site the sample clock is the real hour, so a scheduled sample post is in the future', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env: { ...env, SUPPORT_DESK_MOCK_CLOCK: 'now' } });
  const r = await handleTicket(desk, TICKETS.find(t => t.id === 'T09'));
  await desk.close();
  const m = r.reply.match(/scheduled for (\w+day, \w{3} \d{1,2}, at \d{1,2}:\d\d [ap]m) UTC/);
  assert.ok(m, r.reply);
  const year = new Date().getUTCFullYear();
  const t = Date.parse(`${m[1].replace(/^\w+day, /, '').replace(', at', ` ${year}`)} UTC`);
  assert.ok(t > Date.now() - 3600000, `${m[1]} is in the past`);
});

test('11. "Two most likely causes" is only for a failure; a how-to or yes-no hand-over has no causes heading', () => {
  const base = { asked: 'Can I schedule posts to Threads and Bluesky?', why: 'x', checked: [], evidence: [], causes: [], ruledOut: [] };
  assert.doesNotMatch(renderEscalation({ ...base, failure: false }), /Two most likely causes/);
  assert.match(renderEscalation({ ...base, failure: true }), /Two most likely causes/);
  assert.match(renderEscalation({ ...base, failure: false, causes: ['There is no test mode.'] }), /Possible answers, to confirm/);
  // The page's line of work and its engineer view agree for nonsense: it asked for a clearer message.
  assert.match(appJs, /whyOf\(r\) === 'nonsense' \? 'Why it asked for a clearer message' : 'Why it went to a person'/);
});
