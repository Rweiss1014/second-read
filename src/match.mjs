// Find the help-center entry a customer's message is about, or abstain.
//
// No model and no network: a small TF-IDF scorer over each entry's title and phrasings.
// - Words are lowercased, stripped of accents and stop words, and cut to a rough stem ("charged" -> "charg").
// - Word pairs add a little weight, so "company page" counts for more than "company" and "page" apart.
// - Character 3-grams of each word catch typos and non-native spelling ("subscribtion", "instgram").
// - A message is scored by its best sentence, its best pair of sentences, and as a whole, so a long message
//   is not punished for its extra words.
// - Anchors are a precision gate: an entry with anchors is a candidate only if the message names one word
//   from each anchor group (typos of one letter allowed for longer words).
// - "not_this" phrasings are near misses. If the message is at least as close to one of them as to the
//   entry's own phrasings and uses a word only the near miss has, the entry steps aside.
// The caller decides with a threshold AND a margin over the runner-up. Below either, the desk does not answer.

const STOP = new Set(`a an the and or but if of to in on at for with from by is are was were be been being it its it's this that
these those i i'm im i've ive i'd id me my mine we us our ours you your yours he she they them their do does did doing done have has had
so just can could would should will shall may might must am what how why where when which who whom there here any some about into out
up as than then too very also please pls plz hi hello hey thanks thank thx dear blotato team support guys get got gets one ok okay
yes yeah really actually still now right lol like know need want trying try tried`.split(/\s+/));

export function foldText(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"')
    .toLowerCase();
}

export function stem(w) {
  let s = w;
  if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  if (s.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(s)) s = s.slice(0, -1); // cancell -> cancel, stopp -> stop
  return s;
}

// Every word, stemmed, stop words kept (for anchors and phrase signals).
export function allStems(text) {
  return (foldText(text).match(/[a-z0-9]+/g) || []).map(stem);
}
// Content words only, stemmed.
export function contentStems(text) {
  return (foldText(text).match(/[a-z0-9]+/g) || []).filter(w => !STOP.has(w) && (w.length > 1 || /\d/.test(w))).map(stem);
}

function features(text) {
  const words = contentStems(text);
  const w = new Map(); const g = new Map();
  for (const t of words) w.set(t, (w.get(t) || 0) + 1);
  for (let i = 0; i + 1 < words.length; i++) { const b = `${words[i]}_${words[i + 1]}`; w.set(b, (w.get(b) || 0) + 0.5); }
  for (const t of words) {
    if (t.length < 3 || /\d/.test(t)) continue; // codes and numbers count only as whole words, never as near spellings
    const s = `#${t}#`;
    for (let i = 0; i + 3 <= s.length; i++) { const k = s.slice(i, i + 3); g.set(k, (g.get(k) || 0) + 1); }
  }
  return { words, w, g };
}

function weigh(tf, idf, fallback) {
  const v = new Map(); let norm = 0;
  for (const [k, n] of tf) { const x = (n >= 1 ? 1 + Math.log(n) : n) * (idf.get(k) ?? fallback); v.set(k, x); norm += x * x; }
  return { v, norm: Math.sqrt(norm) };
}
function cosine(a, b) {
  if (!a.norm || !b.norm) return 0;
  let dot = 0;
  const [small, big] = a.v.size < b.v.size ? [a.v, b.v] : [b.v, a.v];
  for (const [k, x] of small) { const y = big.get(k); if (y) dot += x * y; }
  return dot / (a.norm * b.norm);
}

