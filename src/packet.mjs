// The review packet for the fresh checker (.claude/agents/reply-checker.md).
// One builds, one checks: the checker gets ONLY three things.
//   1. the reply, exactly as the customer would get it
//   2. the text of each cited help page around the quoted sentence (as fetched, with the date)
//   3. the status evidence (which read-only calls were made, and what they answered)
// It never gets the writer's notes: no playbook entry, no step types, no escalation reasons, no doc-edit notes.
import { normalizeText } from './docs.mjs';
import { replyHash, reviewName } from './checkreply.mjs';

// A lighter clean-up than the quote matcher's: it keeps underscores and ids as written ("sch_abc123"),
// so the checker reads the page's real words. Found by the first fresh-checker round: the old version showed
// "schabc123" and the checker rightly said the step did not match.
const light = (s) => String(s ?? '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\\_/g, '_').replace(/[*`\\]/g, '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();

// The words around a quote on a page, so the checker can judge the step in context.
export function around(pageText, quote, radius = 400) {
  const clean = light(pageText);
  const q = light(quote);
  let at = clean.toLowerCase().indexOf(q.toLowerCase());
  let len = q.length;
  if (at < 0) {
    // Fall back to the matcher's normalized text (underscores dropped), and say so.
    const n = normalizeText(pageText); const nq = normalizeText(quote);
    at = n.indexOf(nq); len = nq.length;
    if (at < 0) return null;
    return `(shown with formatting removed) ...${n.slice(Math.max(0, at - radius), at + len + radius)}...`;
  }
  const start = Math.max(0, at - radius);
  const end = Math.min(clean.length, at + len + radius);
  return `${start > 0 ? '...' : ''}${clean.slice(start, end)}${end < clean.length ? '...' : ''}`;
}

export function buildPacket(d, { mock = false } = {}) {
  if (!d.reply) return null;
  const name = reviewName(d.ticket);
  const lines = [
    `# Reply to check: ${name}`,
    '',
    `Reply hash (sha256): ${replyHash(d.reply)}`,
    `Write your verdict to: desk/reviews/${name}.json`,
    '',
    '## 1. The reply',
    '',
    '```text',
    d.reply.trim(),
    '```',
    '',
    '## 2. What the cited help pages say',
    '',
  ];
  const steps = d.steps || [];
  let cited = 0;
  steps.forEach((s, i) => {
    if (!s.cite) return;
    cited++;
    const page = d.pages?.[s.cite.url];
    lines.push(`### Step ${i + 1} cites ${s.cite.url}`);
    if (!page) { lines.push('', 'This page could not be read. Treat the step as unsupported.', ''); return; }
    lines.push(`Fetched ${page.fetchedAt.slice(0, 10)} (${page.via}).`, '', `Quoted sentence: "${s.cite.quote.replace(/`/g, '')}"`, '');
    const ctx = around(page.text, s.cite.quote);
    lines.push(ctx ? `Around it on the page:\n\n> ${ctx}` : 'The quoted sentence is NOT on this page as fetched.', '');
  });
  if (!cited) lines.push('No step cites a help page.', '');
  lines.push('## 3. Status evidence', '');
  if (d.evidence) {
    lines.push(`What was looked up: ${(d.evidence.calls || []).join(' | ') || 'no calls'}`);
    lines.push(`Did the lookup succeed: ${d.evidence.ok ? 'yes' : 'no'}`);
    lines.push(`What it found: ${d.evidence.summary || 'nothing'}`);
    if (mock && d.evidence.kind !== 'docs-search') lines.push('(Sample account data, no account connected.)');
  } else lines.push('No account lookup was made for this reply.');
  lines.push('');
  // What the desk itself produced alongside the reply, so a step that says "I am passing this on" can be checked.
  lines.push('## 4. What the desk did alongside this reply', '');
  lines.push(`Escalation packet written for the founder: ${d.escalation ? 'yes (the support person sends it with this reply)' : 'no'}`);
  lines.push(`Help-doc edit proposed: ${d.docEdit ? `yes, for ${d.docEdit.article} (a proposal; nothing is published)` : 'no'}`);
  lines.push('');
  return { name, hash: replyHash(d.reply), text: lines.join('\n') };
}
