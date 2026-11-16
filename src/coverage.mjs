// Specifics must be covered (third tuner).
//
// The desk answers only when the customer's own specifics are covered by what it would say: the sentences it
// quotes, the steps that restate them, the entry's title and reply lines, and the entry's declared scope.
// Phrasings and anchors do NOT count here: they are the entry writer's guesses at customer words, not the docs.
// So "Is there a OneDrive link like the Google Drive one?" is not answered by an entry whose quotes only speak of
// Google Drive, even if a writer once put "onedrive" in a phrasing.
//
// What counts as a specific, read from the customer's questions (pasted code, links and quoted error text left out):
//   1. a word the knowledge base rarely or never uses ("footnotes", "prorated", "keyboard shortcuts"), unless it
//      is plain conversation ("confused", "awesome", "tomorrow"), a short word, or a number;
//   2. a platform, when the entry's quotes name platforms and never this one;
//   3. a plan or billing period (Starter, Creator, Agency, trial, yearly), when the quotes name plans and never this one;
//   4. an error or status code the customer gives, when the entry's quotes give codes and never this one;
//   5. the kind of question: a price needs a quoted amount; "when will it ship" needs a quoted date or a quoted
//      "not announced"; a "why" needs a quoted cause;
//   6. a term the entry's scope says it does not cover (scope.not).
// Each gap names what is missing, so the person who takes the message sees it.
import { contentStems, rawWords, nearWord, splitSentences, allStems, stem, foldText } from './match.mjs';
import { PLATFORMS, NAMED_ITEMS } from './signals.mjs';

// Plain conversation: feelings, judgments, fillers, time words and people words. None of these is a thing the
// docs must cover. (A general list, written from English, not from any exam.)
const CHATTER_WORDS = `
love loved loving like liked hate hated great good bad nice cool awesome amazing brilliant fantastic wonderful
excellent perfect terrible horrible awful useless helpful glad happy sad excited exciting thrilled frustrated
frustrating annoying annoyed angry upset worried confused confusing weird strange odd funny silly dumb stupid
ridiculous crazy honest honestly literally basically totally fully really truly seriously absolutely definitely
probably maybe perhaps hopefully sorry apologies question questions thing things stuff something anything
everything nothing someone anyone everyone somebody anybody everybody whatever lot lots kind sort bit quick
quickly simple simply easy easier hard harder sure think thought guess hope hoping wonder wondering feel feeling
seems seem seemed idea ideas anyway though although otherwise else even instead again only same other another
new old first last next whole every each both either neither many much more most less few several already
yet soon later earlier today tonight tomorrow yesterday week weeks weekend month months year years day days
morning afternoon evening night hour hours minute minutes moment while ago times
monday tuesday wednesday thursday friday saturday sunday january february march april may june july august
september october november december jan feb mar apr jun jul aug sep sept oct nov dec
thanks thank appreciate appreciated cheers regards hello hey
please tell know knew let make made makes making go goes going went gone get gets getting got give gives given
gave take takes took taken put puts see sees saw seen look looks looked looking find found work works worked
working use uses used using want wants wanted need needs needed try tries tried trying say says said ask asks
asked show shows showed shown come comes came keep keeps kept start started starting happen happened happens
mean means meant right wrong fine okay ok normal possible able supposed actually real
her him his hers she he they them their theirs herself himself myself yourself ourselves themselves
boss client clients customer customers friend friends husband wife partner team teammate colleague coworker
manager assistant mom dad son daughter family people person guy guys folks
business company shop store brand small big little large huge tiny whole entire main
help helps helped tip tips advice guide example examples problem problems issue issues error errors bug bugs
fix fixed fixing broken
exactly ever never always often usually sometimes still just almost quite rather pretty very super fast slow
faster slower quickly best worst better worse biggest smallest largest favorite favourite haha lol omg wow yay
ugh hmm idk btw fyi asap urgent urgently
summer winter spring autumn fall season seasons holiday holidays vacation vacations trip trips travel traveling travelling away
`;
export const CHATTER = new Set(CHATTER_WORDS.trim().split(/\s+/).flatMap(w => contentStems(w)));

