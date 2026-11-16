// Entries as data: knowledge/entries/*.json, one file per help-center area.
// loadEntries() reads and checks their shape at start (it throws, naming the entry and the reason).
// checkEntries() adds the checks that need the cached help pages (every quote is on its page) and the
// routing check (every phrasing reaches its own entry).
// The command `node bin/support-desk.mjs check-entries` runs both and prints every problem.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { pageUrl, quoteOnPage, readCacheDir } from './docs.mjs';
import { findPromises, findVoice, findUncheckedRetries, RETRY_WHY } from './checkreply.mjs';
import { SIGNAL_NAMES, DEFAULT_SIGNALS, GENERIC_WORDS, STATUS_MEANING, NAMED_ITEMS } from './signals.mjs';
import { contentStems, anchorsMet, anchorRegex, foldText } from './match.mjs';
import { createRouter } from './route.mjs';

export const ENTRIES_DIR = path.join(ROOT, 'knowledge', 'entries');
export const KINDS = ['non-technical', 'billing', 'technical'];
export const LOOKUPS = ['recent-published', 'recent-activity', 'submission', 'reproduce-schedule', 'docs-search'];
export const GUARDS = ['money', 'others-data', 'staff-action', 'secret', 'desk-instructions', 'needs-person'];
const ENTRY_KEYS = ['id', 'kind', 'title', 'phrasings', 'not_this', 'anchors', 'needs_person_if', 'lookup', 'searchQueries', 'opening', 'steps', 'next', 'proof', 'escalate', 'docEdit', 'noDocAnswer', 'guard', 'priority', 'holding', 'note', 'symptom_only', 'scope'];
const REPLY_KEYS = ['opening', 'steps', 'next', 'proof'];
const SCOPE_KEYS = ['covers', 'coversKinds', 'not', 'why'];
const SCOPE_KINDS = [...Object.keys(NAMED_ITEMS), 'platform'];
const STEP_KEYS = ['type', 'text', 'cite', 'ref'];

// Read every *.json file in the folder. Returns { entries, files, problems }. Each entry knows its file.
export function readEntryFiles(dir = ENTRIES_DIR) {
  const problems = [];
  const entries = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { problems.push(`The entries folder ${dir} could not be read.`); }
  for (const f of files) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch (e) { problems.push(`${f}: not valid JSON (${e.message}).`); continue; }
    if (!data || typeof data.area !== 'string' || !Array.isArray(data.entries)) { problems.push(`${f}: a file needs "area" (text) and "entries" (a list).`); continue; }
    for (const e of data.entries) entries.push(Object.defineProperty({ ...e }, 'file', { value: f, enumerable: false }));
  }
  return { entries, files, problems };
}

const isWarning = (p) => p.startsWith('warning: ');
const isText = (x) => typeof x === 'string' && x.trim().length > 0;
const phraseKey = (s) => contentStems(s).join(' ');