// Sentences, adjacent pairs, and the whole message.
export function splitSentences(text) {
  return String(text || '').split(/(?<=[.?!])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}
function unitsOf(text) {
  const sents = splitSentences(text);
  const units = [text];
  if (sents.length > 1) {
    units.push(...sents);
    for (let i = 0; i + 1 < sents.length; i++) units.push(`${sents[i]} ${sents[i + 1]}`);
  }
  return units.filter(u => contentStems(u).length >= 1);
}

// One-letter typos for words of five letters or more (insert, delete, swap, replace).
// A token with a digit in it (an error code, an HTTP status, an amount, a count, an id) is never a typo of
// another: 20003 is not 20005, and "v2" is not "v3". It must match exactly. Found by an entry writer: the
// anchor for error 20005 took a message about 20003.
export function nearWord(a, b) {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

// Does the message (as stems) contain this term (one or more words, stemmed), typos allowed?
export function hasTerm(msgStems, term) {
  const t = allStems(term);
  if (!t.length) return false;
  outer: for (let i = 0; i + t.length <= msgStems.length; i++) {
    for (let j = 0; j < t.length; j++) if (!nearWord(msgStems[i + j], t[j])) continue outer;
    return true;
  }
  return false;
}

// Anchor words are matched as written (one-letter typos allowed for words of five letters or more), not as
// stems: "posted" must not match every "post". List each form you mean ("cancel", "canceled", "cancelled").
// A term written as "/.../" is a regular expression, for the few cases where word order matters.
export const rawWords = (text) => foldText(text).match(/[a-z0-9]+/g) || [];
const regexCache = new Map();
export function anchorRegex(term) {
  if (!/^\/.+\/$/.test(term)) return null;
  if (!regexCache.has(term)) regexCache.set(term, new RegExp(term.slice(1, -1), 'i'));
  return regexCache.get(term);
}
export function hasAnchor(text, words, term) {
  const re = anchorRegex(term);
  if (re) return re.test(foldText(text));
  const t = rawWords(term);
  if (!t.length) return false;
  outer: for (let i = 0; i + t.length <= words.length; i++) {
    for (let j = 0; j < t.length; j++) if (!nearWord(words[i + j], t[j])) continue outer;
    return true;
  }
  return false;
}

export function anchorsMet(text, anchors) {
  const hits = [];
  const words = rawWords(text);
  for (const group of anchors || []) {
    const hit = group.find(term => hasAnchor(text, words, term));
    if (!hit) return { ok: false, hits };
    hits.push(hit);
  }
  return { ok: true, hits };
}

export function buildIndex(entries) {
  const docs = [];
  for (const e of entries) {
    if (e.guard && !(e.phrasings || []).length) continue;
    for (const p of [e.title, ...(e.phrasings || [])]) docs.push({ entry: e.id, text: p, neg: false });
    // A near miss's own words: the words in it that none of the entry's phrasings use.
    const own = new Set([e.title, ...(e.phrasings || [])].flatMap(contentStems));
    for (const p of e.not_this || []) docs.push({ entry: e.id, text: p, neg: true, distinct: [...new Set(contentStems(p).filter(w => !own.has(w)))] });
  }
  const df = { w: new Map(), g: new Map() };
  const feats = docs.map(d => features(d.text));
  for (const f of feats) { for (const k of f.w.keys()) df.w.set(k, (df.w.get(k) || 0) + 1); for (const k of f.g.keys()) df.g.set(k, (df.g.get(k) || 0) + 1); }
  const N = docs.length || 1;
  const idf = { w: new Map(), g: new Map() };
  for (const [k, n] of df.w) idf.w.set(k, Math.log(1 + N / n));
  for (const [k, n] of df.g) idf.g.set(k, Math.log(1 + N / n));
  const unseen = { w: Math.log(1 + N), g: Math.log(1 + N) };
  const vec = (f) => ({ w: weigh(f.w, idf.w, unseen.w), g: weigh(f.g, idf.g, unseen.g) });
  docs.forEach((d, i) => { d.vec = vec(feats[i]); });
  const byId = new Map(entries.map(e => [e.id, e]));
  return { docs, vec, byId, entries };
}

// Word cosine counts most; the 3-gram cosine carries typos.
const sim = (a, b) => 0.65 * cosine(a.w, b.w) + 0.35 * cosine(a.g, b.g);

// A near miss makes the entry step aside when two things are true: the message is about as close to the near
// miss as to the entry's best phrasing (at least this share of its score), and the message uses a word that
// only the near miss has. The second test keeps "my posts show canceled" from blocking "how do I cancel?"
// just because both say "cancel".
export const NEAR_MISS_RATIO = 0.6;

// Score every entry for this text. Returns candidates sorted best first:
// { id, score, phrasing, unit, anchorHits, excluded: null | 'anchors' | 'not_this', nearMiss }
export function scoreEntries(index, text, { only } = {}) {
  const units = unitsOf(text).map(u => ({ text: u, vec: index.vec(features(u)) }));
  const msg = new Set(contentStems(text));
  const best = new Map();
  for (const d of index.docs) {
    const e = index.byId.get(d.entry);
    if (only && !only(e)) continue;
    let top = 0; let unit = null;
    for (const u of units) { const s = sim(u.vec, d.vec); if (s > top) { top = s; unit = u.text; } }
    const b = best.get(d.entry) || { id: d.entry, score: 0, phrasing: null, unit: null, nearMiss: 0, nearMissText: null, negs: [] };
    if (d.neg) { b.negs.push({ score: top, text: d.text, own: d.distinct.filter(w => msg.has(w)) }); if (top > b.nearMiss) { b.nearMiss = top; b.nearMissText = d.text; } }
    else if (top > b.score) { b.score = top; b.phrasing = d.text; b.unit = unit; }
    best.set(d.entry, b);
  }
  const out = [];
  for (const b of best.values()) {
    const e = index.byId.get(b.id);
    const a = anchorsMet(text, e.anchors);
    b.anchorHits = a.hits;
    b.anchored = !!(e.anchors || []).length;
    const hit = b.negs.filter(n => n.own.length && n.score >= NEAR_MISS_RATIO * b.score).sort((x, y) => y.score - x.score)[0];
    if (hit) { b.nearMiss = hit.score; b.nearMissText = hit.text; b.nearMissWords = hit.own; }
    delete b.negs;
    b.excluded = !a.ok ? 'anchors' : (hit ? 'not_this' : null);
    out.push(b);
  }
  return out.sort((x, y) => (x.excluded ? 1 : 0) - (y.excluded ? 1 : 0) || y.score - x.score);
}

// How close one piece of text is to one entry (its best phrasing). Used for the parts of a two-question message.
export function scoreAgainst(index, text, entryId) {
  return scoreEntries(index, text, { only: (e) => e.id === entryId })[0] || null;
}
