// Route one customer message: which entry answers it, or why a person must take it.
//
// Order, and the first that decides wins:
//   1. Hard guards (money, someone else's data, a key or the desk's settings, a request to post, delete or
//      change something). They always win, even when the message also asks something easy.
//   2. Words aimed at the desk ("ignore your rules", "[SYSTEM NOTE]") are cut out. If no real question is
//      left, the message is handed over.
//   3. The matcher scores every entry. Below the threshold, or too close to the runner-up, the desk does not
//      answer: a person gets the message with the top three candidates. If the message also says the customer
//      already tried things and it still fails (GENERAL_SIGNALS plus a trouble word), the customer gets a
//      holding reply.
//   4. The entry's needs_person_if signals: the customer already did the steps, or it is past the docs.
//      The answer becomes a holding reply and an escalation. The holding reply is chosen by the reason code
//      (HOLDING_FOR), so its opening is true for the case.
//   5. A second question the entry does not cover: answer the part it can cite and hand over the rest,
//      or hand over the whole message when the entry has no room for that line. If the entry covers none
//      of the message's questions, it matched only the background, and the desk does not answer.
import { buildIndex, scoreEntries, scoreAgainst, splitSentences, contentStems, allStems, hasTerm, anchorsMet, anchorRegex, rawWords } from './match.mjs';
import { createCoverage, groundedLines } from './coverage.mjs';
import { runGuards, stripDeskInstructions, needsPerson, saidTried, TROUBLE, NAMED_ITEMS, PLATFORMS, ASKS_NUMBER, ASKS_OWN_COUNT, GIVES_NUMBER, INTRODUCER, COMMON_CAPS, notEnglish, specificError, isNonsense } from './signals.mjs';

// Every hand-over carries a stable, machine-readable reason in "why" (and the details in "whyDetail"), beside
// the human "reason" text, so a page can say it plainly. The codes are listed in knowledge/ENTRY-GUIDE.md.
// An answer has why: null. A "partial" answer has why: 'partly-covered' for the part it hands over.
export const WHY_CODES = ['money', 'others-data', 'secret', 'staff-action', 'desk-instructions', 'tried-already', 'outage', 'records-disagree', 'docs-wrong', 'access-blocked', 'past-docs', 'docs-silent', 'tie', 'partly-covered', 'not-english', 'no-coverage', 'nonsense', 'pressure', 'reader-abstained', 'reader-refuted', 'compose-unverified', 'second-read-objected'];
// reader-abstained: the matcher would have answered, but the reader (src/reader.mjs) picked no entry, or its pick
//   failed the script's checks. reader-refuted: the reader's pick passed, and the refuter named a real objection.
// Both only appear when a reader backend is on; with it off the desk never gives them.
// compose-unverified: no saved entry answered, the composer (src/composer.mjs) wrote a draft from the help pages, and
//   the script's verification rejected it. second-read-objected: the draft passed the script, and the second reader
//   named a real objection. Both only appear when a composer backend is on.
const SIGNAL_WHY = {
  'tried-steps': 'tried-already', 'still-broken': 'tried-already', retried: 'tried-already', 'follow-on': 'tried-already', 'cause-ruled-out': 'tried-already',
  'many-accounts': 'outage', 'records-disagree': 'records-disagree', 'disputes-count': 'records-disagree', 'docs-wrong': 'docs-wrong', 'access-blocked': 'access-blocked', phrase: 'past-docs', pressure: 'pressure',
};
// tried-already sends the reply that thanks the customer for what they tried, so it needs their own words saying
// they did something (saidTried). Otherwise, and for a signal not in the map, the reason is the neutral past-docs.
const whyOfSignals = (hits, text) => {
  const why = SIGNAL_WHY[hits[0].signal] || 'past-docs';
  return { why: why === 'tried-already' && !saidTried(text) ? 'past-docs' : why, whyDetail: { signal: hits[0].signal, words: hits[0].words } };
};
// Which holding reply a hand-over sends, by its reason code (guard names in knowledge/entries/guards.json).
// needs-person opens "Thank you for telling me what you have already tried", which is true only for tried-already.
// An outage question gets the possible-outage reply. Every other reason gets the neutral handover reply.
// A very upset customer (pressure) gets the upset reply: sorry first, and what they said failed, said back to them.
export const HOLDING_FOR = { 'tried-already': 'needs-person', outage: 'possible-outage', pressure: 'upset' };
export const holdingGuardFor = (why) => HOLDING_FOR[why] || 'handover';
// A hand-over for a message that reports no problem (a plain question) never asks for "the exact error": the
// neutral and the upset hand-overs have a question form (Nov 18, 2026: "do my scheduled posts still go out?" was
// told to send the exact error and the time it happened).
export const QUESTION_FORM = { handover: 'handover-question', upset: 'upset-question' };
export const holdingFor = (why, text) => { const g = holdingGuardFor(why); return QUESTION_FORM[g] && !reportsProblem(text) ? QUESTION_FORM[g] : g; };

