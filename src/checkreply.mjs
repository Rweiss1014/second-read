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
import { ROOT } from './config.mjs';

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
  // Found by a fresh reviewer: "We have fixed this for you, and a refund is on the way." passed.
  { why: 'something reported as done that nobody has confirmed', re: /\b(?:we|i)(?:'ve| have| just)? (?:already )?(?:fixed|resolved|solved|refunded|credited|restored|deleted|removed|reconnected|rotated|upgraded|reset)\b/i },
  { why: 'a refund or credit', re: /\b(?:refunds?|credits?|money)\b[^.!?\n]{0,20}\b(?:is|are|has been|have been) (?:on (?:the|its) way|coming|approved|processed|added|sent|issued)\b/i },
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

// The house-voice problems in a piece of text (an em dash, "simply", an easy-sounding "just", a hype word).
export const findVoice = (text) => VOICE.filter(v => v.re.test(String(text || ''))).map(v => v.why);

// ---- Retry only after the platform itself was checked -----------------------------------------------------------
// Found by a fresh checker (Nov 15, 2026), five times: "If the post is not there, retry it" after a check of
// Blotato's own Posts lists only. When the first attempt's outcome is unknown, the post may already be live, and
// Blotato's publishing-status page says "Do not submit a replacement while the original outcome is unknown".
// The rule: a line that tells the customer to retry, resend, repost, resubmit or try again blocks, unless an
// EARLIER numbered step (or the same sentence, before it acts) has them check the platform itself for the first
// post: the post's platform URL, "the intended account on the platform", or "your Instagram account" and the like.
// Checking Blotato's Scheduled, Published and Failed filters is not enough on its own.
// Not a retry instruction: a negated one ("do not post it again yet"), a noun ("a resend can make a copy",
// "its retry loop"), Blotato's own retries ("Blotato retries"), and retrying something that is not a post
// (an authorization, a checkout, a DM automation, a read).
const RETRY_OBJ = String.raw`(?: (?:it|this|that|them|(?:the|your|a) [\w-]+(?: [\w-]+)?))?`;
const RETRY = new RegExp(String.raw`\b(?:re-?try(?:ing)?|try${RETRY_OBJ} again|re-?send(?:ing)?|send(?:ing)?${RETRY_OBJ} again|re-?post(?:ing)?|post(?:ing)?${RETRY_OBJ} again|re-?submit(?:ting)?|submit(?:ting)?${RETRY_OBJ} again|re-?publish(?:ing)?|publish(?:ing)?${RETRY_OBJ} again)\b`, 'i');
// The negation must govern the retry verb itself ("do not post it again"), not some other clause ("If the post is not there, retry it").
const RETRY_NEGATED = /\b(?:do not|don'?t|never|not|no need to|instead of|avoid|without|rather than)\s+(?:(?:please|yet|ever|immediately)\s+)?$/i;
const RETRY_UNHELPFUL = /^[^.!?;]*\b(?:will not|won'?t|does not|doesn'?t|cannot|can'?t) (?:help|fix|work)/i;
const NOT_A_POST = /\b(?:authori[sz]ation|checkout|automation|for a read|sign[- ]?in|log[- ]?in)\b/i;
const NETWORKS = '(?:instagram|facebook|tiktok|youtube|linkedin|x|twitter|threads|bluesky|pinterest|slack)';
export const PLATFORM_CHECK = new RegExp(String.raw`\b(?:check|open|look|search|visit|confirm|make sure)\b[^.!?]*?(?:\bon the (?:social )?platform\b|\bthe platform itself\b|\bplatform url\b|\bthe (?:intended|destination) account on\b|\b(?:your|the) ${NETWORKS}(?: business)? (?:account|page|profile|channel|feed|grid|board|workspace|channel)\b(?! in accounts)|\bon ${NETWORKS}\b(?! is)|\bin the ${NETWORKS} app\b|\bthe (?:slack )?channel\b)`, 'i');

const sentences = (text) => String(text || '').split(/(?<=[.!?])\s+/).filter(Boolean);

// Does this sentence tell the customer to retry a post? Returns the retry words, or null.
export function retryInstruction(sentence) {
  const s = String(sentence || '');
  if (NOT_A_POST.test(s)) return null;
  for (const m of s.matchAll(new RegExp(RETRY.source, 'gi'))) {
    const before = s.slice(0, m.index);
    const after = s.slice(m.index + m[0].length);
    // A noun, not a verb: "a resend can make a copy", "its retry loop", "schedule the post again".
    if (/\b(?:a|an|the|its|each|every|one|any|this|that|your)\s+$/i.test(before)) continue;
    if (/^\s+(?:loop|path|logic|policy|button|limit|attempts?|that|which)\b/i.test(after)) continue;
    // A gerund that opens the sentence is its subject, not an instruction: "Sending it again unchanged often fails".
    if (!before.trim() && /^\w+ing\b/i.test(m[0])) continue;
    if (RETRY_NEGATED.test(before)) continue;
    if (RETRY_UNHELPFUL.test(after)) continue;
    return m[0];
  }
  return null;
}

// lines: [{ name, text, step: true|false }] in the order the customer reads them.
// Returns the lines that tell the customer to retry before any earlier step had them check the platform itself.
export function findUncheckedRetries(lines) {
  const hits = [];
  let checked = false;
  for (const { name, text, step } of lines) {
    // Within one line, a check in an earlier sentence also comes first: "Check your TikTok account. If it is not
    // there, retry." Only a numbered step carries the check on to the lines after it.
    let here = false;
    for (const s of sentences(text)) {
      if (PLATFORM_CHECK.test(s)) here = true;
      const words = retryInstruction(s);
      if (words && !checked && !here) hits.push({ name, words, sentence: s });
    }
    if (step && here) checked = true;
  }
  return hits;
}
export const RETRY_WHY = 'tells the customer to retry before any earlier step has them check the platform itself for the first post (Blotato\'s Posts lists alone do not show whether it went out)';

export const replyHash =(reply) => crypto.createHash('sha256').update(String(reply || '').trim()).digest('hex');
// The file name a review is saved under: the sample ticket's id, or a short hash of a pasted message.
export const reviewName = (ticket) => ticket?.id || `pasted-${replyHash(ticket?.text).slice(0, 12)}`;

export function checkReply(d, { reviewsDir, requireReview = false, checksDir = defaultChecksDir() } = {}) {
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

  // Retry only after the platform was checked: read the lines in order; only numbered steps count as "earlier".
  const replyLines = d.reply.split('\n').map(line => ({ name: line, text: line.replace(/^\d+\.\s+/, ''), step: stepAt.has(line) }));
  for (const h of findUncheckedRetries(replyLines)) problems.push(`The line "${h.name}" ${RETRY_WHY} ("${h.words}").`);

  // The subagent's verdict (written by .claude/agents/reply-checker.md), bound to this exact reply text.
  // A verdict counts for exactly this text, wherever it was saved: the shipped store (knowledge/checks) or desk/reviews.
  let review = null;
  if (reviewsDir || checksDir) {
    const hit = lookupCheck(d.reply, { reviewsDir, checksDir });
    if (hit.state === 'pass') review = { verdict: 'pass', checkedAt: hit.checkedAt };
    else if (hit.state === 'block') problems.push(`The fresh checker blocked it: ${(hit.findings || []).join('; ') || 'no reason given'}`);
    else if (requireReview) {
      // A verdict for an older text does not apply to this one. It blocks only when this run requires a review
      // (a live lookup can change the text from run to run; the saved copy is what "cleared" checks).
      const older = reviewsDir ? readJson(path.join(reviewsDir, `${reviewName(d.ticket)}.json`)) : null;
      problems.push(older ? 'The fresh checker reviewed a different version of this reply. Review it again.' : 'No fresh-checker verdict yet, and this run requires one.');
    }
  }

  return { pass: !problems.length, problems, citations, review: review ? { verdict: review.verdict, checkedAt: review.checkedAt } : null };
}

// The send gate. Live evidence (times, search results) can change between runs, so the gate reads the reply
// exactly as it was saved for the checker, and passes only if the checker's verdict is a pass for that text.
export function clearedToSend(reviewsDir, name, { checksDir = defaultChecksDir() } = {}) {
  let reply;
  try { reply = fs.readFileSync(path.join(reviewsDir, `${name}.reply.txt`), 'utf8'); } catch { return { ok: false, why: `No saved reply for ${name}. Run the ticket with --save-reply first.` }; }
  const hit = lookupCheck(reply, { reviewsDir, checksDir });
  if (hit.state === 'pass') return { ok: true, reply, notes: hit.findings || [], checkedAt: hit.checkedAt, checker: hit.checker, model: hit.model, source: hit.source };
  if (hit.state === 'block') return { ok: false, blocked: true, findings: hit.findings || [], why: `The fresh checker blocked it: ${(hit.findings || []).join('; ') || 'no reason given'}` };
  if (!readJson(path.join(reviewsDir, `${name}.json`))) return { ok: false, why: `No fresh-checker verdict for ${name} yet.` };
  return { ok: false, why: 'The fresh checker reviewed a different version of this reply. Check it again.' };
}

// Where the fresh checker stands on this run's reply:
//   passed        it passed this exact text, so the reply is cleared to send
//   passed-saved  it passed the saved copy, but this run's text is different (a live lookup changed it)
//   blocked       it blocked the saved copy
//   stale         its verdict is for an older saved copy
//   none          no saved copy or no verdict yet
export function freshState(reviewsDir, d, { checksDir = defaultChecksDir() } = {}) {
  if (!d?.reply) return null;
  const name = reviewName(d.ticket);
  // The exact text first: a pass in the shipped store or in desk/reviews clears it, even for a typed message
  // whose saved copy was never written on this machine.
  const hit = lookupCheck(d.reply, { reviewsDir, checksDir });
  if (hit.state === 'pass') return { state: 'passed', name, checkedAt: hit.checkedAt, notes: hit.findings || [], checker: hit.checker, model: hit.model, source: hit.source };
  if (hit.state === 'block') return { state: 'blocked', name, why: `The fresh checker blocked it: ${(hit.findings || []).join('; ') || 'no reason given'}`, findings: hit.findings || [], checkedAt: hit.checkedAt };
  const c = clearedToSend(reviewsDir, name, { checksDir });
  if (!c.ok && /No saved reply|No fresh-checker verdict/.test(c.why)) return { state: 'none', name };
  if (!c.ok) return { state: c.blocked ? 'blocked' : 'stale', name, why: c.why };
  return { state: replyHash(c.reply) === replyHash(d.reply) ? 'passed' : 'passed-saved', name, checkedAt: c.checkedAt, notes: c.notes };
}

// ---- The saved-check store -------------------------------------------------------------------------------------
// A reply counts as "checked" when a fresh checker passed this exact text. Those passes live in two places:
//   knowledge/checks/<sha256>.json   shipped with the repo: one small file per checked reply text, nothing private
//   desk/reviews/*.json              this machine's own verdicts (ignored by git)
// lookupCheck looks in the store first and desk/reviews second.
export const defaultChecksDir = (env = process.env) => env.SUPPORT_CHECKS_DIR ? path.resolve(env.SUPPORT_CHECKS_DIR) : path.join(ROOT, 'knowledge', 'checks');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const SHA = /^[0-9a-f]{64}$/;

// The fields a stored check keeps. No customer message, no account data, no reply text: only who checked what, and when.
export function storedCheckFrom(v) {
  const out = { replySha256: v.replySha256, verdict: v.verdict, findings: Array.isArray(v.findings) ? v.findings.map(String) : [], checkedAt: v.checkedAt || null, checker: v.checker || null };
  if (v.model) out.model = String(v.model);
  if (v.entry) out.entry = String(v.entry);
  return out;
}

// Has a fresh checker passed this exact text? -> { state: 'pass' | 'block' | 'none', source: 'store' | 'desk', ... }
// One changed character changes the hash, so a verdict for any other text never matches.
export function lookupCheck(text, { reviewsDir, checksDir = defaultChecksDir() } = {}) {
  const sha = replyHash(text);
  if (checksDir) {
    const v = readJson(path.join(checksDir, `${sha}.json`));
    if (v && v.replySha256 === sha && v.verdict === 'pass') return { state: 'pass', source: 'store', sha, ...pick(v) };
  }
  let block = null;
  if (reviewsDir) {
    let files = [];
    try { files = fs.readdirSync(reviewsDir).filter(f => f.endsWith('.json')); } catch { /* no folder yet */ }
    for (const f of files) {
      const v = readJson(path.join(reviewsDir, f));
      if (!v || v.replySha256 !== sha) continue;
      if (v.verdict === 'pass') return { state: 'pass', source: 'desk', sha, ...pick(v) };
      block = block || { state: 'block', source: 'desk', sha, ...pick(v) };
    }
  }
  return block || { state: 'none', sha };
}
const pick = (v) => ({ verdict: v.verdict, findings: v.findings || [], checkedAt: v.checkedAt, checker: v.checker, model: v.model, entry: v.entry });

// Why a verdict file cannot be recorded, or null when its shape is right.
export function verdictProblem(v) {
  if (!v || typeof v !== 'object') return 'The verdict is not a JSON object.';
  if (!SHA.test(String(v.replySha256 || ''))) return 'The verdict has no replySha256 (64 hex characters).';
  if (v.verdict !== 'pass' && v.verdict !== 'block') return `The verdict must be "pass" or "block", not ${JSON.stringify(v.verdict)}.`;
  if (v.findings !== undefined && !Array.isArray(v.findings)) return 'findings must be a list of sentences.';
  if (v.verdict === 'pass' && !v.checkedAt) return 'A pass needs checkedAt, the date and time the checker read the text.';
  if (v.verdict === 'pass' && !v.checker) return 'A pass needs the checker\'s name.';
  return null;
}

// Record one checker verdict. A pass goes into the store (only if its sha is in `known`, the shas that were packed).
// A block writes nothing: the entry has to be fixed. `known` is a Map sha -> { entry, ... } from a packets index.
export function recordCheck(verdict, { known, checksDir = defaultChecksDir() } = {}) {
  const bad = verdictProblem(verdict);
  if (bad) return { ok: false, why: bad };
  const meta = known?.get(verdict.replySha256);
  if (!meta) return { ok: false, why: `No packet in the index has the hash ${verdict.replySha256}, so nobody packed this text. Nothing was recorded.` };
  if (verdict.verdict === 'block') return { ok: true, recorded: false, blocked: true, entry: meta.entry, findings: verdict.findings || [] };
  fs.mkdirSync(checksDir, { recursive: true });
  const rec = storedCheckFrom({ ...verdict, entry: meta.entry });
  fs.writeFileSync(path.join(checksDir, `${rec.replySha256}.json`), JSON.stringify(rec, null, 2) + '\n');
  return { ok: true, recorded: true, entry: meta.entry, sha: rec.replySha256 };
}
