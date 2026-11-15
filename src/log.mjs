// Plain JSON lines, one per event, in <desk>/logs/post-desk-YYYY-MM-DD.jsonl.
// Each line: time, run, action, method, path, requestId, status, ok, error. Never the key, never the post text.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { redact } from './env.mjs';

export function newRunId() { return `run-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`; }
export function newRequestId() { return `pd-${crypto.randomUUID()}`; }

export function createLogger({ dir, run = newRunId(), key, mock = false }) {
  const write = (entry) => {
    const line = { time: new Date().toISOString(), run, mock, ...entry };
    if (line.error) line.error = redact(line.error, key);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `post-desk-${line.time.slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, redact(JSON.stringify(line), key) + '\n');
    return line;
  };
  return { run, write };
}

export function readLogLines(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => /^post-desk-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  const lines = [];
  for (const f of files) {
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { lines.push(JSON.parse(l)); } catch { lines.push({ action: 'unreadable-line', raw: l.slice(0, 200) }); }
    }
  }
  return lines;
}

// "What happened last time?" in a few lines: the last run's calls, what failed, and the request ids to quote.
export function summarizeLastRun(dir) {
  const lines = readLogLines(dir);
  if (!lines.length) return { run: null, text: 'No runs logged yet.' };
  const run = lines[lines.length - 1].run;
  const mine = lines.filter(l => l.run === run);
  const calls = mine.filter(l => l.method);
  const failed = mine.filter(l => l.ok === false || l.error);
  const byStatus = {};
  for (const c of calls) byStatus[c.status ?? 'none'] = (byStatus[c.status ?? 'none'] || 0) + 1;
  const out = [];
  out.push(`Last run: ${run}${mine[0]?.mock ? ' (sample data, no account connected)' : ''}`);
  out.push(`From ${mine[0].time} to ${mine[mine.length - 1].time}, ${mine.length} log lines.`);
  out.push(`API calls: ${calls.length}${calls.length ? ` (${Object.entries(byStatus).map(([s, n]) => `${n} x ${s}`).join(', ')})` : ''}`);
  const actions = [...new Set(mine.map(l => l.action))];
  out.push(`Steps: ${actions.join(', ')}`);
  if (!failed.length) out.push('Nothing failed.');
  else {
    out.push(`${failed.length} problem(s):`);
    for (const f of failed) out.push(`  - ${f.action}${f.method ? ` ${f.method} ${f.path}` : ''}${f.status ? ` -> ${f.status}` : ''}: ${f.error || 'not ok'}${f.requestId ? ` (request ${f.requestId})` : ''}`);
  }
  return { run, calls: calls.length, failed: failed.length, text: out.join('\n'), lines: mine };
}
