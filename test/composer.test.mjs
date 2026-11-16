// The composer (src/composer.mjs): when no saved entry answers, a model writes steps from any help page, every step
// quoting its sentence; the script verifies the draft; a second read tries to break it.
// No model is ever called here: every test uses a fake backend, so npm test needs no key and no network.
// The messages and the help page below are made up for these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROUTER, routeMessage } from '../knowledge/playbook.mjs';
import { createComposer, composerConfig, unsupported, numbersIn, assembleReply, FRAME, WRITE_PROMPTS, WRITE_VERSION, SECOND_PROMPTS, SECOND_VERSION, EXPAND_PROMPTS, EXPAND_VERSION } from '../src/composer.mjs';
import { splitPage, buildPassageIndex, numberPassages } from '../src/passages.mjs';
import { checkReply } from '../src/checkreply.mjs';
import { openDesk, handleTicket } from '../src/desk.mjs';
import { tempDesk } from './helpers.mjs';

const URL = 'https://help.blotato.com/test-pages/lantern-widgets';
const PAGE = `# Lantern widgets

Lantern widgets show a small glowing badge on your calendar.

## How many lantern widgets can a workspace hold?

Each workspace can hold up to 7 lantern widgets. Open Settings > Widgets to add one.

1. Choose Add Lantern.
2. Pick a color for the glow.

## Lantern widgets by plan

| Plan | Lantern widgets |
| --- | --- |
| Starter | 7 |
| Agency | 30 |
`;
const MSG = 'How many lantern widgets can one workspace hold, and where do I add them?';
const pages = { [URL]: { url: URL, fetchedAt: '2026-11-16T01:00:00.000Z', via: 'test fixture', text: PAGE } };

// The id the composer gave a sentence, read from what the writer was shown.
const idOf = (user, sentence) => { const m = user.split('\n').find(l => l.endsWith(sentence) || l.includes(`: ${sentence}`)); return m ? m.split(':')[0].trim() : null; };
// A fake backend: answers the writer and the second reader with what the test asks for, and records each call.
function fake({ write, second = { objections: [], verdict: 'send' } }) {
  const calls = [];
  const call = async (args) => {
    calls.push(args);
    const isSecond = args.system === SECOND_PROMPTS[SECOND_VERSION];
    const obj = isSecond ? (typeof second === 'function' ? second(args) : second) : (typeof write === 'function' ? write(args) : write);
    if (obj instanceof Error) throw obj;
    return { obj, model: 'fake' };
  };
  return { calls, call };
}
const goodDraft = (args) => ({
  asked: [{ item: 'how many lantern widgets per workspace', steps: [1] }, { item: 'where to add them', steps: [2] }],
  answerable: true, reason: 'test',
  steps: [
    { text: 'Each workspace can hold up to 7 lantern widgets.', quotes: [idOf(args.user, 'Each workspace can hold up to 7 lantern widgets.')] },
    { text: 'Open Settings > Widgets to add one.', quotes: [idOf(args.user, 'Open Settings > Widgets to add one.')] },
  ],
});
// The search step is off in most tests, so each test counts only the writer and the second reader.
const composer = (f, over = {}) => createComposer({ router: ROUTER, call: f.call, pages, cacheDir: null, expand: false, ...over });

test('off is the default: no composer, and the result says so', async () => {
  assert.equal(composerConfig({}).backend, 'off');
  assert.equal(createComposer({ router: ROUTER, env: {} }), null);
  const { env } = tempDesk();
  const desk = openDesk({ env });
  try {
    assert.equal(desk.composer, null);
    const d = await handleTicket(desk, { text: MSG });
    assert.deepEqual(d.composer, { backend: 'off' });
    assert.equal(d.path, null);
    assert.equal(d.reply, null);
  } finally { await desk.close(); }
});

