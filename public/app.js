// Support Desk page, round 3. No framework, no animation library: motion is written by hand with the
// Web Animations API. The rules this file keeps (design/DESIGN.md, PANEL-2.md):
// - Nothing that carries words ever changes opacity. Things arrive and leave by moving, as solid objects.
//   Words are written onto their line one after another (each word is there or not, never half there).
// - Nothing that moves ever passes over other words.
// - The stage is never empty: the letter's frame, the customer's words and the help page are there from the
//   first frame. The answer is fetched first, so every part has its real place before anything moves.
// - The work is shown in the order it happened (the trace from POST /api/ticket/live).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const wide = () => matchMedia('(min-width: 901px)').matches;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_MARK = 'cubic-bezier(0.45, 0, 0.55, 1)';
const EASE_IN = 'cubic-bezier(0.5, 0, 0.75, 0)';
// The moment's beats (DESIGN.md, "The memorable moment"), tuned in round 4 so the stamp lands within 3.5 s.
const T = { lift: 340, firstHold: 120, line: 400, lineCap: 660, hold: 110, dock: 360, fold: 220, proofIn: 240, wire: 200, word: 14, wordCap: 200, stepGap: 60, stepStagger: 150, thud: 220, nudge: 140 };
const DEMO_ID = 'T02';
const MAX = 2000;

let STATE = null;
let ART = new Set();
let picked = null; // the example in the box: { id, who, text }
let moment = null;

function say(msg) { const el = $('#live'); el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; }); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => r()));

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------------------------------------------------------------- dates, in the viewer's own time
const fmt = (t, o) => new Date(t).toLocaleString('en-US', o);
const day = (t) => t ? fmt(t, { month: 'short', day: 'numeric' }) : '';
const clock = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');
const dayAt = (t) => t ? `${day(t)} at ${clock(t)}` : '';
function when(t) { return `${fmt(t, { weekday: 'long' })}, ${fmt(t, { month: 'short', day: 'numeric' })}, at ${clock(t)}`; }
const techTime = (t) => t ? fmt(t, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '';

// ---------------------------------------------------------------- words
// The page's own words stay child-simple. The customer's message, the reply (the customer's letter) and quoted
// help-page sentences stay exactly as written; a technical call or error inside them is set as a quoted term.
const PLAIN = [
  [/\bAPI Errors\b/g, 'Errors for developers'],
  [/\s*No entry is a candidate for this (?:message|ticket)\.?/g, ''],
  [/\bAPI or MCP access\b/g, 'access for other apps and AI helpers'],
  [/\b([Aa])n API key\b/g, '$1 developer key'],
  [/\bAPI keys?\b/g, (m) => m.endsWith('s') ? 'developer keys' : 'developer key'],
  [/\bthe API\b/g, "Blotato's developer tools"],
  [/\bAPI\b/g, 'developer tools'],
  [/\bschedule endpoints\b/g, 'schedule tools'],
  [/\bendpoints?\b/g, 'developer tools'],
  [/\bMCP servers?\b/g, 'AI helper link'],
  [/\bMCP\b/g, 'AI helper'],
  [/\bOAuth\b/g, 'sign-in'],
  [/\bescalated\b/gi, 'handed over'],
  [/\bescalation\b/gi, 'handover'],
  [/\bescalate\b/gi, 'hand'],
  [/\b[Tt]he founder\b/g, (m) => m[0] === 'T' ? 'A person on the team' : 'a person on the team'],
  [/,(\s*[.,;:])/g, '$1'],
  [/\s+[\u2014\u2013]\s+/g, ', '],
];
// After a word swap the little word in front must still fit: "a developer key", "an AI helper".
const articles = (s) => String(s).replace(/\b([Aa])n ((?:developer|sign-in|connected|later|number|helper)\b)/g, '$1 $2').replace(/\b([Aa]) ((?:AI|answer|error|account|app)\b)/g, '$1n $2');
// A real name a customer must find and click is never reworded (the owner's rule, Nov 15): anything in quotes,
// a menu path ("Settings > Billing"), and a capitalized name with a developer word in it ("Generate API Key",
// "API Errors"). They are set aside before the swap and put back after it.
const LABELS = [
  /"[^"\n]{1,90}"|“[^”\n]{1,90}”/g,
  /\b[A-Z][\w&-]*(?: [A-Z][\w&-]*)*(?:\s*>\s*[A-Z][\w&-]*(?: [A-Z][\w&-]*)*)+/g,
  /\b(?!(?:The|A|An|If|When|Your|Our|Use|Using|Via|With|For|And|Or|But|No|This|That|Make|Making)\b)(?:[A-Z][\w-]*\s+)*(?:API|MCP|OAuth)(?:\s+(?!(?:Or|And|To|For)\b)[A-Z][\w-]*)+|\b(?!(?:The|A|An|If|When|Your|Our|Use|Using|Via|With|For|And|Or|But|No|This|That|Make|Making)\b)(?:[A-Z][\w-]*\s+)+(?:API|MCP|OAuth)\b/g,
];
function keepLabels(s, fn) {
  const kept = [];
  let t = String(s ?? '');
  for (const re of LABELS) t = t.replace(re, (m) => { kept.push(m); return `\u0002${kept.length - 1}\u0002`; });
  return fn(t).replace(/\u0002(\d+)\u0002/g, (m, i) => kept[+i]);
}
const plainWords = (s) => keepLabels(s, (t) => articles(PLAIN.reduce((x, [re, to]) => x.replace(re, to), t)));
const upFirst = (raw, s) => (/^[A-Z]/.test(String(raw)) && s ? s[0].toUpperCase() + s.slice(1) : s);
const both = (raw, plain = upFirst(raw, plainWords(raw))) => plain === raw ? esc(raw) : `<span class="plain-only">${esc(plain)}</span><span class="tech-only">${esc(raw)}</span>`;
const dash = (s) => String(s ?? '').replace(/\s+[\u2014\u2013]\s+/g, ', ').replace(/[\u2014\u2013]/g, ', ');

