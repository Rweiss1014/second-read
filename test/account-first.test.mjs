// Account first (Nov 16, 2026): "did my posts go out?" and "which accounts are connected?" are answered from the
// customer's own account, read-only. The facts come from Blotato's records; no model writes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempDesk } from './helpers.mjs';
import { openDesk, handleTicket } from '../src/desk.mjs';

async function ask(text) {
  const { env } = tempDesk();
  const desk = openDesk({ env });
  const r = await handleTicket(desk, { id: null, text });
  await desk.close();
  return r;
}

test('"did my posts go out?" is answered from the account: counts, the newest post and the newest failure', async () => {
  const r = await ask('Hi, I set up a few posts this week and I am not sure they went out. Did they publish?');
  assert.equal(r.entry?.id, 'did-my-posts-go-out');
  assert.equal(r.evidence.kind, 'publish-check');
  assert.equal(r.evidence.ok, true);
  assert.ok(r.evidence.calls.some(c => /^GET \/v2\/posts\?since=/.test(c)), 'it read the posts list');
  assert.match(r.reply, /In the last 7 days, \d+ posts? went out/);
  assert.match(r.reply, /The newest failure was on \w+/);
  assert.doesNotMatch(r.reply, /SAMPLE-POST/, 'the practice account never puts a made-up link in a reply');
});

test('a named platform narrows the account answer to that platform', async () => {
  const r = await ask('quick one: did my instagram post go out yet?');
  assert.equal(r.entry?.id, 'did-my-posts-go-out');
  assert.equal(r.evidence.counts.platform, 'instagram');
  assert.match(r.reply, /\d+ Instagram posts? went out/);
});

test('"which accounts are connected?" lists them from the account, by platform', async () => {
  const r = await ask('can you show me which accounts I have connected?');
  assert.equal(r.entry?.id, 'which-accounts-connected');
  assert.equal(r.evidence.kind, 'connected-accounts');
  assert.ok(r.evidence.calls.some(c => /^GET \/v2\/users\/me\/accounts: \d+ account/.test(c)));
  assert.match(r.reply, /I see \d+ connected accounts?: /);
  // one account per item, handles as @handle, no brackets inside brackets, no raw placeholders
  assert.match(r.reply, /LinkedIn \(@samplecreator\)/);
  const line = r.reply.split('\n').find(l => /connected accounts?:/.test(l));
  assert.doesNotMatch(line, /\([^)]*\(|[<>]/);
});

test('asking about one platform says plainly whether it is connected', async () => {
  const r = await ask('is my pinterest account connected?');
  assert.equal(r.entry?.id, 'which-accounts-connected');
  assert.match(r.reply, /I do not see a Pinterest account\.|Yes, Pinterest is connected\./);
});

test('a published post that is missing from the feed still goes to its own entry, not the account summary', async () => {
  const r = await ask('It says my TikTok was published but I cannot find it on my TikTok profile. Did it go out?');
  assert.notEqual(r.entry?.id, 'did-my-posts-go-out');
});

test('the account answers never pass a guard: money still goes to a person', async () => {
  const r = await ask('did my posts go out? also you charged me twice this month');
  assert.notEqual(r.entry?.id, 'did-my-posts-go-out');
});
