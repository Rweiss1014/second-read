// One builds, one checks.
// The checker never sees how the reply was written. It gets the reply's steps, the pages they cite and the
// status evidence, and tries to break it. Any problem blocks the reply and says why.
//
// What this script can prove: every cited sentence is really on the cited page (as fetched, with the date),
// every evidence step rests on a lookup that succeeded, no line of the reply matches the promise patterns
// below, and the reply has the shape customers can follow (3 to 5 numbered steps, one next step).
// What it cannot prove: that a step's own wording is faithful to its quote, or that a promise worded some
// other way is absent. That deeper read is the job of the reply-checker subagent (.claude/agents/reply-checker.md).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { quoteOnPage, normalizeText } from './docs.mjs';

// The promise check runs on every line of the reply: greeting, opening, every step, next step, proof line.
// Each pattern names one kind of promise. A step that quotes a help page may repeat the page's own words
// (a faithful quote is the page speaking, not us), but any promise words beyond the quote still block.
const MODAL = String.raw`(?:will|'ll|shall|should|going to)`;
const UNIT = String.raw`(?:minutes?|hours?|days?|weeks?|months?|business days?)`;
const COUNT = String.raw`(?:a|an|one|two|three|four|five|a few|\d+(?:\s?-\s?\d+)?)`;
const DAY = String.raw`(?:today|tonight|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|end of (?:the )?(?:day|week|month))`;
const OUTCOME = String.raw`(?:(?:fix|resolv|solv|process|publish|succeed|arriv|appear|clear|stop)\w*|work(?:s|ed)?\b|sorted\b|go(?:es)? through|post(?:ed)?\b|back\b|come back)`;
export const PROMISES = [
  { why: 'a promise or a guarantee', re: /\b(?:promise[sd]?|guarantee[sd]?|assure you|you have my word)\b/i },
  { why: 'a refund or credit', re: /\b(?:refund(?:ed)?|credit(?:ed)?|reimburse[sd]?|compensate[sd]?)\s+(?:you|your)\b/i },
  { why: 'a refund or credit', re: new RegExp(String.raw`\b${MODAL}\b[^.!?\n]*?\b(?:refund|credit|reimburs|money back|compensat)\w*`, 'i') },
  { why: 'an outcome nobody has checked', re: new RegExp(String.raw`\b${MODAL}\s+(?:(?:definitely|certainly|surely|now|soon|then)\s+)?(?:be\s+|have\s+(?:it|this|that)\s+)?${OUTCOME}`, 'i') },
  { why: 'an outcome nobody has checked', re: /\b(?:this|that|it|which)\s+(?:fixes|solves|resolves)\b/i },
  { why: 'an outcome nobody has checked', re: /\b(?:definitely|certainly|for sure|100%|never (?:fails?|happens?)|won'?t happen again|always works?)\b/i },
  { why: 'a date or time nobody can promise', re: new RegExp(String.raw`\bby\s+${DAY}\b`, 'i') },
  { why: 'a date or time nobody can promise', re: new RegExp(String.raw`\bwithin\s+${COUNT}\s*${UNIT}\b`, 'i') },
  { why: 'a date or time nobody can promise', re: new RegExp(String.raw`\b${MODAL}\b[^.!?\n]*?\b(?:in\s+${COUNT}\s*${UNIT}|on\s+${DAY}|${DAY})\b`, 'i') },
];

// Every promise in a piece of text. With `quote` (a cited help-page sentence), words the quote itself says are allowed.
export function findPromises(text, { quote } = {}) {
  const q = quote ? normalizeText(quote) : null;
  const hits = [];
  for (const p of PROMISES) {
    for (const m of String(text || '').matchAll(new RegExp(p.re.source, 'gi'))) {
      if (q && q.includes(normalizeText(m[0]))) continue;
      hits.push({ words: m[0], why: p.why });
    }
  }
  return hits;
}

const VOICE = [
  { re: /—/, why: 'an em dash' },
  { re: /\bsimply\b/i, why: '"simply"' },
  { re: /\bobviously\b/i, why: '"obviously"' },
  { re: /\bjust (click|do|run|add|open|copy|go|send|use)\b/i, why: 'a "just" that makes a step sound easy' },
  { re: /\b(game.?changer|revolutionary|10x|seamless(ly)?|effortless(ly)?|leverage)\b/i, why: 'a hype word' },
];

export const replyHash = (reply) => crypto.createHash('sha256').update(String(reply || '').trim()).digest('hex');
// The file name a review is saved under: the sample ticket's id, or a short hash of a pasted message.
export const reviewName = (ticket) => ticket?.id || `pasted-${replyHash(ticket?.text).slice(0, 12)}`;

export function checkReply(d, { reviewsDir, requireReview = false } = {}) {
  const problems = [];
  const citations = [];
  if (!d.reply) return { pass: false, problems: ['There is no reply to check. The desk refused to answer without a documented source.'], citations };

  const steps = d.steps || [];
  if (steps.length < 3 || steps.length > 5) problems.push(`The reply has ${steps.length} steps. Customers follow 3 to 5.`);
  const nextLines = d.reply.split('\n').filter(l => /^Next step:/.test(l));
  if (nextLines.length !== 1) problems.push('The reply needs exactly one "Next step:" line.');
  // Blotato's response contract also asks for what proves success (or what is still open) and a link.
  if (!/^(You will know it|Still open:)/m.test(d.reply)) problems.push('The reply does not say what proves success or what is still open.');
  if (!/https:\/\/help\.blotato\.com\//.test(d.reply)) problems.push('The reply has no link to a help page.');

  steps.forEach((s, i) => {
    const n = i + 1;
    if (s.type === 'fact') {
      if (!s.cite?.url || !s.cite?.quote) { problems.push(`Step ${n} states a fact with no source.`); return; }
      const page = d.pages?.[s.cite.url];
      const found = quoteOnPage(s.cite.quote, page);
      citations.push({ step: n, url: s.cite.url, quote: s.cite.quote, found, fetchedAt: page?.fetchedAt || null, via: page?.via || null });
      if (!page) problems.push(`Step ${n} cites ${s.cite.url}, but that page could not be read, so the claim cannot be checked.`);
      else if (!found) problems.push(`Step ${n} cites "${s.cite.quote}", but that sentence is not on ${s.cite.url} (fetched ${page.fetchedAt.slice(0, 10)}).`);
    } else if (s.type === 'evidence') {
      if (!d.evidence) problems.push(`Step ${n} rests on a lookup, but no lookup was made.`);
      else if (!d.evidence.ok) problems.push(`Step ${n} rests on a lookup that did not succeed: ${d.evidence.summary}`);
    } else if (s.type !== 'action') problems.push(`Step ${n} has an unknown type.`);
  });

  // Promises, on every line. A step line is checked against its own quote; every other line has no quote.
  const stepAt = new Map(steps.map((s, i) => [`${i + 1}. ${s.text}`, { s, n: i + 1 }]));
  const seen = new Set();
  for (const line of [...d.reply.split('\n'), ...stepAt.keys()]) {
    if (seen.has(line)) continue;
    seen.add(line);
    const at = stepAt.get(line);
    const hits = findPromises(line, { quote: at?.s.type === 'fact' ? at.s.cite?.quote : undefined });
    for (const h of hits) problems.push(at
      ? `Step ${at.n} makes ${h.why} ("${h.words}")${at.s.type === 'fact' ? ', and its quote does not say that' : ''}.`
      : `The line "${line}" makes ${h.why} ("${h.words}").`);
  }

  for (const v of VOICE) if (v.re.test(d.reply)) problems.push(`The reply uses ${v.why}.`);

  // The subagent's verdict (written by .claude/agents/reply-checker.md), bound to this exact reply text.
  let review = null;
  if (reviewsDir) {
    const f = path.join(reviewsDir, `${reviewName(d.ticket)}.json`);
    try { review = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { review = null; }
    if (review) {
      // A verdict for an older text does not apply to this one. It blocks only when this run requires a review
      // (a live lookup can change the text from run to run; the saved copy is what "cleared" checks).
      if (review.replySha256 !== replyHash(d.reply)) { if (requireReview) problems.push('The fresh checker reviewed a different version of this reply. Review it again.'); review = null; }
      else if (review.verdict !== 'pass') problems.push(`The fresh checker blocked it: ${(review.findings || []).join('; ') || 'no reason given'}`);
    } else if (requireReview) problems.push('No fresh-checker verdict yet, and this run requires one.');
  }

  return { pass: !problems.length, problems, citations, review: review ? { verdict: review.verdict, checkedAt: review.checkedAt } : null };
}

// The send gate. Live evidence (times, search results) can change between runs, so the gate reads the reply
// exactly as it was saved for the checker, and passes only if the checker's verdict is a pass for that text.
export function clearedToSend(reviewsDir, name) {
  let reply; let review;
  try { reply = fs.readFileSync(path.join(reviewsDir, `${name}.reply.txt`), 'utf8'); } catch { return { ok: false, why: `No saved reply for ${name}. Run the ticket with --save-reply first.` }; }
  try { review = JSON.parse(fs.readFileSync(path.join(reviewsDir, `${name}.json`), 'utf8')); } catch { return { ok: false, why: `No fresh-checker verdict for ${name} yet.` }; }
  if (review.replySha256 !== replyHash(reply)) return { ok: false, why: 'The fresh checker reviewed a different version of this reply. Check it again.' };
  if (review.verdict !== 'pass') return { ok: false, blocked: true, findings: review.findings || [], why: `The fresh checker blocked it: ${(review.findings || []).join('; ') || 'no reason given'}` };
  return { ok: true, reply, notes: review.findings || [], checkedAt: review.checkedAt };
}

// Where the fresh checker stands on this run's reply:
//   passed        it passed this exact text, so the reply is cleared to send
//   passed-saved  it passed the saved copy, but this run's text is different (a live lookup changed it)
//   blocked       it blocked the saved copy
//   stale         its verdict is for an older saved copy
//   none          no saved copy or no verdict yet
export function freshState(reviewsDir, d) {
  if (!d?.reply) return null;
  const name = reviewName(d.ticket);
  const c = clearedToSend(reviewsDir, name);
  if (!c.ok && /No saved reply|No fresh-checker verdict/.test(c.why)) return { state: 'none', name };
  if (!c.ok) return { state: c.blocked ? 'blocked' : 'stale', name, why: c.why };
  return { state: replyHash(c.reply) === replyHash(d.reply) ? 'passed' : 'passed-saved', name, checkedAt: c.checkedAt, notes: c.notes };
}