// A help-page quote is the page's own words and stays as written. When it holds a developer's word, one plain
// line under it says the same thing in words a 10-year-old knows (DESIGN.md, the plain-words rule).
const JARGON = [
  [/\(?`?(?:DELETE|GET|POST|PUT|PATCH) \/v2\/[^\s)`]*`?\)?/g, ''],
  [/\bthe limited route after `?429`?/gi, 'that step after the "too many requests" error'],
  [/`?\b429\b`?/g, 'the "too many requests" error'],
  [/\bReduce concurrency and request frequency\b/g, 'Send fewer at once, and less often,'],
  [/\bconcurrency\b/gi, 'how many go at once'],
  [/\brequest frequency\b/gi, 'how often it sends'],
  [/\bRetain the submission ID\b/g, 'Keep the number Blotato gave the post'],
  [/\bsubmission ID\b/gi, 'the number Blotato gave the post'],
  [/\brequest ID\b/gi, 'the error\'s own number'],
  [/\binspect existing work\b/gi, 'look at what already went out'],
  [/\bthe retry interval when the response supplies one\b/gi, 'the wait time when the error gives one'],
  [/\bOAuth codes?\b/g, 'sign-in codes'],
  [/\bre-approve access via OAuth\b/g, 'say yes to the sign-in again'],
  [/\bvia OAuth\b/g, 'by signing in'],
  [/\bOAuth\b/g, 'sign-in'],
  [/\bcustom connector\b/gi, 'connected app'],
  [/\bMCP\b/g, 'AI helper'],
  [/\bAPI keys?\b/g, (m) => (m.endsWith('s') ? 'developer keys' : 'developer key')],
  [/\bAPI\b/g, 'developer tools'],
  [/\bendpoints?\b/gi, 'developer tools'],
  [/\bcreate response\b/gi, 'answer Blotato sent back'],
  [/\bdownstream\b/gi, 'later'],
  [/\s+([.,;:])/g, '$1'],
  [/\s{2,}/g, ' '],
];
const HAS_JARGON = /\b(?:OAuth|MCP|API|endpoints?|concurrency|request frequency|submission ID|request ID|429|retry interval|create response|custom connector|downstream)\b|\/v2\//i;
function plainQuote(s) {
  const raw = String(s || '').replace(/`/g, '');
  if (!HAS_JARGON.test(raw)) return null;
  const out = keepLabels(String(s || ''), (x) => articles(JARGON.reduce((t, [re, to]) => t.replace(re, to), x))).replace(/`/g, '').trim();
  return out && out !== raw ? out[0].toUpperCase() + out.slice(1) : null;
}

// Technical terms inside a letter or a quote: calls, paths, status codes, ids. Works on escaped text.
const STATUS = '(?:200|201|204|400|401|403|404|409|422|429|500|502|503|504)';
function termify(h) {
  const parts = [];
  const keep = (s) => { parts.push(s); return `\u0000${parts.length - 1}\u0000`; };
  let t = String(h);
  // A social handle (@name_with_underscores) is a name, not a code term: it stays plain text.
  t = t.replace(/(^|[\s(])(@[A-Za-z0-9_.]*[A-Za-z0-9_])/g, (m, a, s) => a + keep(s));
  t = t.replace(/\b(?:GET|POST|PUT|PATCH|DELETE)(?:https?:\/\/[^\s<]+|\/[^\s<]+?)(?=[.,;:]?(?:\s|$|<))/g, (m) => keep(`<code class="term">${m}</code>`));
  // A help-page address stays one whole piece of text (never broken into code spans).
  t = t.replace(/https?:\/\/help\.blotato\.com[^\s<]*?(?=[.,;:)]?(?:\s|$|<))/g, (m) => keep(`<span class="url">${m}</span>`));
  t = t.replace(/\bhelp\.blotato\.com(?:\/[^\s<]*?)?(?=[.,;:)]?(?:\s|$|<))/g, (m) => keep(`<span class="url">${m}</span>`));
  t = t.replace(/https?:\/\/(?!help\.blotato\.com)[^\s<]+?(?=[.,;:)]?(?:\s|$|<))/g, (m) => keep(/\/v\d+\/|\bapi\.|localhost/.test(m) ? `<code class="term">${m}</code>` : `<span class="url weblink">${m}</span>`));
  t = t.replace(/(^|[\s(])(\/v2\/[^\s<]+?)(?=[.,;:)]?(?:\s|$|<))/g, (m, a, p) => a + keep(`<code class="term">${p}</code>`));
  t = t.replace(/\bHTTP \d{3}\b/g, (m) => keep(`<code class="term">${m}</code>`));
  t = t.replace(new RegExp(`(^|[\\s(])(${STATUS})(?=[\\s.,:;)]|$)`, 'g'), (m, a, c) => a + keep(`<code class="term">${c}</code>`));
  t = t.replace(/\b[a-z][a-zA-Z0-9]*(?:[._][a-zA-Z0-9{}]+)+\b(?!\.[a-z])/g, (m) => /^(?:e\.g|i\.e)$/.test(m) ? m : keep(`<code class="term">${m}</code>`));
  t = t.replace(/\b(?:[a-z]+[A-Z][a-zA-Z]*|bigint|blotato-api-key)\b/g, (m) => keep(`<code class="term">${m}</code>`));
  // A quoted term is already marked by its own face: drop the quote marks around it, so no stray spaces show.
  t = t.replace(/(?:&quot;|&#39;)(\u0000\d+\u0000)(?:&quot;|&#39;)/g, '$1');
  return t.replace(/\u0000(\d+)\u0000/g, (m, i) => parts[+i]);
}

// The reply as the letter shows it: dates read like a person wrote them, ids only in the technical view.
// (The copy button gives the exact text the checker read.)
function letterText(s) {
  const DATE = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{1,2}) (\w{3}) (\d{4}) (\d\d):(\d\d):(\d\d) (?:UTC|GMT)\b/g;
  const dates = [];
  let t = String(s ?? '').replace(DATE, (m, d, mon, y, H, M, S) => { dates.push([m, Date.parse(`${mon} ${d}, ${y} ${H}:${M}:${S} GMT`)]); return `\u0001${dates.length - 1}\u0001`; });
  t = termify(esc(t))
    .replace(/\u0001(\d+)\u0001/g, (m, i) => { const [raw, ms] = dates[+i]; return Number.isNaN(ms) ? esc(raw) : `<span class="plain-only">${esc(when(ms))}</span><span class="tech-only">${esc(raw)}</span>`; })
    .replace(/ \(((?:post|id) [\w-]+)\)/g, '<span class="tech-only postid"> ($1)</span>')
    .replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\w{3}) (\d{1,2}), at (\d{1,2}):(\d\d) (am|pm) UTC\b/g, (m, mon, d, h, mi, ap) => {
      const ms = Date.parse(`${mon} ${d}, ${new Date().getFullYear()} ${(+h % 12) + (ap === 'pm' ? 12 : 0)}:${mi}:00 GMT`);
      return Number.isNaN(ms) ? m : `<span class="plain-only">${esc(when(ms))}</span><span class="tech-only">${m}</span>`;
    })
    // A post's link reads as a short link in the letter; the copied reply keeps the full address.
    // (termify has already wrapped the address as a web link by now, so match it in either form)
    .replace(/Here it is: (?:<span class="url weblink">(https?:\/\/[^\s<]+)<\/span>|(https?:\/\/[^\s<]+))/g, (m, a, b) => `Here it is: <a class="postlink" href="${a || b}" target="_blank" rel="noopener">open the post</a>`);
  return t;
}

// One plain line above a technical reply, written per sample message. True to what each reply says.
// Absent (never invented) for a message someone pasted.
const PLAIN_LINES = {
  T03: 'They want their posts to go to their company\'s LinkedIn page, not their own profile. The reply shows the two numbers their code needs and where each one goes.',
  T04: 'Making a key to connect another app ended their free trial, so the paid plan started. The reply explains why, and a person on the team will look at the charge.',
  T06: 'Blotato turned away the key their code sent. The reply shows how to copy the key again, where to put it, and one safe way to test it.',
  T07: 'Their automation sent too many posts at once, so Blotato asked it to slow down. The reply says how to pause, check what already went out, and send fewer at a time.',
  T08: 'The link between Claude and Blotato signed itself out. The reply shows how to sign in to Blotato and add the link to Claude again.',
  T09: 'Their code asked Blotato to make a LinkedIn post, but no answer came back, so they do not know if it worked. The reply says to look for the post before sending it again, so it does not go out twice.',
  T10: 'They are waiting on a post that still says "in progress". The reply explains that this can also mean Blotato has no record of that number, and asks them not to post it again yet.',
  T11: 'Their code asked for a schedule with the wrong kind of id. The reply tells them which id to use, and the desk tells a person on the team so the help page can be fixed.',
  T12: 'They want a safe place to test their code without posting for real. The help pages do not say if there is one, so the reply says so and passes the question to the team.',
};
// The note for a person on the team in plain words, for the one sample whose note is written in code terms. The exact note
// is in the details for engineers, and Copy gives it word for word. In the same order as the desk's note.
const PLAIN_NOTES = {
  T11: {
    causes: [
      "Blotato's schedule tools expect an id made only of numbers, but the example on the help page shows an id with letters in it.",
      "The customer copied the id from the help page's example, not from their own list of schedules.",
    ],
    ruledOut: ['A wrong key. A wrong key gives a different error from this one.'],
  },
};
const PLAIN_STOPPED ='Their automation sent too many posts at once. This first reply said more than the help page does, so the second checker stopped it.';
// Why a person takes it, from the route's own reason (src/route.mjs), in one plain sentence each.
const GUARD_PLAIN = {
  money: 'A message about money always goes to a person on the team. The desk explains what it can and never promises a refund.',
  'others-data': 'The desk does not share one customer\'s information with another. A person will look at this.',
  secret: 'The desk never shares a key, a password or its own settings. A person will look at this.',
  'staff-action': 'The desk only reads. It cannot post, delete or change anything on an account, so a person on the team will do this.',
  'desk-instructions': 'The message tells the desk what to do instead of asking a question, so a person will read it.',
  'needs-person': 'The customer already tried the steps on the help page, or the problem goes past what the help pages cover, so a person will look at it.',
};
// The desk's named reason for a hand-over (match.why), one short, kind sentence each. The code itself shows
// only in the details for engineers. Without a code (older data) the page falls back to the route's decision.
const WHY_PLAIN = {
  money: 'This is about money, so a person on the team will answer it. The desk never promises a refund.',
  'others-data': 'The desk never shares one customer\'s information with another, so a person on the team will look at this.',
  secret: 'The desk never shares a key, a password or its own settings, so a person on the team will look at this.',
  'staff-action': 'The desk can only read. It cannot post, delete or change anything, so a person on the team will do this.',
  'desk-instructions': 'The message tells the desk what to do instead of asking a question, so a person on the team will read it.',
  'tried-already': 'The customer already tried what the help page says, so a person on the team will look closer.',
  outage: 'It sounds like many accounts have trouble at the same time, so a person on the team will check it.',
  'records-disagree': 'Two of Blotato\'s records do not match, so a person on the team will look at both.',
  'docs-wrong': 'The customer says the help pages are wrong, so a person on the team will check them.',
  'access-blocked': 'The customer cannot reach the screen the steps need, so a person on the team will help.',
  'past-docs': 'This goes past what the help pages cover, so a person on the team will answer it.',
  pressure: 'The customer is very upset and wants it fixed now, so a person on the team will answer this one, quickly.',
  'docs-silent': 'The help pages do not cover this yet, so the desk will not guess.',
  tie: 'The desk could not tell which of two questions this is, so it will not guess.',
  'partly-covered': 'The message asks more than one thing. The desk answers the part the help pages cover, and a person on the team takes the rest.',
  'not-english': 'The desk can only read English for now, so a person on the team will answer this one.',
  'no-coverage': 'None of Blotato\'s help pages answers this, so the desk will not guess.',
  nonsense: 'That does not look like a question about Blotato. Try asking about your posts, your account or your plan.',
  'compose-unverified': 'The desk tried to write an answer from the help pages, but a step said more than the page does, so a person on the team will answer.',
  'second-read-objected': 'The desk wrote an answer from the help pages, and a second read found a problem with it, so a person on the team will answer.',
};
const whyOf = (r) => r.route?.why || r.match?.why || null;
function whyPlain(r) {
  const w = whyOf(r); if (!w || !WHY_PLAIN[w]) return null;
  const d = r.route?.whyDetail || r.match?.whyDetail || null;
  // The desk had near candidates but none it trusted: it was not sure, which is not the same as "no page answers this".
  if (w === 'no-coverage' && (r.route?.candidates || []).length) return 'The desk was not sure which help page this is about, so it did not guess.';
  const item = w === 'docs-silent' && d?.item ? String(d.item).trim() : '';
  return item && item.length < 40 ? `${WHY_PLAIN[w]} They say nothing about \u201c${item}\u201d.` : WHY_PLAIN[w];
}
function personReason(r) {
  const named = whyPlain(r); if (named) return named;
  const d = r.route?.decision; const g = r.route?.guard;
  if (d === 'guard') return GUARD_PLAIN[g] || 'A person on the team will look at this one.';
  if (d === 'needs-person') return GUARD_PLAIN['needs-person'];
  if (d === 'partial') return 'The message asks two things. The desk answers the part the help pages cover, and a person on the team takes the other part.';
  return null;
}
// "Did they mean one of these?" offers only near candidates that are about what the customer wrote: a candidate
// the matcher scored low, or whose title shares no real word with the message, is a guess, so it is not offered
// (Nov 16, 2026: a long message about a missing post was offered "Make AI visuals match my brand").
const CHIP_MIN = 0.2;
const CHIP_SKIP = new Set('about after again also and are before blotato can could does doing from have help into just like make made many more much need only other post posts should some than that their them then there these they this want what when where which will with would your'.split(' '));
const keyWords = (s) => new Set((String(s || '').toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !CHIP_SKIP.has(w)).map(w => w.slice(0, 5)));
function chipsFor(r) {
  const said = keyWords(r.ticket?.text);
  return (r.route?.candidates || []).filter(c => c.title && c.phrasing && (c.score ?? 1) >= CHIP_MIN && [...keyWords(c.title)].some(w => said.has(w))).slice(0, 3);
}
// The refusal's heading follows its reason: not guessing, asking another way, or a person taking it.
const guessing = (r) => { const w = whyOf(r); return !w || ['no-coverage', 'docs-silent', 'tie'].includes(w); };
function refusalTitle(r) {
  const w = whyOf(r);
  if (w === 'nonsense') return 'Try asking another way';
  return guessing(r) ? 'The desk will not guess' : 'A person on the team takes this one';
}
function refusalReason(r) {
  const named = whyPlain(r); if (named) return named;
  const d = r.route?.decision; const g = r.route?.guard;
  if (d === 'guard' && GUARD_PLAIN[g]) return GUARD_PLAIN[g];
  if ((r.route?.candidates || []).length) return 'The desk could not tell for sure which question this is, so it did not write a reply.';
  return 'None of Blotato\'s help pages answers this message, so the desk did not write a reply.';
}
const TRY_THIS = "Blotato says my post is published but I can't see it on Instagram.";

// ---------------------------------------------------------------- the stamp: one inked impression, set in type
// One round rubber stamp: the ring says who checked it and what it means, the date sits in the middle, and a
// banner across the middle carries the one word. Pressed once, as one piece.
let pmN = 0;
const STAMPS = {
  checked: { word: 'CHECKED', top: 'SECOND CHECKER', sub: 'SAFE TO SEND', label: 'Checked by a second checker. Safe to send.' },
  stopped: { word: 'STOPPED', top: 'SECOND CHECKER', sub: 'DO NOT SEND', label: 'Stopped by the second checker. Do not send.' },
  helped: { word: 'HELPED', top: 'YOUR FIRST SHIFT', sub: 'GOOD FIRST MOVE', label: 'Helped. A good first move.' },
  oops: { word: 'OOPS', top: 'YOUR FIRST SHIFT', sub: 'NOT THIS TIME', label: 'Oops. Not this time.' },
  missed: { word: 'MISSED', top: 'YOUR FIRST SHIFT', sub: 'TRY AGAIN', label: 'Missed this one.' },
};
function centerOf(t) {
  const d = new Date(t);
  return [`${fmt(d, { month: 'short' }).toUpperCase()} ${d.getDate()}`, String(d.getFullYear())];
}
function postmark(kind, { date = null, center = null, word = null, sub = null, label = null } = {}) {
  const s = { ...STAMPS[kind], ...(word ? { word } : {}), ...(sub ? { sub } : {}) }; const id = `pm${++pmN}`;
  const [big, small] = center || centerOf(date || Date.now());
  const aria = label || s.label;
  const wl = s.word.length;
  const wsize = wl > 10 ? 30 : wl > 7 ? 36 : 42;
  const wlen = Math.min(214, Math.round(wl * wsize * 0.66));
  return `<svg class="pm" viewBox="0 0 260 236" role="img" aria-label="${esc(aria)}">
    <defs><path id="${id}t" d="M40 118 A90 90 0 0 1 220 118"/><path id="${id}b" d="M26 118 A104 104 0 0 0 234 118"/></defs>
    <g fill="none" stroke="currentColor"><circle cx="130" cy="118" r="110" stroke-width="6"/><circle cx="130" cy="118" r="82" stroke-width="2.6"/></g>
    <rect x="6" y="90" width="248" height="56" rx="7" fill="#fff" stroke="currentColor" stroke-width="5.5"/>
    <rect x="14" y="97" width="232" height="42" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
    <g fill="currentColor" font-weight="800">
    <text font-size="15" letter-spacing="2.2" text-anchor="middle"><textPath href="#${id}t" startOffset="50%">${esc(s.top)}</textPath></text>
    <text font-size="15" letter-spacing="2.2" text-anchor="middle"><textPath href="#${id}b" startOffset="50%">${esc(s.sub)}</textPath></text>
    <text x="130" y="${big.length > 6 ? 80 : 78}" text-anchor="middle" class="serif" font-size="${big.length > 6 ? 19 : 25}" font-weight="700" letter-spacing=".5">${esc(big)}</text>
    <text x="130" y="171" text-anchor="middle" font-size="13" letter-spacing="2.4">${esc(small)}</text>
    <text x="130" y="${118 + wsize * 0.36}" text-anchor="middle" font-size="${wsize}" font-weight="900" letter-spacing="1"${wl > 5 ? ` textLength="${wlen}" lengthAdjust="spacingAndGlyphs"` : ''}>${esc(s.word)}</text>
    </g></svg>`;
}
// The shift report's stamps: the same stamp, one per letter.
function roundMark(right, n, total = 5) {
  return `<span data-tone="${right ? 'helped' : 'missed'}">${postmark(right ? 'helped' : 'missed', { center: [`LETTER ${n}`, `OF ${total}`], label: `Letter ${n}: ${right ? 'helped' : 'missed'}.` })}</span>`;
}

// ---------------------------------------------------------------- art slots
// A picture shows only when public/art/<slot>.webp exists. Otherwise it leaves nothing at all.
function art(slot, alt, w, h = w, cls = '') {
  if (!ART.has(slot)) return '';
  return `<img${cls ? ` class="${cls}"` : ''} src="/art/${esc(slot)}.webp" alt="${esc(alt || '')}" width="${w}" height="${h}" decoding="sync">`;
}
async function loadArt() {
  try { ART = new Set((await api('/api/art')).slots || []); } catch { /* none */ }
}
function preload(slots) {
  return Promise.all(slots.filter(s => ART.has(s)).map(s => { const im = new Image(); im.src = `/art/${s}.webp`; return im.decode().catch(() => {}); }));
}

// ---------------------------------------------------------------- views, the switch, history
function route() {
  const practice = location.hash === '#practice';
  $('#view-answer').hidden = practice;
  $('#view-practice').hidden = !practice;
  $('#nav-answer').toggleAttribute('aria-current', !practice);
  $('#nav-practice').toggleAttribute('aria-current', practice);
  if (!practice) $('#nav-answer').setAttribute('aria-current', 'page'); else $('#nav-practice').setAttribute('aria-current', 'page');
  document.title = practice ? 'Practice game, Second Read' : 'Second Read';
  if (practice) { demo.cancel(); game.open(); }
}

function setTech(on, save = true) {
  document.body.classList.toggle('tech-on', on);
  for (const b of $$('[data-tech-switch]')) b.setAttribute('aria-checked', String(on));
  if (save) store.set('sd-tech', on ? '1' : '0');
  // Before any answer is on screen, the switch says what it will show (it does something you can see).
  if (save && !$('#ask').hidden && $('#view-practice').hidden) $('#filled').textContent = on ? 'The engineer view is on. Each answer will also show the exact links, times and checks behind it, for the people who build Blotato.' : 'The engineer view is off.';
  // On a phone the details land far below the switch, so the switch says so where the person is looking (Nov 16, 2026).
  const note = $('#switch-note');
  if (note && save) { note.hidden = false; note.textContent = on ? 'Details for engineers added below.' : 'Details for engineers hidden.'; }
  if (on) techHome();
  if (moment?.done) moment.layout();
}

// ---------------------------------------------------------------- the first screen
const whoOf = (from) => { const w = String(from || '').replace(/\s*\(made up\)\s*$/, ''); return w ? w[0].toUpperCase() + w.slice(1) : 'A customer'; };
// The first four examples are everyday customers (DESIGN.md). Developer messages sit under "Show more".
const REFUND = 'I canceled my plan last month but you charged me again. I want a refund.';
const EXTRA = [
  { text: TRY_THIS, who: 'A creator, asking a new way', writer: 'A creator' },
  { text: 'My video won\'t post. It just says failed.', who: 'A creator in a hurry', writer: 'A creator' },
  { text: 'Banana phone purple. Does it work on Tuesdays?', who: 'A message that makes no sense', writer: 'A customer' },
];
// T01's saved check can never match today's account words (its lookup changes every six hours), so it is not
// one of the four first examples: each of those shows a clean, true checked state.
const FIRST = ['T02', 'T05', 'T04'];
const DEV_ORDER = ['T07', 'T11', 'T12', 'T10', 'T09', 'T06', 'T08', 'T03'];
const CUST_ORDER = ['T01'];

function exampleButton({ id, text, who, writer }) {
  return `<li><button type="button"${id ? ` data-id="${esc(id)}"` : ''} data-who="${esc(writer || who)}" aria-pressed="false"><span class="q" aria-hidden="true">&ldquo;</span><span class="t">${esc(text)}</span><span class="who">${esc(who)}</span></button></li>`;
}

function fillExamples() {
  for (const b of $$('#tries button')) { const t = STATE.tickets.find(x => x.id === b.dataset.id); if (t) $('.t', b).textContent = t.text; }
  const rest = STATE.tickets.filter(t => !FIRST.includes(t.id));
  const dev = rest.filter(t => DEV_ORDER.includes(t.id)).sort((a, b) => DEV_ORDER.indexOf(a.id) - DEV_ORDER.indexOf(b.id));
  const cust = rest.filter(t => !DEV_ORDER.includes(t.id));
  $('#more-cust').innerHTML = [...cust.map(t => exampleButton({ id: t.id, text: t.text, who: whoOf(t.from) })), ...EXTRA.map(exampleButton)].join('');
  $('#more-dev').innerHTML = dev.map(t => exampleButton({ id: t.id, text: t.text, who: whoOf(t.from) })).join('');
}

function pick(btn, { focus = true } = {}) {
  const text = $('.t', btn).textContent;
  $('#msg').value = text;
  picked = { id: btn.dataset.id || null, who: btn.dataset.who || null, text };
  for (const b of $$('.tries-list button')) b.setAttribute('aria-pressed', String(b === btn));
  $('#filled').textContent = 'It is in the box. Press "Answer it".';
  if (!focus) return;
  const box = $('#ask-form').getBoundingClientRect();
  if (box.top < 0 || box.bottom > innerHeight) $('#ask-form').scrollIntoView({ block: 'center' });
  $('#answer-btn').focus({ preventScroll: true });
}

// One question at a time from the box: a double-click (or Enter twice) sends one request (Nov 16, 2026).
let sending = false;
function submit() {
  if (sending) return;
  const raw = $('#msg').value;
  const text = raw.trim();
  if (!text) { $('#filled').textContent = 'Type or paste what the customer said first.'; $('#msg').focus(); return; }
  const same = picked && picked.text === raw;
  const body = same && picked.id ? { id: picked.id } : { text: text.slice(0, MAX) };
  sending = true;
  start({ body, who: same ? picked.who : null, text: body.text || text }).finally(() => { sending = false; });
}

async function techHome() {
  try {
    const s = STATE || await api('/api/state');
    $('#tech-state').innerHTML = `
      <dt>Account data</dt><dd>${s.mock ? 'Sample data. No account is connected, so every account lookup reads made-up posts.' : 'A real Blotato account, read-only.'}</dd>
      <dt>Read-only</dt><dd>${s.readOnly ? 'Yes. The client refuses anything but GET, and there is no switch to change that.' : 'No'}</dd>
      <dt>Help pages on hand</dt><dd>${s.docs.pages} pages saved from help.blotato.com${s.docs.newest ? `, newest read ${esc(techTime(s.docs.newest))}` : ''}</dd>`;
  } catch (e) { $('#tech-state').innerHTML = `<dt>Error</dt><dd>${esc(e.message)}</dd>`; }
}

// ---------------------------------------------------------------- what the result means
// A seal shows only where the server vouched for it: a second checker's pass (or block) of this exact text.
function stateOf(r) {
  if (!r.entry || !r.reply) return 'refused';
  if (!r.check.pass || r.fresh?.state === 'blocked') return 'stopped';
  if (r.fresh?.state === 'passed') return 'checked';
  if (r.fresh?.state === 'passed-saved') return 'saved';
  // Written for this message just now, and a second reader passed it just now. Never the saved stamp: no checker
  // read these words ahead of time (src/composer.mjs).
  if (r.path === 'composed' && r.fresh?.state === 'checked-live') return 'composed';
  return 'draft';
}
const sealOf = (st) => (st === 'checked' || st === 'stopped' ? st : null);

function plainEvidence(ev) {
  if (!ev) return 'The desk did not need to look at the account for this one.';
  const s = ev.summary || '';
  if (ev.kind === 'recent-published') {
    const first = s.split(/\.\s/)[0].replace(/^Blotato shows /, '');
    const m = s.match(/from (\w{3}, \d{1,2} \w{3} \d{4} \d\d:\d\d:\d\d) (?:UTC|GMT)/);
    const t = m ? Date.parse(`${m[1]} GMT`) : NaN;
    return `${first[0].toUpperCase()}${first.slice(1)}.${Number.isNaN(t) ? '' : ` The newest went out on ${day(t)}.`}`;
  }
  if (ev.kind === 'recent-activity') return s.replace(/^from/, 'From').replace(/ I see /, ', the account shows ').replace(/\s*\((?:id|post) [^)]*\)/g, '').replace(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{1,2}) (\w{3}) (\d{4}) (\d\d:\d\d:\d\d) (?:UTC|GMT)/g, (m, d, mon, y, hms) => { const t = Date.parse(`${mon} ${d}, ${y} ${hms} GMT`); return Number.isNaN(t) ? m : when(t); });
  if (ev.kind === 'submission') return ev.missing ? 'There was no post number in the message, so the desk could not look it up.' : `The desk looked up this post. Blotato says it is "${ev.status}".`;
  // On the practice account the same lookup gives back the answer Blotato's real API gave on Nov 15, 2026 (src/diagnose.mjs).
  if (ev.kind === 'reproduce-schedule') return ev.missing ? 'There was nothing in the message the desk could try again.' : ev.ok ? (/^The practice account answers/.test(s) ? "The desk tried the same lookup on the practice account. It gives back the error Blotato's real system gave on Nov 15, 2026." : 'The desk tried the same thing on the account and got the same error back.') : 'The desk tried the same thing and got a different answer back.';
  if (ev.kind === 'docs-search') return "The desk searched Blotato's help pages for the question.";
  // Account first: the same facts as the reply, with the time in the reader's own time zone and no raw link.
  if (ev.kind === 'publish-check' || ev.kind === 'connected-accounts') return s.replace(/ Here it is: \S+/g, '')
    .replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\w{3}) (\d{1,2}), at (\d{1,2}):(\d\d) (am|pm) UTC\b/g, (m, mon, d, h, mi, ap) => {
      const ms = Date.parse(`${mon} ${d}, ${new Date().getFullYear()} ${(+h % 12) + (ap === 'pm' ? 12 : 0)}:${mi}:00 GMT`);
      return Number.isNaN(ms) ? m : when(ms);
    });
  return s;
}

// The whole sentence around a quote. Never a cut sentence, never "...".
function sentence(page) {
  const t = page.text; const [s, e] = page.mark;
  const before = t.slice(0, s);
  const m = before.match(/^[\s\S]*[.!?:]["')\]]?\s+/);
  let a = m ? m[0].length : 0;
  if (!m && /^\.\.\.\s/.test(t)) a = s;
  let b = e;
  if (!/[.!?:]["')\]]?$/.test(t.slice(s, e).trim())) {
    const f = t.slice(e).match(/^[^.!?:]{0,160}?[.!?:]["')\]]?(?=\s|$)/);
    if (f) b = e + f[0].length;
  }
  return { pre: t.slice(a, s).replace(/^\d+\.\s+/, ''), mark: t.slice(s, e), post: t.slice(e, b) };
}
// Whole sentences only, up to about max letters: from the start (after) or from the end (before).
function wholeSentences(s, max, fromEnd) {
  const parts = String(s || '').replace(/^\.\.\.\s*/, '').replace(/\s*\.\.\.$/, '').match(/[^.!?]+[.!?:]+["')\]]?(\s+|$)/g) || [];
  const out = []; let n = 0;
  for (const p of fromEnd ? parts.reverse() : parts) { if (n + p.length > max && out.length) break; if (n + p.length > max * 1.6) break; out.push(p); n += p.length; }
  return (fromEnd ? out.reverse() : out).join('').trim();
}
const tq = (s) => termify(esc(s));
// The words around the lit part belong to the same sentence, so they always stay (round 6): a proof starts at its
// sentence's start and ends at its end. Only whole sentences, lists and table cells outside it ever fold away.
const sentenceHTML = (page) => { const x = sentence(page); return `${tq(x.pre)}<mark>${tq(x.mark)}</mark>${tq(x.post)}`; };
// A page's name beside its sentence. A long name gets its own line, so it never pushes one word onto a line alone.
const srcHTML = (src) => `<span class="src${String(src).length > 24 ? ' long' : ''}">${esc(src)}</span>`;
function paragraphHTML(page) {
  const t = page.text; const [s, e] = page.mark;
  const clean = (x) => tq(String(x || '').replace(/^\.\.\.\s*/, '').replace(/\s*\.\.\.$/, ''));
  // Only the sentence's own paragraph: a neighbor block can be a list run together with no stops.
  return `<span class="dim">${clean(t.slice(0, s))}</span><mark>${tq(t.slice(s, e))}</mark><span class="dim">${clean(t.slice(e))}</span>`;
}
const loose = (s) => String(s || '').toLowerCase().replace(/[`*_"'\s]+/g, ' ').replace(/[.:,]+$/, '').trim();
// A code example: only the lines that hold the quote (whole lines), or every line with them marked.
function codeHTML(code, quote, all) {
  const [a, b] = code.hit;
  const q = loose(quote);
  const line = (l, k) => {
    const inHit = k >= a && k <= b;
    if (!inHit) return `<span class="dimline">${esc(l)}</span>`;
    const ll = l.toLowerCase(); const qq = String(quote).replace(/[`]/g, '').replace(/,\s*$/, '').toLowerCase();
    const at = ll.indexOf(qq.trim());
    if (at >= 0 && qq.trim()) return `${esc(l.slice(0, at))}<mark>${esc(l.slice(at, at + qq.trim().length))}</mark>${esc(l.slice(at + qq.trim().length))}`;
    return `<mark>${esc(l)}</mark>`;
  };
  void q;
  const rows = all ? code.lines.map((l, k) => line(l, k)) : code.lines.slice(a, b + 1).map((l, k) => line(l, k + a));
  if (!all) { const pad = Math.min(...code.lines.slice(a, b + 1).filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length)); return `<pre class="pcode">${rows.map(r => r.replace(new RegExp(`^ {0,${pad}}`), '')).join('\n')}</pre>`; }
  return `<pre class="pcode">${rows.join('\n')}</pre>`;
}
// A table row, read as the page means it: each cell named by its column ("Error", "Explanation").
function rowHTML(row, quote, src) {
  const q = loose(quote);
  const parts = row.cells.map((c, k) => {
    const name = row.head?.[k] ? `<b class="rl">${esc(row.head[k])}:</b> ` : '';
    const lit = loose(c) === q;
    const body = lit ? `<mark>${tq(c)}</mark>` : `${tq(c)}${/[.!?]$/.test(c.trim()) ? '' : '.'}`;
    // a cell that is not the lit one folds away with "Show more" (round 6)
    return `<span class="rc${lit ? '' : ' ctx'}">${name}${body}</span>`;
  });
  return `<p class="px prow">${parts.join(' ')}${src ? `${srcHTML(src)}` : ''}</p>`;
}
// The list a sentence introduces, as the page lists it. A call in brackets is for developers: it shows in the
// details for engineers only.
const listHTML = (items) => `<ul class="plist">${items.map(i => {
  const m = String(i).match(/^(.*?)\s*(\((?:DELETE|GET|POST|PUT|PATCH) [^)]*\))\s*$/);
  return `<li>${m ? `${tq(m[1])}<span class="tech-only"> ${tq(m[2])}</span>` : tq(i)}</li>`;
}).join('')}</ul>`;
const plainLineHTML = (s) => { const p = plainQuote(s); return p ? `<p class="pline plain-only"><b>In plain words:</b> ${esc(p)}</p>` : ''; };

// One proof: the compact form that fits its row, the long form that opens when you point at it,
// and the page's name, small, beside the sentence.
function proofParts(step, r) {
  if (step.type === 'fact') {
    const p = step.page;
    const src = `${dash(p?.title || 'Help')} page`;
    if (p?.found && p.mark) {
      const cellHit = p.row && p.row.cells.some(c => loose(c) === loose(step.quote));
      const x = sentence(p);
      const plain = plainLineHTML(`${x.pre}${x.mark}${x.post}`);
      if (p.code) return { kind: 'code', compact: `${codeHTML(p.code, step.quote, false)}${plain}`, more: p.code.lines.length > (p.code.hit[1] - p.code.hit[0] + 1) ? codeHTML(p.code, step.quote, true) : '', src };
      if (cellHit) return { kind: 'row', compact: `${rowHTML(p.row, step.quote, src)}${plainLineHTML(step.quote)}`, more: '', src };
      // A sentence that ends on a colon is shown with the list it opens, so the proof never stops mid-thought.
      // The page's name sits on the sentence's line, so folding the list away leaves no line of its own.
      if (p.list && /:\s*$/.test(`${x.mark}${x.post}`)) return { kind: 'sentence', compact: `<p class="px">${sentenceHTML(p)}${srcHTML(src)}</p>${listHTML(p.list)}${plain}`, more: '', src };
      const longer = x.pre.length + x.post.length + x.mark.length < p.text.replace(/^\.\.\.\s*|\s*\.\.\.$/g, '').length - 4;
      // The longer form replaces the sentence (it holds it), so nothing is said twice.
      return { kind: 'sentence', compact: `<p class="px">${sentenceHTML(p)}${srcHTML(src)}</p>${plain}`, more: longer ? `<p class="px">${paragraphHTML(p)}${srcHTML(src)}</p>` : '', replace: longer, src };
    }
    return { kind: 'sentence', compact: `<p class="px"><mark>${tq(step.quote)}</mark>${srcHTML(src)}</p>${plainLineHTML(step.quote)}`, more: '', src };
  }
  if (step.type === 'evidence') {
    const search = r.evidence?.kind === 'docs-search';
    // On the practice account, the account a step looked at is made up: it says so where it is used.
    const copy = r.evidence?.kind === 'reproduce-schedule' && /^The practice account answers/.test(r.evidence.summary || '');
    const src = search ? 'a search of the help pages' : copy ? 'the practice account (a copy of a real answer)' : r.mock ? 'their account (practice data)' : 'their account';
    const at = (r.steps || []).indexOf(step);
    const first = (r.steps || []).findIndex(s => s.type === 'evidence');
    if (first >= 0 && first < at) return { kind: 'note', compact: `<p class="px">The same look at ${search ? 'the help pages' : 'their account'} as step ${first + 1}.${srcHTML(src)}</p>`, more: '', src };
    return { kind: 'note', compact: `<p class="px">${esc(plainEvidence(r.evidence))}${srcHTML(src)}</p>`, more: '', src };
  }
  // A step with no page says what it is (Nov 16, 2026: "I can't share anyone else's email" was labeled as the
  // hand-off note): a rule of this desk, something the desk does itself, or advice for the customer.
  const i = (r.steps || []).indexOf(step);
  const kind = actionKind(step.text);
  const earlier = (r.steps || []).slice(0, i).some(s => s.type !== 'fact' && s.type !== 'evidence' && actionKind(s.text) === 'does');
  const what = kind === 'rule' ? 'A rule of this desk, so there is no page to quote.'
    : kind === 'advice' ? 'Advice from the desk, so there is no page to quote.'
      : earlier ? 'The desk does this step itself too.'
        : r.escalation && /\bpass(?:ing)?\b/i.test(step.text) ? 'The desk does this step itself. It wrote a note for a person on the team, under the letter.'
          : 'The desk does this step itself, so there is no page to quote.';
  const src = 'no page needed';
  return { kind: 'note', compact: `<p class="px">${what}${kind === 'does' && earlier ? '' : srcHTML(src)}</p>`, more: '', src: '' };
}
// rule: what the desk will not do. does: what the desk itself does ("I am passing ..."). advice: a step for the customer.
function actionKind(text) {
  const t = String(text || '');
  if (/\b(?:can'?t|cannot|will not|won'?t|never)\b|\bplease ask the person who owns\b/i.test(t)) return 'rule';
  if (/\bI (?:am|will|have|'m)\b|\bI'm\b|\bI can\b/.test(t)) return 'does';
  return 'advice';
}

function proofHTML(step, i, r) {
  const n = i + 1;
  const cite = (r.check?.citations || []).find(c => c.step === n);
  const flagged = r.example?.plain?.names?.includes(n);
  const p = proofParts(step, r);
  const srcBeside = p.kind === 'code' ? `<p class="px srcline">${srcHTML(p.src)}</p>` : '';
  const tech = step.type === 'fact'
    ? `<p class="tech-only"><a class="url" href="${esc(step.url)}" target="_blank" rel="noopener">${esc(String(step.url).replace('https://', ''))}</a>${cite?.fetchedAt ? `, read ${esc(techTime(cite.fetchedAt))}` : ''}. ${cite ? (cite.found ? 'The quote is on the page.' : 'The quote is NOT on the page.') : ''}</p>`
    : step.type === 'evidence' ? `<p class="tech-only">${(r.evidence?.calls || []).map(c => `<code>${esc(cleanCall(c))}</code>`).join('<br>') || 'No call was made.'}</p>` : '';
  // The checker's flag sits under the sentence, so the proof's first line stays level with its step.
  return `<div class="cmp${p.replace ? ' swap' : ''}">${p.compact}${srcBeside}</div>${p.more ? `<div class="more-of">${p.more}</div>` : ''}${flagged ? `<p class="flagline">The second checker named this step.</p>` : ''}${tech}<button type="button" class="link pmore" hidden>Show more</button>`;
}
const cleanCall = (c) => String(c).replace(/\s*\((?:Blotato )?req(?:uest|Id)? [^)]*\)/gi, '').replace(/\s*\(request [^)]*\)/g, '');

function letterParts(reply) {
  const lines = String(reply || '').split('\n');
  const first = lines.findIndex(l => /^1\. /.test(l));
  let last = first;
  while (first >= 0 && last + 1 < lines.length && /^\d+\. /.test(lines[last + 1])) last++;
  const paras = (arr) => arr.join('\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return { head: paras(first >= 0 ? lines.slice(0, first) : lines), tail: paras(first >= 0 ? lines.slice(last + 1) : []) };
}

function tailHTML(paras, r) {
  const flagNext = r.example?.plain?.names?.includes('next');
  return paras.map((p, k) => {
    if (k === paras.length - 1 && /^Thanks,/.test(p)) return `<p class="sign">${esc(p).replace(/\n/g, '<br>')}</p>`;
    return p.split('\n').map(line => {
      if (/^Next step:/.test(line)) return `<p class="next${flagNext ? ' flag' : ''}">${letterText(line).replace(/^Next step:/, '<b>Next step:</b>')}</p>`;
      const m = line.match(/^Help page: (https:\/\/\S+)$/);
      if (m) return `<p class="helplink">Help page: <a href="${esc(m[1])}" target="_blank" rel="noopener">${esc(m[1].replace('https://', ''))}</a></p>`;
      return `<p>${letterText(line)}</p>`;
    }).join('');
  }).join('');
}

function splitCause(c) {
  const guess = /\(Not documented: a guess to confirm\.\)/.test(c);
  const [text] = c.replace(/\s*\(Not documented: a guess to confirm\.\)/, '').split(/ Source: https?:\/\//);
  const sourced = / Source: https?:\/\//.test(c);
  return { text: (sourced ? text.replace(/\s*\(documented\)/g, '') : text).trim(), tag: guess ? 'a guess to check' : sourced ? 'from the help page' : '' };
}

function plainChecked(r) {
  const trace = r.trace || [];
  const pages = new Set(trace.filter(e => e.t === 'page').map(e => e.url)).size;
  const parts = [];
  if (pages) parts.push(`I read ${pages === 1 ? "one of Blotato's help pages" : `${pages} of Blotato's help pages`}.`);
  if (trace.some(e => e.t === 'search' && !e.offline)) parts.push('I searched the help pages for the question, and none of them answers it.');
  if (r.evidence && r.evidence.kind !== 'docs-search') parts.push(plainEvidence(r.evidence).replace(/^The desk /, 'I '));
  return parts.join(' ') || 'Nothing could be checked.';
}

// The note for a person on the team: a short letter, with run-in labels (never small labels above the text).
function noteHTML(r, own = true, lead = false) {
  const e = r.escalation; if (!e) return '';
  const pn = PLAIN_NOTES[r.ticket?.id] || {};
  const li = (arr, plain = []) => `<ul>${arr.map((c, k) => { const x = splitCause(c); const body = plain[k] ? `<span class="plain-only">${esc(plain[k])}</span><span class="tech-only">${termify(esc(x.text))}</span>` : termify(both(x.text)); return `<li>${body}${x.tag ? ` <span class="src-tag">(${x.tag})</span>` : ''}</li>`; }).join('')}</ul>`;
  const why = String(e.why).replace(/this ticket/g, 'this message').replace(/\s*No entry is a candidate for this (?:message|ticket)\.?/g, '').replace(/:\s*And:\s*/g, ': ').replace(/\s*\("[^"]*"\)/g, '');
  const causes = (e.causes || []).filter(c => !/matcher's top candidates/.test(c));
  return `<section class="note" aria-labelledby="note-h">
    <h3 id="note-h">A person on the team needs to see this</h3>
    <p class="note-lead">The desk wrote this note for the person on the team who takes it next. ${own ? 'Copy it and pass it on.' : 'Copy it and pass it on, so the customer gets an answer.'}</p>
    <div class="letterish">
      <p>Hi,</p>
      <p>A customer wrote: <span class="cq">&ldquo;${esc(e.asked)}&rdquo;</span></p>
      <p><b>Why it needs you.</b> <span class="plain-only">${esc(personReason(r) || refusalReason(r))}</span><span class="tech-only">${termify(esc(why))}</span></p>
      <p><b>What I checked.</b> ${esc(plainChecked(r))}</p>
      ${causes.length ? `<p><b>What I think it is:</b></p>${li(causes, pn.causes)}` : '<p><b>What I think it is.</b> Not known yet. The help pages have no answer, so I will not guess.</p>'}
      ${(e.ruledOut || []).length ? `<p><b>What I ruled out:</b></p>${li(e.ruledOut, pn.ruledOut)}` : ''}
    </div>
    <div class="note-act"><button type="button" class="${lead ? 'btn' : 'btn-quiet'}" data-copy="sabrina">Copy the note</button><span class="copied" data-copied="sabrina" aria-live="polite"></span></div>
  </section>`;
}

// A proposed help-page edit, shown as the page itself: struck words, added words lit. Never a diff block.
function docEditHTML(r) {
  const d = r.docEdit; if (!d || !r.entry) return '';
  const rawTitle = d.page?.title || d.article.replace(/^https:\/\/help\.blotato\.com\//, '');
  // The help page as it reads today, marked up the way an editor marks a page: what is wrong is circled in red
  // with the change written beside it, and the sentence to add is lit in yellow. Never a diff.
  let sheet; let circled = false;
  const cap = (s) => { const t = String(s || ''); return t ? t[0].toUpperCase() + t.slice(1) : t; };
  const valueOf = (s) => { const m = String(s || '').match(/:\s*("[^"]*"|[^,]+)\s*,?\s*$/); return (m ? m[1] : String(s || '')).trim(); };
  if (d.kind === 'change') {
    const p = d.page;
    const before = String(d.before).trim(); const after = String(d.after).trim();
    const fromV = valueOf(before); const toV = valueOf(after);
    if (p?.code) {
      const [a, b] = p.code.hit;
      const from = Math.max(0, a - 2); const to = Math.min(p.code.lines.length - 1, b + 2);
      const rows = [];
      for (let k = from; k <= to; k++) {
        const l = p.code.lines[k];
        if (k < a || k > b) { rows.push(`<span class="cl">${esc(l)}</span>`); continue; }
        const at = l.indexOf(fromV);
        if (at < 0) { rows.push(`<span class="cl"><span class="circled">${esc(l)}</span></span>`); circled = true; continue; }
        circled = true;
        rows.push(`<span class="cl">${esc(l.slice(0, at))}<span class="circled">${esc(fromV)}</span>${esc(l.slice(at + fromV.length))}<span class="pen" aria-label="Change it to ${esc(toV)}"> change to ${esc(toV)}</span></span>`);
      }
      const gap = '<span class="cl dimline">⋮</span>';
      sheet = `${p.heading ? `<p class="sub">The part called “${esc(dash(p.heading))}”, the example on the page:</p>` : ''}<div class="page-code">${from > 0 ? gap : ''}${rows.join('')}${to < p.code.lines.length - 1 ? gap : ''}</div><div class="added-block"><span class="add-k">Add this sentence under the example:</span> ${tq(d.add)}</div>`;
    } else {
      const ctx = p?.found && p.mark
        ? (() => { const t = p.text; const [s, e] = p.mark; let a = Math.max(0, s - 60); let z = Math.min(t.length, e + 90); if (a > 0) a = t.indexOf(' ', a) + 1 || a; if (z < t.length) z = t.lastIndexOf(' ', z) > e ? t.lastIndexOf(' ', z) : z; return `${tq(t.slice(a, s))}<span class="circled">${tq(t.slice(s, e))}</span><span class="pen"> change to ${tq(d.after)}</span>${tq(t.slice(e, z))}`; })()
        : `<span class="circled">${tq(d.before)}</span><span class="pen"> change to ${tq(d.after)}</span>`;
      circled = true;
      sheet = `<p class="ctx">${ctx}</p><div class="added-block"><span class="add-k">Add:</span> ${tq(d.add)}</div>`;
    }
  } else {
    const head = cap(plainWords(d.heading)); const add = plainWords(String(d.add).replace(/^\[|\]$/g, ''));
    sheet = `<div class="added-block"><b class="plain-only">${esc(head)}</b><b class="tech-only">${esc(d.heading)}</b><span class="plain-only">${esc(cap(add))}</span><span class="tech-only">${esc(String(d.add).replace(/^\[|\]$/g, ''))}</span></div>`;
  }
  const heading = d.kind === 'change' ? 'A help page needs a fix' : "The help pages don't cover this yet";
  const lead = d.kind === 'change'
    ? `The desk found a help page that leads people the wrong way. Here is the page, marked up with the change it suggests. A person on the team decides if it goes in.`
    : `The desk suggests a new part for this help page. A person on the team writes the answer and decides if it goes in.`;
  const legend = `${circled ? 'Circled in red: what the desk would change, with the change written in red. ' : ''}In yellow: what it would add. Nothing changes on the real help page until a person does it.`;
  return `<section class="note doc" aria-labelledby="doc-h">
    <h3 id="doc-h">${heading}</h3>
    <p class="note-lead">${lead}</p>
    <div class="page-sheet"><p class="ttl">${both(dash(rawTitle), cap(plainWords(dash(rawTitle))))}<span class="sh-site">Blotato help</span></p>${sheet}</div>
    <p class="red-note">${legend}</p>
  </section>`;
}

const SECOND = 'The second checker is a separate AI that did not write the reply and has not seen the desk\'s work. It read the reply with only the help pages beside it. Before that, the desk checked that every yellow sentence is really on its help page.';
// The verdict: a heading and one line. The longer story waits behind "How was it checked?".
let discN = 0;
const disclose = (label, body) => { const id = `disc${++discN}`; return `<button type="button" class="link disc" aria-expanded="false" aria-controls="${id}">${label}</button><div class="disc-body" id="${id}" hidden>${body}</div>`; };
function verdictHTML(r, st, typed = false) {
  const f = r.fresh || {};
  const at = f.checkedAt ? dayAt(f.checkedAt) : '';
  if (st === 'checked') {
    const notes = (f.notes || []).length;
    // A typed message gets a reply the desk has given before. Say plainly what the check covers: the reply's words.
    // What the date means is said once, at the top (practiceHTML); here only the record.
    void typed;
    const what = `A second checker passed these exact words${at ? ` on ${esc(at)}` : ''}.`;
    return `<div class="verdict" style="--tone: var(--pass)"><p class="v1">${what}</p>${disclose('How was it checked?', `<p>${SECOND} The desk found this answer live just now. The second checker read the same words earlier.${notes ? ` It left ${notes === 1 ? 'one small note' : `${notes} small notes`}, which the engineer view shows.` : ''}</p>`)}</div>`;
  }
  if (st === 'stopped') {
    const plain = r.example?.plain;
    const why = plain?.why || f.why || (r.check.problems || [])[0] || '';
    const more = plain?.more || [];
    return `<div class="verdict" style="--tone: var(--block)"><p class="v1">${esc(why)}</p>${more.length ? disclose('What else did it find?', `<ul>${more.map(m => `<li>${esc(m)}</li>`).join('')}</ul><p>A second checker read this exact reply${at ? ` on ${esc(at)}` : ''}. ${SECOND}</p>`) : ''}</div>`;
  }
  if (st === 'saved') return `<div class="verdict" style="--tone: var(--draft)"><p class="v1">A second checker read this reply${at ? ` on ${esc(at)}` : ''}. Since then, today's look at their account changed the line about their posts, so read that line yourself before you send it.</p></div>`;
  if (st === 'refused') return '';
  if (st === 'composed') {
    // The time the second reader really read these words: an earlier run of this exact message keeps its own time.
    const when = !f.checkedAt ? '' : day(f.checkedAt) === day(Date.now()) ? ` at ${esc(clock(f.checkedAt))}` : ` on ${esc(dayAt(f.checkedAt))}`;
    return `<div class="verdict" style="--tone: var(--pass)"><p class="v1">The desk wrote this reply for this message, and a second reader passed it${when}.</p>${disclose('How was it checked?', `<p>Each step that states a fact quotes a sentence from a help page. A script found every one of those sentences on its page, word for word. The steps marked as advice from the desk are fixed lines the desk adds to every written reply. Then a second reader, a separate AI that did not write the reply, tried to find a mistake in it and passed it. If either check had failed, you would have seen a saved reply or a note for a person instead.</p><p>There is no stamp because the stamp means a checker read these exact words ahead of time. These words are new.</p>`)}</div>`;
  }
  return '<div class="verdict" style="--tone: var(--draft)"><p class="v1">The desk wrote this. A second checker has not read it yet, so there is no stamp. Read it yourself before you send it.</p></div>';
}

// The technical view: real calls, statuses, dates and the checkers' notes. No internal ids, no tool names, no enum keys.
function cleanNote(s) {
  return String(s || '')
    .replace(/\s*\((?:Blotato )?reqId [^)]*\)/g, '')
    .replace(/\(docs MCP getPage, fetched ([\d-]+)\)/g, '(read $1)')
    .replace(/docs MCP searchDocumentation/g, 'Searched the help pages for')
    .replace(/docs MCP getPage/g, 'read');
}
function inline(s) { return termify(esc(s)).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>'); }
function mdHTML(src) {
  const lines = cleanNote(src).split('\n');
  const out = []; let list = null; let fence = null;
  const close = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const l of lines) {
    if (/^```/.test(l)) {
      if (fence) { out.push(`<pre>${fence.lines.map(x => fence.diff ? (x.startsWith('-') ? `<span class="cut">${esc(x.slice(1).trim())}</span>` : x.startsWith('+') ? `<span class="added">${esc(x.slice(1).trim())}</span>` : esc(x)) : esc(x)).join('\n')}</pre>`); fence = null; }
      else { close(); fence = { diff: /diff/.test(l), lines: [] }; }
      continue;
    }
    if (fence) { fence.lines.push(l); continue; }
    if (/^#{1,6} /.test(l)) { close(); continue; } // the section has its own heading on the page
    if (/^\s*[-*] /.test(l)) { (list ||= []).push(`<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`); continue; }
    close();
    if (/^> /.test(l)) { out.push(`<blockquote>${inline(l.slice(2))}</blockquote>`); continue; }
    if (/^\*\*[^*]+\*\*$/.test(l.trim())) { out.push(`<h4>${esc(l.trim().replace(/\*\*/g, ''))}</h4>`); continue; }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  close();
  return `<div class="md">${out.join('')}</div>`;
}
function techHTML(r) {
  const f = r.fresh || {};
  const calls = (r.trace || []).map(e => {
    if (e.t === 'page') return `<li><span class="what">Read <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.url.replace('https://', ''))}</a></span><span class="meta">${e.ok ? `${e.fromCache ? 'saved copy' : 'fetched now'}, read ${esc(techTime(e.fetchedAt))}` : 'could not be read'}, ${e.ms} ms</span></li>`;
    if (e.t === 'search') return `<li><span class="what">Searched the help pages for "${esc(e.query)}"</span><span class="meta">${e.offline ? 'skipped: this copy runs without the network, so it used its saved pages' : `${e.results} results`}, ${e.ms} ms</span></li>`;
    // In practice mode a schedule lookup gives back a copy of the real API's answer of Nov 15, 2026; every other lookup reads made-up posts.
    if (e.t === 'call') return `<li><span class="what"><code>${esc(e.method)} ${esc(decodeURIComponent(e.path))}</code></span><span class="meta">HTTP ${esc(e.status ?? 'none')}${e.error ? `, ${esc(e.error)}` : ''}, ${e.ms} ms${r.mock ? (r.evidence?.kind === 'reproduce-schedule' && /^The practice account answers/.test(r.evidence.summary || '') ? ", practice account: a copy of the answer Blotato's real API gave to a read-only lookup on Nov 15, 2026, not a call made now" : ', practice account: made-up sample data') : ''}</span></li>`;
    if (e.t === 'model' && e.phase !== 'start') return `<li><span class="what">${esc({ expand: 'Model call: search words for the help pages', write: 'Model call: the writer', second: 'Model call: the second reader' }[e.kind] || `Model call: ${e.kind}`)}</span><span class="meta">${esc(String(e.model || '').replace(/^claude-/, ''))}, ${e.phase === 'error' ? 'failed, ' : ''}${e.cached ? 'answer reused from an earlier run of this exact message' : `${e.ms} ms`}</span></li>`;
    return '';
  }).join('');
  const steps = (r.steps || []).map((s, i) => {
    const c = (r.check?.citations || []).find(x => x.step === i + 1);
    const what = s.type === 'fact' ? `Quote from <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(String(s.url).replace('https://', ''))}</a>` : s.type === 'evidence' ? (r.mock ? 'From the practice account' : 'From the account') : ({ rule: 'A rule of this desk', advice: 'Advice for the customer' }[actionKind(s.text)] || 'An action the desk takes');
    return `<li><span class="what">Step ${i + 1}. ${what}</span><span class="meta">${s.quote ? `<code>${esc(s.quote)}</code>` : esc(s.type === 'evidence' ? cleanCall(r.evidence?.summary || '') : 'No page to quote.')}${c ? ` ${c.found ? 'Found on the page' : 'NOT found on the page'}${c.fetchedAt ? `, page read ${esc(techTime(c.fetchedAt))}` : ''}.` : ''}</span></li>`;
  }).join('');
  const findings = f.findings || f.notes || [];
  const ex = r.example;
  const searched = (r.evidence?.searched || []).filter(q => !q.offline).map(q => `<li><span class="what">"${esc(q.query)}"</span><span class="meta">${q.results.slice(0, 4).map(x => esc(x.title || x.url)).join(', ') || 'no results'}</span></li>`).join('');
  const fstate = { passed: `Passed this exact text${f.checkedAt ? ` on ${esc(techTime(f.checkedAt))}` : ''}.`, blocked: `Stopped this exact text${f.checkedAt ? ` on ${esc(techTime(f.checkedAt))}` : ''}.`, 'passed-saved': `Passed an earlier copy${f.checkedAt ? ` on ${esc(techTime(f.checkedAt))}` : ''}. Today's account lookup changed some words, so this text has not been read.`, stale: 'Its verdict is for an older text.', 'checked-live': `Written for this message. The second reader (${esc(String(f.checker || '').replace(/^second reader \(|\)$/g, ''))}) passed this exact text${f.checkedAt ? ` on ${esc(techTime(f.checkedAt))}` : ''}. No saved verdict exists for new words.`, 'script-checked': 'Written for this message. The second read is turned off, so only the script checked it.', none: 'Not read yet.' }[f.state || 'none'] || 'Not read yet.';
  return `<section class="tech" aria-labelledby="tech-h">
    <h2 id="tech-h">The engineer view</h2>
    <dl class="kv">
      <dt>Account data</dt><dd>${r.mock ? 'Practice account, no real account connected. Its posts are made up; the one error it copies from the real API is marked where it is used.' : 'Live, read-only'}</dd>
      ${whyOf(r) ? `<dt>Why it went to a person</dt><dd><code>${esc(whyOf(r))}</code>${r.route?.reason || r.match?.reason ? ` ${esc(String(r.route?.reason || r.match?.reason).replace(/\s*\(words: [^)]*\)/, ''))}` : ''}</dd>` : ''}
      ${r.entry ? `<dt>A saved, checked answer for this kind of message</dt><dd>${f.state === 'passed' ? 'Yes' : 'No'}</dd>` : ''}
    </dl>
    ${ex ? `<h3>About this example</h3><p>The first reply the desk wrote to this sample message on Nov 15, rebuilt byte for byte from that day's code. On every load the server hashes this text and compares it with the second checker's saved verdict. The desk was fixed after this verdict, and today's reply to the same message passed.</p><dl class="kv"><dt>Matches the saved verdict</dt><dd>${ex.hashMatches ? 'Yes, checked by the server on this load' : 'NO'}</dd></dl>` : ''}
    <h3>Every read the desk made, in order</h3>
    ${calls ? `<ol class="calls">${calls}</ol>` : '<p>None recorded.</p>'}
    ${searched ? `<h3>What the help-page search found</h3><ol class="calls">${searched}</ol>` : ''}
    ${r.steps?.length ? `<h3>Each step and its source</h3><ol class="calls">${steps}</ol>` : ''}
    <h3>Script check</h3>
    <p>${r.entry ? (r.check.pass ? 'Passed. Every quote is on its cited page. Every account step is backed by a lookup. No line makes a promise (a refund, a date, a sure outcome).' : `Blocked: ${esc((r.check.problems || []).join(' '))}`) : 'There was no reply to check.'}</p>
    ${r.reply ? `<h3>Second checker</h3><p>${fstate}</p>
    ${findings.length ? `<p>${f.state === 'blocked' ? 'Its findings:' : 'Its notes:'}</p><ul class="mono-list">${findings.map(x => `<li>${tq(x)}</li>`).join('')}</ul>` : ''}
    <h3>The exact text the checker read (what Copy gives you)</h3><pre>${esc(r.reply)}</pre>` : ''}
    ${r.escalationText ? `<h3>The note for a person, as the desk saved it</h3>${mdHTML(r.escalationText)}` : ''}
    ${r.docEditText ? `<h3>The proposed help-page edit, as the desk saved it</h3>${mdHTML(r.docEditText)}` : ''}
  </section>`;
}

// ---------------------------------------------------------------- the answer view
// The verdict, in one line right under the line of work (round 6), so it is on screen with the stamp when the
// stamp lands. Its place is kept from the first frame; it shows when the check is done.
const VLINE = {
  checked: ['Checked. Safe to send.', 'var(--pass)'],
  stopped: ['Stopped. Do not send this one.', 'var(--block)'],
  saved: ['Checked, then one line changed.', 'var(--draft)'],
  composed: ['Written for this message. A second reader passed it.', 'var(--pass)'],
  draft: ['Not checked yet.', 'var(--draft)'],
};
// Said once, in plain view, beside the verdict (Nov 16, 2026: a first-time visitor could not tell the account was a
// practice one, and "checked Nov 15" confused someone pressing the button on Nov 16): what is made up, what is real,
// and that the date is when these exact words were checked.
function practiceHTML(r, st) {
  const at = r.fresh?.checkedAt ? ` on ${day(r.fresh.checkedAt)}` : '';
  const acct = r.mock ? 'This is a practice account with made-up customers and posts. The help pages and their sentences are real.' : '';
  const words = st === 'checked' && r.fresh?.scope === 'words' ? `A second checker read the words of this reply${at} and passed them. The facts in step 1 come straight from the customer's own account, just now.`
    : st === 'checked' ? `A second checker read these exact words${at} and passed them, so the same words do not need checking twice.`
    : st === 'stopped' && r.fresh?.state === 'blocked' ? `A second checker read these exact words${at} and stopped them.` : '';
  const s = [acct, words].filter(Boolean).join(' ');
  return s ? `<p class="plainline practice">${esc(s)}</p>` : '';
}
function shellHTML(meta, r) {
  const st = stateOf(r);
  const line = r.example ? PLAIN_STOPPED : (r.ticket?.id && PLAIN_LINES[r.ticket.id]) || null;
  const person = st !== 'refused' && !line ? personReason(r) : null;
  // A sample message is labeled as one where it is shown (the founder's test, round 4).
  const sample = (!!meta.body?.id || !!meta.example) && !meta.demo;
  const by = `${meta.who ? `${meta.who} wrote this.` : 'The customer wrote this.'}${sample ? ' It is made up, on a practice account.' : ''}`;
  return `<div class="result-in" id="result-in">
    <div class="said">
      <div><blockquote id="said-q">${esc(meta.text)}</blockquote><button type="button" class="link said-more" id="said-more" aria-expanded="false" aria-controls="said-q" hidden>Show the whole message</button><p class="by" id="said-by">${esc(by)}${meta.demo ? ' <b class="demo-say" id="demo-say">This is a made-up example. Watch the desk answer it.</b>' : ''}</p></div>
      <div class="said-btns">
        ${meta.demo ? '<button type="button" class="btn-quiet" id="demo-skip2">Skip the example</button>' : '<button type="button" class="btn-quiet back" id="back">New message</button><button type="button" class="skip-btn" id="skip-btn">Skip to the answer</button>'}
      </div>
    </div>
    ${meta.example ? '<p class="example-tag">A saved example from Nov 15: the desk\'s first reply to this message. The second checker stopped it, and the desk was fixed.</p>' : ''}
    <div class="did-row"><ol class="did" id="did" aria-label="What the desk did"></ol></div>
    ${VLINE[st] ? `<p class="vline away" id="vline" style="--tone: ${VLINE[st][1]}">${VLINE[st][0]}</p>` : ''}
    ${practiceHTML(r, st)}
    ${line ?`<p class="plainline"><b>In plain words:</b> ${esc(line)}</p>` : ''}
    ${person ? `<p class="plainline person"><b>A person on the team takes this one.</b> ${esc(person)}</p>` : ''}
    <div class="stage" id="stage"></div>
    <div id="after"></div>
  </div>`;
}

// The letter (left), the proofs flowing down the margin (right), and the connectors drawn between them.
// On a phone each proof sits right under its step instead (layout() moves them).
function stageHTML(r) {
  const st = stateOf(r);
  if (st === 'refused') {
    const cands = chipsFor(r);
    const nonsense = whyOf(r) === 'nonsense';
    const note = !!r.escalation && !nonsense;
    // Two parts side by side (round 5): the letter that says why, and beside it the note for a person on the team
    // with its one "Copy the note" button (the main job here), or, with no note, a message to try instead.
    const tryBtn = `<button type="button" class="try" data-ask="${esc(TRY_THIS)}"><span class="q" aria-hidden="true">&ldquo;</span><span>${esc(TRY_THIS)}</span><span class="hint">Press to try it</span></button>`;
    const tryCard = `<p class="rr"><b>Or try a message like this one.</b></p>${tryBtn}`;
    return { cls: 'single refusal', html: `
      <article class="letter away" id="letter" aria-labelledby="letter-h">
        <div class="lh">
          <h2 id="letter-h">${esc(refusalTitle(r))}</h2>
          <p class="rr unw" data-write>${esc(refusalReason(r))}${guessing(r) ? ' A wrong answer can hurt a customer more than a slow one.' : ''}</p>
          ${note ? '<p class="rr unw" data-write><b>Who gets it next.</b> A person on the support team. The desk wrote them a note, and it is on this page, ready to copy and pass on.</p>' : ''}
          <div class="actions refusal-actions away" data-pop><button type="button" class="${note ? 'btn-quiet' : 'btn'}" id="reword-btn">Say it another way</button></div>
          <p class="rr unw" data-write><b>What the desk knows.</b> It can answer questions about posting, scheduling, accounts, plans and error messages.</p>
          ${cands.length ? `<p class="rr unw" data-write><b>Did they mean one of these?</b></p><div class="chips away" data-pop>${cands.map(c => `<button type="button" class="chip" data-ask="${esc(c.phrasing)}">${both(dash(c.title))}</button>`).join('')}</div>` : ''}
          ${note ? `<div class="away" data-pop>${tryCard}</div>` : ''}
        </div>
      </article>
      <aside class="refusal-side away" data-pop>${note ? noteHTML(r, false, true) : `<section class="note try-card" aria-labelledby="try-h"><h3 id="try-h">Or try a message like this one</h3>${tryBtn}</section>`}</aside>` };
  }
  const seal = sealOf(st);
  const stamp = seal ? `<div class="stamp-slot" aria-hidden="false"><div class="stamp away" data-tone="${seal}">${postmark(seal, { date: r.fresh?.checkedAt, label: `${STAMPS[seal].label}${r.fresh?.checkedAt ? ` Read on ${dayAt(r.fresh.checkedAt)}.` : ''}` })}</div></div>` : '';
  const { head, tail } = letterParts(r.reply);
  const steps = r.steps || [];
  const flags = r.example?.plain?.names || [];
  const title = r.outcome === 'no-answer' ? 'Here is a reply for now' : 'Here is the answer';
  const [hi, ...rest] = /^Hi\b/.test(head[0] || '') ? head : ['', ...head];
  const stepsHTML = steps.map((s, i) => {
    const fl = flags.includes(i + 1) ? ' flag' : '';
    return `<div class="lstep${fl}" id="step-${i + 1}" data-i="${i}" tabindex="0" aria-describedby="proof-${i + 1}"><span class="num" aria-hidden="true">${i + 1}</span><span class="txt unw" data-write><span class="sr-only">Step ${i + 1}. </span>${letterText(s.text)}</span></div>`;
  }).join('');
  const proofs = steps.map((s, i) => `<div class="proof away${flags.includes(i + 1) ? ' flag' : ''}" id="proof-${i + 1}" data-i="${i}"><span class="sr-only">Proof for step ${i + 1}. </span>${proofHTML(s, i, r)}</div>`).join('');
  return { cls: '', html: `
    <article class="letter" id="letter" aria-labelledby="letter-h">
      <div class="lh">${stamp}<h2 id="letter-h">${title}</h2>${hi ? `<p class="hi">${letterText(hi)}</p>` : ''}<div class="head unw" data-write>${rest.map(p => `<p>${letterText(p)}</p>`).join('')}</div></div>
      <div class="steps">${stepsHTML}</div>
      <div class="ltail"><div class="tail-text unw" data-write>${tailHTML(tail, r)}</div></div>
    </article>
    <svg class="wires" aria-hidden="true" focusable="false"></svg>
    <aside class="margin" aria-labelledby="mh-h">
      <div class="mh"><h2 id="mh-h">How do we know?</h2><p>Each step's proof is the help-page sentence beside it, lit in yellow. Point at a step to see its pair.</p><button type="button" class="link page-toggle" aria-expanded="false">Show more of each page</button></div>
      <div class="proofs" id="proofs">${proofs}</div>
      <div class="side" id="side"></div>
    </aside>` };
}

// After the letter: the verdict and the main button (beside the stamp on wide screens, under the letter on a
// phone), then the notes for a person and the details for engineers.
function closingHTML(r, st, typed = false) {
  const single = st === 'refused';
  const nonsense = whyOf(r) === 'nonsense';
  let actions = '';
  if (st === 'stopped') {
    actions = `<button type="button" class="btn" id="fixed-btn">See the fixed reply</button>
      <p class="why-line">The desk will not let you copy a reply the checker stopped.</p>`;
  } else if (!single && r.escalation && !nonsense) {
    // A reply and a note: the reply is the page's main job, so its button leads. The note has its own quiet
    // button, once, on the note itself.
    actions = `<button type="button" class="btn" data-copy="reply">Copy the reply</button><span class="copied" data-copied="reply" aria-live="polite"></span>
      <p class="why-line">Send the reply to the customer. The note under the letter goes to a person on the team. The desk never sends anything itself.</p>`;
  } else if (!single) {
    actions = `<button type="button" class="btn" data-copy="reply">Copy the reply</button><span class="copied" data-copied="reply" aria-live="polite"></span>
      <p class="why-line">The desk never sends anything. You copy the reply and send it yourself.</p>`;
  }
  // A hand-over with no reply keeps its note beside the letter (stageHTML); the help-page fix stays below.
  const notes = nonsense ? '' : `${single ? '' : noteHTML(r, true, false)}${docEditHTML(r)}`;
  const verdict = verdictHTML(r, st, typed);
  return {
    closing: verdict || actions ? `<div class="closing${single ? ' single' : ''}" id="closing">${verdict}${actions ? `<div class="actions">${actions}</div>` : ''}</div>` : '',
    rest: `${notes ? `<div class="notes">${notes}</div>` : ''}${techHTML(r)}`,
  };
}

// Light one step and its proof as a pair. Only ever one pair at a time.
function point(i) {
  const host = $('#stage'); if (!host) return;
  for (const el of $$('.lstep, .proof, .wire', host)) el.classList.toggle('on', i !== null && Number(el.dataset.i) === i);
}

// Each word of an element becomes its own span, so the words can be written one after another.
function words(el) {
  if (el.dataset.split) return $$('.w', el);
  el.dataset.split = '1';
  const walk = (node) => {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 3) {
        if (!ch.textContent.trim()) continue;
        const frag = document.createDocumentFragment();
        for (const p of ch.textContent.split(/(\s+)/)) { if (!p) continue; if (/^\s+$/.test(p)) frag.append(p); else { const s = document.createElement('span'); s.className = 'w'; s.textContent = p; frag.append(s); } }
        ch.replaceWith(frag);
      } else if (ch.nodeType === 1 && !ch.classList.contains('sr-only')) {
        if (ch.matches('svg, .stamp-slot')) continue;
        if (ch.matches('code, mark, a, b, button, .src, .url')) { if (!ch.querySelector('.w')) { ch.classList.add('w'); } }
        else walk(ch);
      }
    }
  };
  walk(el);
  return $$('.w', el);
}

