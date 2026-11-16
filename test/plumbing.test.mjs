// Plumbing: sample data that holds still, dates a person would write, the saved-check store, the practice words.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempDesk } from './helpers.mjs';
import { openDesk, handleTicket } from '../src/desk.mjs';
import { when, whenRaw } from '../src/diagnose.mjs';
import { createMockApi, MOCK_NOW } from '../src/mock.mjs';
import { TICKETS } from '../knowledge/playbook.mjs';
import { replyHash, lookupCheck, clearedToSend, freshState, recordCheck, storedCheckFrom } from '../src/checkreply.mjs';
import { buildPacket } from '../src/packet.mjs';

async function buildAll(clock) {
  const { env } = tempDesk();
  const real = Date.now;
  if (clock) Date.now = clock;
  const desk = openDesk({ env, now: clock });
  const out = [];
  try { for (const t of TICKETS) { const r = await handleTicket(desk, t); out.push({ id: t.id, reply: r.reply, packet: r.reply ? buildPacket(r, { mock: true }).text.replace(/sd-[0-9a-f-]{36}/g, 'sd-REQUEST') : null }); } }
  finally { Date.now = real; await desk.close(); }
  return out;
}

// Piece 1
test('sample data holds still: all 12 replies and packets are byte-identical under a later clock', async () => {
  const a = await buildAll();
  const later = Date.now() + 40 * 864e5;
  const b = await buildAll(() => later);
  assert.equal(a.length, 12);
  for (let i = 0; i < a.length; i++) { assert.equal(b[i].reply, a[i].reply, a[i].id); assert.equal(b[i].packet, a[i].packet, a[i].id); }
});

test('the sample account has fixed dates and plainly-sample links', () => {
  const src = fs.readFileSync(new URL('../src/mock.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Date\.now|SIX_HOURS|steadyNow/);
  assert.doesNotMatch(src, /example\.com\/sample-(instagram|published)-post/);
  const api = createMockApi();
  const { data } = api.handle('GET', '/posts?since=2026-11-01T00:00:00Z&until=2026-12-01T00:00:00Z');
  assert.ok(data.items.length >= 5);
  assert.ok(data.items.find(i => i.platform === 'instagram').state.postUrl.startsWith('https://www.instagram.com/p/SAMPLE-POST'));
  assert.equal(MOCK_NOW, Date.parse('2026-11-15T12:00:00Z'));
});

// Piece 2
test('dates read the way a person writes them, with the same moment and the time zone named', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  assert.equal(when('2026-11-15T19:00:00Z', now), 'Sunday, Nov 15, at 7:00 pm UTC');
  assert.equal(when('2026-11-15T00:05:00Z', now), 'Sunday, Nov 15, at 12:05 am UTC');
  assert.equal(when('2026-11-15T12:30:00Z', now), 'Sunday, Nov 15, at 12:30 pm UTC');
  assert.equal(when('2027-01-02T12:00:00Z', now), 'Saturday, Jan 2, 2027, at 12:00 pm UTC');
  assert.equal(whenRaw('2026-11-15T19:00:00Z'), 'Sun, 15 Nov 2026 19:00:00 UTC');
});

test('a customer reply has no raw stamp and no post id; the packet and escalation keep them', async () => {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, TICKETS.find(t => t.id === 'T01'));
  await desk.close();
  assert.doesNotMatch(r.reply, /\b\d{2}:\d{2}:\d{2}\b|\bGMT\b|post \d{5}|\(id \d+\)/);
  assert.match(r.reply, /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), Nov \d+, at \d+:\d\d (am|pm) UTC/);
  assert.match(r.evidence.technical, /\d{2}:\d{2}:\d{2} UTC \(post \d+\)/);
  assert.match(buildPacket(r, { mock: true }).text, /\(post \d+\)/);
});

// Piece 3
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'checks-'));
const passFor = (text, extra = {}) => ({ replySha256: replyHash(text), verdict: 'pass', findings: [], checkedAt: '2026-11-15T21:12:43Z', checker: 'reply-checker', model: 'test-model', ...extra });
const putStore = (dir, v) => fs.writeFileSync(path.join(dir, `${v.replySha256}.json`), JSON.stringify(v));

test('a stored pass clears exactly that text; one changed character does not', () => {
  const checksDir = tmpDir();
  putStore(checksDir, passFor('Hello there.'));
  const hit = lookupCheck('Hello there.', { checksDir });
  assert.equal(hit.state, 'pass'); assert.equal(hit.source, 'store'); assert.equal(hit.checkedAt, '2026-11-15T21:12:43Z');
  assert.equal(lookupCheck('Hello there!', { checksDir }).state, 'none');
  assert.equal(lookupCheck('Hello there. ', { checksDir }).state, 'pass', 'the hash trims, as it always has');
});

test('a block never clears, in the store or in desk/reviews', () => {
  const checksDir = tmpDir(); const reviewsDir = tmpDir();
  putStore(checksDir, { ...passFor('Text A'), verdict: 'block' });
  assert.equal(lookupCheck('Text A', { checksDir }).state, 'none');
  fs.writeFileSync(path.join(reviewsDir, 'X.json'), JSON.stringify({ ...passFor('Text B'), verdict: 'block', findings: ['step 1 overstates'] }));
  const hit = lookupCheck('Text B', { checksDir, reviewsDir });
  assert.equal(hit.state, 'block');
  fs.writeFileSync(path.join(reviewsDir, 'X.reply.txt'), 'Text B');
  assert.equal(clearedToSend(reviewsDir, 'X', { checksDir }).ok, false);
});