// Plans and billing periods, as customers write them.
export const PLANS = {
  starter: ['starter'], creator: ['creator'], agency: ['agency'],
  trial: ['trial', 'free trial'], yearly: ['yearly', 'annual', 'annually', 'per year', 'a year'],
  monthly: ['monthly', 'per month', 'a month'],
};
const TIERS = ['starter', 'creator', 'agency', 'trial'];
const PERIODS = ['yearly', 'monthly'];

// Capitalized words that are not a named thing: the desk's own words, plan names, days, months.
const NAME_OK = new Set('blotato settings billing api ai mcp utc gmt pst est cet english spanish starter creator agency pro free trial post posts account accounts calendar video videos draft drafts help support team the this that these those and but or so if when then also ok okay thanks hi hello please my our your its it is are was what why how where which who can could would should does did do will has have had any some'.split(' '));
const ITEM_WORDS = new Set(Object.values(NAMED_ITEMS).flat().flatMap(t => rawWords(t)));
const PLATFORM_WORDS = new Set(Object.values(PLATFORMS).flat().filter(a => !a.includes(' ')));
const CODE = /\b(?:[1-5]\d\d|\d{4,5})\b/g;
// What the customer pasted is what they sent, not what they ask about.
export function withoutPasted(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\{[^\n]*\}/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/"[^"\n]{2,300}"|“[^”\n]{2,300}”|‘[^’\n]{2,300}’/g, ' ')
    .replace(/(^|[\s:(\[])'[^'\n]{2,300}'(?=$|[\s.,!?;:)\]])/g, '$1 ')
    // A pasted error line ("ClientError: Command failed: ffprobe ...") is what a tool printed.
    .replace(/\b(?:[A-Z][A-Za-z]*Error|Error|Exception|Warning)\s*:[^\n]*/g, ' ')
    .replace(/\b[a-z]+[A-Z][A-Za-z0-9]*\b|\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b|\b[a-z0-9]+_[a-z0-9_]+\b/g, ' ');
}

// Words in order, as written (no stems): "link in" is not "linked in", "short video" is not "Shorts".
const hasRaw = (words, term) => { const t = rawWords(term); outer: for (let i = 0; i + t.length <= words.length; i++) { for (let j = 0; j < t.length; j++) if (words[i + j] !== t[j]) continue outer; return true; } return false; };

const QUESTION = /\?\s*$|^(?:how|what|why|where|when|which|who|can|could|does|do|is|are|will|would|should|did|has|have|may|any|also|and also|plus|p\.?s\.?)\b|\b(?:want to know|wondering|wonder|need to know|curious|tell me|let me know)\b|^(?:i|we) (?:need|want|would like|'d like) (?:the|a|an|to know)\b/i;
// A question that points back ("Can I claim it again for that one?") leans on the sentence before it.
const POINTS_BACK = /\b(?:that one|this one|those|these|the same|that|this|it|them|there)\b/i;

// The text whose specifics must be covered: the question sentences (with the sentence before a question that
// points back), or the whole message when it asks nothing in question form. Pasted text left out.
export function specificsText(text) {
  const sents = splitSentences(String(text || ''));
  const picked = []; const own = [];
  sents.forEach((s, i) => {
    if (!QUESTION.test(s.trim())) return;
    if (i > 0 && POINTS_BACK.test(s) && !picked.includes(sents[i - 1])) picked.push(sents[i - 1]);
    picked.push(s); own.push(s);
  });
  // Questions too short to stand alone ("Why?", "Is that normal?") lean on the whole message.
  const asked = picked.length > 0 && contentStems(withoutPasted(own.join(' '))).length >= 3;
  return { text: withoutPasted(asked ? picked.join(' ') : text), questions: withoutPasted(asked ? own.join(' ') : text), asked };
}

// A typo of a common word is that word: "credts" is "credits", "thes" is "these".
function editOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 3) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  const [x, y] = a.length < b.length ? [a, b] : [b, a];
  return x.slice(i) === y.slice(i + 1);
}