// Quiet placeholder lines (round 6): before its words are written, each line of the letter shows as a soft gray
// rule exactly where its words will stand, so the letter is never an empty page. As the words are written the
// rule gives way to them, word by word, on the same line. Nothing moves.
const shownWords = (el) => words(el).filter(w => w.getClientRects().length);
function placeholders(el) {
  if (el._ph) return;
  const ws = shownWords(el); if (!ws.length) return;
  const er = el.getBoundingClientRect();
  const lines = [];
  ws.forEach((w, n) => {
    for (const r of w.getClientRects()) {
      if (r.width < 1) continue;
      const mid = (r.top + r.bottom) / 2;
      let L = lines.find(l => Math.abs(l.mid - mid) < r.height / 2);
      if (!L) { L = { mid, l: r.left, r: r.right, first: n, last: n }; lines.push(L); }
      L.l = Math.min(L.l, r.left); L.r = Math.max(L.r, r.right); L.last = n;
    }
  });
  const box = document.createElement('span'); box.className = 'ph'; box.setAttribute('aria-hidden', 'true');
  for (const L of lines) {
    L.l -= er.left; L.r -= er.left; L.mid -= er.top;
    L.el = document.createElement('i'); L.el.style.cssText = `left:${L.l.toFixed(1)}px;top:${L.mid.toFixed(1)}px;width:${(L.r - L.l).toFixed(1)}px`;
    box.append(L.el);
  }
  el.append(box);
  el._ph = { box, lines, ws };
}
// k words of el are written: each line's rule now starts after its last written word.
function phAt(el, k) {
  const ph = el._ph; if (!ph) return;
  const x0 = el.getBoundingClientRect().left;
  for (const L of ph.lines) {
    if (!L.el.isConnected) continue;
    if (k > L.last) { L.el.remove(); continue; }
    // the rule's box never moves (moving it would count as a layout shift); its written part is clipped away
    if (k > L.first) { const x = ph.ws[k - 1].getBoundingClientRect().right - x0 + 7; L.el.style.clipPath = `inset(0 0 0 ${Math.max(0, x - L.l).toFixed(1)}px round 5px)`; }
  }
}
function phOff(el) { if (el?._ph) { el._ph.box.remove(); el._ph = null; } }