test('the store is looked in first, desk/reviews second', () => {
  const checksDir = tmpDir(); const reviewsDir = tmpDir();
  fs.writeFileSync(path.join(reviewsDir, 'D.json'), JSON.stringify(passFor('Only on this desk')));
  assert.equal(lookupCheck('Only on this desk', { checksDir, reviewsDir }).source, 'desk');
  putStore(checksDir, passFor('Only on this desk', { checkedAt: '2026-11-14T10:00:00Z' }));
  const hit = lookupCheck('Only on this desk', { checksDir, reviewsDir });
  assert.equal(hit.source, 'store'); assert.equal(hit.checkedAt, '2026-11-14T10:00:00Z');
});

test('a typed message that earns a stored text is reported as checked, with the stored date', async () => {
  const t = tempDesk();
  const desk = openDesk({ env: t.env });
  const first = await handleTicket(desk, { id: null, text: TICKETS.find(x => x.id === 'T05').text });
  assert.equal(first.fresh.state, 'none');
  fs.mkdirSync(t.env.SUPPORT_CHECKS_DIR, { recursive: true });
  putStore(t.env.SUPPORT_CHECKS_DIR, passFor(first.reply, { checkedAt: '2026-11-15T20:00:00Z' }));
  const again = await handleTicket(desk, { id: null, text: TICKETS.find(x => x.id === 'T05').text });
  await desk.close();
  assert.equal(again.fresh.state, 'passed');
  assert.equal(again.fresh.checkedAt, '2026-11-15T20:00:00Z');
  assert.match(again.status, /cleared to send/);
  assert.equal(freshState(path.join(t.env.SUPPORT_DESK_DIR, 'reviews'), { ticket: { id: null, text: 'x' }, reply: first.reply }, { checksDir: t.env.SUPPORT_CHECKS_DIR }).state, 'passed');
});

test('record-check: a pass for packed text is stored; a pass for unpacked text is refused; a block stores nothing', () => {
  const checksDir = tmpDir();
  const known = new Map([[replyHash('Packed text'), { entry: 'some-entry' }]]);
  const ok = recordCheck(passFor('Packed text'), { known, checksDir });
  assert.equal(ok.recorded, true);
  const file = JSON.parse(fs.readFileSync(path.join(checksDir, `${replyHash('Packed text')}.json`), 'utf8'));
  assert.deepEqual(Object.keys(file).sort(), ['checkedAt', 'checker', 'entry', 'findings', 'model', 'replySha256', 'verdict']);
  const unknown = recordCheck(passFor('Never packed'), { known, checksDir });
  assert.equal(unknown.ok, false); assert.match(unknown.why, /nobody packed/);
  assert.equal(fs.existsSync(path.join(checksDir, `${replyHash('Never packed')}.json`)), false);
  const blk = recordCheck({ ...passFor('Packed text'), verdict: 'block', findings: ['bad'] }, { known, checksDir: tmpDir() });
  assert.equal(blk.recorded, false); assert.equal(blk.entry, 'some-entry'); assert.deepEqual(blk.findings, ['bad']);
  assert.equal(recordCheck({ verdict: 'pass' }, { known, checksDir }).ok, false);
  assert.equal(recordCheck({ ...passFor('Packed text'), verdict: 'maybe' }, { known, checksDir }).ok, false);
  assert.equal(storedCheckFrom({ ...passFor('x'), customerMessage: 'private' }).customerMessage, undefined);
});

test('packets --all: one packet per distinct text, skips stored texts; record-check refuses unpacked hashes', async () => {
  const { buildAllPackets, recordChecks } = await import('../src/allpackets.mjs');
  const { ENTRY_BY_ID } = await import('../knowledge/playbook.mjs');
  const t = tempDesk();
  const desk = openDesk({ env: t.env });
  const entries = ['canceled-status', 'api-401', 'staff-action'].map(id => ENTRY_BY_ID.get(id));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'packets-'));
  const idx = await buildAllPackets(desk, { outDir: out, entries });
  assert.equal(idx.counts.packets, 3);
  for (const i of idx.items) {
    assert.ok(fs.existsSync(path.join(out, i.packet)));
    assert.equal(i.packet, `${i.sha256}.packet.md`);
    const txt = fs.readFileSync(path.join(out, i.packet), 'utf8');
    assert.ok(txt.includes(`Reply hash (sha256): ${i.sha256}`));
    assert.doesNotMatch(txt, /needs_person_if|phrasings|anchors/);
  }
  assert.ok(idx.items.some(i => i.kind.startsWith('holding')));
  // a checker's passes: one for a packed text, one for an unpacked text
  const first = idx.items[0];
  const good = path.join(out, first.verdictFile);
  fs.writeFileSync(good, JSON.stringify({ replySha256: first.sha256, verdict: 'pass', findings: [], checkedAt: '2026-11-15T22:00:00Z', checker: 'reply-checker' }));
  const bad = path.join(out, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ replySha256: replyHash('nobody packed this'), verdict: 'pass', findings: [], checkedAt: '2026-11-15T22:00:00Z', checker: 'reply-checker' }));
  const res = recordChecks({ files: [good, bad], indexFile: path.join(out, 'index.json'), checksDir: t.env.SUPPORT_CHECKS_DIR });
  assert.equal(res[0].recorded, true); assert.equal(res[1].ok, false);
  // run it again: the recorded text is skipped, the other two still get packets
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'packets-'));
  const idx2 = await buildAllPackets(desk, { outDir: out2, entries });
  await desk.close();
  assert.equal(idx2.counts.alreadyChecked, 1); assert.equal(idx2.counts.packets, 2);
  assert.equal(idx2.items.find(i => i.sha256 === first.sha256).alreadyChecked, true);
});