function checkReplyBlock(where, b, e, problems) {
  for (const k of ['opening', 'next', 'proof']) if (!isText(b[k])) problems.push(`${where}: "${k}" is missing.`);
  if (!Array.isArray(b.steps)) { problems.push(`${where}: "steps" is missing.`); return; }
  if (b.steps.length < 3 || b.steps.length > 5) problems.push(`${where}: the reply would have ${b.steps.length} numbered steps. It needs three to five.`);
  if (isText(b.proof) && !/^(You will know it|Still open:)/.test(b.proof)) problems.push(`${where}: "proof" must start with "You will know it" or "Still open:".`);
  if (!b.steps.some(s => s?.type === 'fact')) problems.push(`${where}: no step quotes a help page, so the reply would have no help link.`);
  b.steps.forEach((s, i) => {
    const at = `${where}, step ${i + 1}`;
    if (!s || typeof s !== 'object') { problems.push(`${at}: not an object.`); return; }
    for (const k of Object.keys(s)) if (!STEP_KEYS.includes(k)) problems.push(`${at}: unknown field "${k}".`);
    if (!isText(s.text)) problems.push(`${at}: "text" is missing.`);
    if (s.type === 'fact') {
      if (!isText(s.cite?.url) || !isText(s.cite?.quote)) problems.push(`${at}: a fact step needs "cite": { "url", "quote" }.`);
      else if (!/^https:\/\/help\.blotato\.com\//.test(s.cite.url)) problems.push(`${at}: the cited url must be a page on https://help.blotato.com/.`);
      else if (isText(s.text)) {
        // A cheap look at a step written about something else than its quote. (Whether it says more than the
        // quote is the fresh checker's job.)
        const q = new Set(contentStems(s.cite.quote));
        const shared = contentStems(s.text).filter(w => q.has(w)).length;
        // A warning, not a failure: a plain rewrite can share no words and still be faithful ("send fewer posts
        // at a time" for "reduce concurrency"). It is there so a writer looks twice.
        if (!shared && q.size >= 3) problems.push(`warning: ${at}: the step shares no words with its quote ("${s.cite.quote}"). Check it says what the quote says.`);
      }
    } else if (s.type === 'evidence') {
      if (!e.lookup) problems.push(`${at}: an evidence step needs the entry to name a "lookup".`);
    } else if (s.type !== 'action') problems.push(`${at}: "type" must be "fact", "evidence" or "action".`);
  });
  // Every line a customer reads: no promises (a fact step may repeat its own quote), and the house voice.
  const lines = [['opening', b.opening, null], ['next', b.next, null], ['proof', b.proof, null], ...(b.steps || []).map((s, i) => [`step ${i + 1}`, s?.text, s?.type === 'fact' ? s.cite?.quote : null])];
  for (const [name, text, quote] of lines) {
    if (!isText(text)) continue;
    if (/\[[^\]]*\]|\b(?:TODO|TBD|FIXME|lorem ipsum|xxx)\b/i.test(text)) problems.push(`${where}, ${name}: has placeholder text. A customer would read it.`);
    for (const p of findPromises(text, { quote: quote || undefined })) problems.push(`${where}, ${name}: makes ${p.why} ("${p.words}").`);
    for (const v of findVoice(text)) problems.push(`${where}, ${name}: uses ${v}.`);
  }
  // A retry only after an earlier step has the customer check the platform itself (see checkreply.mjs).
  const ordered = [{ name: 'opening', text: b.opening }, ...(b.steps || []).map((s, i) => ({ name: `step ${i + 1}`, text: s?.text, step: true })), { name: 'next', text: b.next }, { name: 'proof', text: b.proof }];
  for (const h of findUncheckedRetries(ordered)) problems.push(`${where}, ${h.name}: ${RETRY_WHY} ("${h.words}").`);
}