class Moment {
  constructor(meta) {
    this.meta = meta; this.result = null;
    this.skipped = false; this.dead = false; this.done = false; this.instant = reduced.matches || !!meta.instant; this.anims = []; this.waiters = new Set();
    this.t0 = performance.now(); this.marks = {}; this.userScrolled = false;
  }
  poke() { for (const w of [...this.waiters]) w(); }
  get fast() { return this.instant || this.skipped || this.dead; }
  wait(ms) {
    if (this.fast) return Promise.resolve();
    return new Promise(res => {
      const end = () => { clearTimeout(timer); this.waiters.delete(check); res(); };
      const check = () => { if (this.skipped || this.dead) end(); };
      const timer = setTimeout(end, ms);
      this.waiters.add(check);
    });
  }
  anim(el, kf, opts = {}) {
    if (!el || this.fast) return Promise.resolve();
    const a = el.animate(kf, { easing: EASE_OUT, ...opts });
    this.anims.push(a);
    return a.finished.then(() => {}, () => {});
  }
  skip() { if (this.done) return; this.skipped = true; for (const a of this.anims) { try { a.finish(); } catch { /* gone */ } } this.poke(); }
  stop() { this.dead = true; for (const a of this.anims) { try { a.cancel(); } catch { /* gone */ } } this.poke(); }
  mark(k) { this.marks[k] = Math.round(performance.now() - this.t0); }