// What a question asks for, and what the quotes must hold to answer it.
const ASKS_PRICE = /\bhow much (?:does|is|do|will|would|are)\b[^.?!\n]{0,40}\b(?:cost|costs|charge|pay|price)\b|\bhow much (?:is|are) (?:the |a |an )?(?:starter|creator|agency|plan|plans|subscription|credits?|pack)\b|\b(?:what(?:'s| is| are)|whats) the (?:price|prices|cost|pricing)\b|\b(?:price|prices|pricing|cost) (?:of|for)\b|\bplan price\b|\bprice\b[^.?!\n]{0,20}\?/i;
const GIVES_PRICE = /\$\s?\d|\b\d+(?:\.\d\d)?\s?(?:usd|dollars?)\b|\bfree\b/i;
const ASKS_WHEN_SHIP = /\bwhen (?:will|is|are|do|does|can)\b[^.?!\n]{0,60}\b(?:come|coming|launch|launching|release|released|ship|shipping|available|support|supported|add|added|get|be ready|arrive|out)\b|\b(?:release date|launch date|eta|roadmap|coming soon|which month|what month|exact month|what date|exact date)\b/i;
const GIVES_DATE = /\b(?:20\d\d|january|february|march|april|may|june|july|august|september|october|november|december|announced|roadmap|not (?:yet )?(?:available|supported|planned))\b/i;
const ASKS_WHY = /(?:^|[.!?]\s+)why\b|\bwhy (?:did|does|do|is|are|was|were|would|has|have)\b/i;
const GIVES_CAUSE = /\b(?:because|when|if|means|caused|cause|due to|so that|since|unless|after|before|only|requires?|must|needs?|cannot|can't|does not|doesn't|not supported|happens)\b/i;

const has = (stems, term) => { const t = allStems(term); outer: for (let i = 0; i + t.length <= stems.length; i++) { for (let j = 0; j < t.length; j++) if (stems[i + j] !== t[j]) continue outer; return true; } return false; };

export function groundedLines(e) {
  return [e.title, e.opening, e.next, e.proof, ...(e.steps || []).flatMap(s => [s.text, s.cite?.quote]), ...(e.scope?.covers || [])].filter(t => typeof t === 'string');
}

// Build the check once for a set of entries. rareDf: a word used by more entries than this is common to the
// knowledge base and is not read as a specific (it is what tickets are about, not what this one is about).
export function createCoverage(entries, { rareDf = 3, phrasings = true, twoWhenNoQuestion = true, why = false, codes = 'http', names = true } = {}) {
  const matchable = entries.filter(e => !e.guard);
  const df = new Map();
  const g = new Map();
  const common = [];
  for (const e of matchable) {
    const lines = groundedLines(e);
    const all = [...lines, ...(e.phrasings || []), ...(e.anchors || []).flat()];
    for (const w of new Set(all.flatMap(t => contentStems(t)))) df.set(w, (df.get(w) || 0) + 1);
    const stems = lines.flatMap(t => [...allStems(t), '|']);
    const text = lines.join(' | ');
    const wordText = phrasings ? [text, ...(e.phrasings || [])].join(' | ') : text;
    g.set(e.id, {
      stems, set: new Set(contentStems(wordText)), raw: [...new Set(rawWords(wordText))], gset: new Set(contentStems(text)), graw: [...new Set(rawWords(text))],
      // A quote about "other platforms", "platforms other than", "outside this list" speaks for every platform.
      anyPlatform: /\b(?:other|all|every|any|each) (?:social )?(?:platforms?|networks?)\b|\bplatforms? other than\b|\boutside (?:this|that|the) list\b/i.test(text) || (e.scope?.coversKinds || []).includes('platform'),
      platforms: Object.entries(PLATFORMS).filter(([, al]) => al.some(a => hasRaw(rawWords(text), a))).map(([p]) => p),
      // About platforms at all: its title names one, or its quotes go platform by platform (two or more named).
      // A general entry that names one platform as an example ("for example, TikTok") is not platform-specific.
      // Read in the title and the quotes only: a step's "for example your Instagram or TikTok page" is the desk's own.
      platformSpecific: Object.values(PLATFORMS).some(al => al.some(a => hasRaw(rawWords(e.title), a)))
        || Object.values(PLATFORMS).filter(al => al.some(a => hasRaw(rawWords((e.steps || []).map(s => s.cite?.quote || '').join(' | ')), a))).length >= 2,
      plans: Object.entries(PLANS).filter(([, al]) => al.some(a => has(stems, a))).map(([p]) => p),
      codes: new Set(text.match(CODE) || []),
      routes: new Set([...text.matchAll(/\/v2\/([a-z][a-z-]*)/gi)].map(m => m[1].toLowerCase())),
      price: lines.some(t => GIVES_PRICE.test(t)),
      date: lines.some(t => GIVES_DATE.test(t)),
      cause: (e.steps || []).some(s => GIVES_CAUSE.test(s.cite?.quote || '') || GIVES_CAUSE.test(s.text || '')),
      not: (e.scope?.not || []),
    });
  }

  // A route many entries quote (/v2/posts) is the background of most API tickets, not a specific.
  const routeDf = new Map();
  for (const c of g.values()) for (const r of c.routes) routeDf.set(r, (routeDf.get(r) || 0) + 1);
  const commonRaw = new Set();
  for (const e of matchable) for (const t of [...groundedLines(e), ...(e.phrasings || [])]) for (const w of rawWords(t)) if (w.length >= 3 && !/\d/.test(w) && (df.get(contentStems(w)[0]) || 0) > rareDf) commonRaw.add(w);
  const STOPWORDS = 'the these those this that there their they them then than what when where which while with would could should have does about into from your yours were been being'.split(' ');
  // A typo of a common word is that word ("credts" is "credits"): a word no entry uses at all, one letter from a
  // common word, with the same first two letters (so "iphone" is not a typo of "phone").
  const isCommonTypo = (w) => STOPWORDS.some(x => editOne(x, w)) || (w.length >= 5 && (df.get(contentStems(w)[0]) || 0) <= 1 && [...commonRaw].some(v => v.slice(0, 2) === w.slice(0, 2) && nearWord(v, w)));

  // The first specific of the message the entry does not cover, as { kind, term }, or null.
  function gap(entry, text, { only } = {}) {
    const c = g.get(entry.id);
    if (!c) return null;
    const sp = specificsText(text);
    const asked = sp.text;
    const stems = allStems(asked);
    const qStems = allStems(sp.questions);
    const want = (k) => !only || only.includes(k);
    if (want('scope')) for (const t of c.not) if (has(stems, t)) return { kind: 'outside scope', term: t };
    // Platforms and plans are read in the questions only: "someone in a Facebook group said..." is background.
    if (want('platform') && sp.asked && c.platformSpecific && !c.anyPlatform) {
      for (const [p, al] of Object.entries(PLATFORMS)) if (al.some(a => hasRaw(rawWords(sp.questions), a)) && !c.platforms.includes(p)) return { kind: 'platform', term: p };
    }
    // Tiers and billing periods are two questions: quotes about monthly and yearly billing do not stop "Agency".
    if (want('plan') && sp.asked && c.plans.length) {
      for (const group of [TIERS, PERIODS]) {
        if (!c.plans.some(p => group.includes(p))) continue;
        for (const p of group) if (PLANS[p].some(a => has(qStems, a)) && !c.plans.includes(p)) return { kind: 'plan', term: p };
      }
    }
    if (want('endpoint') && sp.asked) {
      // An API route the customer names ("POST /v2/messages", "the schedules routes") must be one the quotes name.
      for (const m of String(sp.questions).matchAll(/\/v2\/([a-z][a-z-]*)/gi)) if (!c.routes.has(m[1].toLowerCase()) && (routeDf.get(m[1].toLowerCase()) || 0) <= rareDf) return { kind: 'endpoint', term: `/v2/${m[1]}` };
    }
    if (want('name') && names) {
      // A named screen, button, setting or product, written with a capital inside a sentence ("When I click
      // Duplicate", "the Combine Clips step", "I'm in New York"), must be something the quotes name.
      for (const sent of splitSentences(asked)) {
        for (const m of sent.matchAll(/(?<=\s)([A-Z][a-zA-Z]+)\b/g)) {
          const w = m[1].toLowerCase();
          // An all-capitals word is an acronym (HTTP, URL); the word rule reads those.
          // A named item (Mastodon, OneDrive, Venmo) is the named-items check's to judge, with the entry's declared kinds.
          if (w.length <= 2 || /^[A-Z]+s?$/.test(m[1]) || NAME_OK.has(w) || CHATTER.has(contentStems(w)[0] || w) || PLATFORM_WORDS.has(w) || ITEM_WORDS.has(w)) continue;
          if (c.graw.includes(w) || c.graw.some(r => nearWord(r, w)) || c.gset.has(contentStems(w)[0])) continue;
          return { kind: 'name', term: m[1] };
        }
      }
    }
    if (want('code') && c.codes.size) {
      // Codes anywhere in the message count here (a pasted 429 is the customer's error), years and amounts do not.
      const said = (String(text).replace(/\$\s?\d[\d,.]*|\b(?:19|20)\d\d\b|\b\d+(?:[.,]\d+)?\s?(?:%|mb|gb|kb|px|k|am|pm|posts?|times|accounts?|credits?|seconds?|minutes?|hours?|days?|characters?|chars?|images?|videos?|clients?|followers|people)\b/gi, ' ').match(CODE) || []);
      // A 3-digit HTTP status only by default: a 4 or 5 digit number in a message is as often an id as a code.
      const own = said.find(n => (codes === 'http' ? /^[45]\d\d$/ : /^(?:[45]\d\d|\d{4,5})$/).test(n) && !c.codes.has(n));
      if (own && !said.some(n => c.codes.has(n))) return { kind: 'error code', term: own };
    }
    if (want('type')) {
      if (ASKS_PRICE.test(asked) && !c.price) return { kind: 'price', term: asked.match(ASKS_PRICE)[0] };
      if (ASKS_WHEN_SHIP.test(asked) && !c.date) return { kind: 'date', term: asked.match(ASKS_WHEN_SHIP)[0] };
      if (why && ASKS_WHY.test(asked) && !c.cause) return { kind: 'cause', term: 'why' };
    }
    if (want('word')) {
      const missing = [];
      // A word right after a subject ("I", "we", "it") is the action, not the thing asked about:
      // "the draft I wrote", "while I travel", "before it renews", "can I hook up". Things are what must be covered.
      const toks = (foldText(asked).match(/[a-z0-9']+/g) || []);
      const verbs = new Set(toks.filter((t, i) => i > 0 && /^(?:i|we|you|they|he|she|it|i'm|we're|you're|they're|it's|i've|we've|i'd|we'd|i'll|we'll)$/.test(toks[i - 1])).map(t => t.replace(/'.*$/, '')));
      // With no question, the whole message is read; the customer's own things ("for my lemonade stand", "our
      // bakery's page") are background there, so the two words after "my", "our" or "their" are not read.
      if (!sp.asked) toks.forEach((t, i) => { if (/^(?:my|our|their|his|her)$/.test(t)) for (const x of toks.slice(i + 1, i + 3)) verbs.add(x.replace(/'.*$/, '')); });
      for (const w of new Set(rawWords(asked))) {
        if (w.length <= 3 || /\d/.test(w) || verbs.has(w)) continue;
        const s = contentStems(w)[0];
        if (!s || CHATTER.has(s) || (df.get(s) || 0) > rareDf) continue;
        if (c.set.has(s) || c.raw.some(r => nearWord(r, w)) || c.set.has(stem(w))) continue;
        if (isCommonTypo(w)) continue;
        missing.push(w);
      }
      // With no question to read, the whole message is read, background and all, so one stray word is not enough.
      if (missing.length >= (sp.asked || !twoWhenNoQuestion ? 1 : 2)) return { kind: 'specific', term: missing.join(', ') };
    }
    return null;
  }
  return { gap, df };
}
