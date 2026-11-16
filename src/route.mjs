// Route one customer message: which entry answers it, or why a person must take it.
//
// Order, and the first that decides wins:
//   1. Hard guards (money, someone else's data, a key or the desk's settings, a request to post, delete or
//      change something). They always win, even when the message also asks something easy.
//   2. Words aimed at the desk ("ignore your rules", "[SYSTEM NOTE]") are cut out. If no real question is
//      left, the message is handed over.
//   3. The matcher scores every entry. Below the threshold, or too close to the runner-up, the desk does not
//      answer: a person gets the message with the top three candidates. If the message also says the customer
//      already tried things and it still fails (GENERAL_SIGNALS plus a trouble word), the customer gets the
//      general holding reply.
//   4. The entry's needs_person_if signals: the customer already did the steps, or it is past the docs.
//      The answer becomes a holding reply and an escalation.
//   5. A second question the entry does not cover: answer the part it can cite and hand over the rest,
//      or hand over the whole message when the entry has no room for that line. If the entry covers none
//      of the message's questions, it matched only the background, and the desk does not answer.
import { buildIndex, scoreEntries, scoreAgainst, splitSentences, contentStems, allStems, hasTerm, anchorsMet, anchorRegex } from './match.mjs';
import { runGuards, stripDeskInstructions, needsPerson, TROUBLE, NAMED_ITEMS, PLATFORMS, ASKS_NUMBER, ASKS_OWN_COUNT, GIVES_NUMBER, INTRODUCER, COMMON_CAPS } from './signals.mjs';

// Tuned on the dev set only (eval/tickets.dev.jsonl). See BUILD-LOG.md for how.
export const THRESHOLD = 0.25;   // the best entry's score must reach this, when the entry has anchors and they are met
export const THRESHOLD_UNANCHORED = 0.45; // an entry with no anchors has only its phrasings to go on, so it needs more
export const MARGIN = 0.06;      // and beat the runner-up by this much
export const COVERED = 0.30;     // a second question this close to the chosen entry counts as the same topic
// Signals strong enough to hand a message over even when no entry matches it.
export const GENERAL_SIGNALS = ['tried-steps', 'still-broken', 'retried', 'disputes-count', 'records-disagree', 'many-accounts'];
// A question: ends with "?", starts like one, starts a second ask ("Also, ..."), or asks indirectly
// ("I also want to know whether ...").
const QUESTION = /\?\s*$|^(?:how|what|why|where|when|which|who|can|could|does|do|is|are|will|would|should|did|has|have|may|also|and also|plus|p\.?s\.?|another thing|one more thing)\b|\b(?:want to know|wondering|wonder|need to know|curious|tell me|let me know)\b(?:\s+\w+){0,2}?\s+(?:if|whether|how|what|when|why|where|which)\b/i;