  tick(key, state, text) {
    if (this.dead) return;
    const list = $('#did', this.root); if (!list) return;
    let li = $(`li[data-k="${key}"]`, list);
    if (!li) { li = document.createElement('li'); li.dataset.k = key; li.innerHTML = '<span class="g" aria-hidden="true"></span><span class="w"></span>'; list.append(li); }
    li.dataset.s = state;
    $('.g', li).textContent = { done: '✓', wait: '', stop: '✕', needs: '→', neutral: '', pending: '' }[state];
    if (text) $('.w', li).textContent = text;
  }

  // Write an element's words onto its line, one after another. Nothing fades.
  async write(el, { per = T.word, cap = T.wordCap } = {}) {
    if (!el || this.dead) return;
    const ws = el._ph ? el._ph.ws : shownWords(el);
    const done = () => { el.classList.remove('unw'); phOff(el); };
    if (this.fast || !ws.length) { done(); return; }
    const step = Math.min(per, cap / ws.length);
    const start = performance.now();
    await new Promise(res => {
      const tickf = () => {
        if (this.dead) return res();
        if (this.skipped) { done(); return res(); }
        const k = Math.min(ws.length, 1 + Math.floor((performance.now() - start) / step));
        for (let j = 0; j < k; j++) ws[j].classList.add('v');
        if (k >= ws.length) { done(); return res(); }
        phAt(el, k);
        requestAnimationFrame(tickf);
      };
      tickf();
    });
  }

  // The highlighter: one sweep, left to right, line after line.
  async sweep(mark) {
    if (!mark || this.fast) return;
    const lines = Math.max(1, mark.getClientRects().length);
    mark.style.backgroundSize = '0% 100%';
    await this.anim(mark, [{ backgroundSize: '0% 100%' }, { backgroundSize: '100% 100%' }], { duration: Math.min(T.line * lines, T.lineCap), easing: lines > 1 ? 'linear' : EASE_MARK, fill: 'forwards' });
    mark.style.backgroundSize = '';
  }

  // Where everything sits. Wide: steps at their natural spacing, each proof as level with its step as the proofs
  // above it allow, the verdict beside the stamp. Phone: each proof under its step, the verdict under the letter.
  layout() {
    const stage = $('#stage', this.root); if (!stage) return;
    const closing = $('#closing', this.root); const after = $('#after', this.root);
    const svg = $('svg.wires', stage);
    if (stage.classList.contains('single')) { if (closing && closing.parentElement !== after) after.prepend(closing); return; }
    const box = $('#proofs', stage); const side = $('#side', stage);
    const proofs = $$('.proof', stage).sort((a, b) => a.dataset.i - b.dataset.i);
    const allOpen = stage.classList.contains('all-open');
    // Every proof folds to its lit sentence (round 6): a list it opens, the other cells of a table row, and (when
    // it is still taller than its step) its plain line wait behind "Show more", which sits on the page name's line.
    // A fold that hides nothing is not kept, so "Show more" only shows when there is more.
    const foldAll = (rows, fits) => {
      for (const { p, s } of rows) {
        // a long page name has a line of its own: "Show more" goes on that line, inside it
        const pm = $('.pmore', p); const src = $$('.cmp .src', p).at(-1); if (pm && src && pm.parentElement !== src && pm.previousElementSibling !== src) { if (src.classList.contains('long')) src.append(pm); else src.after(pm); }
        p.classList.remove('fold1', 'fold2');
        let any = false;
        if (!allOpen && !p.classList.contains('open')) {
          for (const f of ['fold1', 'fold2']) {
            if (f === 'fold2' && (!fits || fits(p, s))) break;
            const h = p.offsetHeight; p.classList.add(f);
            if (p.offsetHeight < h - 1) any = true; else p.classList.remove(f);
          }
        }
        const more = $('.pmore', p); if (more) more.hidden = !any;
      }
    };
    if (!wide()) {
      for (const p of proofs) { const s = $(`.lstep[data-i="${p.dataset.i}"]`, stage); if (s && s.nextElementSibling !== p) s.after(p); p.style.top = ''; }
      foldAll(proofs.map(p => ({ p, s: $(`.lstep[data-i="${p.dataset.i}"]`, stage) })), (p, s) => p.offsetHeight <= s.offsetHeight + 24);
      if (closing && closing.parentElement !== after) after.prepend(closing);
      if (svg) svg.innerHTML = '';
      return;
    }
    for (const p of proofs) if (p.parentElement !== box || p !== box.children[proofs.indexOf(p)]) box.append(p);
    if (closing && closing.parentElement !== side) side.append(closing);
    // One shared row per step and its proof (round 5). Each proof's first line is level with its step's first
    // line. Round 6: the steps keep one even gap. It is the room the tallest folded proof needs beside its step,
    // the same under every step; a proof someone opened with "Show more" gets more room under its own step only.
    const rows = proofs.map(p => ({ p, s: $(`.lstep[data-i="${p.dataset.i}"]`, stage) })).filter(x => x.s);
    for (const { s } of rows) s.style.marginBottom = '';
    // the space below a step that keeps its proof clear of the next one (10 px apart)
    const extra = (p, s) => p.offsetHeight + 10 - s.offsetHeight;
    foldAll(rows, (p, s) => extra(p, s) <= 6);
    const lineMid = (el) => { const lh = parseFloat(getComputedStyle(el).lineHeight); return el.getBoundingClientRect().top + (Number.isNaN(lh) ? 12 : lh / 2); };
    const firstLine = (p) => $('.px, .pcode, .prow', p) || p;
    const opened = (p) => !allOpen && p.classList.contains('open');
    const even = Math.max(6, ...rows.slice(0, -1).filter(({ p }) => !opened(p)).map(({ p, s }) => Math.round(extra(p, s))));
    for (const [k, { p, s }] of rows.entries()) {
      if (k === rows.length - 1) continue;
      s.style.marginBottom = `${Math.max(even, opened(p) ? Math.round(extra(p, s)) : 0)}px`;
    }
    const br = box.getBoundingClientRect();
    for (const { p, s } of rows) {
      const t = $('.txt', s);
      p.style.top = `${Math.round(t.getBoundingClientRect().top - br.top - 8)}px`;
      const d = lineMid(t) - lineMid(firstLine(p));
      if (Math.abs(d) > 0.5) p.style.top = `${Math.round(parseFloat(p.style.top) + d)}px`;
    }
    const lastP = rows.at(-1)?.p;
    box.style.height = lastP ? `${Math.max(0, lastP.offsetTop + lastP.offsetHeight)}px` : '0px';
    // The verdict starts beside the stamp (the letter's last part), or right after the last proof.
    const tail = $('.ltail', stage).getBoundingClientRect().top;
    side.style.marginTop = '0px';
    const natural = side.getBoundingClientRect().top;
    side.style.marginTop = `${Math.round(Math.max(28, tail - natural + 4))}px`;
    this.wires();
  }

  // The connectors: from the step's first line at the letter's edge to its proof's first line. They may angle.
  wires() {
    const stage = $('#stage', this.root); const svg = $('svg.wires', stage); if (!svg || !wide()) return;
    const sr = stage.getBoundingClientRect(); const lr = $('#letter', stage).getBoundingClientRect();
    svg.setAttribute('width', sr.width); svg.setAttribute('height', sr.height); svg.setAttribute('viewBox', `0 0 ${sr.width} ${sr.height}`);
    const was = new Map($$('.wire', svg).map(g => [g.dataset.i, g.getAttribute('class')]));
    const mid = (el) => { const lh = parseFloat(getComputedStyle(el).lineHeight); return el.getBoundingClientRect().top + (Number.isNaN(lh) ? 12 : lh / 2); };
    const pairs = $$('.lstep', stage).map(s => {
      const i = s.dataset.i; const p = $(`.proof[data-i="${i}"]`, stage); if (!p) return null;
      const first = $('.px, .pcode, .prow', p) || p;
      const pr = p.getBoundingClientRect();
      return { s, i, x1: lr.right - sr.left + 2, y1: Math.round(mid($('.txt', s)) - sr.top), x2: pr.left - sr.left + 2, y2: Math.round(mid(first) - sr.top) };
    }).filter(Boolean);
    // A proof pushed down by the ones above it gets a connector that drops in its own lane. Later steps take the
    // lanes nearer the letter, so no two connectors ever cross or run on top of each other.
    const drift = pairs.filter(q => Math.abs(q.y2 - q.y1) >= 4);
    svg.innerHTML = pairs.map(q => {
      const { x1, y1, x2, y2 } = q;
      let d;
      const k = drift.indexOf(q);
      if (k < 0) d = `M${x1} ${y1} H${x2 - 7}`;
      else {
        const lane = Math.min(x2 - 16, x1 + 12 + (drift.length - 1 - k) * 9);
        const dir = y2 > y1 ? 1 : -1; const r = Math.min(8, Math.abs(y2 - y1) / 2);
        d = `M${x1} ${y1} H${lane - r} Q${lane} ${y1} ${lane} ${y1 + dir * r} V${y2 - dir * r} Q${lane} ${y2} ${lane + r} ${y2} H${x2 - 7}`;
      }
      const cls = was.get(q.i) || `wire away${q.s.classList.contains('flag') ? ' flag' : ''}`;
      return `<g class="${cls}" data-i="${q.i}"><path d="${d}"/><circle cx="${x2 - 4}" cy="${y2}" r="4"/></g>`;
    }).join('');
  }
  async wireIn(i) {
    const g = $(`svg.wires .wire[data-i="${i}"]`, this.root); if (!g) return;
    g.classList.remove('away');
    const path = $('path', g); const dot = $('circle', g);
    if (this.fast || !path) return;
    const len = path.getTotalLength();
    dot.style.visibility = 'hidden';
    await this.anim(path, [{ strokeDasharray: `${len} ${len}`, strokeDashoffset: len }, { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 }], { duration: T.wire, easing: EASE_MARK });
    dot.style.visibility = '';
  }