test('passages: headings, sentences, list items and table rows are each citable, word for word', () => {
  const sp = splitPage(pages[URL]);
  assert.equal(sp.title, 'Lantern widgets');
  const texts = sp.units.map(u => u.text);
  for (const t of ['How many lantern widgets can a workspace hold?', 'Each workspace can hold up to 7 lantern widgets.', 'Choose Add Lantern.', 'Starter 7']) assert.ok(texts.includes(t), t);
  assert.ok(sp.units.every(u => u.citable));
  assert.deepEqual(sp.units.find(u => u.text === 'Agency 30').path, ['Lantern widgets', 'Lantern widgets by plan']);
  const idx = buildPassageIndex(pages);
  const got = idx.retrieve(MSG);
  assert.equal(got.pages[0].url, URL);
  const n = numberPassages(got);
  assert.match(n.text, /S\d+: Each workspace can hold up to 7 lantern widgets\./);
  assert.match(n.text, /S\d+: \[table row\] Plan \| Lantern widgets\nS\d+: \[table row\] Starter \| 7/);
});

test('the script refuses a step that says more than its quote: numbers, platforms, plans, labels, names', () => {
  const q = 'Each workspace can hold up to 7 lantern widgets. Open Settings > Widgets to add one.';
  assert.equal(unsupported('A workspace holds up to 7 lantern widgets.', q), null);
  assert.equal(unsupported('A workspace holds up to seven lantern widgets.', q), null);
  assert.deepEqual(unsupported('A workspace holds up to 9 lantern widgets.', q), { kind: 'number', term: '9' });
  assert.equal(unsupported('On Instagram, a workspace holds 7.', q).kind, 'platform');
  assert.equal(unsupported('On the Agency plan, a workspace holds 7.', q).kind, 'plan');
  assert.equal(unsupported('Click "Add Glow" to add one.', q).kind, 'label');
  assert.equal(unsupported('Open Settings > Lanterns to add one.', q).kind, 'menu');
  assert.equal(unsupported('Open the Glowboard to add one.', q).kind, 'name');
  // A name the customer used may be repeated; a number the customer used may not.
  assert.equal(unsupported('Glowboard users can add up to 7 lantern widgets.', q, { message: 'I use Glowboard.' }), null);
  assert.equal(unsupported('Your 12 widgets are too many.', q, { message: 'I have 12 widgets.' }).kind, 'number');
  assert.deepEqual([...numbersIn('1,000 credits, nine months, 2.5 MB')].sort(), ['1000', '2.5', '9'].sort());
});

test('a draft that passes every check becomes a composed reply, in the saved replies\' shape, marked composed', async () => {
  const r0 = routeMessage(MSG);
  assert.equal(r0.decision, 'abstain');
  const f = fake({ write: goodDraft });
  const c = composer(f);
  const r = await c.compose(MSG, r0);
  assert.equal(r.decision, 'answer');
  assert.equal(r.path, 'composed');
  assert.equal(r.entry.id, 'composed');
  assert.equal(r.composer.state, 'checked-live');
  assert.equal(r.composer.secondReadResult.verdict, 'send');
  assert.equal(f.calls.length, 2);
  // The writer sees the message and the numbered sentences, never a path or a key; the second reader sees the reply and the section.
  assert.match(f.calls[0].user, /^<message>\nHow many lantern widgets/);
  assert.doesNotMatch(f.calls[0].user + f.calls[1].user, /[A-Z]:\\|\/Users\/|BLOTATO_API_KEY|sk-ant/);
  assert.equal(f.calls[0].system, WRITE_PROMPTS[WRITE_VERSION]);
  assert.match(f.calls[1].user, /<reply>[\s\S]*1\. Each workspace can hold up to 7 lantern widgets\.[\s\S]*<help-page-sections>[\s\S]*Choose Add Lantern\./);
  // The frame is the script's; the reply passes the script checker.
  const a = assembleReply(r.composed.steps);
  assert.ok(a.reply.includes(FRAME.opening) && a.reply.includes(`Next step: ${FRAME.next}`) && a.reply.includes(FRAME.proof) && a.reply.includes(`Help page: ${URL}`));
  assert.equal(a.steps.length, 3);   // two written steps, one fixed line to keep the 3-to-5-step shape
  assert.equal(checkReply({ reply: a.reply, steps: a.steps, pages }, { reviewsDir: null, checksDir: null }).pass, true);
});

