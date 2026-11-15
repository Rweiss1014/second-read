// One builds, one checks.
// The checker never sees how the reply was written. It gets the reply's steps, the pages they cite and the
// status evidence, and tries to break it. Any problem blocks the reply and says why.
//
// What this script can prove: every cited sentence is really on the cited page (as fetched, with the date),
// every evidence step rests on a lookup that succeeded, no step promises what nobody checked, and the reply
// has the shape customers can follow (3 to 5 numbered steps, one next step).
// What it cannot prove: that a step's own wording is faithful to its quote. That deeper read is the job of the
// reply-checker subagent (.claude/agents/reply-checker.md). Its verdict, when present, is required to pass.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { quoteOnPage } from './docs.mjs';

const PROMISE = /\b(guarantee[ds]?|always|never fails?|will be (fixed|refunded|credited|resolved)|refund(ed)? (you|your)|within \d+|by (tomorrow|monday|tonight)|\d+\s?(hours?|days?|minutes?) )\b/i;
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
    } else if (s.type === 'action') {
      if (PROMISE.test(s.text)) problems.push(`Step ${n} makes a promise or a claim with no source: "${s.text}"`);
    } else problems.push(`Step ${n} has an unknown type.`);
  });

  for (const v of VOICE) if (v.re.test(d.reply)) problems.push(`The reply uses ${v.why}.`);
  if (PROMISE.test(d.next || '')) problems.push(`The next step makes a promise: "${d.next}"`);

  // The subagent's verdict (written by .claude/agents/reply-checker.md), bound to this exact reply text.
  let review = null;
  if (reviewsDir) {
    const f = path.join(reviewsDir, `${reviewName(d.ticket)}.json`);
    try { review = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { review = null; }
    if (review) {
      if (review.replySha256 !== replyHash(d.reply)) problems.push('The fresh checker reviewed a different version of this reply. Review it again.');
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
