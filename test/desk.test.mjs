import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDesk } from './helpers.mjs';
import { openDesk, handleTicket, runShift, morning } from '../src/desk.mjs';
import { TICKETS, matchEntry, PAGES } from '../knowledge/playbook.mjs';
import { readFailures } from '../src/failures.mjs';
import { replyHash } from '../src/checkreply.mjs';

test('each of the 12 sample tickets goes to the playbook entry it was written for', () => {
  for (const t of TICKETS) assert.equal(matchEntry(t.text)?.id, t.expect, `${t.id}: ${t.text}`);
});

// Offline tests stand in for Blotato's docs search with one fixed, empty-of-answers result.
const fakeSearch = async (query) => ({ offline: false, results: [{ title: 'API keys', url: 'https://help.blotato.com/settings/api-keys', excerpt: `nothing about ${query}` }] });

test('with the docs search offline, the test-mode ticket is blocked: no search, no claim', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, TICKETS.find(t => t.id === 'T12'));
  await desk.close();
  assert.equal(r.check.pass, false);
  assert.match(r.check.problems.join(' '), /the docs search was offline/);
});

test('a full shift in mock mode: 12 tickets, every reply checked, a handoff written', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  desk.docs.search = fakeSearch;
  const results = await runShift(desk);
  await desk.close();
  assert.equal(results.length, 12);
  for (const r of results) assert.equal(r.check.pass, true, `${r.ticket.id}: ${r.check.problems.join(' | ')}`);
  for (const r of results) {
    const n = r.steps.length;
    assert.ok(n >= 3 && n <= 5, `${r.ticket.id} has ${n} steps`);
    assert.equal(r.reply.split('\n').filter(l => l.startsWith('Next step:')).length, 1);
  }
  const handoff = fs.readFileSync(path.join(env.SUPPORT_DESK_DIR, 'HANDOFF.md'), 'utf8');
  for (const h of ['## Tickets (12)', '## Ready to send, checked (12)', '## Blocked by the checker (0)', '## Waiting on the founder (3)', '## Help-doc edits proposed (2)', '## Next step']) assert.ok(handoff.includes(h), h);
  assert.ok(handoff.includes('sample data'));
});

test('a status ticket rests on a real lookup: in-progress for an unknown id, as the docs warn', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, TICKETS.find(t => t.id === 'T10'));
  await desk.close();
  assert.equal(r.evidence.ok, true);
  assert.equal(r.evidence.status, 'in-progress');
  assert.match(r.reply, /does not prove the post exists or failed/);
});

test('the schedule-id ticket is reproduced, escalated with two causes, and gets a doc-edit diff', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, TICKETS.find(t => t.id === 'T11'));
  await desk.close();
  assert.equal(r.evidence.ok, true);
  assert.equal(r.evidence.status, 500);
  assert.equal(r.escalation.causes.length, 2);
  assert.match(r.escalationText, /Ruled out/);
  assert.match(r.docEditText, /- "id": "sch_abc123",\n\+ "id": "5100001",/);
  assert.match(r.docEditText, /Nothing is published by the desk/);
});

test('a question with no playbook entry gets no reply: it is refused, escalated and turned into a doc edit', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, { id: 'X1', text: 'Can Blotato post to my Mastodon server?' });
  await desk.close();
  assert.equal(r.entry, null);
  assert.equal(r.reply, null);
  assert.equal(r.check.pass, false);
  assert.match(r.refused, /will not write a reply/);
  assert.match(r.docEditText, /\[Answer to confirm with the founder\.\]/);
  assert.equal(r.status, 'refused: no documented answer');
});

test('mistakes teach: a solved ticket is recorded, a repeat is "seen before", and a blocked reply is recorded as blocked', async () => {
  const { env } = tempDesk();
  let desk = openDesk({ env });
  const t = TICKETS.find(x => x.id === 'T06');
  const first = await handleTicket(desk, t);
  assert.equal(first.seenBefore.length, 0);
  const second = await handleTicket(desk, t);
  assert.equal(second.seenBefore[0].id, 'api-401');
  assert.equal(second.seenBefore[0].times, 1);
  await desk.close();
  let list = readFailures(path.join(env.SUPPORT_DESK_DIR, 'known-failures.md'));
  assert.equal(list.find(f => f.id === 'api-401').times, 2);
  assert.match(list.find(f => f.id === 'api-401').error, /401/);

  // Now break the auth page in the cache so the cited sentence is gone: the reply must be blocked and recorded.
  const broken = tempDesk({ extraPages: { [PAGES.auth]: '# Access and authentication\nThis page changed.' } });
  broken.env.SUPPORT_DESK_DIR = env.SUPPORT_DESK_DIR;
  desk = openDesk({ env: broken.env });
  const third = await handleTicket(desk, t);
  await desk.close();
  assert.equal(third.check.pass, false);
  assert.equal(third.status, 'blocked');
  list = readFailures(path.join(env.SUPPORT_DESK_DIR, 'known-failures.md'));
  assert.ok(list.find(f => f.id === 'blocked-api-401'));
});

test('the fresh checker\'s verdict counts only for the exact reply it read', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const t = TICKETS.find(x => x.id === 'T02');
  const r = await handleTicket(desk, t);
  const reviews = path.join(env.SUPPORT_DESK_DIR, 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  fs.writeFileSync(path.join(reviews, 'T02.json'), JSON.stringify({ verdict: 'pass', replySha256: replyHash(r.reply) }));
  assert.equal((await handleTicket(desk, t)).check.pass, true);
  fs.writeFileSync(path.join(reviews, 'T02.json'), JSON.stringify({ verdict: 'pass', replySha256: replyHash(r.reply + ' changed') }));
  assert.match((await handleTicket(desk, t)).check.problems.join(' '), /different version/);
  fs.writeFileSync(path.join(reviews, 'T02.json'), JSON.stringify({ verdict: 'block', replySha256: replyHash(r.reply), findings: ['step 2 says more than the quote'] }));
  assert.match((await handleTicket(desk, t)).check.problems.join(' '), /step 2 says more than the quote/);
  await desk.close();
});

test('the morning note explains what failed in the last 24 hours, read-only', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const m = await morning(desk);
  await desk.close();
  assert.equal(m.error, null);
  assert.equal(m.failed.length, 2); // the sample failure from 26 hours ago is outside the window
  const note = fs.readFileSync(path.join(env.SUPPORT_DESK_DIR, 'MORNING.md'), 'utf8');
  assert.match(note, /The account id does not match a connected account/);
  assert.match(note, /I do not recognize this error yet/);
  assert.match(note, /Exact error: "Unsupported media type"/);
});