test('through the desk: the result says composed, carries the steps with their sentences, and never claims a saved check', async () => {
  const { env } = tempDesk({ extraPages: { [URL]: PAGE } });
  const f = fake({ write: goodDraft });
  const desk = openDesk({ env: { ...env, SUPPORT_DESK_COMPOSER_EXPAND: 'off' }, composerCall: f.call });
  try {
    const d = await handleTicket(desk, { text: MSG });
    assert.equal(d.path, 'composed');
    assert.equal(d.match.path, 'composed');
    assert.equal(d.outcome, 'reply');
    assert.equal(d.check.pass, true, d.check.problems.join(' | '));
    assert.equal(d.fresh.state, 'checked-live');
    assert.equal(d.fresh.saved, false);
    assert.notEqual(d.fresh.state, 'passed');
    assert.match(d.status, /composed reply: .*not a saved, pre-checked reply/);
    assert.equal(d.composed.steps[0].quotes[0].url, URL);
    assert.equal(d.composed.steps[0].quotes[0].sentence, 'Each workspace can hold up to 7 lantern widgets.');
    assert.equal(d.composed.secondRead.verdict, 'send');
    // A saved answer is still the saved path, and the composer is never asked.
    const before = f.calls.length;
    const saved = await handleTicket(desk, { text: 'How do I cancel my subscription?' });
    if (saved.match.decision === 'answer') { assert.equal(saved.path, 'saved'); assert.equal(f.calls.length, before); }
  } finally { await desk.close(); }
});

test('the script rejects a draft: an unknown id, a step with no quote, an added number, an untied ask, a promise (compose-unverified)', async () => {
  const r0 = routeMessage(MSG);
  const cases = {
    'step-1-unknown-id': (a) => ({ ...goodDraft(a), steps: [{ text: 'Each workspace can hold up to 7 lantern widgets.', quotes: ['S999'] }] }),
    'step-1-no-quote': (a) => ({ ...goodDraft(a), steps: [{ text: 'Each workspace can hold up to 7 lantern widgets.', quotes: [] }] }),
    'step-1-says-more': (a) => ({ ...goodDraft(a), steps: [{ text: 'Each workspace can hold up to 70 lantern widgets.', quotes: goodDraft(a).steps[0].quotes }, goodDraft(a).steps[1]] }),
    'asked-not-tied': (a) => ({ ...goodDraft(a), asked: [...goodDraft(a).asked, { item: 'can widgets blink', steps: [] }] }),
    'checker': (a) => ({ ...goodDraft(a), steps: [{ text: 'Each workspace can hold up to 7 lantern widgets, and this will fix it.', quotes: goodDraft(a).steps[0].quotes }, goodDraft(a).steps[1]] }),
  };
  for (const [problem, write] of Object.entries(cases)) {
    const f = fake({ write });
    const r = await composer(f).compose(MSG, r0);
    assert.equal(r.decision, 'abstain', problem);
    assert.equal(r.why, 'compose-unverified', problem);
    assert.ok(r.composer.problem.startsWith(problem), `${problem}: ${r.composer.problem}`);
    assert.equal(r.whyDetail.before.why, r0.why);
    assert.equal(f.calls.length, 1, `${problem}: the second reader is not asked about a rejected draft`);
  }
});

test('the second reader can stop a draft that passed the script (second-read-objected); with it off the state is script-checked', async () => {
  const r0 = routeMessage(MSG);
  const f = fake({ write: goodDraft, second: { objections: [{ kind: 'caveat', about: 'The page limits this by plan.' }], verdict: 'stop' } });
  const r = await composer(f).compose(MSG, r0);
  assert.equal(r.decision, 'abstain');
  assert.equal(r.why, 'second-read-objected');
  assert.equal(r.composer.state, 'rejected-by-second-read');
  assert.equal(r.whyDetail.objections[0].kind, 'caveat');
  const f2 = fake({ write: goodDraft });
  const off = await composer(f2, { secondRead: false }).compose(MSG, r0);
  assert.equal(off.composer.state, 'script-checked');
  assert.equal(f2.calls.length, 1);
});

test('"not answerable" keeps the hand-over and its reason code', async () => {
  const r0 = routeMessage(MSG);
  const f = fake({ write: { asked: [{ item: 'x', steps: [] }], answerable: false, reason: 'the pages do not say', steps: [] } });
  const r = await composer(f).compose(MSG, r0);
  assert.equal(r.decision, r0.decision);
  assert.equal(r.why, r0.why);
  assert.equal(r.composer.state, 'declined');
});