export function createRouter(entries, { threshold = THRESHOLD, thresholdUnanchored = THRESHOLD_UNANCHORED, margin = MARGIN, covered = COVERED } = {}) {
  const matchable = entries.filter(e => !e.guard);
  const index = buildIndex(matchable);
  const guardEntry = (g) => entries.find(e => e.guard === g) || null;

  // What each entry speaks about: every word of its title, phrasings, anchors, steps, quotes and other reply
  // lines, as stems (a "|" between texts, so a two-word term never spans two texts).
  const vocab = new Map(matchable.map(e => {
    const texts = [e.title, ...(e.phrasings || []), ...(e.anchors || []).flat().filter(t => !anchorRegex(t)), e.opening, e.next, e.proof,
      ...(e.steps || []).flatMap(s => [s.text, s.cite?.quote])].filter(t => typeof t === 'string');
    return [e.id, texts.flatMap(t => [...allStems(t), '|'])];
  }));
  const everyWord = new Set([...vocab.values()].flat());
  const givesNumber = new Map(matchable.map(e => [e.id, (e.steps || []).some(s => GIVES_NUMBER.test(s.text || '') || GIVES_NUMBER.test(s.cite?.quote || ''))]));
  const items = Object.entries(NAMED_ITEMS).flatMap(([kind, terms]) => terms.map(term => ({ kind, term })));
  const platformSpecific = new Map(matchable.map(e => [e.id, Object.values(PLATFORMS).some(al => al.some(a => hasTerm(allStems(e.title), a)))]));

  // Docs-silent: the customer asks about a named thing, or a number, that the chosen entry never mentions.
  // Returns { kind, term } for the first one, or null.
  // Named items match exactly, both ways: with one-letter typos allowed, "video" would be "vimeo".
  const has = (stems, term) => { const t = allStems(term); outer: for (let i = 0; i + t.length <= stems.length; i++) { for (let j = 0; j < t.length; j++) if (stems[i + j] !== t[j]) continue outer; return true; } return false; };
  const namesPlatform = (stems, al) => al.some(a => has(stems, a));
  function silentOn(entry, text) {
    const stems = allStems(text);
    const v = vocab.get(entry.id) || [];
    for (const { kind, term } of items) if (has(stems, term) && !has(v, term)) return { kind, term };
    const asked = Object.entries(PLATFORMS).filter(([, al]) => namesPlatform(stems, al));
    const missing = asked.find(([, al]) => !namesPlatform(v, al));
    if (missing && platformSpecific.get(entry.id)) return { kind: 'platform', term: missing[0] };
    const asksNumber = ASKS_NUMBER.test(text) && !ASKS_OWN_COUNT.test(text);
    if (asksNumber && !givesNumber.get(entry.id)) return { kind: 'number', term: text.match(ASKS_NUMBER)[0] };
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
      return { ...base, decision: 'guard', guard: g.guard, words: g.words, entry, reason: guardReason(g) };
    }

    const cut = stripDeskInstructions(original);
    base.stripped = cut.found;
    const real = cut.text;
    if (cut.found.length && contentStems(real).length < 2) {
      return { ...base, decision: 'guard', guard: 'desk-instructions', words: cut.found[0], entry: guardEntry('desk-instructions'), reason: 'The message gives the desk instructions and asks no real question.' };
    }

    const scored = scoreEntries(index, real);
    const live = scored.filter(c => !c.excluded);
    base.candidates = live.slice(0, 3).map(c => ({ id: c.id, score: round(c.score), phrasing: c.phrasing }));
    const [best, second] = live;
    const gap = best ? best.score - (second?.score || 0) : 0;
    const need = best?.anchored ? threshold : thresholdUnanchored;
    if (!best || best.score < need || gap < margin) {
      const why = !best ? 'No entry is a candidate for this message.'
        : best.score < need ? `The best match, "${best.id}", scored ${round(best.score)}, below the ${need} the desk needs to answer.`
          : `The best match, "${best.id}" (${round(best.score)}), is too close to "${second.id}" (${round(second.score)}) to choose between them.`;
      // No entry, but the customer says they already tried things, or it keeps failing, or Blotato's own
      // records disagree: whatever the topic, a person takes it, and the customer gets the holding reply.
      // The strong default signals ("three days in a row", "is something down", "I only posted 3") count on
      // their own; the rest need a trouble word.
      const hits = needsPerson(real, { signals: TROUBLE.test(real) ? GENERAL_SIGNALS : [] }, { hasTerm, allStems }, { defaults: true });
      if (hits.length) return { ...base, decision: 'needs-person', entry: guardEntry('needs-person'), holding: guardEntry('needs-person'), signals: hits, reason: `${why} And: ${hits[0].about} ("${hits[0].words}")` };
      return { ...base, decision: 'abstain', entry: null, reason: why };
    }
    const entry = index.byId.get(best.id);
    base.words = best.anchorHits?.[0] || best.phrasing;
    base.score = round(best.score);
    base.margin = round(gap);

    // The entry's own signals, plus the default ones every answering entry has (signals.mjs DEFAULT_SIGNALS).
    const hits = needsPerson(real, entry.needs_person_if, { hasTerm, allStems }, { defaults: true });
    if (hits.length && !entry.escalate && !entry.noDocAnswer) {
      return { ...base, decision: 'needs-person', entry, signals: hits, holding: entry.holding || guardEntry('needs-person'), reason: `${hits[0].about} ("${hits[0].words}")` };
    }

    // The thing asked about must be something the entry speaks about. Only the questions are read (the whole
    // message when it has none), so "I make my images in Canva. How do I schedule a post?" is not blocked.
    if (!entry.escalate && !entry.noDocAnswer) {
      const asked = splitSentences(real).filter(s => QUESTION.test(s.trim()));
      const silent = silentOn(entry, asked.length ? asked.join(' ') : real);
      if (silent) {
        const what = silent.kind === 'number' ? `asks for a number ("${silent.term}"), and its steps give none`
          : `asks about ${silent.kind === 'name' ? '' : `${/^[aeiou]/.test(silent.kind) ? 'an' : 'a'} ${silent.kind}, `}"${silent.term}", which it never mentions`;
        return { ...base, decision: 'abstain', entry: null, silent, reason: `"${entry.id}" matched the message, but the message ${what}. The docs may be silent on it.` };
      }
    }

    // Every real question in the message must belong to this entry. A question with fewer than three content
    // words ("Is it stuck?", "Did it post or not?") leans on the rest of the message, so it is not checked on
    // its own. Anchors are for the whole message, so a question is scored against the phrasings without them.
    // If no question is covered, the entry matched only the background ("I'm leaving next month. How do I
    // download my videos?"), so the desk does not answer.
    const qs = splitSentences(real)
      .filter(s => QUESTION.test(s.trim()))
      // Two questions in one sentence ("How many per minute, and how much does the plan cost?") are split,
      // but only when each part can stand on its own.
      .flatMap(s => {
        const parts = s.split(/,?\s+(?:and|also|plus|or)\s+(?=(?:also\s+)?(?:how|what|why|where|when|which|who|can|could|does|do|is|are|will|would|should)\b)/i);
        return parts.length > 1 && parts.every(p => contentStems(p).length >= 3) ? parts : [s];
      })
      .filter(s => contentStems(s).length >= 3);
    const enough = Math.min(covered, need);
    if (qs.length >= 1) {
      const open = [];
      for (const q of qs) {
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
        return { ...base, decision: 'abstain', entry: null, reason: `"${entry.id}" matched the message, but not its question: "${open[0].question}"` };
      }
      if (open.length) {
        const room = (entry.steps || []).length < 5 && !entry.escalate && !entry.noDocAnswer;
        if (room) return { ...base, decision: 'partial', entry, reason: `The message asks more than one thing. "${entry.id}" answers one part; this part needs a person: "${open[0].question}"` };
        return { ...base, decision: 'abstain', entry: null, reason: `The message asks more than one thing, and "${entry.id}" covers only part of it: "${open[0].question}"` };
      }
    }
    return { ...base, decision: 'answer', entry, reason: `Matched "${entry.id}" (${round(best.score)}, ahead by ${round(gap)}).` };
  }

  return { route, index, entries };
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