// An error the customer describes in their own words, with no quotes or code: "It says the text is too long.",
// "it shows that the video is too large", "the caption exceeds the limit". An entry whose premise is that the
// customer has not given the error (symptom_only) must not answer them (Nov 18, 2026: "Why did my X post fail? It
// says the text is too long." got "send us the exact error"). "It just says failed" is no error text: it names only
// the state, so the symptom entry still fits.
const STATE_ONLY = /^(?:(?:just|only|simply|that|it|it's|its|is|was|the|my|our|this|post|video|reel|status|has|been)\s+)*(?:failed|failure|error|an error|errored|failed to post|not posted|published|posted|scheduled|pending|processing|in progress|in-progress|canceled|cancelled|done|success|successful)\b(?:\s+(?:in|on|next to|under|beside|at|for|by)\b[^.?!]*)?[.!?]?\s*$/i; // "it says failed next to my reel" names only where
export function describedError(text) {
  const t = String(text || '');
  for (const m of t.matchAll(/\b(?:it|this|that|the (?:error|message|app|platform|post|notice|banner|screen)|blotato|x|twitter|instagram|tiktok|youtube|linkedin|facebook|threads|bluesky|pinterest)\s+(?:just\s+|only\s+)?(?:says|said|shows|showed|reads|read|tells me|told me|gives me|gave me|displays|displayed)\s+(?:that\s+)?([^.?!\n]{3,120})/gi)) {
    if (!STATE_ONLY.test(m[1].trim())) return m[0].trim();
  }
  const limit = t.match(/\b(?:is |was |are |were )?(?:too long|too large|too big|too short|too small|too many \w+|exceeds?|exceeded|over the (?:limit|character limit|max\w*)|not supported|unsupported|not allowed|duplicate content|is a duplicate)\b/i);
  return limit ? limit[0].trim() : null;
}

// An entry whose premise is that the customer hit an error or a symptom ("Your workflow is sending faster than
// Blotato accepts.", "This error means...", "Let's find out what happened to your post."): its reply starts from a
// problem the customer reported. A plain question that reports no problem must not get it (Nov 18, 2026: "How many
// API calls can I make per minute?" got the n8n rate-limit fix, word for word, stamped Checked).
const PREMISE_OPENING = /\b(?:this|that|the|your|an?)\s+(?:\w+\s+){0,2}?(?:error|message|rejection|failure|timeout|exception)\b|\bsending faster\b|\bturn(?:ing|ed|s)? (?:down|away)\b|\brejecting\b|\bhappened to (?:your|that) post\b|\bfail(?:ed|s|ure)?\b|\bnot (?:accept|recogni[sz]e|match)\w*\b|\bcould not\b|\bdoes not tell us\b|\bexpired\b|\bstuck\b|\bmissing\b|\bdouble post\b/i;
export const problemPremise = (e) => !!e && !e.guard && (!!e.symptom_only || PREMISE_OPENING.test(e.opening || ''));
// Does the message report a problem? Trouble words ("still" and "again" alone are not one: "do my posts still go
// out?"), an exact error or code, an error told in the customer's words, or words that say something was seen or
// received ("I got a message", "it shows 0", "views are lower").
const REPORTS = /\b(?:hit|hitting|reached|reaching|ran into|running into|broke|breaks|breaking|crash\w*|blocks|blocking|show|appears?|got|getting|gets? (?:a|an|the|this|that)|received|receiving|seeing|saw|says|said|shows|showing|showed|returns?|returned|message|messages|notification|popup|pop-up|warning|lower|higher|different|differs|wrong|bug|weird|strange|odd|instead|disappear\w*|vanish\w*|blank|duplicate\w*|twice|double|rate[- ]limited|throttl\w*|too many|timed? out|timeout|slow|delay\w*|late|never|not|no longer|didn'?t|didnt|did not|doesn'?t|doesnt|don'?t|dont|isn'?t|isnt|wasn'?t|hasn'?t|haven'?t|went wrong|what now|now what)\b/i;
// The customer pasted the error itself, unquoted: five words in a row from the entry's title ("This video is 130
// seconds long, but we can only automatically fix videos up to 120 seconds").
const words5 = (s) => { const w = String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []; return new Set(w.slice(0, Math.max(0, w.length - 4)).map((x, i) => w.slice(i, i + 5).join(' '))); };
const pastesTitle = (text, e) => { const t = words5(e?.title); for (const g of words5(text)) if (t.has(g)) return true; return false; };
export function reportsProblem(text, entry = null) {
  const t = String(text || '');
  return (!!entry && pastesTitle(t, entry)) || TROUBLE.test(t.replace(/\b(?:still|again)\b/gi, ' ')) || !!specificError(t.replace(/\brate limits?\b(?!ed)/gi, 'rate cap')) || !!describedError(t) || REPORTS.test(t) || /"[^"\n]{3,}"|“[^”\n]{3,}”|`[^`\n]+`/.test(t);
}

// The same test as isErrorEntry in entries.mjs (kept here so route.mjs does not import entries.mjs, which imports it).
const isErrorEntryLike = (e) => !!e && ((e.steps || []).some(s => /\/errors?\b|error-handling|limitations/.test(s?.cite?.url || '')) || /\b(?:error|errors|failed|fails|rejected|not found|invalid|exceeded|unsupported)\b/i.test(e.title || ''));

// "25 posts" in the title, "26 posts" in the message and no "25 posts" there: the counts disagree.
export function countMismatch(title, text) {
  const t = String(text || '').toLowerCase().replace(/,(?=\d{3}\b)/g, '');
  for (const [, n, word] of String(title || '').toLowerCase().matchAll(/\b(\d{2,})\s+([a-z]{3,})/g)) {
    const said = [...t.matchAll(new RegExp(`\\b(\\d{2,})\\s+${word}\\b`, 'g'))].map(m => m[1]);
    if (said.length && !said.includes(n)) return { title: `${n} ${word}`, said: `${said[0]} ${word}` };
  }
  return null;
}

// A sentence that only thanks or agrees ("Thanks for the scheduling help!") is background, not the question:
// it is left out of matching, so the topic it names cannot pull the message to its entry. A sentence that goes
// on to say something ("Thanks, but it still fails") is kept.
const PLEASANTRY = /^(?:thanks|thank you|thank u|thx|ty|tysm|cheers|many thanks|much appreciated|appreciate (?:it|the|your|you)|great|awesome|perfect|cool|nice|ok(?:ay)?|got it|that worked|that helped|you(?:'re| are) (?:great|awesome|the best|amazing))\b[^?]*$/i;
const GOES_ON = /\b(?:but|however|still|now|except|although|though|yet|problem|issue|error|fail\w*|can'?t|cannot|won'?t|doesn'?t|didn'?t|not)\b/i;
export function withoutPleasantries(text) {
  const sents = splitSentences(text);
  const kept = sents.filter(x => !(PLEASANTRY.test(x) && !GOES_ON.test(x) && x.split(/\s+/).length <= 12));
  if (kept.length === sents.length || contentStems(kept.join(' ')).length < 2) return text;
  return kept.join(' ');
}

// Tuned on the dev sets only (eval/tickets.dev.jsonl, eval/tickets.dev2.jsonl). See BUILD-LOG.md for how.
export const THRESHOLD = 0.30;   // the best entry's score must reach this, when the entry has anchors and they are met. Third tuner: 0.25 -> 0.30, chosen from the curve (eval/sweep.mjs)
export const THRESHOLD_UNANCHORED = 0.45; // an entry with no anchors has only its phrasings to go on, so it needs more
export const MARGIN = 0.06;      // and beat the runner-up by this much
export const COVERED = 0.30;     // a second question this close to the chosen entry counts as the same topic
export const CANDIDATE_FLOOR = 0.1; // a candidate shown to a person must at least share real words with the message
// Signals strong enough to hand a message over even when no entry matches it.
export const GENERAL_SIGNALS = ['tried-steps', 'still-broken', 'retried', 'disputes-count', 'records-disagree', 'many-accounts', 'cause-ruled-out', 'docs-wrong', 'pressure'];
// A question: ends with "?", starts like one, starts a second ask ("Also, ..."), or asks indirectly
// ("I also want to know whether ...").
const QUESTION = /\?\s*$|^(?:how|what|why|where|when|which|who|can|could|does|do|is|are|will|would|should|did|has|have|may|also|and also|plus|p\.?s\.?|another thing|one more thing)\b|\b(?:want to know|wondering|wonder|need to know|curious|tell me|let me know)\b(?:\s+\w+){0,2}?\s+(?:if|whether|how|what|when|why|where|which)\b/i;

// The questions of a message, each able to stand alone (three or more content words).
// Two questions in one sentence ("How many per minute, and how much does the plan cost?", "price + how many
// credits?") are split, but only when each part can stand on its own.
export function questionsOf(text) {
  return splitSentences(text)
    .filter(s => QUESTION.test(s.trim()))
    .flatMap(s => {
      const parts = s.split(/,?\s+(?:and|also|plus|or|\+|&)\s+(?=(?:also\s+)?(?:how|what|why|where|when|which|who|can|could|does|do|is|are|will|would|should)\b)/i);
      return parts.length > 1 && parts.every(p => contentStems(p).length >= 3) ? parts : [s];
    })
    .filter(s => contentStems(s).length >= 3);
}

export function createRouter(entries, { threshold = THRESHOLD, thresholdUnanchored = THRESHOLD_UNANCHORED, margin = MARGIN, covered = COVERED, coverage: coverageOpt = {} } = {}) {
  const matchable = entries.filter(e => !e.guard);
  const coverage = coverageOpt === false ? null : createCoverage(entries, coverageOpt);
  const index = buildIndex(matchable);
  const guardEntry = (g) => entries.find(e => e.guard === g) || null;

  // What each entry speaks about: every word of its title, phrasings, anchors, steps, quotes and other reply
  // lines, as stems (a "|" between texts, so a two-word term never spans two texts).
  const vocab = new Map(matchable.map(e => {
    const texts = [e.title, ...(e.phrasings || []), ...(e.anchors || []).flat().filter(t => !anchorRegex(t)), e.opening, e.next, e.proof,
      ...(e.steps || []).flatMap(s => [s.text, s.cite?.quote]), ...(e.scope?.covers || [])].filter(t => typeof t === 'string');
    return [e.id, texts.flatMap(t => [...allStems(t), '|'])];
  }));
  const OUTSIDE = new Set(['payment method', 'platform or service', 'tool', 'device', 'language', 'file type']);
  const vocabRaw = new Map(matchable.map(e => [e.id, [e.title, ...(e.phrasings || []), ...(e.anchors || []).flat().filter(t => !anchorRegex(t)), ...groundedLines(e)].filter(t => typeof t === 'string').flatMap(t => [...rawWords(t), '|'])]));
  const groundedRaw = new Map(matchable.map(e => [e.id, groundedLines(e).flatMap(t => [...rawWords(t), '|'])]));
  // Words in order, as written, a plural allowed either way ("dm automation" = "DM automations"), no other stemming.
  const same = (a, b) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
  const seq = (words, term) => { const t = rawWords(term); outer: for (let i = 0; i + t.length <= words.length; i++) { for (let j = 0; j < t.length; j++) if (!same(words[i + j], t[j])) continue outer; return true; } return false; };
  const everyWord = new Set([...vocab.values()].flat());
  const givesNumber = new Map(matchable.map(e => [e.id, (e.steps || []).some(s => GIVES_NUMBER.test(s.text || '') || GIVES_NUMBER.test(s.cite?.quote || ''))]));
  const items = Object.entries(NAMED_ITEMS).flatMap(([kind, terms]) => terms.map(term => ({ kind, term })));
  const platformSpecific = new Map(matchable.map(e => [e.id, Object.values(PLATFORMS).some(al => al.some(a => hasTerm(allStems(e.title), a)))]));
  // The same facts for an entry that is not in the knowledge base (a composed draft, src/composer.mjs, marked adHoc):
  // computed from that entry's own lines when it is checked.
  const vocabOf = (e) => vocab.get(e.id) || (e.adHoc ? [e.title, e.opening, e.next, e.proof, ...(e.steps || []).flatMap(s => [s.text, s.cite?.quote])].filter(t => typeof t === 'string').flatMap(t => [...allStems(t), '|']) : []);
  const vocabRawOf = (e) => vocabRaw.get(e.id) || (e.adHoc ? groundedLines(e).flatMap(t => [...rawWords(t), '|']) : []);
  const groundedRawOf = (e) => groundedRaw.get(e.id) || (e.adHoc ? groundedLines(e).flatMap(t => [...rawWords(t), '|']) : []);
  const givesNumberOf = (e) => givesNumber.has(e.id) ? givesNumber.get(e.id) : !!e.adHoc && (e.steps || []).some(s => GIVES_NUMBER.test(s.text || '') || GIVES_NUMBER.test(s.cite?.quote || ''));
  const platformSpecificOf = (e) => platformSpecific.has(e.id) ? platformSpecific.get(e.id) : !!e.adHoc && Object.values(PLATFORMS).some(al => al.some(a => hasTerm(allStems(e.title || ''), a)));

  // Docs-silent: the customer asks about a named thing, or a number, that the chosen entry never mentions.
  // Returns { kind, term } for the first one, or null.
  // Named items match exactly, both ways: with one-letter typos allowed, "video" would be "vimeo".
  const has = (stems, term) => { const t = allStems(term); outer: for (let i = 0; i + t.length <= stems.length; i++) { for (let j = 0; j < t.length; j++) if (stems[i + j] !== t[j]) continue outer; return true; } return false; };
  const namesPlatform = (stems, al) => al.some(a => has(stems, a));
  function silentOn(entry, text) {
    const stems = allStems(text);
    const v = vocabOf(entry);
    // A named thing must be in what the desk would say (quotes, steps, declared scope), not only in a phrasing
    // (third tuner): a writer's phrasing that names OneDrive does not make a Google Drive quote cover it.
    // Named items are matched on words as written, not stems: "state" is not "stats", "polling" is not "polls".
    // Things outside Blotato (another service, a tool, a device, a payment method, a language, a file type) must
    // be in what the desk would say; Blotato's own features and ids may still be claimed by a phrasing.
    if (coverage) {
      const words = rawWords(text); const gw = groundedRawOf(entry); const vw = vocabRawOf(entry);
      const kinds = entry.scope?.coversKinds || [];
      for (const { kind, term } of items) if (seq(words, term) && !kinds.includes(kind) && !seq(OUTSIDE.has(kind) ? gw : vw, term)) return { kind, term };
    } else for (const { kind, term } of items) if (has(stems, term) && !has(v, term)) return { kind, term };
    const asked = Object.entries(PLATFORMS).filter(([, al]) => namesPlatform(stems, al));
    const missing = asked.find(([, al]) => !namesPlatform(v, al));
    if (missing && platformSpecificOf(entry)) return { kind: 'platform', term: missing[0] };
    const asksNumber = ASKS_NUMBER.test(text) && !ASKS_OWN_COUNT.test(text);
    if (asksNumber && !givesNumberOf(entry)) return { kind: 'number', term: text.match(ASKS_NUMBER)[0] };
    // A number for a platform the entry's per-platform figures leave out ("how many posts a day on Pinterest"
    // against a list of Instagram, LinkedIn and Facebook limits).
    if (missing && asksNumber && Object.values(PLATFORMS).filter(al => namesPlatform(v, al)).length >= 2) return { kind: 'platform', term: missing[0] };
    for (const m of text.matchAll(INTRODUCER)) {
      const s = allStems(m[1]);
      if (s.length !== 1 || COMMON_CAPS.has(m[1].toLowerCase()) || everyWord.has(s[0])) continue;
      return { kind: 'name', term: m[1] };
    }
    return null;
  }

  // What the customer asks: the question sentences, or the whole message when it has none, or when its
  // questions are too short to stand alone ("Is that wrong?" leans on the sentences before it).
  // Pasted code (a JSON payload) and links are what the customer sent, not what they ask about, so they are
  // left out: a "pageId" inside a pasted request body is not a question about page ids.
  function askedText(text) {
    const asked = splitSentences(text).filter(s => QUESTION.test(s.trim()));
    if (asked.length && contentStems(asked.join(' ')).length >= 3) return asked.join(' ');
    return text.replace(/\{[^\n]*\}/g, ' ').replace(/`[^`\n]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  }

  function breakTie(a, b, text) {
    const q = askedText(text);
    const [ea, eb] = [index.byId.get(a.id), index.byId.get(b.id)];
    // Only a named item or platform breaks a tie. A missing number does not: when the entry that owns the
    // topic gives no number, the docs are silent, and a neighbor with some other number is not the answer
    // ("how many first comments a day" is not answered by the posts-per-day limits).
    const sa = silentOn(ea, q); const sb = silentOn(eb, q);
    if (sa?.kind === 'number' || sb?.kind === 'number') return null;
    if (sa && !sb) return { c: b, why: `"${a.id}" never mentions "${sa.term}"` };
    if (sb && !sa) return { c: a, why: `"${b.id}" never mentions "${sb.term}"` };
    // An error the customer pasted decides a tie: when the message carries an exact error text or code, and only
    // one of the two is an error entry whose title shares at least two words with the message, that one is
    // about this error and the other only shares the background. (Second tuner.)
    if (specificError(text)) {
      const msg = new Set(contentStems(text));
      const fits = (e) => isErrorEntryLike(e) && contentStems(e.title || '').filter(w => msg.has(w)).length >= 2;
      const [fa, fb] = [fits(ea), fits(eb)];
      if (fa && !fb && !isErrorEntryLike(eb)) return { c: a, why: `the message gives an error, and only "${a.id}" is about that error` };
      if (fb && !fa && !isErrorEntryLike(ea)) return { c: b, why: `the message gives an error, and only "${b.id}" is about that error` };
    }
    // Tried and dropped: preferring the entry that names more of the message's platforms. It sent "the pin
    // shows published, the link gives a 404" to the connect-accounts entry because that one names Pinterest.
    return null;
  }

  function pickMoneyEntry(text) {
    const money = entries.filter(e => e.guard === 'money').filter(e => anchorsMet(text, e.anchors).ok);
    money.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return money[0] || null;
  }

  function route(text) {
    const original = String(text || '');
    const base = { text: original, guard: null, words: null, signals: [], candidates: [], stripped: [], questions: [] };

    const g = runGuards(original);
    if (g) {
      const entry = g.guard === 'money' ? pickMoneyEntry(original) : guardEntry(g.guard);
      return { ...base, decision: 'guard', guard: g.guard, words: g.words, entry, why: g.guard, whyDetail: { words: g.words }, reason: guardReason(g) };
    }

    const cut = stripDeskInstructions(original);
    base.stripped = cut.found;
    // "full" is what the customer wrote (minus the desk instructions): the signals read it. "real" also leaves
    // out sentences that only thank or agree; matching, the docs-silent check and the questions read it.
    const full = cut.text;
    const real = withoutPleasantries(full);
    if (cut.found.length && contentStems(full).length < 2) {
      return { ...base, decision: 'guard', guard: 'desk-instructions', words: cut.found[0], entry: guardEntry('desk-instructions'), why: 'desk-instructions', whyDetail: { words: cut.found[0] }, reason: 'The message gives the desk instructions and asks no real question.' };
    }
    // A message not in English goes to a person. The entries, the quotes and the checkers are all English, so
    // the desk cannot tell what it asks, let alone answer it.
    const lang = notEnglish(cut.text);
    if (lang) return { ...base, decision: 'abstain', entry: null, why: 'not-english', whyDetail: { language: lang.language }, reason: `The message is not in English (it reads as ${lang.language}). A person who reads it should answer.` };

    const scored = scoreEntries(index, real);
    const live = scored.filter(c => !c.excluded);
    // The top candidates a person can start from: entries only (guards are never matched), and only ones with
    // some real overlap, so a person reads them as close.
    base.candidates = live.slice(0, 3).filter(c => c.score >= CANDIDATE_FLOOR).map(c => ({ id: c.id, title: index.byId.get(c.id)?.title, score: round(c.score), phrasing: c.phrasing }));
    let [best, second] = live;
    const needOf = (c) => (c?.anchored ? threshold : thresholdUnanchored);
    // Two entries too close to choose between: if the docs-silent check stops exactly one of them (it never
    // mentions the item or number asked about), the other is the candidate. It must still reach the threshold
    // and beat the third entry by the margin, and it then goes through every other check.
    if (best && second && best.score - second.score < margin) {
      const pick = breakTie(best, second, real);
      const third = live[2];
      if (pick && pick.c.score >= needOf(pick.c) && pick.c.score - (third?.score || 0) >= margin) {
        base.tie = { chose: pick.c.id, over: (pick.c === best ? second : best).id, why: pick.why };
        [best, second] = [pick.c, third];
      }
    }
    const gap = best ? best.score - (second?.score || 0) : 0;
    const need = needOf(best);
    if (!best || best.score < need || gap < margin) {
      const why = !best ? 'No entry is a candidate for this message.'
        : best.score < need ? `The best match, "${best.id}", scored ${round(best.score)}, below the ${need} the desk needs to answer.`
          : `The best match, "${best.id}" (${round(best.score)}), is too close to "${second.id}" (${round(second.score)}) to choose between them.`;
      // No entry, but the customer says they already tried things, or it keeps failing, or Blotato's own
      // records disagree: whatever the topic, a person takes it, and the customer gets the holding reply.
      // The strong default signals ("three days in a row", "is something down", "I only posted 3") count on
      // their own; the rest need a trouble word.
      const hits = needsPerson(full, { signals: TROUBLE.test(full) ? GENERAL_SIGNALS : [] }, { hasTerm, allStems }, { defaults: true });
      if (hits.length) {
        const w = whyOfSignals(hits, full);
        const holding = guardEntry(holdingFor(w.why, full));
        return { ...base, decision: 'needs-person', entry: holding, holding, signals: hits, ...w, reason: `${why} And: ${hits[0].about} ("${hits[0].words}")` };
      }
      const tied = best && second && best.score >= need && gap < margin;
      const code = tied ? { why: 'tie', whyDetail: { candidates: [best, second].map(c => ({ id: c.id, title: index.byId.get(c.id)?.title, score: round(c.score) })) } }
        : isNonsense(real, { contentStems, rawWords, known: (w) => everyWord.has(w) }) ? { why: 'nonsense', whyDetail: null }
          : { why: 'no-coverage', whyDetail: null };
      return { ...base, decision: 'abstain', entry: null, ...code, reason: code.why === 'nonsense' ? `${why} The message has no words the desk knows, or no question.` : why };
    }
    const entry = index.byId.get(best.id);
    base.words = best.anchorHits?.[0] || best.phrasing;
    base.score = round(best.score);
    base.margin = round(gap);

    // The entry's own signals, plus the default ones every answering entry has (signals.mjs DEFAULT_SIGNALS).
    const hits = needsPerson(full, entry.needs_person_if, { hasTerm, allStems }, { defaults: true });
    if (hits.length && !entry.escalate && !entry.noDocAnswer) {
      const w = whyOfSignals(hits, full);
      return { ...base, decision: 'needs-person', entry, signals: hits, holding: entry.holding || guardEntry(holdingFor(w.why, full)), ...w, reason: `${hits[0].about} ("${hits[0].words}")` };
    }

    // An entry for a symptom with no error text ("my post failed", "it never went up") gives the first steps
    // and asks for the error. When the customer does give an exact error or code, that error decides the fix,
    // and this entry is not about it: a person takes it (or that error's own entry, when it wins the match).
    if (entry.symptom_only) {
      const err = specificError(real) || describedError(real);
      if (err) return { ...base, decision: 'abstain', entry: null, why: 'no-coverage', whyDetail: { error: err, nearest: entry.id }, reason: `"${entry.id}" is for a failure with no error text, but the message gives one ("${err}"), and no entry is a clear match for it.` };
    }

    // An entry that starts from a reported problem does not answer a message that reports none: the customer asked
    // for information, and the fix for a failure answers a question they did not ask.
    if (problemPremise(entry) && !reportsProblem(real, entry)) {
      return { ...base, decision: 'abstain', entry: null, why: 'no-coverage', whyDetail: { kind: 'premise', nearest: entry.id }, reason: `"${entry.id}" is for a customer who hit a problem, but the message reports none: it asks for information. None of the desk's saved answers is written for that question.` };
    }

    // A count in an error entry's title is part of that error: "the maximum number of 25 posts". A message that
    // gives the same thing with another count ("26 posts") is quoting a different error, or none the docs list.
    if (isErrorEntryLike(entry)) {
      const wrongCount = countMismatch(entry.title, real);
      if (wrongCount) return { ...base, decision: 'abstain', entry: null, silent: { kind: 'number', term: wrongCount.said }, why: 'docs-silent', whyDetail: { kind: 'number', item: wrongCount.said, nearest: entry.id }, reason: `"${entry.id}" is about "${wrongCount.title}", but the message says "${wrongCount.said}". None of the desk's saved answers is about that error.` };
    }

    // The thing asked about must be something the entry speaks about. Only the questions are read (the whole
    // message when it has none, or only short ones), so "I make my images in Canva. How do I schedule a post?"
    // is not blocked.
    if (!entry.escalate && !entry.noDocAnswer) {
      const silent = silentOn(entry, askedText(real));
      if (silent) {
        const what = silent.kind === 'number' ? `asks for a number ("${silent.term}"), and its steps give none`
          : `asks about ${silent.kind === 'name' ? '' : `${/^[aeiou]/.test(silent.kind) ? 'an' : 'a'} ${silent.kind}, `}"${silent.term}", which it never mentions`;
        return { ...base, decision: 'abstain', entry: null, silent, why: 'docs-silent', whyDetail: { kind: silent.kind, item: silent.term, nearest: entry.id }, reason: `"${entry.id}" matched the message, but the message ${what}. None of the desk's saved answers covers it.` };
      }
    }

    // Specifics must be covered: what the customer asks about must be in what the desk would say (its quotes,
    // its steps, its declared scope), not only in the entry's phrasings. See src/coverage.mjs.
    // Every real question in the message must belong to this entry. A question with fewer than three content
    // words ("Is it stuck?", "Did it post or not?") leans on the rest of the message, so it is not checked on
    // its own. Anchors are for the whole message, so a question is scored against the phrasings without them.
    // If no question is covered, the entry matched only the background ("I'm leaving next month. How do I
    // download my videos?"), so the desk does not answer.
    const qs = questionsOf(real);

    // Specifics must be covered: what the customer asks about must be in what the desk would say (its quotes,
    // its steps, its declared scope), not only in the entry's phrasings. See src/coverage.mjs.
    // With two or more questions, each is read on its own: a question with a gap is handed over, and the entry
    // may still answer the others (the partly-covered rule below). With none left, the desk does not answer.
    const uncovered = new Set();
    if (coverage && !entry.escalate && !entry.noDocAnswer) {
      const whole = coverage.gap(entry, real, coverageOpt);
      if (whole) {
        const each = qs.length >= 2 ? qs.map(q => [q, coverage.gap(entry, q, coverageOpt)]) : [];
        if (!each.length || each.every(([, g]) => g)) return { ...base, decision: 'abstain', entry: null, silent: whole, why: 'docs-silent', whyDetail: { kind: whole.kind, item: whole.term, nearest: entry.id }, reason: `"${entry.id}" matched the message, but what it would quote does not cover the ${whole.kind} asked about ("${whole.term}"). None of the desk's saved answers covers it.` };
        for (const [q, g] of each) if (g) uncovered.add(q);
      }
    }
    const enough = Math.min(covered, need);
    if (qs.length >= 1) {
      const open = [];
      for (const q of qs) {
        if (uncovered.has(q)) { const other = scoreEntries(index, q).find(c => !c.excluded && c.id !== entry.id); open.push({ question: q, best: other ? { id: other.id, score: round(other.score) } : null }); continue; }
        const s = scoreAgainst(index, q, entry.id);
        // Covered: close enough to the entry's phrasings, and (if the entry has anchors) naming at least one
        // of its anchor words, so "how much does the Agency plan cost?" is not covered by the cancel entry.
        const anchorWord = !(entry.anchors || []).length || anchorsMet(q, [entry.anchors.flat()]).ok;
        if (s && s.excluded !== 'not_this' && s.score >= enough && anchorWord) continue;
        const other = scoreEntries(index, q).find(c => !c.excluded && c.id !== entry.id);
        open.push({ question: q, best: other ? { id: other.id, score: round(other.score) } : null });
      }
      base.questions = open;
      if (open.length && open.length === qs.length) {
        return { ...base, decision: 'abstain', entry: null, why: 'no-coverage', whyDetail: { question: open[0].question, nearest: entry.id }, reason: `"${entry.id}" matched the message, but not its question: "${open[0].question}"` };
      }
      if (open.length) {
        const room = (entry.steps || []).length < 5 && !entry.escalate && !entry.noDocAnswer;
        if (room) return { ...base, decision: 'partial', entry, why: 'partly-covered', whyDetail: { question: open[0].question }, reason: `The message asks more than one thing. "${entry.id}" answers one part; this part needs a person: "${open[0].question}"` };
        return { ...base, decision: 'abstain', entry: null, why: 'partly-covered', whyDetail: { question: open[0].question, nearest: entry.id }, reason: `The message asks more than one thing, and "${entry.id}" covers only part of it: "${open[0].question}"` };
      }
    }
    return { ...base, decision: 'answer', entry, why: null, whyDetail: null, reason: `Matched "${entry.id}" (${round(best.score)}, ahead by ${round(gap)}).` };
  }

  // For the reader (src/reader.mjs). route() above is unchanged; these only re-use its checks.
  //
  // The lexical candidates for a message, best first, with the threshold and margin ignored (anchor-excluded
  // entries included, since a new phrasing often misses an anchor word).
  function lexical(text) {
    const real = withoutPleasantries(stripDeskInstructions(String(text || '')).text);
    return scoreEntries(index, real).slice().sort((a, b) => b.score - a.score);
  }

  // Every script check that applies once an entry is chosen, run for an entry the reader picked:
  //   signals: the entry's own hand-over signals (plus the defaults), exactly as route() reads them.
  //   gaps:    every gap the docs-silent and coverage rules raise, each marked hard or soft.
  // Hard: no sentence of this entry can close it, because the rule already found the entry's own lines silent on
  // that platform, plan, code, route, price, date, number, named outside thing, or scope. Soft: a vocabulary gap
  // (a word, a short question's topic, a capitalized name) that a verbatim sentence the reader points to may close.
  const SOFT_GAPS = new Set(['specific', 'name', 'cause']);
  function reviewPick(entryId, text) {
    const entry = typeof entryId === 'object' ? entryId : index.byId.get(entryId);
    if (!entry) return null;
    const full = stripDeskInstructions(String(text || '')).text;
    const real = withoutPleasantries(full);
    let signals = null;
    const hits = needsPerson(full, entry.needs_person_if, { hasTerm, allStems }, { defaults: true });
    if (hits.length && !entry.escalate && !entry.noDocAnswer) {
      const w = whyOfSignals(hits, full);
      signals = { hits, ...w, holding: entry.holding || guardEntry(holdingFor(w.why, full)), reason: `${hits[0].about} ("${hits[0].words}")` };
    }
    const gaps = [];
    if (entry.symptom_only) { const err = specificError(real) || describedError(real); if (err) gaps.push({ kind: 'error', term: err, hard: true, rule: 'symptom-only' }); }
    if (problemPremise(entry) && !reportsProblem(real, entry)) gaps.push({ kind: 'premise', term: 'no problem reported', hard: true, rule: 'premise' });
    if (isErrorEntryLike(entry)) { const wc = countMismatch(entry.title, real); if (wc) gaps.push({ kind: 'number', term: wc.said, hard: true, rule: 'count' }); }
    if (!entry.escalate && !entry.noDocAnswer) {
      const s = silentOn(entry, askedText(real));
      if (s) gaps.push({ ...s, hard: !SOFT_GAPS.has(s.kind), rule: 'docs-silent' });
      if (coverage) for (const only of ['scope', 'action', 'platform', 'plan', 'endpoint', 'name', 'code', 'type', 'short', 'word']) {
        const g = coverage.gap(entry, real, { ...coverageOpt, only: [only] });
        if (g) gaps.push({ ...g, hard: !SOFT_GAPS.has(g.kind), rule: `coverage:${only}` });
      }
    }
    return { entry, full, real, signals, gaps };
  }

  // For the composer (src/composer.mjs): the same checks, for a draft that is not a saved entry. `draft` is an
  // entry-shaped object { adHoc: true, title, steps: [{ text, cite: { quote } }] } built from the composed steps.
  // The hand-over signals read are the defaults every answering entry has.
  const reviewDraft = (draft, text) => reviewPick({ id: '__composed__', title: '', ...draft, adHoc: true }, text);

  return { route, index, entries, lexical, reviewPick, reviewDraft, guardEntry };
}

function guardReason(g) {
  return {
    money: 'A message about money taken or asked back always goes to a person.',
    'others-data': 'The message asks for someone else\'s data or account. A person must handle that.',
    secret: 'The message asks for a key, a password or the desk\'s own settings. The desk never shares those.',
    'staff-action': 'The message asks us to post, delete or change something. Only a person on the team can do that, and the desk only reads.',
  }[g.guard] + ` (words: "${g.words}")`;
}

const round = (x) => Math.round(x * 1000) / 1000;