test('guards, hand-over signals and saved answers come first: the composer is never asked', async () => {
  const f = fake({ write: goodDraft });
  const c = composer(f);
  for (const text of ['I was charged twice for lantern widgets and want my money back.', 'Please delete my lantern widgets for me.', 'Is something down? All 9 of my client accounts failed this morning.']) {
    const r0 = routeMessage(text);
    const r = await c.compose(text, r0);
    assert.notEqual(r.path, 'composed', text);
    assert.ok(r.decision === r0.decision || r.decision === 'needs-person', text);
  }
  assert.equal(f.calls.length, 0);
});

test('fail closed: an error, a timeout or an answer in the wrong shape leaves the decision exactly as it was', async () => {
  const r0 = routeMessage(MSG);
  for (const write of [new Error('boom'), { steps: 'nope' }, { answerable: 'yes', steps: [], asked: [] }]) {
    const r = await composer(fake({ write })).compose(MSG, r0);
    assert.equal(r.decision, r0.decision);
    assert.equal(r.why, r0.why);
    assert.ok(r.composer.error);
  }
  const r = await composer(fake({ write: goodDraft, second: new Error('timed out') })).compose(MSG, r0);
  assert.equal(r.decision, r0.decision);
  assert.match(r.composer.error, /second read/);
});

test('the verdict cache: a second run makes no call and gives the same answer; it holds no customer text', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-test-'));
  const r0 = routeMessage(MSG);
  const f = fake({ write: goodDraft });
  const a = await composer(f, { cacheDir: dir }).compose(MSG, r0);
  const b = await composer(f, { cacheDir: dir }).compose(MSG, r0);
  assert.equal(f.calls.length, 2);
  assert.equal(b.path, 'composed');
  assert.deepEqual(b.composed.steps, a.composed.steps);
  assert.equal(b.composer.cached, true);
  for (const file of fs.readdirSync(dir)) assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /where do I add them/);
});

test('the search step: its queries widen what the script retrieves; if it fails, the message alone is ranked', async () => {
  const r0 = routeMessage(MSG);
  const seen = [];
  const call = async (args) => {
    seen.push(args.system === EXPAND_PROMPTS[EXPAND_VERSION] ? 'expand' : args.system === SECOND_PROMPTS[SECOND_VERSION] ? 'second' : 'write');
    if (args.system === EXPAND_PROMPTS[EXPAND_VERSION]) return { obj: { queries: ['lantern widgets per workspace limit'] }, model: 'fake' };
    if (args.system === SECOND_PROMPTS[SECOND_VERSION]) return { obj: { objections: [], verdict: 'send' }, model: 'fake' };
    return { obj: goodDraft(args), model: 'fake' };
  };
  const r = await createComposer({ router: ROUTER, call, pages, cacheDir: null }).compose(MSG, r0);
  assert.deepEqual(seen, ['expand', 'write', 'second']);
  assert.deepEqual(r.composer.queries, ['lantern widgets per workspace limit']);
  assert.equal(r.path, 'composed');
  // The search model sees only the message.
  const failing = async (args) => { if (args.system === EXPAND_PROMPTS[EXPAND_VERSION]) throw new Error('down'); return call(args); };
  const r2 = await createComposer({ router: ROUTER, call: failing, pages, cacheDir: null }).compose(MSG, r0);
  assert.equal(r2.path, 'composed');
  assert.match(r2.composer.expandError, /down/);
});

test('a quoted sentence that sends the customer to support hands the message over', async () => {
  const page = `# Lantern support

## Lantern widgets disappeared

If your lantern widgets disappeared, contact support so the team can restore them.
`;
  const u = 'https://help.blotato.com/test-pages/lantern-support';
  const pg = { [u]: { url: u, fetchedAt: '2026-11-16T01:00:00.000Z', via: 'test fixture', text: page } };
  const text = 'My lantern widgets disappeared from my calendar. What should I do?';
  const write = (a) => ({ asked: [{ item: 'lantern widgets disappeared', steps: [1] }], answerable: true, reason: 'test', steps: [{ text: 'Contact support so the team can restore your lantern widgets.', quotes: [idOf(a.user, 'If your lantern widgets disappeared, contact support so the team can restore them.')] }] });
  const r = await createComposer({ router: ROUTER, call: fake({ write }).call, pages: pg, cacheDir: null, expand: false }).compose(text, routeMessage(text));
  assert.equal(r.why, 'compose-unverified');
  assert.match(r.composer.problem, /^quote-hands-over/);
});

