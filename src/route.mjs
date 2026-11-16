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
import { buildIndex, scoreEntries, scoreAgainst, splitSentences, contentStems, allStems, hasTerm, anchorsMet } from './match.mjs';
import { runGuards, stripDeskInstructions, needsPerson, TROUBLE } from './signals.mjs';

// Tuned on the dev set only (eval/tickets.dev.jsonl). See BUILD-LOG.md for how.
export const THRESHOLD = 0.25;   // the best entry's score must reach this, when the entry has anchors and they are met
export const THRESHOLD_UNANCHORED = 0.45; // an entry with no anchors has only its phrasings to go on, so it needs more
export const MARGIN = 0.06;      // and beat the runner-up by this much
export const COVERED = 0.30;     // a second question this close to the chosen entry counts as the same topic
// Signals strong enough to hand a message over even when no entry matches it.
export const GENERAL_SIGNALS = ['tried-steps', 'still-broken', 'retried', 'disputes-count', 'records-disagree', 'many-accounts'];
const QUESTION =/\?\s*$|^(?:how|what|why|where|when|which|who|can|could|does|do|is|are|will|would|should|did|has|have|may)\b/i;

export function createRouter(entries, { threshold = THRESHOLD, thresholdUnanchored = THRESHOLD_UNANCHORED, margin = MARGIN, covered = COVERED } = {}) {
  const matchable = entries.filter(e => !e.guard);
  const index = buildIndex(matchable);
  const guardEntry = (g) => entries.find(e => e.guard === g) || null;

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
      const hits = TROUBLE.test(real) ? needsPerson(real, { signals: GENERAL_SIGNALS }, { hasTerm, allStems }) : [];
      if (hits.length) return { ...base, decision: 'needs-person', entry: guardEntry('needs-person'), holding: guardEntry('needs-person'), signals: hits, reason: `${why} And: ${hits[0].about} ("${hits[0].words}")` };
      return { ...base, decision: 'abstain', entry: null, reason: why };
    }
    const entry = index.byId.get(best.id);
    base.words = best.anchorHits?.[0] || best.phrasing;
    base.score = round(best.score);
    base.margin = round(gap);

    const hits = needsPerson(real, entry.needs_person_if, { hasTerm, allStems });
    if (hits.length && !entry.escalate && !entry.noDocAnswer) {
      return { ...base, decision: 'needs-person', entry, signals: hits, holding: entry.holding || guardEntry('needs-person'), reason: `${hits[0].about} ("${hits[0].words}")` };
    }

    // Every real question in the message must belong to this entry. A question with fewer than three content
    // words ("Is it stuck?", "Did it post or not?") leans on the rest of the message, so it is not checked on
    // its own. Anchors are for the whole message, so a question is scored against the phrasings without them.
    // If no question is covered, the entry matched only the background ("I'm leaving next month. How do I
    // download my videos?"), so the desk does not answer.
    const qs = splitSentences(real).filter(s => QUESTION.test(s.trim()) && contentStems(s).length >= 3);
    const enough = Math.min(covered, need);
    if (qs.length >= 1) {
      const open = [];
      for (const q of qs) {
        const s = scoreAgainst(index, q, entry.id);
        if (s && s.excluded !== 'not_this' && s.score >= enough) continue;
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
