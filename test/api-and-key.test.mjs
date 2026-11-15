import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, listPosts } from '../src/api.mjs';
import { loadKey, readEnvFile, redact } from '../src/env.mjs';
import { createLogger, summarizeLastRun } from '../src/log.mjs';
import { explain } from '../src/explain.mjs';
import { createMockApi } from '../src/mock.mjs';

const FAKE = 'FAKE-key-for-tests-0000000000000000000000==';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'support-desk-key-'));

test('the key comes from the environment first, then from .env in the repo folder', () => {
  const dir = tmp();
  const f = path.join(dir, '.env');
  fs.writeFileSync(f, `OTHER=x\nBLOTATO_API_KEY="${FAKE}"\n`);
  assert.equal(loadKey({ env: {}, envFile: f }), FAKE);
  assert.equal(loadKey({ env: { BLOTATO_API_KEY: 'from-env' }, envFile: f }), 'from-env');
  assert.equal(loadKey({ env: {}, envFile: path.join(dir, 'missing.env') }), undefined);
});

test('a .env with the key twice is refused, and the error never carries the value', () => {
  const f = path.join(tmp(), '.env');
  fs.writeFileSync(f, `BLOTATO_API_KEY=${FAKE}\nBLOTATO_API_KEY=${FAKE}2\n`);
  assert.throws(() => readEnvFile('BLOTATO_API_KEY', f), (e) => /2 times/.test(e.message) && !e.message.includes(FAKE));
});

test('the desk only reads: a write is refused before the key is read or the network is used', async () => {
  let calls = 0;
  const client = createClient({ env: { BLOTATO_API_KEY: FAKE }, fetchImpl: async () => { calls++; throw new Error('network used'); } });
  for (const m of ['POST', 'DELETE', 'PATCH', 'PUT']) await assert.rejects(client.request(m, '/posts', {}), /only reads\. Nothing was sent/);
  assert.equal(calls, 0);
});

test('the key goes only into the request header: never into logs, errors or summaries', async () => {
  const dir = tmp();
  const logger = createLogger({ dir, key: FAKE });
  let seenHeader;
  const fetchImpl = async (url, opts) => {
    seenHeader = opts.headers['blotato-api-key'];
    return new Response(JSON.stringify({ message: `bad key ${FAKE}` }), { status: 401, headers: { 'content-type': 'application/json' } });
  };
  const client = createClient({ env: { BLOTATO_API_KEY: FAKE }, logger, fetchImpl });
  await assert.rejects(listPosts(client), (e) => !e.message.includes(FAKE));
  assert.equal(seenHeader, FAKE);
  const logText = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  assert.ok(logText.length > 0);
  assert.ok(!logText.includes(FAKE), 'key found in the log');
  assert.match(logText, /"status":401/);
  assert.ok(!summarizeLastRun(dir).text.includes(FAKE));
  assert.equal(redact(`x blotato-api-key: ${FAKE} y`, FAKE).includes(FAKE), false);
});

test('with no key and no mock, the desk says what to do and sends nothing', async () => {
  let calls = 0;
  const client = createClient({ env: {}, fetchImpl: async () => { calls++; } });
  // loadKey also looks at <repo>/.env; the repo ships without one.
  if (fs.existsSync(path.resolve('.env'))) return;
  await assert.rejects(client.get('/users/me/accounts'), /No BLOTATO_API_KEY found/);
  assert.equal(calls, 0);
});

test('logs: one JSON line per event, and a plain summary of the last run', async () => {
  const dir = tmp();
  const logger = createLogger({ dir, mock: true });
  const client = createClient({ env: { BLOTATO_MOCK: '1' }, logger, mockApi: createMockApi() });
  await client.get('/users/me/accounts');
  await client.get('/schedules/sch_abc123');
  const s = summarizeLastRun(dir);
  assert.equal(s.calls, 2);
  assert.equal(s.failed, 1);
  assert.match(s.text, /sample data/);
  assert.match(s.text, /GET \/schedules\/sch_abc123 -> 500: invalid input syntax for type bigint/);
  const line = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8').split('\n')[1]);
  for (const k of ['time', 'run', 'action', 'method', 'path', 'requestId', 'status', 'ok', 'error']) assert.ok(k in line, k);
  assert.equal(line.upstreamRequestId, 'mock-req-0001');
});

test('mock responses follow the documented shapes', async () => {
  const client = createClient({ env: { BLOTATO_MOCK: '1' }, mockApi: createMockApi() });
  const acc = await client.get('/users/me/accounts');
  for (const a of acc.data.items) assert.deepEqual(Object.keys(a).sort(), ['fullname', 'id', 'platform', 'username']);
  const posts = await listPosts(client, {});
  for (const p of posts) {
    for (const k of ['id', 'postTime', 'platform', 'text', 'mediaUrls', 'account', 'state']) assert.ok(k in p, k);
    assert.ok(['scheduled', 'published', 'failed'].includes(p.state.type));
  }
  const sch = await client.get('/schedules');
  assert.equal(typeof sch.data.count, 'string');
  assert.equal((await client.get('/posts/not-a-real-id')).data.status, 'in-progress');
  assert.equal((await client.get('/schedules/999')).status, 404);
});

test('explain: known errors in plain words with their source, unknown errors shown exactly and never guessed', () => {
  const k = explain('Account 98499 not found');
  assert.equal(k.known, true);
  assert.match(k.source, /^https:\/\/help\.blotato\.com\//);
  assert.equal(explain('Unauthorized').id, 'bad-key');
  assert.equal(explain('', { status: 429 }).id, 'blotato-rate-limit');
  const u = explain('Zorp failed at stage 7');
  assert.equal(u.known, false);
  assert.equal(u.raw, 'Zorp failed at stage 7');
  assert.match(u.plain, /rather show it to you than guess/);
});