test('every quote must come from the best-ranked pages (topPages), or the draft is handed over', async () => {
  const u2 = 'https://help.blotato.com/test-pages/glow-colors';
  const pg = { ...pages, [u2]: { url: u2, fetchedAt: '2026-11-16T01:00:00.000Z', via: 'test fixture', text: '# Glow colors\n\n## Colors\n\nA lantern glow can be amber or teal.\n' } };
  const write = (a) => ({ ...goodDraft(a), steps: [...goodDraft(a).steps, { text: 'A lantern glow can be amber or teal.', quotes: [idOf(a.user, 'A lantern glow can be amber or teal.')] }] });
  const r0 = routeMessage(MSG);
  const one = await createComposer({ router: ROUTER, call: fake({ write }).call, pages: pg, cacheDir: null, expand: false, topPages: 1 }).compose(MSG, r0);
  assert.ok(one.composer.passages.some(p => p.url === u2), "the second page is retrieved");
  {
    assert.equal(one.why, 'compose-unverified');
    assert.match(one.composer.problem, /^outside-top-pages/);
    const any = await createComposer({ router: ROUTER, call: fake({ write }).call, pages: pg, cacheDir: null, expand: false, topPages: 0 }).compose(MSG, r0);
    assert.equal(any.path, 'composed');
  }
});

// Compose over a saved entry (Nov 16, 2026 experiment; off by default).
const savedRoute = (steps = [{ type: 'fact', text: 'Lantern widgets show a small glowing badge.', cite: { url: URL, quote: 'Lantern widgets show a small glowing badge on your calendar.' } }]) =>
  ({ ...routeMessage(MSG), decision: 'answer', why: null, guard: null, entry: { id: 'lantern-saved', title: 'Lantern widgets', steps } });
test('over a saved entry: off by default, the saved entry stands and no model is asked', async () => {
  const f = fake({ write: goodDraft });
  const r = await composer(f).compose(MSG, savedRoute());
  assert.equal(r.entry.id, 'lantern-saved');
  assert.equal(f.calls.length, 0);
});
test('over a saved entry: on, a checked draft for this message replaces the saved entry and names it', async () => {
  const f = fake({ write: goodDraft });
  const r = await composer(f, { overSaved: true }).compose(MSG, savedRoute());
  assert.equal(r.decision, 'answer');
  assert.equal(r.path, 'composed');
  assert.equal(r.composer.overSaved, 'lantern-saved');
  assert.match(r.reason, /A saved entry \(lantern-saved\) matched the topic/);
});
test('over a saved entry: a sample message keeps its own checked saved reply, with no model call', async () => {
  const f = fake({ write: goodDraft });
  const r = await composer(f, { overSaved: true }).compose(MSG, savedRoute(), { keepSaved: true });
  assert.equal(r.entry.id, 'lantern-saved');
  assert.notEqual(r.path, 'composed');
  assert.equal(f.calls.length, 0);
});
test('over a saved entry: when the second read objects, the saved entry stands unchanged', async () => {
  const f = fake({ write: goodDraft, second: { verdict: 'stop', objections: [{ about: 'does not answer the question' }] } });
  const r0 = savedRoute();
  const r = await composer(f, { overSaved: true }).compose(MSG, r0);
  assert.equal(r.decision, 'answer');
  assert.equal(r.entry, r0.entry);
  assert.notEqual(r.path, 'composed');
  assert.equal(r.composer.fellBack, true);
});
test('over a saved entry: an entry that reads the account keeps its own reply', async () => {
  const f = fake({ write: goodDraft });
  const r = await composer(f, { overSaved: true }).compose(MSG, savedRoute([{ type: 'status', text: 'What your account shows.' }]));
  assert.equal(r.entry.id, 'lantern-saved');
  assert.equal(f.calls.length, 0);
});