  // The help page the desk read (round 5). It opens where its sentence will rest: the lit sentence sits exactly
  // on its proof's place from the first frame, the page around it as large as the room allows. Wide: in the
  // margin, the sentence scaled up so the sweep is big. Phone: under step 1, at its own size. Then the page folds
  // away round the sentence, a whole line at a time, and the sentence settles to its proof's size where it is.
  // Nothing slides across the paper.
  sheet(i) {
    const stage = $('#stage', this.root);
    const proof = $(`.proof[data-i="${i}"]`, stage);
    const step = this.result.steps[i]; const p = step.page;
    const target = $('.px, .pcode, .prow', proof);
    if (!target) return null;
    const W = wide();
    const sr = stage.getBoundingClientRect(); const tr = target.getBoundingClientRect();
    const tw = tr.width; const th = tr.height;
    const pad = W ? { t: 22, r: 24, b: 24, l: 28 } : { t: 12, r: 14, b: 14, l: 14 };
    // As big as the room to the right of the sentence's place allows, never past the screen's edge.
    const k = W ? Math.max(1, Math.min(1.34, (innerWidth - 28 - pad.r - tr.left) / tw)) : 1;
    // The highest the page may reach: under "How do we know?" when wide (the heading is plain text that is there
    // from the first frame, round 6); under the letter's head, stamp place included, on a phone.
    const lim = (W ? $('.mh', stage) : $('.letter .lh', stage)).getBoundingClientRect().bottom - sr.top + 6;
    const x = p.found && p.mark ? sentence(p) : { pre: '', mark: step.quote, post: '' };
    const [s0] = p.mark || [0];
    const cut = p.found && p.mark ? p.text.slice(0, s0).length - x.pre.length : 0;
    const beforeAll = `${p.before || ''} ${p.found ? p.text.slice(0, cut) : ''}`;
    const after = p.found ? wholeSentences(`${p.text.slice(s0 + x.mark.length + x.post.length)} ${p.after || ''}`, W ? 230 : 110, false) : '';
    const s = document.createElement('div');
    s.className = 'sheet'; s.setAttribute('aria-hidden', 'true');
    const strip = document.createElement('div');
    strip.className = 'strip';
    strip.innerHTML = target.outerHTML;
    // the strip is the proof's own first line as it will rest (a folded proof shows only its lit part)
    if (proof.classList.contains('fold1') && !proof.classList.contains('open')) for (const c of $$('.ctx', strip)) c.remove();
    for (const src of $$('.src', strip)) src.style.visibility = 'hidden';
    for (const pm of $$('.pmore', strip)) pm.remove();
    strip.style.cssText = `position:absolute;left:0;top:0;width:${tw}px;transform:scale(${k});transform-origin:0 0;`;
    if (proof.classList.contains('flag')) strip.classList.add('flag');
    s.style.cssText = `visibility:hidden;width:${tw * k + pad.l + pad.r}px;padding:${pad.t}px ${pad.r}px ${pad.b}px ${pad.l}px;`;
    stage.append(s);
    // Fill the page above the sentence with as much of the page as fits under the limit.
    let ox = 0; let oy = 0;
    const tries = W ? [[300, true], [230, true], [170, true], [120, true], [80, true], [0, true], [0, false]] : [[110, true], [60, true], [0, true], [0, false]];
    for (const [n, head] of tries) {
      const before = n && p.found ? wholeSentences(beforeAll, n, true) : '';
      s.innerHTML = `<div class="sh-top"><p class="sh-title">${both(dash(p.title || 'Help page'))}</p><span class="sh-site">Blotato help</span></div>${head && p.heading ? `<p class="sh-head">${both(dash(p.heading))}</p>` : ''}${before ? `<p class="sh-ctx">${tq(before)}</p>` : ''}<div class="slot" style="width:${tw * k}px;height:${th * k}px;position:relative"></div>${after ? `<p class="sh-ctx sh-after">${tq(after)}</p>` : ''}`;
      const slot = $('.slot', s).getBoundingClientRect(); const box = s.getBoundingClientRect();
      ox = slot.left - box.left; oy = slot.top - box.top;
      if ((tr.top - sr.top) - oy >= lim) break;
    }
    $('.slot', s).append(strip);
    const left = (tr.left - sr.left) - ox; const top = (tr.top - sr.top) - oy;
    s.style.left = `${left}px`; s.style.top = `${top}px`;
    s.style.visibility = '';
    const box = s.getBoundingClientRect();
    this.sh = { el: s, strip, target, proof, k, ox, oy, w: box.width, h: box.height, tw, th };
    return s;
  }

  async sheetIn() {
    const s = this.sh; if (!s) return;
    await this.anim(s.el, [{ clipPath: 'inset(0 0 100% 0 round 14px)' }, { clipPath: 'inset(0 0 0 0 round 14px)' }], { duration: 260, easing: EASE_OUT });
  }

  // The page folds away round its sentence. First the lines above and below go, one whole line at a time (a
  // line is never cut through its middle); then the sentence settles to its proof's size in its own place.
  async fold() {
    const s = this.sh; if (!s) return;
    const { el, strip, k, ox, oy, w, h, tw, th } = s;
    const er = el.getBoundingClientRect();
    const lines = [];
    for (const e of $$('*', el)) {
      if (strip.contains(e)) continue;
      for (const n of e.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.height > 2) lines.push({ t: r.top - er.top, b: r.bottom - er.top });
      }
    }
    const sTop = oy - 8; const sBot = oy + th * k + 8;
    // the clip's top edge steps down past each line above the sentence; its bottom edge steps up past each below
    const tops = [...new Set(lines.filter(l => l.b <= oy + 1).map(l => Math.ceil(l.b + 1)))].sort((a, b) => a - b).filter(v => v < sTop);
    const bots = [...new Set(lines.filter(l => l.t >= oy + th * k - 1).map(l => Math.floor(l.t - 1)))].sort((a, b) => b - a).map(v => h - v).filter(v => v < h - sBot);
    const n = Math.max(tops.length, bots.length) + 1;
    const at = (arr, j, last) => (j < arr.length ? arr[j] : last);
    const kf = [{ clipPath: 'inset(0px 0px 0px 0px round 14px)', easing: 'steps(1, end)' }];
    for (let j = 0; j < n; j++) kf.push({ clipPath: `inset(${j === n - 1 ? sTop : at(tops, j, sTop)}px 0px ${j === n - 1 ? h - sBot : at(bots, j, h - sBot)}px 0px round 14px)`, easing: 'steps(1, end)' });
    kf.push({ ...kf.at(-1) });
    this.mark('fold');
    await this.anim(el, kf, { duration: Math.min(280, 55 * n + 50), easing: 'linear', fill: 'forwards' });
    if (this.dead) return;
    // Only the sentence is left. It settles to its proof's size where it is (its top left corner holds still).
    const clipAt = (sc) => `inset(${sTop}px ${Math.max(0, w - ox - tw * sc - 14)}px ${Math.max(0, h - oy - th * sc - 8)}px ${Math.max(0, ox - 14)}px round 14px)`;
    if (k > 1.001) {
      await Promise.all([
        this.anim(el, [{ clipPath: clipAt(k) }, { clipPath: clipAt(1) }], { duration: T.fold, easing: EASE_OUT, fill: 'forwards' }),
        this.anim(strip, [{ transform: `scale(${k})` }, { transform: 'scale(1)' }], { duration: T.fold, easing: EASE_OUT, fill: 'forwards' }),
      ]);
    } else {
      await this.anim(el, [{ clipPath: clipAt(1).replace(/inset\(([^ ]+) [^ ]+ ([^ ]+) [^ ]+/, 'inset($1 0px $2 0px') }, { clipPath: clipAt(1) }], { duration: 140, easing: EASE_OUT, fill: 'forwards' });
    }
    if (this.dead) return;
    s.proof.classList.remove('away');
    el.remove(); this.sh = null;
    this.mark('settled');
  }

  // A proof arrives in its place: revealed from the top, with its highlight already on.
  async proofIn(proof) {
    if (!proof) return;
    proof.classList.remove('away');
    if (this.fast) return;
    await this.anim(proof, [{ clipPath: 'inset(0 0 100% 0 round 14px)' }, { clipPath: 'inset(0 0 0 0 round 14px)' }], { duration: T.proofIn, easing: EASE_OUT });
  }

  // The stamp is pressed once, as one piece: it comes down onto the letter with weight, and the paper gives a little.
  async press(stamp, landed = () => {}) {
    if (!stamp) return;
    stamp.classList.remove('away');
    if (this.fast) return;
    // It comes straight down in its own place (only a slight turn and size), so it never passes over the words beside it.
    await this.anim(stamp, [{ transform: 'rotate(-10deg) scale(1.045)' }, { transform: 'rotate(-7deg) scale(1)' }], { duration: T.thud, easing: EASE_IN });
    // the verdict line under the line of work, and its tick, show the instant the stamp lands (round 6)
    landed();
    $('#vline', this.root)?.classList.remove('away');
    this.mark('stampLanded');
    await this.anim($('#letter', this.root), [{ transform: 'none' }, { transform: 'translateY(3px)' }, { transform: 'none' }], { duration: T.nudge, easing: 'ease-out' });
  }

  build(r) {
    this.result = r;
    const st = stateOf(r);
    const root = this.root;
    const stage = $('#stage', root);
    const built = stageHTML(r);
    stage.className = `stage ${built.cls}`.trim();
    stage.innerHTML = built.html;
    const c = closingHTML(r, st, !this.meta.body?.id && !this.meta.example);
    $('#after', root).innerHTML = `${c.closing}${c.rest}`;
    const cl = $('#closing', root); if (cl) cl.classList.add('away');
    $('#after', root).classList.add('held');
    // Every line of work this answer shows has its place now, in order, with its final words.
    const trace = r.trace || [];
    const pages = new Set(trace.filter(e => e.t === 'page').map(e => e.url)).size;
    const searched = trace.some(e => e.t === 'search');
    const called = trace.some(e => e.t === 'call');
    const f = r.fresh || {};
    this.texts = {
      read: pages ? (pages === 1 ? "Read Blotato's help page" : `Read ${pages} of Blotato's help pages`) : searched ? "Looked through Blotato's help pages" : 'No help page was needed',
      // on the practice account, the account is made up: the line says so where it is used
      account: r.mock ? 'Looked at the practice account' : 'Looked at their account',
      write: st === 'refused' ? (whyOf(r) === 'nonsense' ? 'Wrote no reply' : guessing(r) ? 'Wrote no reply. It will not guess.' : 'Wrote no reply') : `Wrote ${(r.steps || []).length} steps`,
      check: whyOf(r) === 'nonsense' ? 'Asked for a clearer message' : { checked: `A second checker passed it${f.checkedAt ? `, ${day(f.checkedAt)}` : ''}`, stopped: 'A second checker stopped it', saved: 'Checked, then one line changed', composed: 'A second reader passed it', draft: 'Not read by a second checker yet', refused: 'A person on the team will take it' }[st],
    };
    this.tick('read', 'pending', this.texts.read);
    if (called && st !== 'refused') this.tick('account', 'pending', this.texts.account);
    this.tick('write', 'pending', this.texts.write);
    this.tick('check', 'pending', this.texts.check);
    // Every word that will be written is split now, so it holds its place and is not seen until it is written.
    if (!this.instant) { for (const el of $$('[data-write]', stage)) words(el); for (const s of $$('.lstep', stage)) s.classList.add('pending'); }
    this.layout();
    // Each line still to be written shows as a quiet placeholder line where its words will stand (round 6).
    if (!this.instant) for (const el of $$('[data-write]', stage)) placeholders(el);
  }

  async play(r) {
    const root = this.root;
    const stage = $('#stage', root);
    const st = stateOf(r);
    const steps = r.steps || [];
    const called = (r.trace || []).some(e => e.t === 'call');
    if (this.fast) return this.finish();
    stage.classList.add('moving');
    const letter = $('#letter', stage);
    const firstFact = st === 'refused' ? -1 : steps.findIndex(s => s.type === 'fact' && s.page?.found && s.page.mark);
    this.tick('read', 'wait', this.texts.read.replace(/^Read /, 'Reading ').replace(/^Looked through/, 'Looking through'));
    say('The desk is working on the answer.');
    await this.lifting;
    this.mark('frame');
    if (this.dead) return;
    if (st === 'refused') {
      letter.classList.remove('away');
      this.anim(letter, [{ transform: 'translateY(18px)' }, { transform: 'none' }], { duration: 300, easing: EASE_OUT });
      await this.wait(200);
      this.tick('read', 'done', this.texts.read);
      this.mark('letter');
      // Not writing a reply is the right move here, not a failure: a plain mark, never a red cross.
      this.tick('write', 'neutral');
      for (const el of $$('[data-write], [data-pop]', stage)) {
        if (el.hasAttribute('data-pop')) { el.classList.remove('away'); continue; }
        await this.write(el, { per: 12, cap: 260 });
      }
      this.tick('check', whyOf(r) === 'nonsense' ? 'neutral' : 'needs');
      return this.finish();
    }
    // The letter is on the page from the first frame, in its final place (its heading and greeting only).
    this.mark('letter');
    const sheet = firstFact >= 0 ? this.sheet(firstFact) : null;
    // on a phone the page lies over the letter's steps: their numbers wait under it until it folds away
    if (sheet && !wide()) stage.classList.add('reading');
    let head;
    if (sheet) {
      // 1. The help page opens where its sentence will rest, and the sentence is highlighted, big.
      await this.sheetIn();
      this.mark('sweep');
      head = this.write($('.head', stage), { per: 10, cap: 160 });
      await this.sweep($('mark', this.sh.strip));
      this.tick('read', 'done', this.texts.read);
      await this.wait(T.hold);
      // 2. It folds away round its sentence, which is now the proof.
      $(`.proof[data-i="${firstFact}"]`, stage)?.classList.add('on');
      await this.fold();
      stage.classList.remove('reading');
    } else {
      head = this.write($('.head', stage), { per: 10, cap: 160 });
      await this.wait(200);
      this.tick('read', 'done', this.texts.read);
    }
    if (this.dead) return;
    await head;

    // 3. The steps, each with its proof, one by one, a beat apart, each pair lit while it is written. Nothing
    // scrolls the page by itself (the customer's question stays where the visitor left it).
    const writeStep = async (i) => {
      const pr = $(`.proof[data-i="${i}"]`, stage);
      const row = $(`.lstep[data-i="${i}"]`, stage);
      row.classList.remove('pending');
      if (steps[i].type === 'evidence' && called) this.tick('account', 'wait', 'Looking at their account');
      const coming = i === firstFact ? null : this.proofIn(pr);
      pr.classList.add('on'); row.classList.add('on');
      $(`svg.wires .wire[data-i="${i}"]`, stage)?.classList.add('on');
      const wired = this.wireIn(i);
      await this.write($('.txt', row));
      await Promise.all([coming, wired]);
      if (steps[i].type === 'evidence' && called) this.tick('account', 'done', this.texts.account);
    };
    const off = (i) => { if (this.done) return; for (const el of $$(`[data-i="${i}"]`, stage)) el.classList.remove('on'); };
    const from = 0;
    const runs = [];
    for (let i = from; i < steps.length; i++) {
      if (this.dead) return;
      runs.push(writeStep(i).then(() => this.wait(T.stepGap)).then(() => off(i)));
      await this.wait(wide() ? T.stepStagger : T.stepStagger + 80);
    }
    await Promise.all(runs);
    if (this.dead) return;
    await this.write($('.tail-text', stage), { per: 4, cap: 120 });
    this.tick('write', 'done');

    // 4. The stamp.
    const seal = sealOf(st);
    this.mark('stampStart');
    const checkTick = () => this.tick('check', { checked: 'done', stopped: 'stop', saved: 'neutral', composed: 'done', draft: 'neutral' }[st]);
    if (seal) await this.press($('.stamp', stage), checkTick);
    checkTick();
    $('#vline', root)?.classList.remove('away');
    this.finish();
  }

  finish() {
    if (this.dead) return;
    const r = this.result; const root = this.root; const stage = $('#stage', root);
    this.done = true;
    this.mark('done');
    stage.classList.remove('moving');
    for (const el of $$('.unw', root)) el.classList.remove('unw');
    for (const el of $$('.pending', root)) el.classList.remove('pending');
    for (const el of $$('.away', root)) el.classList.remove('away');
    for (const m of $$('mark', root)) m.style.backgroundSize = '';
    for (const el of $$('.sheet, .strip, .ph', root)) el.remove();
    for (const el of $$('[data-write]', root)) el._ph = null;
    stage.classList.remove('reading');
    $('#after', root).classList.remove('held');
    const st = stateOf(r);
    for (const k of ['read', 'account', 'write', 'check']) {
      const li = $(`#did li[data-k="${k}"]`, root); if (!li) continue;
      if (li.dataset.s === 'pending' || li.dataset.s === 'wait') this.tick(k, k === 'write' && st === 'refused' ? 'neutral' : k === 'check' ? (whyOf(r) === 'nonsense' ? 'neutral' : { checked: 'done', stopped: 'stop', saved: 'neutral', composed: 'done', draft: 'neutral', refused: 'needs' }[st]) : 'done', this.texts[k]);
    }
    const sk = $('#skip-btn', root); if (sk) sk.style.visibility = 'hidden';
    this.layout();
    for (const g of $$('svg.wires .wire', root)) g.classList.remove('away');
    // Wide screens rest with the first pair lit, to show how pointing works. A phone rests with nothing lit.
    point(wide() ? Math.max(0, (r.steps || []).findIndex(s => s.type === 'fact')) : null);
    const words2 = { checked: 'Checked. Safe to send.', saved: 'Here is the reply. It changed after it was checked, so have it checked again before you send it.', composed: 'Here is a reply written for this message. A second reader passed it.', draft: 'Here is a reply. No second checker has read it yet.', stopped: 'Stopped by the second checker. Do not send it.', refused: 'The desk did not write a reply. A person on the team will take it.' }[st];
    say(`${words2}${r.escalation && st !== 'refused' ? ' This one also goes to a person on the team.' : ''}`);
    window.__lastMoment = this.marks;
    if (this.meta.demo) return demo.done();
    if (this.meta.quiet) return;
    // Focus goes to the main button only when it is on screen; otherwise to the first thing that is (the answer's
    // heading, the verdict line, New message). It never scrolls the page (Nov 16, 2026: focus landed off screen).
    const main = $('#closing .btn', root) || $('.refusal-side .btn', root) || $('.refusal-actions .btn', root);
    const onScreen = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.top >= 0 && b.bottom <= innerHeight; };
    const to = [main, $('#letter-h', root), $('#vline', root), $('#back', root)].find(onScreen);
    if (to && !to.matches('button, a, [tabindex]')) to.setAttribute('tabindex', '-1');
    to?.focus({ preventScroll: true });
  }

  fail(message) {
    if (this.dead) return;
    this.done = true;
    this.mark('done');
    this.tick('read', 'stop', 'The desk could not finish this one');
    const sk = $('#skip-btn', this.root); if (sk) sk.style.visibility = 'hidden';
    $('#after', this.root).classList.remove('held');
    $('#after', this.root).innerHTML = `<div class="closing single"><div class="verdict" style="--tone: var(--block)"><b>Something went wrong.</b><p class="v1">${esc(message)}</p></div><div class="actions"><button type="button" class="btn" data-again>Try again</button></div></div>`;
    say('The desk could not finish this one.');
    window.__lastMoment = this.marks;
    $('#after [data-again]', this.root)?.focus();
  }
}

