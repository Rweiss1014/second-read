// Mistakes teach.
// Every problem the desk sees (a solved ticket, a blocked reply, a question with no documented answer) goes
// into known-failures.md with its date, the exact error and the fix. A repeat bumps "Times seen" instead of
// adding a twin. Every new ticket is checked against this list first.
import fs from 'node:fs';

const HEADER = `# Known failures

Every problem this desk has seen: tickets it solved, replies its checker blocked, questions the docs could not answer.
Each has the date, the exact error and the fix. Every new ticket is checked against this list first.
`;

export function readFailures(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const block of raw.replace(/\r\n/g, '\n').split(/\n(?=## )/)) {
    const h = block.match(/^## (.+)$/m);
    if (!h || !block.startsWith('## ')) continue;
    const get = (k) => block.match(new RegExp(`^- ${k}: (.*)$`, 'm'))?.[1]?.trim();
    out.push({ id: h[1].trim(), title: get('What happened'), firstSeen: get('First seen'), lastSeen: get('Last seen'), times: Number(get('Times seen') || 1), error: get('Exact error'), fix: get('Fix'), guard: get('Guard') || undefined, source: get('Source') });
  }
  return out;
}

function render(list) {
  return HEADER + list.map(f => [
    `\n## ${f.id}`,
    `- What happened: ${f.title || f.id}`,
    `- First seen: ${f.firstSeen}`,
    `- Last seen: ${f.lastSeen}`,
    `- Times seen: ${f.times}`,
    `- Exact error: ${String(f.error || '').replace(/\n/g, ' ')}`,
    `- Fix: ${f.fix || 'not known yet'}`,
    ...(f.guard ? [`- Guard: ${f.guard}`] : []),
    ...(f.source ? [`- Source: ${f.source}`] : []),
  ].join('\n')).join('\n') + '\n';
}

// failure: { id, title, error, fix, guard, source }. Returns { added, entry }.
export function recordFailure(file, failure, { now = new Date() } = {}) {
  const day = now.toISOString().slice(0, 10);
  const list = readFailures(file);
  const hit = list.find(f => f.id === failure.id);
  if (hit) { hit.lastSeen = day; hit.times += 1; hit.error = failure.error || hit.error; }
  else list.push({ ...failure, firstSeen: day, lastSeen: day, times: 1 });
  fs.writeFileSync(file, render(list));
  return { added: !hit, entry: hit || list[list.length - 1] };
}

export function ensureFailuresFile(file) { if (!fs.existsSync(file)) fs.writeFileSync(file, HEADER); }

// A stable id for an error we do not recognize, so the same unknown error is counted once.
export function unknownId(text) {
  const words = String(text).toLowerCase().replace(/\d+/g, '#').replace(/[^a-z# ]+/g, ' ').trim().split(/\s+/).slice(0, 6).join('-');
  return `unknown-${words || 'empty'}`;
}