// Shape checks that need no network and no cache. Returns a list of problems, each naming the entry.
export function validateShape(entries) {
  const problems = [];
  const ids = new Map();
  const phrasings = new Map();
  for (const e of entries) {
    const where = `${e.file ? e.file + ': ' : ''}${e.id || '(entry with no id)'}`;
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) problems.push(`${where}: unknown field "${k}". Known fields: ${ENTRY_KEYS.join(', ')}.`);
    if (!isText(e.id)) problems.push(`${where}: "id" is missing.`);
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.id)) problems.push(`${where}: "id" must be lowercase words joined by hyphens.`);
    else if (ids.has(e.id)) problems.push(`${where}: the id "${e.id}" repeats (also in ${ids.get(e.id)}).`);
    else ids.set(e.id, e.file || '?');
    if (!isText(e.title)) problems.push(`${where}: "title" is missing.`);
    if (!KINDS.includes(e.kind)) problems.push(`${where}: "kind" must be one of ${KINDS.join(', ')}.`);
    if (e.guard !== undefined && !GUARDS.includes(e.guard)) problems.push(`${where}: "guard" must be one of ${GUARDS.join(', ')}.`);
    if (e.lookup !== undefined && !LOOKUPS.includes(e.lookup)) problems.push(`${where}: "lookup" must be one of ${LOOKUPS.join(', ')}.`);
    if (e.priority !== undefined && typeof e.priority !== 'number') problems.push(`${where}: "priority" must be a number.`);
    checkReplyBlock(where, e, e, problems);
    if (e.holding !== undefined) {
      for (const k of Object.keys(e.holding || {})) if (!REPLY_KEYS.includes(k)) problems.push(`${where}, holding: unknown field "${k}".`);
      checkReplyBlock(`${where}, holding`, e.holding || {}, e, problems);
    }

    // Matching fields.
    const ph = e.phrasings;
    if (ph !== undefined && (!Array.isArray(ph) || !ph.every(isText))) problems.push(`${where}: "phrasings" must be a list of text.`);
    if (!e.guard && (!Array.isArray(ph) || ph.length < 5)) problems.push(`${where}: "phrasings" needs at least five ways a customer might say it (has ${Array.isArray(ph) ? ph.length : 0}).`);
    for (const p of Array.isArray(ph) ? ph : []) {
      if (!isText(p)) continue;
      const key = phraseKey(p);
      if (!key) { problems.push(`${where}: the phrasing "${p}" has no words the matcher can use.`); continue; }
      if (phrasings.has(key)) problems.push(`${where}: the phrasing "${p}" is the same as one in ${phrasings.get(key)}. Two entries may not share a phrasing.`);
      else phrasings.set(key, e.id);
    }
    if (e.not_this !== undefined && (!Array.isArray(e.not_this) || !e.not_this.every(isText))) problems.push(`${where}: "not_this" must be a list of text.`);
    const own = new Set((Array.isArray(ph) ? ph : []).filter(isText).map(phraseKey));
    for (const n of Array.isArray(e.not_this) ? e.not_this : []) if (isText(n) && own.has(phraseKey(n))) problems.push(`${where}: "${n}" is in both "phrasings" and "not_this".`);
    if (e.anchors !== undefined && (!Array.isArray(e.anchors) || !e.anchors.every(g => Array.isArray(g) && g.length && g.every(isText)))) problems.push(`${where}: "anchors" must be a list of word lists, like [["linkedin"], ["page", "company page"]].`);
    else for (const term of (e.anchors || []).flat()) {
      // Found while building: "\b" in a JSON string is a backspace character, not a regex word boundary.
      if (/[\u0000-\u001f]/.test(term)) problems.push(`${where}: the anchor "${term.replace(/[\u0000-\u001f]/g, '?')}" has a control character. In JSON, write a regex word boundary as "\\\\b".`);
      else if (/^\/.+\/$/.test(term)) { try { const re = new RegExp(term.slice(1, -1), 'i'); if (['', 'a', 'hello there', 'thanks for the help'].some(x => re.test(x))) problems.push(`${where}: the anchor ${term} matches almost any message, so it guards nothing.`); } catch (err) { problems.push(`${where}: the anchor ${term} is not a valid regular expression (${err.message}).`); } }
    }
    if (e.symptom_only !== undefined && typeof e.symptom_only !== 'boolean') problems.push(`${where}: "symptom_only" must be true or false.`);
    // Declared scope (third tuner): what the quotes cover beyond their own words, and what they do not cover.
    if (e.scope !== undefined) {
      const sc = e.scope;
      if (!sc || typeof sc !== 'object' || Array.isArray(sc)) problems.push(`${where}: "scope" must be { "covers": [...], "coversKinds": [...], "not": [...], "why": "..." }.`);
      else {
        for (const k of Object.keys(sc)) if (!SCOPE_KEYS.includes(k)) problems.push(`${where}: "scope" has an unknown field "${k}". Known fields: ${SCOPE_KEYS.join(', ')}.`);
        for (const k of ['covers', 'coversKinds', 'not']) if (sc[k] !== undefined && !(Array.isArray(sc[k]) && sc[k].length && sc[k].every(isText))) problems.push(`${where}: "scope.${k}" must be a list of text.`);
        for (const k of sc.coversKinds || []) if (!SCOPE_KINDS.includes(k)) problems.push(`${where}: "${k}" in "scope.coversKinds" is not a kind. Kinds: ${SCOPE_KINDS.join(', ')}.`);
        if ((sc.covers || sc.coversKinds) && !isText(sc.why)) problems.push(`${where}: "scope.covers" and "scope.coversKinds" need "scope.why": which quote covers them, in a sentence.`);
        // A cover that the quotes already say is not needed, and one that is also in "not" contradicts itself.
        const quoted = foldText([e.title, e.opening, e.next, e.proof, ...(e.steps || []).flatMap(s => [s?.text, s?.cite?.quote])].filter(isText).join(' | '));
        for (const t of sc.covers || []) if (isText(t) && quoted.includes(foldText(t))) problems.push(`${where}: "${t}" in "scope.covers" is already in the entry's quotes or steps. Take it out.`);
        for (const t of sc.not || []) if ((sc.covers || []).includes(t)) problems.push(`${where}: "${t}" is in both "scope.covers" and "scope.not".`);
      }
    }
    const np = e.needs_person_if;
    if (np !== undefined) {
      if (typeof np !== 'object' || Array.isArray(np)) problems.push(`${where}: "needs_person_if" must be { "signals": [...], "phrases": [...] }.`);
      else {
        for (const k of Object.keys(np)) if (!['signals', 'phrases', 'ignore'].includes(k)) problems.push(`${where}: "needs_person_if" has an unknown field "${k}".`);
        for (const s of np.signals || []) if (!SIGNAL_NAMES.includes(s)) problems.push(`${where}: "${s}" is not a known signal. Known signals: ${SIGNAL_NAMES.join(', ')}.`);
        if (np.ignore !== undefined && !(Array.isArray(np.ignore) && np.ignore.every(isText))) problems.push(`${where}: "needs_person_if.ignore" must be a list of signal names.`);
        for (const s of Array.isArray(np.ignore) ? np.ignore : []) if (!DEFAULT_SIGNALS.includes(s)) problems.push(`${where}: "${s}" in "needs_person_if.ignore" is not a default signal. Default signals: ${DEFAULT_SIGNALS.join(', ')}.`);
        for (const s of Array.isArray(np.ignore) ? np.ignore : []) if ((np.signals || []).includes(s)) problems.push(`${where}: "${s}" is in both "needs_person_if.signals" and "needs_person_if.ignore".`);
        if (np.phrases !== undefined && !(Array.isArray(np.phrases) && np.phrases.every(isText))) problems.push(`${where}: "needs_person_if.phrases" must be a list of text.`);
      }
    }
    const answers = !e.guard && !e.escalate && !e.noDocAnswer;
    // A named signal, not only phrases: a phrase that never fires would meet a looser rule.
    if (answers && !(np?.signals || []).length) problems.push(`${where}: an entry that answers needs "needs_person_if", at least one signal (most entries want "tried-steps" and "still-broken").`);

    if (e.escalate !== undefined) {
      if (!isText(e.escalate?.why)) problems.push(`${where}: "escalate.why" is missing.`);
      if (!Array.isArray(e.escalate?.causes)) problems.push(`${where}: "escalate.causes" must be a list.`);
      if (!Array.isArray(e.escalate?.ruledOut)) problems.push(`${where}: "escalate.ruledOut" must be a list.`);
    }
    if (e.docEdit !== undefined) {
      if (!isText(e.docEdit?.article) || !['new', 'change'].includes(e.docEdit?.kind)) problems.push(`${where}: "docEdit" needs "article" and "kind" ("new" or "change").`);
      if (e.docEdit?.kind === 'change' && (!isText(e.docEdit.before) || !isText(e.docEdit.after))) problems.push(`${where}: a "change" doc edit needs "before" and "after".`);
      if (e.docEdit?.kind === 'new' && !isText(e.docEdit.heading)) problems.push(`${where}: a "new" doc edit needs "heading".`);
    }
    if (e.lookup === 'docs-search' && !(Array.isArray(e.searchQueries) && e.searchQueries.every(isText))) problems.push(`${where}: a docs-search lookup needs "searchQueries".`);
  }
  // Every guard the desk can raise needs an entry to answer it.
  for (const g of GUARDS) if (!entries.some(e => e.guard === g)) problems.push(`No entry has "guard": "${g}". The desk needs one to hand those messages over.`);
  return problems;
}