// The box lifts and becomes the customer's quote at the top. The first screen is put away at once (nothing
// scrolls by itself, and no heading slides away under the menu); only the customer's words travel.
function showShell(m, meta, r) {
  const ask = $('#ask');
  const animate = !m.instant && !ask.hidden;
  const box = $('#msg').getBoundingClientRect();
  ask.hidden = true;
  // the first screen is put away: from now on its status line takes room only when it has words
  document.documentElement.classList.remove('demo-first');
  const res = $('#result');
  res.hidden = false;
  res.innerHTML = shellHTML(meta, r);
  m.root = $('#result-in', res);
  scrollTo(0, 0);
  m.build(r);
  // A long message is cut at a few lines, with a way to read all of it.
  const sq = $('#said-q', res); const cap = sq ? parseFloat(getComputedStyle(sq).maxHeight) : NaN;
  if (sq && !Number.isNaN(cap) && sq.scrollHeight > cap + 4) $('#said-more', res).hidden = false;
  m.lifting = Promise.resolve();
  for (const el of [m.root]) el.addEventListener('wheel', () => { m.userScrolled = true; }, { passive: true, once: true });
  addEventListener('touchmove', () => { m.userScrolled = true; }, { passive: true, once: true });
  if (!animate) return;
  const q = $('#said-q', res); const qr = q.getBoundingClientRect();
  // on a phone the words rise straight up (a sideways nudge pushed their line ends past the screen's edge)
  const dy = (box.top + 4) - qr.top; const dx = wide() ? box.left + 28 - qr.left : 0;
  if (dy <= 0 || dy > 1400) return;
  m.root.classList.add('lifting', 'lifting-stage');
  const lifted = m.anim(q, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: T.lift, easing: 'cubic-bezier(.22, .9, .3, 1)' }).then(() => m.root.classList.remove('lifting', 'lifting-stage'));
  // The help page starts to open once the words have passed the place where it lies.
  m.lifting = Promise.race([lifted, m.wait(T.lift * 0.5)]).then(() => m.root.classList.remove('lifting-stage'));
}

// Ask the desk. The answer comes back first, so every part of the stage has its real place before anything moves.
async function fetchLive(body, onEvent = () => {}) {
  const events = []; let result = null; let error = null;
  try {
    const res = await fetch('/api/ticket/live', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok || !res.body) { let msg = `HTTP ${res.status}`; try { msg = (await res.json()).error || msg; } catch { /* not json */ } error = msg; }
    else {
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.t === 'result') result = ev.result; else if (ev.t === 'error') error = ev.message; else if (ev.t !== 'start') { events.push(ev); onEvent(ev); }
        }
        if (done) break;
      }
      if (!result && !error) error = 'The desk stopped before it finished. Try again.';
    }
  } catch (e) { error = `The desk could not be reached. ${e.message}`; }
  return { result, error, events };
}

let asking = 0;
async function start({ body, who, text, demo: isDemo = false, instant = false, example = false, fromHistory = false, quiet = false }) {
  moment?.stop();
  const my = ++asking;
  const btn = $('#answer-btn');
  const onAsk = !$('#ask').hidden;
  let slow = null; let told = false;
  if (onAsk && !instant) { btn.classList.add('pressed'); slow = setTimeout(() => { if (my === asking && !told) { btn.textContent = 'Reading the help pages...'; } }, 400); }
  // A reply written for this message takes a few model calls (about 15 seconds). Say which one the desk is on.
  const WAITING = { expand: 'Finding the right help pages...', write: 'Writing a reply for this message...', second: 'A second reader is checking it...' };
  const progress = (ev) => { if (onAsk && !instant && my === asking && ev.t === 'model' && ev.phase === 'start' && WAITING[ev.kind]) { told = true; btn.textContent = WAITING[ev.kind]; } };
  const got = example ? await api('/api/example/stopped').then(r => ({ result: r }), e => ({ error: e.message })) : await fetchLive(body, progress);
  clearTimeout(slow); btn.classList.remove('pressed'); btn.textContent = 'Answer it';
  if (my !== asking) return; // a newer question took over
  if (!got.result) {
    if (onAsk) { $('#filled').textContent = got.error || 'The desk could not answer.'; return; }
  }
  const meta = { who, text, demo: isDemo, instant, example, body, quiet };
  if (!fromHistory) {
    const st = { r: 1, body, who, text, example };
    if (history.state?.r) history.replaceState(st, '', '#answer'); else history.pushState(st, '', '#answer');
  }
  const m = moment = new Moment(meta);
  showShell(m, meta, got.result || { trace: [], steps: [], check: { pass: false } });
  if (!got.result) return m.fail(got.error);
  await m.play(got.result);
}

// Back to the box. keepText: put the customer's words back so they can say it another way.
function back({ keepText = false, fromHistory = false, text: given = null } = {}) {
  const text = given ?? (keepText ? (moment?.meta?.text || '') : '');
  moment?.stop(); moment = null; asking++; sending = false;
  demo.cancel();
  $('#result').hidden = true; $('#result').innerHTML = '';
  $('#ask').hidden = false;
  $('#msg').value = text; picked = null; $('#filled').textContent = keepText ? 'Here is the message again. Add a little more detail, then press "Answer it".' : '';
  for (const b of $$('.tries-list button')) b.setAttribute('aria-pressed', 'false');
  scrollTo(0, 0);
  if (!fromHistory && history.state?.r) history.replaceState(null, '', '#answer');
  $('#msg').focus({ preventScroll: true });
}

const leave = () => (history.state?.r ? history.back() : back());

