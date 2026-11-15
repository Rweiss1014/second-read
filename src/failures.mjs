// Mistakes teach.
// Every problem the desk sees (a solved ticket, a blocked reply, a question with no documented answer) goes
// into known-failures.md with its date, the words that matched or why it was blocked, and the fix. A repeat bumps "Times seen" instead of
// adding a twin. Every new ticket is checked against this list first.
import fs from 'node:fs';

const HEADER = `# Known failures

Every problem this desk has seen: tickets it solved, replies its checker blocked, questions the docs could not answer.
Each has the date, the words that matched it or why it was blocked, and the fix. Every new ticket is checked against this list first.
`;

export function readFailures(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const block of raw.replace(/\r\n/g, '\n').split(/\n(?=## )/)) {
    const h = block.match(/^## (.+)$/m);
    if (!h || !block.startsWith('## ')) continue;
    const get = (k) => block.match(new RegExp(`^- ${k}: (.*)$`, 'm'))?.[1]?.trim();
    // "Exact error" is read too, for files written before Nov 15, 2026, when every entry used that label.
    out.push({ id: h[1].trim(), title: get('What happened'), firstSeen: get('First seen'), lastSeen: get('Last seen'), times: Number(get('Times seen') || 1), matched: get('Matched words') || undefined, why: get('Why') || get('Exact error') || undefined, fix: get('Fix'), guard: get('Guard') || undefined, source: get('Source') });
  }
  return out;
}

// Each entry says what it really holds:
//   Matched words: the words in the ticket that picked the playbook entry (a solved ticket). Not an error.
//   Why: what the checker said when it blocked a reply, or why the desk refused to answer.
function render(list) {
  const one = (s) => String(s).replace(/\n/g, ' ');
  return HEADER + list.map(f => [
    `\n## ${f.id}`,
    `- What happened: ${f.title || f.id}`,
    `- First seen: ${f.firstSeen}`,
    `- Last seen: ${f.lastSeen}`,
    `- Times seen: ${f.times}`,
    ...(f.matched ? [`- Matched words: "${one(f.matched).replace(/^"|"$/g, '')}"`] : []),
    ...(f.why ? [`- Why: ${one(f.why)}`] : []),
    `- Fix: ${f.fix || 'not known yet'}`,
    ...(f.guard ? [`- Guard: ${f.guard}`] : []),
    ...(f.source ? [`- Source: ${f.source}`] : []),
  ].join('\n')).join('\n') + '\n';
}

// failure: { id, title, matched, why, fix, guard, source }. Returns { added, entry }.
export function recordFailure(file, failure, { now = new Date() } = {}) {
  const day = now.toISOString().slice(0, 10);
  const list = readFailures(file);
  const hit = list.find(f => f.id === failure.id);
  if (hit) { hit.lastSeen = day; hit.times += 1; hit.matched = failure.matched || hit.matched; hit.why = failure.why || hit.why; hit.fix = failure.fix || hit.fix; hit.title = failure.title || hit.title; }
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