// Every page an entry cites (steps, holding steps, escalation causes, the doc edit's article).
export function citedPages(e) {
  const urls = new Set();
  for (const s of [...(e.steps || []), ...(e.holding?.steps || [])]) if (s?.cite?.url) urls.add(pageUrl(s.cite.url));
  for (const c of [...(e.escalate?.causes || []), ...(e.escalate?.ruledOut || [])]) if (c?.cite?.url) urls.add(pageUrl(c.cite.url));
  if (e.docEdit?.article) urls.add(pageUrl(e.docEdit.article));
  return urls;
}

// The checks that need the cached help pages.
export function validateQuotes(entries, pages) {
  const problems = [];
  for (const e of entries) {
    const where = `${e.file ? e.file + ': ' : ''}${e.id}`;
    const quotes = [];
    for (const [block, list] of [['', e.steps], ['holding, ', e.holding?.steps]]) (list || []).forEach((s, i) => { if (s?.cite?.url && s.cite.quote) quotes.push([`${block}step ${i + 1}`, s.cite]); });
    for (const c of [...(e.escalate?.causes || []), ...(e.escalate?.ruledOut || [])]) if (c?.cite?.url) quotes.push(['escalation', c.cite]);
    if (e.docEdit?.kind === 'change' && e.docEdit.before) quotes.push(['doc edit "before"', { url: e.docEdit.article, quote: e.docEdit.before }]);
    for (const [name, c] of quotes) {
      const page = pages[pageUrl(c.url)];
      if (!page) problems.push(`${where}, ${name}: the page ${pageUrl(c.url)} is not cached. Run: node bin/support-desk.mjs docs --all`);
      else if (!quoteOnPage(c.quote, page)) problems.push(`${where}, ${name}: the quote "${c.quote}" is not on ${pageUrl(c.url)} (fetched ${String(page.fetchedAt).slice(0, 10)}).`);
    }
    if (e.docEdit?.article && !pages[pageUrl(e.docEdit.article)]) problems.push(`${where}, doc edit: the page ${pageUrl(e.docEdit.article)} is not cached.`);
  }
  return problems;
}