async function copy(kind, btn) {
  const r = moment?.result; if (!r) return;
  const text = kind === 'sabrina' ? cleanNote(r.escalationText || '').replace(/^## Escalation\n\n/, '') : r.reply;
  const out = $(`[data-copied="${kind}"]`, btn.closest('section, .actions') || document);
  try { await navigator.clipboard.writeText(text); if (out) out.textContent = kind === 'sabrina' ? 'Copied. Paste it where the team will see it.' : 'Copied. Paste it into your reply to the customer.'; }
  catch { if (out) out.textContent = 'Your browser blocked copying. Select the text and copy it by hand.'; }
}

// ---------------------------------------------------------------- the first-open example
// First visit only: the first example types itself in, stays long enough to read, and the desk answers it.
const demo = {
  running: false, typing: false,
  wanted() {
    const q = new URLSearchParams(location.search);
    if (q.has('nodemo')) return false;
    if (q.has('demo')) return true;
    return !store.get('sd-demo-seen') && location.hash !== '#practice' && !history.state?.r;
  },
  async run() {
    if (this.running) return;
    this.running = true;
    store.set('sd-demo-seen', '1');
    const btn = $(`#tries button[data-id="${DEMO_ID}"]`);
    const text = $('.t', btn).textContent;
    if (reduced.matches) { pick(btn, { focus: false }); return this.go(btn, text, true); }
    $('#demo-skip').hidden = false;
    // on a phone the link stands in the status line's place, so the line stays empty while it is there
    $('#filled').textContent = wide() ? 'Watch: an example is going in the box.' : '';
    // The first screen gets a quiet moment to be read before anything moves.
    await sleep(1400);
    if (!this.running) return;
    btn.setAttribute('aria-pressed', 'true');
    this.typing = true;
    const box = $('#msg');
    for (let i = 1; i <= text.length && this.running; i += 3) { box.value = text.slice(0, i); await sleep(16); }
    this.typing = false;
    if (!this.running) return; // skipped while typing: the box stays as the skip left it
    box.value = text;
    pick(btn, { focus: false });
    $('#filled').textContent = wide() ? 'That is the message. Now the desk answers it.' : '';
    await sleep(900);
    if (!this.running) return;
    $('#answer-btn').animate([{ transform: 'none' }, { transform: 'scale(.97)' }, { transform: 'none' }], { duration: 200, easing: 'ease-out' });
    await sleep(160);
    if (!this.running) return;
    this.go(btn, text, false);
  },
  go(btn, text, instant) {
    $('#demo-skip').hidden = true;
    start({ body: { id: DEMO_ID }, who: btn.dataset.who, text, demo: true, instant });
  },
  // Skip the example: no example at all. Back to an empty box, with the cursor in it.
  skip() {
    const was = this.running || !!$('#demo-skip2');
    this.cancel();
    if (!was) return;
    if (!$('#result').hidden) back(); else { $('#msg').value = ''; picked = null; for (const b of $$('.tries-list button')) b.setAttribute('aria-pressed', 'false'); $('#filled').textContent = ''; $('#msg').focus({ preventScroll: true }); }
  },
  done() {
    const b = $('#demo-skip2'); if (!b) return;
    $('#demo-say').textContent = 'That was a made-up example. Now try your own.';
    b.className = 'btn'; b.id = 'try-own'; b.textContent = 'Now try your own';
    this.running = false;
  },
  cancel() { this.running = false; this.typing = false; $('#demo-skip').hidden = true; document.documentElement.classList.remove('demo-first'); },
};

// ---------------------------------------------------------------- the practice game
const CUST = {
  'in-progress': { slot: 'cust-dev-waiting', who: 'A developer', look: 'A developer with curly dark hair, round glasses and a gray-blue hoodie' },
  'unknown-outcome-resend': { slot: 'cust-dev-timeout', who: 'Another developer', look: 'A developer with black hair tied back and a dark green sweater' },
  'mcp-invalid-grant': { slot: 'cust-claude-user', who: 'A marketer who uses Claude', look: 'A marketer with a short beard and a mustard-yellow overshirt' },
  'published-not-visible': { slot: 'cust-creator', who: 'A young creator', look: 'A young creator with long wavy auburn hair and a cream sweatshirt' },
  'trial-api-key-charge': { slot: 'cust-coach', who: 'A coach on the free trial', look: 'A coach with short gray hair and a navy track jacket' },
};
const custOf = (d) => CUST[d.entry] || { slot: '', who: 'A customer', look: 'A customer' };
// Each move's stamp word and what the customer writes back, in the order the choices are listed
// (knowledge/practice.mjs keeps each round's choices in one fixed order). Each row also says whether it is the
// right move, and is used only when that matches the data, so a reordered choice can never get the wrong reply.
const MOVES = {
  'in-progress': [
    [false, 'Post again', 'Ugh. The first one went out after all, so my followers saw it twice.'],
    [true, 'Check the ID', 'Thanks! I checked the ID like you said. It was the wrong one, so now I know it was never stuck.'],
    [false, 'Wait longer', 'I waited another hour. Still nothing. Was the ID even right?'],
  ],
  'unknown-outcome-resend': [
    [false, 'Send again', 'Now I have two copies scheduled. The first one had gone through.'],
    [false, 'Say it failed', 'You said it failed, so I sent it again. Now it is going to post twice.'],
    [true, 'Look first', 'Found it in my scheduled posts. Glad I did not send it twice!'],
  ],
  'mcp-invalid-grant': [
    [true, 'Add it again', 'I took it out and added it back. Claude works with Blotato again. Thank you!'],
    [false, 'Reconnect', 'I reconnected Instagram, but Claude still shows the same error.'],
    [false, 'Fix button', "I clicked that button and nothing happened. I don't even use n8n."],
  ],
  'published-not-visible': [
    [false, 'Post again', 'Oh no. It was on my other account, and now that one has it twice.'],
    [true, 'Check where', 'Found it! It went to my second account. Thank you!'],
    [false, 'Guess', "Wait, is my account hidden? Now I'm really worried."],
  ],
  'trial-api-key-charge': [
    [false, 'Promise', "You said I'd get my money back. Now someone says they have to check first?"],
    [false, 'Blame them', "Okay, but you didn't have to make me feel bad about it."],
    [true, 'Explain', 'That makes sense now. Thanks for passing the charge to someone who can help.'],
  ],
};
const moveOf = (d, k) => { const row = (MOVES[d.entry] || [])[k]; return row && row[0] === !!d.choices[k]?.right ? row : null; };
const writeBack = (d, k) => moveOf(d, k)?.[2] || null;
const verbOf = (d, k) => moveOf(d, k)?.[1] || `Stamp ${k + 1}`;
// A help sentence is shown in the game only when a beginner can read it, or when the data gives it a plain line.
const HARD = /\b(fallback|queue|downstream|OAuth|endpoint|validate|established?|submission ID|response)\b/i;
let lastInput = 'pointer';

// The player's place in the shift is kept for this tab (Back, Forward and a reload keep it).
const SHIFT_KEY = 'sd-shift';
const shiftStore = {
  get() { try { return JSON.parse(sessionStorage.getItem(SHIFT_KEY) || 'null'); } catch { return null; } },
  set(v) { try { sessionStorage.setItem(SHIFT_KEY, JSON.stringify(v)); } catch { /* private window */ } },
  clear() { try { sessionStorage.removeItem(SHIFT_KEY); } catch { /* private window */ } },
};

const game = {
  data: null, i: 0, score: 0, picks: [], phase: 'start', lockUntil: 0,
  save() { if (this.phase === 'ask' || this.phase === 'after') shiftStore.set({ i: this.i, score: this.score, picks: this.picks, phase: this.phase }); else shiftStore.clear(); },
  async open() {
    if (!this.data) {
      $('#game-stage').innerHTML = '<p class="lede">Getting your desk ready.</p>';
      try { [this.data] = await Promise.all([api('/api/practice'), loadArt()]); } catch (e) { $('#game-stage').innerHTML = `<p>${esc(e.message)}</p>`; return; }
      // Every face (and the stamp's handle, when its picture is there) is ready before the desk is shown.
      await preload(['stamp-handle', ...this.data.decisions.flatMap(d => { const s = custOf(d).slot; return [s, `${s}-relieved`, `${s}-upset`]; })]);
      const was = shiftStore.get();
      const n = this.data.decisions.length;
      if (was && Number.isInteger(was.i) && was.i >= 0 && was.i < n && Array.isArray(was.picks)) {
        // Back where the player was: the same letter, the stamps already pressed.
        this.i = was.i; this.score = was.score || 0; this.picks = was.picks;
        const k = was.phase === 'after' ? this.picks[this.i]?.k : null;
        if (k !== null && k !== undefined) this.picks[this.i] = undefined;
        if (k !== null && k !== undefined && this.picks[this.i] === undefined) this.score = this.picks.filter(p => p?.right).length;
        await this.round();
        if (k !== null && k !== undefined) { this.lockUntil = 0; this.answer(k); }
        return;
      }
      this.startScreen();
    } else if (this.phase === 'end') {
      // A finished shift: the tab offers a new one.
      this.startScreen();
    }
    // The start button gets the focus ring only for someone using the keyboard.
    if (this.phase === 'start' && lastInput === 'key') $('#game-go')?.focus({ preventScroll: true });
  },
  face(d, mood, size) {
    const c = custOf(d); const slot = mood ? `${c.slot}-${mood}` : c.slot;
    const alt = `${c.look}, ${mood === 'relieved' ? 'relieved and smiling' : mood === 'upset' ? 'upset' : 'waiting for an answer'}.`;
    return art(slot, alt, size);
  },
  // The queue: the five customers' faces, the one you are helping now marked, each answered one shown with
  // how they feel now. Real portraits only.
  tray() {
    const n = this.data.decisions.length;
    const now = this.phase === 'start' || this.phase === 'end' ? null : this.i;
    $('#tray').innerHTML = `<p class="tray-say">${now === null ? (this.phase === 'end' ? `Shift over. You helped <b>${this.score}</b> of ${n}.` : `${n} customers are waiting.`) : `Letter <b>${now + 1}</b> of ${n}. Helped so far: <b>${this.score}</b>.`}</p>
      <ol class="queue" aria-label="The customers in your shift">${this.data.decisions.map((d, k) => {
        const p = this.picks[k]; const s = p ? (p.right ? 'right' : 'wrong') : k === now ? 'now' : 'wait';
        const mood = p ? (p.right ? 'relieved' : 'upset') : '';
        const f = this.face(d, mood, 56);
        return `<li data-s="${s}">${f || ''}<span class="sr-only">${esc(custOf(d).who)}: ${p ? (p.right ? 'helped' : 'not helped') : k === now ? 'writing to you now' : 'still waiting'}</span></li>`;
      }).join('')}</ol>`;
  },
  // A new desk slides in from the right. The old one goes out to the left first, so they never cross.
  async swap(html) {
    const stage = $('#game-stage');
    const old = stage.firstElementChild;
    if (!reduced.matches && old && this.phase !== 'loading') {
      await old.animate([{ transform: 'none' }, { transform: `translateX(${-innerWidth}px)` }], { duration: 240, easing: EASE_IN, fill: 'forwards' }).finished.catch(() => {});
    }
    stage.innerHTML = html;
    const nu = stage.firstElementChild;
    if (!reduced.matches && nu) nu.animate([{ transform: `translateX(${innerWidth}px)` }, { transform: 'none' }], { duration: 420, easing: EASE_OUT });
    return nu;
  },
  startScreen() {
    this.phase = 'start'; this.picks = []; this.score = 0; this.i = 0; this.save();
    this.tray();
    $('#game-stage').innerHTML = `<div><ol class="desk" aria-label="The five customers waiting">${this.data.decisions.map(d => {
      const c = custOf(d); const f = this.face(d, '', 120);
      return `<li>${f ? f.replace('<img', '<img class="dface"') : ''}<p class="dq">${esc(d.ticket)}</p><span class="dwho">${esc(c.who)}</span></li>`;
    }).join('')}</ol>
    <div class="desk-go"><button type="button" class="btn" id="game-go">Start my shift</button><p class="key-hint">Keys <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> press the stamps. <kbd>Enter</kbd> opens the next letter.</p></div></div>`;
  },
  begin() { this.i = 0; this.score = 0; this.picks = []; this.round(); },
  lock(ms = 380) { this.lockUntil = performance.now() + ms; },
  locked() { return performance.now() < this.lockUntil; },
  async round() {
    const d = this.data.decisions[this.i]; this.phase = 'ask'; this.lock(700); this.save();
    const c = custOf(d); const n = this.data.decisions.length;
    this.tray();
    const face = this.face(d, '', 280);
    const html = `<div class="round">
      <div class="cust">${face ? `<div class="face" id="face">${face}</div>` : ''}<div><p class="cname">${esc(c.who)}</p><p class="cmood" id="cmood">Waiting for your answer</p></div></div>
      <div class="letters">
        <article class="cust-letter" id="cust-letter" aria-labelledby="cust-from">
          <h2 class="from" id="cust-from" tabindex="-1"><span class="sr-only">Letter ${this.i + 1} of ${n}. ${esc(c.who)} writes: </span>Hi Blotato support,</h2>
          <blockquote>${esc(d.ticket)}</blockquote>
          <div class="sig-row"><p class="sig">Thanks,<b>${esc(c.who)}</b></p><div class="stamp-slot" id="letter-slot"></div></div>
        </article>
        <div id="write-back" class="wb-slot"></div>
      </div>
      <div class="stamps">
        <h2 id="move-h">Press one stamp</h2>
        <p class="stamps-hint">Each stamp is a first move. The one you press prints on their letter, and they write back.</p>
        <ol aria-labelledby="move-h">${d.choices.map((ch, k) => `<li><button type="button" class="choice" data-k="${k}">${this.rubber(d, k, n)}<span class="sbody"><span class="sverb">${esc(verbOf(d, k))}<kbd class="key-hint" aria-hidden="true">${k + 1}</kbd></span><span class="ct"><span class="sr-only">Stamp ${k + 1}: </span>${esc(ch.text)}</span></span></button></li>`).join('')}</ol>
        <div class="after-move" id="after-move"></div>
      </div>
    </div>`;
    const top = $('#view-practice').getBoundingClientRect().top;
    if (!wide()) scrollTo(0, scrollY + $('#game-stage').getBoundingClientRect().top - 8);
    else if (top < 0) $('#view-practice').scrollIntoView({ block: 'start' });
    await this.swap(html);
    say(`Letter ${this.i + 1} of ${n}. ${c.who} writes: ${d.ticket}`);
    $('#cust-from').focus({ preventScroll: true });
  },
  // One rubber stamp in the rack: its handle (the painted picture, only when it is there; never a drawn
  // stand-in) over its inked face, which shows exactly what it prints on the letter.
  rubber(d, k, n) {
    const handle = ART.has('stamp-handle') ? `<img class="handle" src="/art/stamp-handle.webp" alt="" width="120" height="96" decoding="sync">` : '';
    return `<span class="rstamp${handle ? ' has-handle' : ''}" aria-hidden="true">${handle}<span class="rface" data-tone="ready">${postmark('helped', { center: [`LETTER ${this.i + 1}`, `OF ${n}`], word: verbOf(d, k).toUpperCase(), sub: 'YOUR FIRST MOVE', label: '' })}</span></span>`;
  },
  answer(k) {
    if (this.phase !== 'ask' || this.locked()) return;
    const d = this.data.decisions[this.i]; const ch = d.choices[k]; if (!ch) return;
    this.phase = 'after'; this.lock(450);
    this.picks[this.i] = { k, right: !!ch.right };
    if (ch.right) this.score++;
    this.save();
    $$('#game-stage .choice').forEach((b, idx) => {
      b.disabled = true;
      const right = d.choices[idx].right;
      if (idx === k) b.classList.add('picked', right ? 'right' : 'wrong');
      if (right) b.classList.add('answer');
      if (idx !== k && !right) b.classList.add('dim');
      if (idx === k || right) b.insertAdjacentHTML('beforeend', `<span class="tag">${right ? (idx === k ? 'Your stamp. The right first move.' : 'The right first move') : 'Your stamp'}</span>`);
    });
    const c = custOf(d);
    const n = this.data.decisions.length;
    // The stamp comes down on their letter, in the place kept for it beside their name.
    const slot = $('#letter-slot');
    slot.innerHTML = `<div class="stamp" data-tone="${ch.right ? 'helped' : 'oops'}">${postmark(ch.right ? 'helped' : 'oops', { center: [`LETTER ${this.i + 1}`, `OF ${n}`], word: verbOf(d, k).toUpperCase(), label: `${STAMPS[ch.right ? 'helped' : 'oops'].label} Your stamp: ${verbOf(d, k).toLowerCase()}.` })}</div>`;
    const stamp = $('.stamp', slot);
    const letter = $('#cust-letter');
    // The stamp you chose is pressed down in the rack as its print lands on the letter.
    const rs = $(`#game-stage .choice[data-k="${k}"] .rstamp`);
    if (rs && !reduced.matches) rs.animate([{ transform: 'none' }, { transform: 'translateY(10px) scale(.95)', offset: 0.45 }, { transform: 'none' }], { duration: T.thud + 160, easing: 'cubic-bezier(.3, 0, .3, 1)' });
    const contact = () => {
      const mood = this.face(d, ch.right ? 'relieved' : 'upset', 280);
      const faceBox = $('#face');
      if (mood && faceBox) { faceBox.innerHTML = mood; if (!reduced.matches) faceBox.animate([{ transform: 'scale(1.035)' }, { transform: 'none' }], { duration: 260, easing: EASE_OUT }); }
      $('#cmood').textContent = ch.right ? 'Relieved' : 'Upset';
      $('#cmood').className = `cmood ${ch.right ? 'ok' : 'no'}`;
    };
    if (!reduced.matches) {
      stamp.animate([{ transform: 'translateY(-22px) rotate(-12deg) scale(1.22)' }, { transform: 'rotate(-7deg) scale(1)' }], { duration: T.thud, easing: EASE_IN }).finished.then(() => {
        letter.animate([{ transform: 'rotate(-.8deg)' }, { transform: 'rotate(-.8deg) translateY(4px)' }, { transform: 'rotate(-.8deg)' }], { duration: T.nudge, easing: 'ease-out' });
        contact();
      }, () => {});
    } else contact();
    // They write back: a small letter of their own, right under theirs, with their face as it is now.
    const wb = writeBack(d, k);
    const last = this.i + 1 >= n;
    const p = d.source.page;
    const sent = p?.found && p.mark ? sentence(p) : { pre: '', mark: d.source.quote.replace(/^["“]|["”]$/g, '').replace(/`/g, ''), post: '' };
    const plainLine = d.source.plain ? plainWords(String(d.source.plain).replace(/^In plain words:\s*/i, '')) : '';
    const fits = !!plainLine || !HARD.test(`${sent.pre}${sent.mark}${sent.post}`);
    const quote = `<p class="x">${esc(sent.pre)}<mark>${esc(sent.mark)}</mark>${esc(sent.post)}</p>${plainLine ? `<p class="xplain"><b>In plain words:</b> ${esc(plainLine)}</p>` : ''}`;
    const mini = this.face(d, ch.right ? 'relieved' : 'upset', 64);
    $('#write-back').innerHTML = `<article class="write-back ${ch.right ? 'ok' : 'no'}" aria-labelledby="wb-h"><h3 class="wb-h" id="wb-h">${mini ? `<span class="wb-face">${mini}</span>` : ''}<span>${esc(c.who)} writes back</span></h3>${wb ? `<p class="wb">&ldquo;${esc(wb)}&rdquo;</p>` : ''}<p class="what">${esc(ch.consequence)}</p></article>`;
    const wbEl = $('.write-back');
    const nextHTML = `<div class="game-next"><button type="button" class="btn" id="game-next">${last ? 'See my shift report' : 'Open the next letter'}</button><span class="hint">or press Enter</span></div>`;
    // The lesson comes first, then the next button (round 6), so no one moves on before reading the right
    // first move. On a phone both sit right under their reply; on a wide screen, under the stamps.
    const lessonHTML = `<h3>${ch.right ? 'You got it.' : 'The right first move'}</h3><p class="right-move">${both(d.firstCheck)}</p>
      ${fits ? `<div class="src">${quote}<p class="k">Blotato's help page says so.</p><a href="${esc(d.source.url)}" target="_blank" rel="noopener">Open the help page</a></div>` : `<div class="src"><p class="k">Blotato's help page explains why.</p><a href="${esc(d.source.url)}" target="_blank" rel="noopener">Open the help page</a></div>`}${nextHTML}`;
    // Wide (Nov 16, 2026): the next button sits on their reply, so the reply and the button are on screen together;
    // the lesson stays beside it, under the stamps, where the right stamp is already marked.
    if (wide()) { $('#after-move').innerHTML = lessonHTML.replace(nextHTML, ''); wbEl.insertAdjacentHTML('beforeend', nextHTML); }
    else { $('#after-move').innerHTML = ''; $('#write-back').insertAdjacentHTML('beforeend', `<div class="after-move">${lessonHTML}</div>`); }
    if (!reduced.matches) {
      wbEl.animate([{ clipPath: 'inset(0 0 100% 0)', transform: 'translateY(-14px) rotate(.8deg)' }, { clipPath: 'inset(0 0 0 0)', transform: 'rotate(.8deg)' }], { duration: 420, delay: T.thud + 120, easing: EASE_OUT, fill: 'backwards' });
    }
    this.tray();
    say(`${ch.right ? 'Helped.' : 'Oops.'} ${c.who} writes back. ${wb || ''} ${ch.consequence}`);
    $('#game-next').focus({ preventScroll: true });
    // On a phone, bring their answer and the next button into view once the stamp has landed.
    if (!wide()) setTimeout(() => {
      const w = $('#write-back')?.getBoundingClientRect(); if (!w) return;
      if (w.bottom > innerHeight - 12 || w.top < 0) scrollTo({ top: scrollY + w.top - 12, behavior: reduced.matches ? 'auto' : 'smooth' });
    }, reduced.matches ? 0 : 560);
    // Wide: if their reply (with the next button) ends below the screen, move up only as far as it needs, keeping
    // their letter's top in view where it can.
    else setTimeout(() => {
      if (!wbEl.isConnected) return;
      const w = wbEl.getBoundingClientRect();
      const need = w.bottom + 16 - innerHeight;
      if (need > 0) scrollTo({ top: scrollY + Math.min(need, Math.max(0, w.top - 16)), behavior: reduced.matches ? 'auto' : 'smooth' });
    }, reduced.matches ? 0 : 560);
  },
  next() {
    if (this.phase !== 'after' || this.locked()) return;
    this.i++;
    if (this.i >= this.data.decisions.length) return this.end();
    this.round();
  },
  async end() {
    this.phase = 'end'; this.lock(); this.tray(); this.save();
    const n = this.data.decisions.length; const s = this.score;
    const line = s === n ? 'A clean shift. Every customer got the right first move, so nobody posted twice and nobody waited for nothing.'
      : s >= n - 1 ? 'A good shift. One customer had a rough moment. Here is the right first move for each one.'
      : 'Every wrong move here is a real way a support message goes sideways. Here is the right first move for each one, so next time you will know.';
    const title = s === n ? 'You are ready for a real shift.' : s >= n - 1 ? 'Nearly ready for a real shift.' : s >= 2 ? 'A good start. Play once more.' : 'Every pro starts here. Play once more.';
    await preload(['shift-end']);
    const pic = art('shift-end', 'A desk at dusk with five stamped envelopes, a mug, a highlighter and a lamp.', 1200, 600, 'report-art');
    $('#view-practice').scrollIntoView({ block: 'start' });
    await this.swap(`<div class="report">
      <div class="report-paper">
        ${pic}
        <h2 tabindex="-1" id="score-h">You helped ${s} of ${n} customers</h2>
        <p class="score-title">${esc(title)}</p>
        <p class="score-say">${esc(line)}</p>
        <ol class="earned" aria-label="Your stamps">${this.data.decisions.map((d, k) => { const p = this.picks[k]; return `<li class="${p?.right ? 'got' : 'missed'}"><span class="em">${roundMark(!!p?.right, k + 1, n)}</span><span class="en">${esc(custOf(d).who)}</span></li>`; }).join('')}</ol>
        <div class="row"><button type="button" class="btn" id="game-again">Play the shift again</button><a class="btn-quiet" href="#answer">Answer a real message</a></div>
      </div>
      <div>
        <h3 class="learned-h">What you learned</h3>
        <ol class="learned">${this.data.decisions.map((d, k) => { const p = this.picks[k]; return `<li><span class="g ${p?.right ? 'ok' : 'no'}" aria-hidden="true">${p?.right ? '✓' : '✕'}</span><p><span class="sr-only">${p?.right ? 'You got this one.' : 'You missed this one.'} </span>${both(d.firstCheck)}</p><a href="${esc(d.source.url)}" target="_blank" rel="noopener">The help page that says so</a></li>`; }).join('')}</ol>
      </div>
    </div>`);
    if (!reduced.matches) {
      // The stamps are pressed one after another: hidden until their turn, then on the paper at once.
      $$('.earned .em').forEach((el, k) => {
        el.style.visibility = 'hidden';
        setTimeout(() => { el.style.visibility = ''; el.animate([{ transform: `translateY(-14px) rotate(${k % 2 ? 6 : -9}deg) scale(1.18)` }, { transform: `rotate(${k % 2 ? 6 : -9}deg) scale(1)` }], { duration: T.thud, easing: EASE_IN }); }, 520 + k * 170);
      });
    }
    say(`Your shift is over. You helped ${s} of ${n} customers.`);
    $('#score-h').focus({ preventScroll: true });
  },
};

// ---------------------------------------------------------------- wiring
function wire() {
  addEventListener('keydown', () => { lastInput = 'key'; }, true);
  addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
  addEventListener('hashchange', route);
  addEventListener('popstate', (e) => {
    const s = e.state;
    if (s?.r && !$('#view-answer').hidden) return start({ ...s, instant: true, fromHistory: true, quiet: true });
    if (!s?.r && !$('#result').hidden) back({ fromHistory: true });
  });
  $('#ask-form').addEventListener('submit', (e) => { e.preventDefault(); demo.cancel(); submit(); });
  $('#msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
  $('#msg').addEventListener('input', () => {
    const box = $('#msg');
    if (box.value.length > MAX) { box.value = box.value.slice(0, MAX); $('#filled').textContent = 'That is longer than the desk reads. It kept the first 2,000 characters.'; }
    else $('#filled').textContent = '';
    if (picked && box.value !== picked.text) { picked = null; for (const b of $$('.tries-list button')) b.setAttribute('aria-pressed', 'false'); }
  });
  $('#msg').addEventListener('pointerdown', () => { if (demo.running) demo.skip(); });
  $('#tries').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { demo.cancel(); pick(b); } });
  $('#more').addEventListener('click', (e) => { const b = e.target.closest('.tries-list button'); if (b) pick(b); });
  $('#more-btn').addEventListener('click', () => {
    const open = $('#more-btn').getAttribute('aria-expanded') !== 'true';
    $('#more-btn').setAttribute('aria-expanded', String(open)); $('#more').hidden = !open;
    $('#more-btn').textContent = open ? 'Show fewer examples' : 'Show more examples';
  });
  $('#stopped-btn').addEventListener('click', () => { demo.cancel(); start({ body: null, who: 'Someone who posts with n8n (an automation tool)', text: (STATE?.tickets.find(x => x.id === 'T07')?.text) || 'My n8n workflow posts 50 videos at once.', example: true }); });
  $('#demo-skip').addEventListener('click', () => demo.skip());
  $('#watch-btn').addEventListener('click', () => { demo.running = false; demo.run(); });

  document.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-tech-switch]'); if (sw) return setTech(sw.getAttribute('aria-checked') !== 'true');
    if (e.target.closest('#back')) return leave();
    if (e.target.closest('#skip-btn')) return moment?.skip();
    if (e.target.closest('#demo-skip2')) return demo.skip();
    if (e.target.closest('#try-own')) return leave();
    if (e.target.closest('#reword-btn')) return back({ keepText: true });
    const ask = e.target.closest('[data-ask]');
    if (ask) { const text = ask.dataset.ask; back({ text }); return start({ body: { text }, who: null, text }); }
    if (e.target.closest('#fixed-btn')) { const t = STATE?.tickets.find(x => x.id === 'T07'); return start({ body: { id: 'T07' }, who: 'Someone who posts with n8n (an automation tool)', text: t?.text || moment?.meta?.text || '' }); }
    if (e.target.closest('[data-again]')) { leave(); return; }
    const c = e.target.closest('[data-copy]'); if (c) return copy(c.dataset.copy, c);
    const more = e.target.closest('.page-toggle');
    if (more) {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'Show only the sentences' : 'Show more of each page';
      $('#stage')?.classList.toggle('all-open', open);
      moment?.layout();
      return;
    }
    // A folded proof opens in place; the next step moves down to keep each pair level.
    const pm = e.target.closest('.pmore');
    if (pm) { const pr = pm.closest('.proof'); pr?.classList.add('open'); pm.hidden = true; moment?.layout(); return; }
    const longq = e.target.closest('#said-more');
    if (longq) { const q = $('#said-q'); const open = longq.getAttribute('aria-expanded') !== 'true'; longq.setAttribute('aria-expanded', String(open)); q.classList.toggle('whole', open); longq.textContent = open ? 'Show less of the message' : 'Show the whole message'; return; }
    const disc = e.target.closest('.disc');
    if (disc) {
      const open = disc.getAttribute('aria-expanded') !== 'true';
      disc.setAttribute('aria-expanded', String(open));
      const body = document.getElementById(disc.getAttribute('aria-controls')); if (body) body.hidden = !open;
      moment?.layout();
      return;
    }
    const step = e.target.closest('.lstep');
    if (step && !e.target.closest('a') && moment?.done) point(Number(step.dataset.i));
    if (e.target.closest('#game-go')) return game.begin();
    if (e.target.closest('#game-next')) return game.next();
    if (e.target.closest('#game-again')) return game.begin();
    const ch = e.target.closest('.choice'); if (ch && !ch.disabled) return game.answer(Number(ch.dataset.k));
  });
  // Pointing at a step (or its proof) makes the pair stand out, and a long proof opens.
  const over = (e) => { if (!moment?.done) return; const el = e.target.closest?.('.lstep, .proof'); if (el) point(Number(el.dataset.i)); };
  document.addEventListener('mouseover', over);
  document.addEventListener('focusin', (e) => { const s = e.target.closest?.('.lstep'); if (s && moment?.done) point(Number(s.dataset.i)); });
  addEventListener('resize', () => { if (moment?.done) moment.layout(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (demo.running || ($('#demo-skip2') && !moment?.done)) { demo.skip(); return; }
      if (moment && !moment.done && !$('#result').hidden) { moment.skip(); return; }
    }
    if ($('#view-practice').hidden) return;
    if (e.target.matches?.('textarea, input')) return;
    if (game.phase === 'ask' && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); game.answer(Number(e.key) - 1); return; }
    if (e.key === 'Enter' && game.locked() && e.target.closest?.('.choice, #game-next')) { e.preventDefault(); return; }
    if (game.phase === 'after' && e.key === 'Enter' && !e.target.closest?.('button, a')) { e.preventDefault(); game.next(); }
  });
}

(async () => {
  wire();
  setTech(store.get('sd-tech') === '1', false);
  for (const el of $$('[data-stamp]')) { el.dataset.tone = el.dataset.stamp; el.innerHTML = postmark(el.dataset.stamp, { date: Date.UTC(2026, 10, 15, 21) }); }
  route();
  const back0 = history.state?.r && location.hash !== '#practice' ? history.state : null;
  if (back0) start({ ...back0, instant: true, fromHistory: true, quiet: true });
  else if (demo.wanted()) demo.run();
  try {
    STATE = await api('/api/state');
    fillExamples();
    if (!STATE.mock) $('#sample-note').textContent = "A real Blotato account is connected. The desk only reads it. The help pages are Blotato's real ones.";
    if (document.body.classList.contains('tech-on')) techHome();
  } catch (e) {
    $('#sample-note').textContent = `The desk could not be reached: ${e.message}`;
  }
})();