// Every phrasing must be able to reach its own entry: it meets the entry's anchors, no guard takes it first,
// and the router does not send it to a different entry. (Run by check-entries, not at start: it routes every
// phrasing once.)
export function validateRouting(entries) {
  const problems = [];
  const router = createRouter(entries);
  for (const e of entries) {
    if (e.guard) continue;
    const where = `${e.file ? e.file + ': ' : ''}${e.id}`;
    for (const p of e.phrasings || []) {
      if (!isText(p)) continue;
      if (!anchorsMet(p, e.anchors).ok) { problems.push(`${where}: the phrasing "${p}" does not meet this entry's own anchors, so a message worded like it can never match. Add a word to the anchors or reword the phrasing.`); continue; }
      const r = router.route(p);
      if (r.decision === 'guard') problems.push(`${where}: the phrasing "${p}" is taken by the ${r.guard} guard before matching (words: "${r.words}"). Reword it as a question, not a request.`);
      else if (r.entry && r.entry.id !== e.id && r.entry.guard !== 'needs-person') problems.push(`${where}: the phrasing "${p}" routes to "${r.entry.id}" instead. The two entries overlap: make the phrasings more distinct, or add a "not_this".`);
      // The rules every entry shares can stop a phrasing too.
      else if (r.decision === 'needs-person' && (r.signals || []).some(s => s.byDefault)) { const s = r.signals.find(x => x.byDefault); problems.push(`${where}: the phrasing "${p}" is handed to a person by the default "${s.signal}" signal (words: "${s.words}"). Reword it, or, if your entry truly answers that case, add "${s.signal}" to "needs_person_if.ignore".`); }
      else if (r.decision === 'abstain' && r.silent) problems.push(`${where}: the phrasing "${p}" is stopped by the docs-silent check: ${r.reason} ${r.silent.kind === 'number' ? 'Give the number in a step, or reword the phrasing.' : 'Name it in a step, or reword the phrasing.'}`);
    }
  }
  return problems;
}

// An entry that explains one error or one cause must not be reachable on words many problems share. Each of its
// anchor groups must not ALL be meetable by generic words: a status code, a platform name, or a common symptom
// word (GENERIC_WORDS in signals.mjs). At least one group must name the error's own text or code.
// Error entries: those citing an Errors or limitations page, or whose title says error, failed, rejected and
// the like. Not checked: entries for a symptom with no error text ("symptom_only", generic on purpose), and
// entries whose title is itself only generic words ("YouTube Unauthorized error when posting").
// A bare status code counts as distinctive when the title gives that status's meaning ("503 Service Unavailable").
const GENERIC_SAMPLES = [...GENERIC_WORDS, ...Array.from({ length: 500 }, (_, i) => String(100 + i))];
const GENERIC_STEMS = new Set([...GENERIC_WORDS].flatMap(contentStems));
const TITLE_FILLER = new Set(contentStems('when while from on in the to with posting error errors service unavailable gateway timeout unauthorized unauthorised too many requests internal server bad request forbidden not found'));
export const isErrorEntry = (e) => (e.steps || []).some(s => /\/errors?\b|error-handling|limitations/.test(s?.cite?.url || '')) || /\b(?:error|errors|failed|fails|rejected|not found|invalid|exceeded|unsupported)\b/i.test(e.title || '');
export function genericTerm(term, title = '') {
  const re = anchorRegex(term);
  if (re) return GENERIC_SAMPLES.some(x => re.test(x));
  const t = foldText(term).trim();
  if (/^\d{3}$/.test(t)) return !(STATUS_MEANING[t] && foldText(title).includes(STATUS_MEANING[t]));
  return GENERIC_WORDS.has(t);
}
export function validateAnchors(entries) {
  const problems = [];
  for (const e of entries) {
    if (e.guard || e.symptom_only || !(e.anchors || []).length || !isErrorEntry(e)) continue;
    if (contentStems(e.title).every(w => GENERIC_STEMS.has(w) || TITLE_FILLER.has(w) || /^\d+$/.test(w))) continue;
    if (!e.anchors.every(g => g.some(t => genericTerm(t, e.title)))) continue;
    const loose = e.anchors.map(g => g.filter(t => genericTerm(t, e.title))[0]);
    problems.push(`${e.file ? e.file + ': ' : ''}${e.id}: the anchors can all be met by words many problems share (for example "${loose.join('" + "')}"), so a message with only a status code, a platform name or a common symptom word could get this entry. Make one anchor group hold only this error's own text or code.`);
  }
  return problems;
}

// Load at start: read, check the shape, and throw if anything is wrong.
export function loadEntries(dir = ENTRIES_DIR) {
  const { entries, files, problems } = readEntryFiles(dir);
  problems.push(...validateShape(entries).filter(p => !isWarning(p)));
  if (problems.length) {
    const err = new Error(`The entries in ${dir} have ${problems.length} problem(s). Run "node bin/support-desk.mjs check-entries" for the list.\n- ${problems.slice(0, 10).join('\n- ')}`);
    err.problems = problems;
    throw err;
  }
  return { entries, files };
}

// The whole check, for the command and for npm test.
export function checkEntries({ dir = ENTRIES_DIR, cacheDir } = {}) {
  const { entries, files, problems: all } = readEntryFiles(dir);
  all.push(...validateShape(entries));
  const warnings = all.filter(isWarning).map(p => p.replace(/^warning: /, ''));
  const problems = all.filter(p => !isWarning(p));
  const pages = readCacheDir(cacheDir);
  problems.push(...validateQuotes(entries, pages));
  // Routing needs a sound set of entries, so it runs only when the shape is right.
  if (!problems.length) problems.push(...validateAnchors(entries), ...validateRouting(entries));
  const cited = new Set(); for (const e of entries) for (const u of citedPages(e)) cited.add(u);
  return { ok: !problems.length, problems, warnings, entries: entries.length, files: files.length, pagesCited: cited.size, pagesCached: Object.keys(pages).length };
}
