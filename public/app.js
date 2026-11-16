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
const T = { scroll: 520, firstHold: 160, line: 400, lineCap: 760, hold: 140, away: 340, settle: 420, proofIn: 360, wire: 200, word: 16, wordCap: 340, stepGap: 50, press: 170, nudge: 150 };
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
const plainWords = (s) => PLAIN.reduce((t, [re, to]) => t.replace(re, to), String(s ?? ''));
const both = (raw, plain = plainWords(raw)) => plain === raw ? esc(raw) : `<span class="plain-only">${esc(plain)}</span><span class="tech-only">${esc(raw)}</span>`;
const dash = (s) => String(s ?? '').replace(/\s+[\u2014\u2013]\s+/g, ', ').replace(/[\u2014\u2013]/g, ', ');

// Technical terms inside a letter or a quote: calls, paths, status codes, ids. Works on escaped text.
const STATUS = '(?:200|201|204|400|401|403|404|409|422|429|500|502|503|504)';
function termify(h) {
  const parts = [];
  const keep = (s) => { parts.push(s); return `\u0000${parts.length - 1}\u0000`; };
  let t = String(h);
  t = t.replace(/\b(?:GET|POST|PUT|PATCH|DELETE) (?:https?:\/\/[^\s<]+|\/[^\s<]+?)(?=[.,;:]?(?:\s|$|<))/g, (m) => keep(`<code class="term">${m}</code>`));
  t = t.replace(/https?:\/\/(?!help\.blotato\.com)[^\s<]+?(?=[.,;:)]?(?:\s|$|<))/g, (m) => keep(`<code class="term">${m}</code>`));
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
    .replace(/ \(((?:post|id) [\w-]+)\)/g, '<span class="tech-only postid"> ($1)</span>');
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
  'docs-silent': 'The help pages do not cover this yet, so the desk will not guess.',
  tie: 'The desk could not tell which of two questions this is, so it will not guess.',
  'partly-covered': 'The message asks more than one thing. The desk answers the part the help pages cover, and a person on the team takes the rest.',
  'not-english': 'The desk can only read English for now, so a person on the team will answer this one.',
  'no-coverage': 'None of Blotato\'s help pages answers this, so the desk will not guess.',
  nonsense: 'That does not look like a question about Blotato. Try asking about your posts, your account or your plan.',
};
const whyOf = (r) => r.route?.why || r.match?.why || null;
function whyPlain(r) {
  const w = whyOf(r); if (!w || !WHY_PLAIN[w]) return null;
  const d = r.route?.whyDetail || r.match?.whyDetail || null;
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

// ---------------------------------------------------------------- the stamp: a postmark, set in type, inked
let pmN = 0;
const STAMPS = {
  checked: { word: 'CHECKED', sub: 'SAFE TO SEND', ring: 'SUPPORT DESK \u2022 SECOND CHECKER \u2022 ', label: 'Checked by a second checker. Safe to send.' },
  stopped: { word: 'STOPPED', sub: 'DO NOT SEND', ring: 'SUPPORT DESK \u2022 SECOND CHECKER \u2022 ', label: 'Stopped by the second checker. Do not send.' },
  helped: { word: 'HELPED', sub: 'GOOD FIRST MOVE', ring: 'YOUR FIRST SHIFT \u2022 SUPPORT DESK \u2022 ', label: 'Helped. A good first move.' },
  oops: { word: 'OOPS', sub: 'NOT THIS TIME', ring: 'YOUR FIRST SHIFT \u2022 SUPPORT DESK \u2022 ', label: 'Oops. Not this time.' },
};
function centerOf(t) {
  const d = new Date(t);
  return [fmt(d, { month: 'short' }).toUpperCase(), String(d.getDate()), String(d.getFullYear())];
}
function postmark(kind, { date = null, center = null, word = null, label = null } = {}) {
  const s = { ...STAMPS[kind], ...(word ? { word } : {}) }; const id = `pm${++pmN}`;
  const [top, big, bottom] = center || centerOf(date || Date.now());
  const aria = label || s.label;
  return `<svg class="pm" viewBox="0 0 320 150" role="img" aria-label="${esc(aria)}">
    <defs><path id="${id}" d="M75 75 m-55 0 a55 55 0 1 1 110 0 a55 55 0 1 1 -110 0"/></defs>
    <g fill="none" stroke="currentColor"><circle cx="75" cy="75" r="67" stroke-width="5"/><circle cx="75" cy="75" r="44" stroke-width="2.4"/>
    <rect x="156" y="31" width="158" height="88" rx="10" stroke-width="5"/><rect x="164" y="39" width="142" height="72" rx="5" stroke-width="2.2"/></g>
    <g fill="currentColor">
    <text font-size="11.5" font-weight="800" letter-spacing="1.6"><textPath href="#${id}" textLength="342" lengthAdjust="spacingAndGlyphs">${esc(s.ring)}</textPath></text>
    <text x="75" y="${big.length > 2 ? 72 : 62}" text-anchor="middle" font-size="12.5" font-weight="800" letter-spacing="1.5">${esc(top)}</text>
    <text x="75" y="${big.length > 2 ? 90 : 93}" text-anchor="middle" class="serif" font-size="${big.length > 2 ? 17 : 34}" font-weight="700">${esc(big)}</text>
    <text x="75" y="${big.length > 2 ? 104 : 108}" text-anchor="middle" font-size="11" font-weight="800" letter-spacing="1.5">${esc(bottom)}</text>
    <text x="235" y="84" text-anchor="middle" font-size="34" font-weight="900" textLength="128" lengthAdjust="spacingAndGlyphs">${esc(s.word)}</text>
    <text x="235" y="102" text-anchor="middle" font-size="11.5" font-weight="800" textLength="${s.sub.length > 14 ? 128 : 104}" lengthAdjust="spacingAndGlyphs">${esc(s.sub)}</text>
    </g></svg>`;
}
// A round seal for the shift report and the desk tray. The ring says what it is, large enough to read.
function roundMark(right, n, small = false) {
  const id = `pm${++pmN}`;
  // Said once, large, so it reads at phone size.
  const ring = right ? `HELPED \u2022 LETTER ${n} \u2022 ` : `MISSED \u2022 LETTER ${n} \u2022 `;
  const glyph = right ? '<path d="M52 78 L69 95 L100 58" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M58 58 L92 92 M92 58 L58 92" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>';
  return `<svg viewBox="0 0 150 150" aria-hidden="true" data-tone="${right ? 'helped' : 'missed'}"><defs><path id="${id}" d="M75 75 m-50 0 a50 50 0 1 1 100 0 a50 50 0 1 1 -100 0"/></defs>
    <g fill="none" stroke="currentColor"><circle cx="75" cy="75" r="70" stroke-width="5"/><circle cx="75" cy="75" r="44" stroke-width="2.4"/></g>
    ${small ? '' : `<text fill="currentColor" font-size="21" font-weight="800" font-family="Source Sans 3, sans-serif"><textPath href="#${id}" textLength="306" lengthAdjust="spacing">${ring}</textPath></text>`}
    ${glyph}</svg>`;
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
  document.title = practice ? 'Practice game, Support Desk' : 'Support Desk';
  if (practice) { demo.cancel(); game.open(); }
}

function setTech(on, save = true) {
  document.body.classList.toggle('tech-on', on);
  for (const b of $$('[data-tech-switch]')) b.setAttribute('aria-checked', String(on));
  if (save) store.set('sd-tech', on ? '1' : '0');
  if (on) techHome();
  if (moment?.done) moment.rhythm();
}

// ---------------------------------------------------------------- the first screen
const whoOf = (from) => { const w = String(from || '').replace(/\s*\(made up\)\s*$/, ''); return w ? w[0].toUpperCase() + w.slice(1) : 'A customer'; };
const EXTRA = [
  { text: 'I canceled my plan last month but you charged me again. I want a refund.', who: 'A customer who wants their money back', writer: 'A customer' },
  { text: TRY_THIS, who: 'A creator, asking a new way', writer: 'A creator' },
  { text: 'Banana phone purple. Does it work on Tuesdays?', who: 'A message that makes no sense', writer: 'A customer' },
];
const FIRST = ['T02', 'T05', 'T04', 'T07'];
const DEV_ORDER = ['T11', 'T12', 'T10', 'T09', 'T06', 'T08', 'T03'];

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

function submit() {
  const raw = $('#msg').value;
  const text = raw.trim();
  if (!text) { $('#filled').textContent = 'Type or paste what the customer said first.'; $('#msg').focus(); return; }
  const same = picked && picked.text === raw;
  const body = same && picked.id ? { id: picked.id } : { text: text.slice(0, MAX) };
  start({ body, who: same ? picked.who : null, text: body.text || text });
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
  if (ev.kind === 'reproduce-schedule') return ev.missing ? 'There was nothing in the message the desk could try again.' : ev.ok ? 'The desk tried the same thing on the account and got the same error back.' : 'The desk tried the same thing and got a different answer back.';
  if (ev.kind === 'docs-search') return "The desk searched Blotato's help pages for the question.";
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
const sentenceHTML = (page) => { const x = sentence(page); return `${tq(x.pre)}<mark>${tq(x.mark)}</mark>${tq(x.post)}`; };
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
function rowHTML(row, quote) {
  const q = loose(quote);
  const cells = row.cells.map(c => loose(c) === q ? `<td><mark>${tq(c)}</mark></td>` : `<td>${tq(c)}</td>`);
  return `<table class="prow"><tbody><tr>${cells.join('')}</tr></tbody></table>`;
}

// One proof: the compact form that fits its row, the long form that opens when you point at it,
// and the page's name, small, beside the sentence.
function proofParts(step, r) {
  if (step.type === 'fact') {
    const p = step.page;
    const src = `${dash(p?.title || 'Help')} page`;
    if (p?.found && p.mark) {
      const cellHit = p.row && p.row.cells.some(c => loose(c) === loose(step.quote));
      if (p.code) return { kind: 'code', compact: codeHTML(p.code, step.quote, false), more: p.code.lines.length > (p.code.hit[1] - p.code.hit[0] + 1) ? codeHTML(p.code, step.quote, true) : '', src };
      if (cellHit) return { kind: 'row', compact: rowHTML(p.row, step.quote), more: '', src };
      const x = sentence(p);
      if (p.list) return { kind: 'sentence', compact: `<p class="px">${sentenceHTML(p)}<span class="src">${esc(src)}</span></p>`, more: `<ul class="plist">${p.list.map(i => `<li>${tq(i)}</li>`).join('')}</ul>`, src };
      const longer = x.pre.length + x.post.length + x.mark.length < p.text.replace(/^\.\.\.\s*|\s*\.\.\.$/g, '').length - 4;
      // The longer form replaces the sentence (it holds it), so nothing is said twice.
      return { kind: 'sentence', compact: `<p class="px">${sentenceHTML(p)}<span class="src">${esc(src)}</span></p>`, more: longer ? `<p class="px">${paragraphHTML(p)}<span class="src">${esc(src)}</span></p>` : '', replace: longer, src };
    }
    return { kind: 'sentence', compact: `<p class="px"><mark>${tq(step.quote)}</mark><span class="src">${esc(src)}</span></p>`, more: '', src };
  }
  if (step.type === 'evidence') {
    const search = r.evidence?.kind === 'docs-search';
    const src = search ? 'a search of the help pages' : 'their account';
    const at = (r.steps || []).indexOf(step);
    const first = (r.steps || []).findIndex(s => s.type === 'evidence');
    if (first >= 0 && first < at) return { kind: 'note', compact: `<p class="px">The same look at ${search ? 'the help pages' : 'their account'} as step ${first + 1}.<span class="src">${src}</span></p>`, more: '', src };
    return { kind: 'note', compact: `<p class="px">${esc(plainEvidence(r.evidence))}<span class="src">${src}</span></p>`, more: '', src };
  }
  const i = (r.steps || []).indexOf(step);
  const earlier = (r.steps || []).slice(0, i).some(s => s.type !== 'fact' && s.type !== 'evidence');
  const what = earlier ? 'The desk does this step itself too.'
    : r.escalation ? 'The desk does this step itself. It wrote a note for a person on the team, under the letter.'
      : 'The desk does this step itself, so there is no page to quote.';
  return { kind: 'note', compact: `<p class="px">${what}${earlier ? '' : '<span class="src">no page needed</span>'}</p>`, more: '', src: '' };
}

function proofHTML(step, i, r) {
  const n = i + 1;
  const cite = (r.check?.citations || []).find(c => c.step === n);
  const flagged = r.example?.plain?.names?.includes(n);
  const p = proofParts(step, r);
  const srcBeside = p.kind === 'code' || p.kind === 'row' ? `<p class="px"><span class="src">${esc(p.src)}</span></p>` : '';
  const tech = step.type === 'fact'
    ? `<p class="tech-only"><a href="${esc(step.url)}" target="_blank" rel="noopener">${esc(String(step.url).replace('https://', ''))}</a>${cite?.fetchedAt ? `, read ${esc(techTime(cite.fetchedAt))}` : ''}. ${cite ? (cite.found ? 'The quote is on the page.' : 'The quote is NOT on the page.') : ''}</p>`
    : step.type === 'evidence' ? `<p class="tech-only">${(r.evidence?.calls || []).map(c => `<code>${esc(cleanCall(c))}</code>`).join('<br>') || 'No call was made.'}</p>` : '';
  return `${flagged ? `<p class="flagline">The checker named step ${n}.</p>` : ''}<div class="cmp${p.replace ? ' swap' : ''}">${p.compact}${srcBeside}</div>${p.more ? `<div class="more-of">${p.more}</div>` : ''}${tech}`;
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
function noteHTML(r, own = true) {
  const e = r.escalation; if (!e) return '';
  const pn = PLAIN_NOTES[r.ticket?.id] || {};
  const li = (arr, plain = []) => `<ul>${arr.map((c, k) => { const x = splitCause(c); const body = plain[k] ? `<span class="plain-only">${esc(plain[k])}</span><span class="tech-only">${termify(esc(x.text))}</span>` : termify(both(x.text)); return `<li>${body}${x.tag ? ` <span class="src-tag">(${x.tag})</span>` : ''}</li>`; }).join('')}</ul>`;
  const why = String(e.why).replace(/this ticket/g, 'this message').replace(/\s*No entry is a candidate for this (?:message|ticket)\.?/g, '');
  const causes = (e.causes || []).filter(c => !/matcher's top candidates/.test(c));
  return `<section class="note" aria-labelledby="note-h">
    <h3 id="note-h">A person on the team needs to see this</h3>
    <p class="note-lead">The desk wrote this note for the person on the team who takes it next. ${own ? 'Copy it and pass it on.' : 'Copy it and pass it on, so the customer gets an answer.'}</p>
    <div class="letterish">
      <p>Hi,</p>
      <p>A customer wrote: <span class="cq">&ldquo;${esc(e.asked)}&rdquo;</span></p>
      <p><b>Why it needs you.</b> ${termify(both(why))}</p>
      <p><b>What I checked.</b> ${esc(plainChecked(r))}</p>
      ${causes.length ? `<p><b>What I think it is:</b></p>${li(causes, pn.causes)}` : '<p><b>What I think it is.</b> Not known yet. The help pages have no answer, so I will not guess.</p>'}
      ${(e.ruledOut || []).length ? `<p><b>What I ruled out:</b></p>${li(e.ruledOut, pn.ruledOut)}` : ''}
    </div>
    <button type="button" class="btn-quiet" data-copy="sabrina">Copy the note</button><span class="copied" data-copied="sabrina" aria-live="polite"></span>
  </section>`;
}

// A proposed help-page edit, shown as the page itself: struck words, added words lit. Never a diff block.
function docEditHTML(r) {
  const d = r.docEdit; if (!d || !r.entry) return '';
  const rawTitle = d.page?.title || d.article.replace(/^https:\/\/help\.blotato\.com\//, '');
  let sheet;
  if (d.kind === 'change') {
    const p = d.page;
    if (p?.code) {
      const [a, b] = p.code.hit;
      // The few whole lines around the change, not the whole example.
      const from = Math.max(0, a - 3); const to = Math.min(p.code.lines.length - 1, b + 3);
      const lines = p.code.lines.map((l, k) => {
        if (k < from || k > to) return null;
        if (k < a || k > b) return esc(l);
        const at = l.indexOf(String(d.before).trim());
        if (at < 0) return `<span class="cut">${esc(l)}</span>`;
        const ind = l.slice(0, at);
        return `${esc(ind)}<span class="cut">${esc(String(d.before).trim())}</span>\n${esc(ind)}<span class="added">${esc(String(d.after).trim())}</span>${esc(l.slice(at + String(d.before).trim().length))}`;
      });
      const shown = lines.filter(l => l !== null);
      const gap = '<span class="dimline">⋮</span>';
      sheet = `${p.heading ? `<p class="sub">From the part called “${esc(dash(p.heading))}”</p>` : ''}<pre class="pcode">${from > 0 ? `${gap}\n` : ''}${shown.join('\n')}${to < p.code.lines.length - 1 ? `\n${gap}` : ''}</pre><div class="added-block">${tq(d.add)}</div>`;
    } else {
      const ctx = p?.found && p.mark
        ? (() => { const t = p.text; const [s, e] = p.mark; let a = Math.max(0, s - 60); let z = Math.min(t.length, e + 90); if (a > 0) a = t.indexOf(' ', a) + 1 || a; if (z < t.length) z = t.lastIndexOf(' ', z) > e ? t.lastIndexOf(' ', z) : z; return `${tq(t.slice(a, s))}<span class="cut">${tq(t.slice(s, e))}</span> <span class="added">${tq(d.after)}</span>${tq(t.slice(e, z))}`; })()
        : `<span class="cut">${tq(d.before)}</span> <span class="added">${tq(d.after)}</span>`;
      sheet = `<p class="ctx">${ctx}</p><div class="added-block">${tq(d.add)}</div>`;
    }
  } else {
    sheet = `<div class="added-block"><b>${both(d.heading)}</b>${both(String(d.add).replace(/^\[|\]$/g, ''))}</div>`;
  }
  const heading = d.kind === 'change' ? 'A help page needs a fix' : "The help pages don't cover this yet";
  const lead = d.kind === 'change'
    ? `The desk found a help page that leads people the wrong way. Here is the page with the change it suggests. A person on the team decides if it goes in.`
    : `The desk suggests a new part for this help page. A person on the team writes the answer and decides if it goes in.`;
  return `<section class="note doc" aria-labelledby="doc-h">
    <h3 id="doc-h">${heading}</h3>
    <p class="note-lead">${lead}</p>
    <div class="page-sheet"><p class="ttl">${both(dash(rawTitle))}</p>${sheet}</div>
    <p class="red-note">Crossed out: what the desk would take away. In yellow: what it would add. Nothing changes on the real help page until a person does it.</p>
  </section>`;
}

const SECOND = 'The second checker is a fresh AI that has not seen the desk\'s work. It read the reply with only the help pages beside it. Before that, the desk checked that every yellow sentence is really on its help page.';
function verdictHTML(r, st) {
  const f = r.fresh || {};
  const at = f.checkedAt ? dayAt(f.checkedAt) : '';
  if (st === 'checked') {
    const notes = (f.notes || []).length;
    return `<p class="verdict" style="--tone: var(--pass)"><b>Checked. Safe to send.</b>A second checker read this exact reply${at ? ` on ${esc(at)}` : ''} and found no mistakes. The desk found this answer live just now. The second check was done earlier, on these exact words.<span class="how-checked">${SECOND}${notes ? ` It left ${notes === 1 ? 'one small note' : `${notes} small notes`}, which the details for engineers show.` : ''}</span></p>`;
  }
  if (st === 'stopped') {
    const plain = r.example?.plain;
    const why = plain?.why || f.why || (r.check.problems || [])[0] || '';
    const more = plain?.more || [];
    return `<div class="verdict" style="--tone: var(--block)"><b>Stopped. Do not send this one.</b>A second checker read this exact reply${at ? ` on ${esc(at)}` : ''} and found a mistake. ${esc(why)}${more.length ? `<ul>${more.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div>`;
  }
  if (st === 'saved') return '<p class="verdict" style="--tone: var(--draft)"><b>Not checked in this form.</b>This reply changed after it was checked. Have it checked again before you send it.</p>';
  if (st === 'refused') return '';
  return '<p class="verdict" style="--tone: var(--draft)"><b>Not checked yet.</b>No second checker has read this reply yet. Read it yourself before you send it.</p>';
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
    if (e.t === 'call') return `<li><span class="what"><code>${esc(e.method)} ${esc(decodeURIComponent(e.path))}</code></span><span class="meta">HTTP ${esc(e.status ?? 'none')}${e.error ? `, ${esc(e.error)}` : ''}, ${e.ms} ms${r.mock ? ', sample data' : ''}</span></li>`;
    return '';
  }).join('');
  const steps = (r.steps || []).map((s, i) => {
    const c = (r.check?.citations || []).find(x => x.step === i + 1);
    const what = s.type === 'fact' ? `Quote from <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(String(s.url).replace('https://', ''))}</a>` : s.type === 'evidence' ? 'From the account' : 'An action the desk takes';
    return `<li><span class="what">Step ${i + 1}. ${what}</span><span class="meta">${s.quote ? `<code>${esc(s.quote)}</code>` : esc(s.type === 'evidence' ? cleanCall(r.evidence?.summary || '') : 'No page to quote.')}${c ? ` ${c.found ? 'Found on the page' : 'NOT found on the page'}${c.fetchedAt ? `, page read ${esc(techTime(c.fetchedAt))}` : ''}.` : ''}</span></li>`;
  }).join('');
  const findings = f.findings || f.notes || [];
  const ex = r.example;
  const searched = (r.evidence?.searched || []).filter(q => !q.offline).map(q => `<li><span class="what">"${esc(q.query)}"</span><span class="meta">${q.results.slice(0, 4).map(x => esc(x.title || x.url)).join(', ') || 'no results'}</span></li>`).join('');
  const fstate = { passed: `Passed this exact text${f.checkedAt ? ` on ${esc(techTime(f.checkedAt))}` : ''}.`, blocked: `Stopped this exact text${f.checkedAt ? ` on ${esc(techTime(f.checkedAt))}` : ''}.`, 'passed-saved': `Passed an earlier copy${f.checkedAt ? ` on ${esc(techTime(f.checkedAt))}` : ''}. Today's account lookup changed some words, so this text has not been read.`, stale: 'Its verdict is for an older text.', none: 'Not read yet.' }[f.state || 'none'] || 'Not read yet.';
  return `<section class="tech" aria-labelledby="tech-h">
    <h2 id="tech-h">Details for engineers</h2>
    <dl class="kv">
      <dt>Account data</dt><dd>${r.mock ? 'Sample data, no account connected' : 'Live, read-only'}</dd>
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
function shellHTML(meta, r) {
  const st = stateOf(r);
  const line = r.example ? PLAIN_STOPPED : (r.ticket?.id && PLAIN_LINES[r.ticket.id]) || null;
  const person = st !== 'refused' && !line ? personReason(r) : null;
  return `<div class="result-in" id="result-in">
    <div class="said">
      <div><blockquote id="said-q">${esc(meta.text)}</blockquote><p class="by">${esc(meta.who ? `${meta.who} wrote this.` : 'The customer wrote this.')}</p></div>
      <div class="said-btns">
        ${meta.demo ? '' : '<button type="button" class="btn-quiet back" id="back">New message</button>'}
        ${meta.demo ? '' : '<button type="button" class="skip-btn" id="skip-btn">Skip to the answer</button>'}
      </div>
    </div>
    ${meta.demo ? `<div class="demo-bar" id="demo-bar"><p id="demo-say"><b>Watch the desk answer an example.</b> It finds the answer live. The second check was done earlier, on these exact words.</p><button type="button" class="btn quiet" id="demo-skip2">Skip the example</button></div>` : ''}
    ${meta.example ? '<p class="example-tag">A saved example from Nov 15: the desk\'s first reply to this message. The second checker stopped it, and the desk was fixed.</p>' : ''}
    <div class="did-row"><ol class="did" id="did" aria-label="What the desk did"></ol></div>
    ${line ? `<p class="plainline"><b>In plain words:</b> ${esc(line)}</p>` : ''}
    ${person ? `<p class="plainline person"><b>A person on the team takes this one.</b> ${esc(person)}</p>` : ''}
    <div class="stage" id="stage"></div>
    <div id="after"></div>
  </div>`;
}

// The letter and its proofs: one grid row per step (wide), or each step then its proof (phone).
function stageHTML(r) {
  const st = stateOf(r);
  if (st === 'refused') {
    const cands = (r.route?.candidates || []).filter(c => c.title && c.phrasing).slice(0, 3);
    return { cls: 'single refusal', rows: 2, rowsN: 2, html: `
      <div class="paper"></div>
      <div class="lh" style="--r:1;--rn:1">
        <h2 id="letter-h">${esc(refusalTitle(r))}</h2>
        <p class="rr unw" data-write>${esc(refusalReason(r))}${guessing(r) ? ' A wrong answer can hurt a customer more than a slow one.' : ''}</p>
        <p class="rr unw" data-write><b>What the desk knows.</b> It can answer questions about posting, scheduling, accounts, plans and error messages.</p>
        ${cands.length ? `<p class="rr unw" data-write><b>Did they mean one of these?</b></p><div class="chips away" data-pop>${cands.map(c => `<button type="button" class="chip" data-ask="${esc(c.phrasing)}">${esc(dash(c.title))}</button>`).join('')}</div>` : ''}
        <p class="rr unw" data-write><b>Try a message like this one.</b></p>
        <button type="button" class="try away" data-pop data-ask="${esc(TRY_THIS)}"><span class="q" aria-hidden="true">&ldquo;</span><span>${esc(TRY_THIS)}</span><span class="hint">Press to try it</span></button>
        <p class="rr unw" data-write><b>Who gets it next.</b> A person on the support team. The desk wrote them a note with what it looked for. You can read it below.</p>
      </div>
      <div class="ltail" style="--r:2;--rn:2"><div class="actions refusal-actions away" data-pop><button type="button" class="btn" id="reword-btn">Say it another way</button></div></div>` };
  }
  const seal = sealOf(st);
  const stamp = seal ? `<div class="stamp away" data-tone="${seal}">${postmark(seal, { date: r.fresh?.checkedAt, label: `${STAMPS[seal].label}${r.fresh?.checkedAt ? ` Read on ${dayAt(r.fresh.checkedAt)}.` : ''}` })}</div>` : '';
  const { head, tail } = letterParts(r.reply);
  const steps = r.steps || [];
  const flags = r.example?.plain?.names || [];
  const n = steps.length;
  const title = r.outcome === 'no-answer' ? 'Here is a reply for now' : 'Here is the answer';
  const [hi, ...rest] = /^Hi\b/.test(head[0] || '') ? head : ['', ...head];
  const rows = steps.map((s, i) => {
    const fl = flags.includes(i + 1) ? ' flag' : '';
    const r1 = i + 2; const rn = 2 + i * 2;
    return `<div class="lstep${fl}" id="step-${i + 1}" data-i="${i}" tabindex="0" aria-describedby="proof-${i + 1}" style="--r:${r1};--rn:${rn}"><span class="num" aria-hidden="true">${i + 1}</span><span class="txt unw ruled" data-write><span class="sr-only">Step ${i + 1}. </span>${letterText(s.text)}</span></div>
      <i class="wire away${fl}" data-i="${i}" aria-hidden="true" style="--r:${r1}"><i></i></i>
      <div class="proof away${fl}" id="proof-${i + 1}" data-i="${i}" style="--r:${r1};--rn:${rn + 1}">${proofHTML(s, i, r)}</div>`;
  }).join('');
  return { cls: '', rows: n + 2, rowsN: n * 2 + 2, html: `
    <div class="paper"></div>
    <div class="lh" style="--r:1;--rn:1">${stamp}<h2 id="letter-h">${title}</h2>${hi ? `<p>${letterText(hi)}</p>` : ''}<div class="head unw" data-write>${rest.map(p => `<p>${letterText(p)}</p>`).join('')}</div></div>
    <div class="mh unw" data-write style="--r:1"><h2>How do we know?</h2><p>Each step's proof sits beside it, and the small words name its help page. Point at a step to light it up.</p><button type="button" class="link page-toggle" aria-expanded="false">Show more of each page</button></div>
    ${rows}
    <div class="ltail unw" data-write style="--r:${n + 2};--rn:${n * 2 + 2}">${tailHTML(tail, r)}</div>` };
}

function closingHTML(r, st) {
  const single = st === 'refused';
  let actions = '';
  if (st === 'stopped') {
    actions = `<button type="button" class="btn" id="fixed-btn">See the fixed reply</button>
      <p class="why-line">The desk never sends anything, and it will not let you copy a reply the checker stopped.</p>`;
  } else if (!single) {
    actions = `<button type="button" class="btn" data-copy="reply">Copy the reply</button><span class="copied" data-copied="reply" aria-live="polite"></span>
      <p class="why-line">The desk never sends anything. You copy the reply and send it yourself.</p>`;
  }
  const notes = `${noteHTML(r, !single)}${docEditHTML(r)}`;
  return `<div class="closing${single ? ' single' : ''}">${verdictHTML(r, st)}${actions ? `<div class="actions">${actions}</div>` : ''}</div>
    ${notes ? `<div class="notes">${notes}</div>` : ''}
    ${techHTML(r)}`;
}

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
        if (ch.matches('code, mark, a, b, button, .src')) { if (!ch.querySelector('.w')) { ch.classList.add('w'); } }
        else walk(ch);
      }
    }
  };
  walk(el);
  return $$('.w', el);
}

class Moment {
  constructor(meta) {
    this.meta = meta; this.result = null;
    this.skipped = false; this.dead = false; this.done = false; this.instant = reduced.matches || !!meta.instant; this.anims = []; this.waiters = new Set();
    this.t0 = performance.now(); this.marks = {};
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
  el(sel) { return this.dead ? null : $(sel, this.root); }

  tick(key, state, text) {
    if (this.dead) return;
    const list = $('#did', this.root); if (!list) return;
    let li = $(`li[data-k="${key}"]`, list);
    if (!li) { li = document.createElement('li'); li.dataset.k = key; li.innerHTML = '<span class="g" aria-hidden="true"></span><span class="w"></span>'; list.append(li); }
    li.dataset.s = state;
    $('.g', li).textContent = { done: '\u2713', wait: '', stop: '\u2715', needs: '\u2192', neutral: '', pending: '' }[state];
    if (text) $('.w', li).textContent = text;
  }

  // Write an element's words onto its line, one after another. Nothing fades.
  async write(el, { per = T.word, cap = T.wordCap } = {}) {
    if (!el || this.dead) return;
    const ws = words(el).filter(w => w.getClientRects().length);
    const done = () => { el.classList.remove('unw', 'ruled'); };
    if (this.fast || !ws.length) { done(); return; }
    el.classList.remove('ruled');
    const step = Math.min(per, cap / ws.length);
    const start = performance.now();
    await new Promise(res => {
      const tickf = () => {
        if (this.dead) return res();
        if (this.skipped) { done(); return res(); }
        const k = Math.min(ws.length, 1 + Math.floor((performance.now() - start) / step));
        for (let j = 0; j < k; j++) ws[j].classList.add('v');
        if (k >= ws.length) { done(); return res(); }
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

  // Even spacing between steps (wide screens): every step gets the same gap, large enough for its proof.
  rhythm() {
    const stage = $('#stage', this.root); if (!stage || !wide() || stage.classList.contains('single')) { stage?.style.removeProperty('--gap'); return; }
    let need = 0;
    for (const s of $$('.lstep', stage)) {
      const p = $(`.proof[data-i="${s.dataset.i}"]`, stage); if (!p) continue;
      const txt = $('.txt', s);
      const sh = txt.getBoundingClientRect().height + 10;
      const ph = [...p.children].filter(c => getComputedStyle(c).display !== 'none').reduce((a, c) => a + c.getBoundingClientRect().height, 0) + 24;
      need = Math.max(need, ph - sh);
    }
    // One gap for every step. With every page opened (a reading mode the viewer chose) each row takes its proof's height.
    if (stage.classList.contains('all-open')) { stage.style.setProperty('--gap', '28px'); return; }
    stage.style.setProperty('--gap', `${Math.round(Math.min(60, Math.max(28, need + 6)))}px`);
  }

  // The help page the desk read, lying beside the letter: its sentence sits exactly where its proof will rest.
  sheet(i) {
    const stage = $('#stage', this.root);
    const proof = $(`.proof[data-i="${i}"]`, stage);
    const step = this.result.steps[i]; const p = step.page;
    const target = $('.px, .pcode, .prow', proof);
    if (!target) return null;
    const W = wide(); const k = W ? 1.18 : 1;
    const sr = stage.getBoundingClientRect(); const tr = target.getBoundingClientRect();
    const s = document.createElement('div');
    s.className = 'sheet'; s.setAttribute('aria-hidden', 'true');
    const x = p.found && p.mark ? sentence(p) : { pre: '', mark: step.quote, post: '' };
    const [s0] = p.mark || [0];
    const cut = p.found && p.mark ? p.text.slice(0, s0).length - x.pre.length : 0;
    const before = W && p.found && !this.noBefore ? wholeSentences(`${p.before || ''} ${p.text.slice(0, cut)}`, 150, true) : '';
    const after = p.found ? wholeSentences(`${p.text.slice(s0 + x.mark.length + x.post.length)} ${p.after || ''}`, W ? 170 : 110, false) : '';
    const tw = tr.width; const th = tr.height;
    s.innerHTML = `<div class="sh-top"><p class="sh-title">${both(dash(p.title || 'Help page'))}</p><span class="sh-site">Blotato help</span></div>${p.heading ? `<p class="sh-head">${both(dash(p.heading))}</p>` : ''}${before ? `<p class="sh-ctx">${tq(before)}</p>` : ''}<div class="slot" style="width:${tw * k}px;height:${th * k}px;position:relative"></div>${after ? `<p class="sh-ctx sh-after">${tq(after)}</p>` : ''}`;
    // The strip is a copy of the proof's own sentence, at the same width, so nothing rewraps when it lands.
    const strip = document.createElement('div');
    strip.className = 'strip';
    strip.innerHTML = target.outerHTML;
    for (const src of $$('.src', strip)) src.style.visibility = 'hidden';
    strip.style.cssText = `position:absolute;left:0;top:0;width:${tw}px;transform:scale(${k});transform-origin:0 0;`;
    if (proof.classList.contains('flag')) strip.classList.add('flag');
    $('.slot', s).append(strip);
    s.style.visibility = 'hidden';
    s.style.width = `${tw * k + (W ? 48 : 28)}px`;
    stage.append(s);
    const slot = $('.slot', s).getBoundingClientRect(); const box = s.getBoundingClientRect();
    const offX = slot.left - box.left; const offY = slot.top - box.top;
    let left = (tr.left - sr.left) - offX - (W ? 10 : 0);
    let top = (tr.top - sr.top) - offY - (th * k - th) / 2;
    if (top < 0) { const h = $('.sh-ctx', s); if (h && !h.classList.contains('sh-after')) { h.remove(); return this.sheetRetry(s, i); } top = 0; }
    s.style.left = `${left}px`; s.style.top = `${top}px`;
    s.style.visibility = '';
    this.strip = strip; this.target = target; this.k = k;
    return s;
  }
  sheetRetry(s, i) { s.remove(); this.noBefore = true; return this.sheet(i); }

  // The page is put away to the right, as one piece. The sentence stays and settles into its place.
  async putAway(sheet, i) {
    const stage = $('#stage', this.root);
    const proof = $(`.proof[data-i="${i}"]`, stage);
    const strip = this.strip; const target = this.target;
    const sr = stage.getBoundingClientRect();
    const a = strip.getBoundingClientRect(); const b = target.getBoundingClientRect();
    // Lift the strip out of the page without moving it on screen.
    const rot = wide() ? -0.6 : 0;
    stage.append(strip);
    strip.style.left = `${b.left - sr.left}px`; strip.style.top = `${b.top - sr.top}px`;
    strip.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px) rotate(${rot}deg) scale(${this.k})`;
    strip.style.zIndex = '9';
    const off = innerWidth - sheet.getBoundingClientRect().left + 40;
    this.mark('away');
    const from = getComputedStyle(sheet).transform; const base = from === 'none' ? '' : from;
    const going = this.anim(sheet, [{ transform: base || 'none' }, { transform: `translateX(${off}px) ${base} rotate(2deg)` }], { duration: T.away, easing: EASE_IN, fill: 'forwards' });
    await this.wait(110);
    const settling = this.anim(strip, [{ transform: strip.style.transform }, { transform: 'none' }], { duration: T.settle, easing: 'cubic-bezier(.3, 0, .1, 1)', fill: 'forwards' });
    await Promise.all([going, settling]);
    sheet.remove(); strip.remove();
    if (this.dead) return;
    proof.classList.remove('away');
    this.mark('settled');
  }

  // A proof slides in from the right edge, along its own row, with its highlight already on.
  async proofIn(proof) {
    if (!proof) return;
    proof.classList.remove('away');
    if (this.fast) return;
    const r = proof.getBoundingClientRect();
    await this.anim(proof, [{ transform: `translateX(${innerWidth - r.left + 30}px)` }, { transform: 'none' }], { duration: T.proofIn, easing: EASE_OUT });
  }
  async wireIn(i) {
    const w = $(`.wire[data-i="${i}"]`, this.root); if (!w) return;
    w.classList.remove('away');
    await this.anim($('i', w), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: T.wire, easing: EASE_MARK });
  }

  // The seal is pressed: a shadow comes down, the ink is there on contact, the paper gives a little.
  async press(stamp, rot) {
    if (!stamp) return;
    if (this.fast) { stamp.classList.remove('away'); return; }
    const shade = document.createElement('div');
    const r = stamp.getBoundingClientRect(); const pr = stamp.offsetParent.getBoundingClientRect();
    shade.style.cssText = `position:absolute;left:${r.left - pr.left}px;top:${r.top - pr.top}px;width:${r.width}px;height:${r.height}px;border-radius:40%;background:radial-gradient(closest-side, rgba(25,30,45,.22), rgba(25,30,45,0));pointer-events:none;z-index:5;`;
    stamp.offsetParent.append(shade);
    await this.anim(shade, [{ transform: 'scale(1.35)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 150, easing: EASE_IN, fill: 'forwards' });
    shade.remove();
    stamp.classList.remove('away');
    this.mark('stampLanded');
    this.anim(stamp, [{ transform: `rotate(${rot}deg) scale(1.035)` }, { transform: `rotate(${rot}deg) scale(1)` }], { duration: T.press, easing: 'cubic-bezier(.2,.8,.3,1)' });
    await this.anim($('#stage', this.root), [{ transform: 'none' }, { transform: 'translateY(3px)' }, { transform: 'none' }], { duration: T.nudge, easing: 'ease-out' });
  }

  build(r) {
    this.result = r;
    const st = stateOf(r);
    const root = this.root;
    const stage = $('#stage', root);
    const built = stageHTML(r);
    stage.className = `stage ${built.cls}`.trim();
    stage.innerHTML = built.html;
    $('.paper', stage).style.setProperty('--rows', built.rows); $('.paper', stage).style.setProperty('--rowsn', built.rowsN);
    // Every line of work this answer shows has its place now, in order, with its final words.
    const trace = r.trace || [];
    const pages = new Set(trace.filter(e => e.t === 'page').map(e => e.url)).size;
    const searched = trace.some(e => e.t === 'search');
    const called = trace.some(e => e.t === 'call');
    const f = r.fresh || {};
    this.texts = {
      read: pages ? (pages === 1 ? "Read Blotato's help page" : `Read ${pages} of Blotato's help pages`) : searched ? "Looked through Blotato's help pages" : 'No help page was needed',
      account: 'Looked at their account',
      write: st === 'refused' ? 'Wrote no reply. It will not guess.' : `Wrote ${(r.steps || []).length} steps`,
      check: { checked: `A second checker passed it${f.checkedAt ? `, ${day(f.checkedAt)}` : ''}`, stopped: 'A second checker stopped it', saved: 'Changed after its second check', draft: 'No second check yet', refused: 'A person on the team will take it' }[st],
    };
    this.tick('read', 'pending', this.texts.read);
    if (called && st !== 'refused') this.tick('account', 'pending', this.texts.account);
    this.tick('write', 'pending', this.texts.write);
    this.tick('check', 'pending', this.texts.check);
    // Every word that will be written is split now, so it holds its place and is not seen until it is written.
    if (!this.instant) for (const el of $$('[data-write]', stage)) words(el);
    this.rhythm();
  }

  async play(r) {
    const root = this.root;
    const stage = $('#stage', root);
    const st = stateOf(r);
    const steps = r.steps || [];
    const called = (r.trace || []).some(e => e.t === 'call');
    if (this.fast) return this.finish();
    stage.classList.add('moving');
    const firstFact = st === 'refused' ? -1 : steps.findIndex(s => s.type === 'fact' && s.page?.found && s.page.mark);
    // Wide screens: the help page lies in the margin, its sentence exactly where the proof will rest.
    // Phones: there is no margin, so the proof itself arrives under its step and is lit there.
    const sheet = firstFact >= 0 && wide() ? this.sheet(firstFact) : null;
    const firstProof = firstFact >= 0 && !sheet ? $(`.proof[data-i="${firstFact}"]`, stage) : null;
    const firstMark = firstProof ? $('mark', firstProof) : null;
    if (firstMark) firstMark.style.backgroundSize = '0% 100%';
    this.tick('read', 'wait', this.texts.read.replace(/^Read /, 'Reading ').replace(/^Looked through/, 'Looking through'));
    say('The desk is working on the answer.');
    await this.scrolling;
    this.mark('frame');
    if (this.dead) return;
    await this.wait(T.firstHold);
    // The greeting is written while the desk reads, on the letter's own side.
    const head = st === 'refused' ? null : this.write($('.head', stage), { per: 15, cap: 260 });

    if (sheet) {
      this.mark('sweep');
      await this.sweep($('mark', this.strip));
      this.tick('read', 'done', this.texts.read);
      await this.wait(T.hold);
      await this.putAway(sheet, firstFact);
    } else if (firstProof) {
      await this.proofIn(firstProof);
      this.mark('sweep');
      await this.sweep(firstMark);
      this.tick('read', 'done', this.texts.read);
      this.mark('settled');
      await this.wait(T.hold);
    } else {
      await this.wait(240);
      this.tick('read', 'done', this.texts.read);
    }
    await head;
    if (this.dead) return;

    if (st === 'refused') {
      this.tick('write', 'stop');
      for (const el of $$('[data-write], [data-pop]', stage)) {
        if (el.hasAttribute('data-pop')) { el.classList.remove('away'); continue; }
        await this.write(el, { per: 14, cap: 360 });
        await this.wait(40);
      }
      this.tick('check', 'needs');
      return this.finish();
    }

    this.write($('.mh', stage), { per: 12, cap: 240 });
    for (let i = 0; i < steps.length; i++) {
      if (this.dead) return;
      const pr = $(`.proof[data-i="${i}"]`, stage);
      const row = $(`.lstep[data-i="${i}"]`, stage);
      if (steps[i].type === 'evidence' && called) this.tick('account', 'wait', 'Looking at their account');
      // The proof comes in along its own row with its highlight on; the step is written from it.
      const coming = i !== firstFact ? this.proofIn(pr) : null;
      pr.classList.add('on'); row.classList.add('on');
      $(`.wire[data-i="${i}"]`, stage)?.classList.add('on');
      if (coming) await this.wait(T.proofIn * 0.55);
      const wired = this.wireIn(i);
      await this.write($('.txt', row));
      await Promise.all([coming, wired]);
      if (steps[i].type === 'evidence' && called) this.tick('account', 'done', this.texts.account);
      await this.wait(T.stepGap);
      if (!this.done) { row.classList.remove('on'); pr.classList.remove('on'); $(`.wire[data-i="${i}"]`, stage)?.classList.remove('on'); }
    }
    await this.write($('.ltail', stage), { per: 6, cap: 240 });
    this.tick('write', 'done');
    await this.wait(80);

    const seal = sealOf(st);
    const stamp = $('.stamp', stage);
    this.mark('stampStart');
    if (seal) await this.press(stamp, wide() ? -7 : -6);
    this.tick('check', { checked: 'done', stopped: 'stop', saved: 'neutral', draft: 'neutral' }[st]);
    await this.wait(120);
    this.finish();
  }

  finish() {
    if (this.dead) return;
    const r = this.result; const root = this.root; const stage = $('#stage', root);
    this.done = true;
    this.mark('done');
    stage.classList.remove('moving');
    for (const el of $$('.unw', root)) el.classList.remove('unw', 'ruled');
    for (const el of $$('.ruled', root)) el.classList.remove('ruled');
    for (const el of $$('.away', root)) el.classList.remove('away');
    for (const m of $$('mark', root)) m.style.backgroundSize = '';
    for (const el of $$('.sheet, .strip', root)) el.remove();
    const st = stateOf(r);
    for (const k of ['read', 'account', 'write', 'check']) {
      const li = $(`#did li[data-k="${k}"]`, root); if (!li) continue;
      if (li.dataset.s === 'pending' || li.dataset.s === 'wait') this.tick(k, k === 'write' && st === 'refused' ? 'stop' : k === 'check' ? { checked: 'done', stopped: 'stop', saved: 'neutral', draft: 'neutral', refused: 'needs' }[st] : 'done', this.texts[k]);
    }
    $('#after', root).innerHTML = closingHTML(r, st);
    const sk = $('#skip-btn', root); if (sk) sk.style.visibility = 'hidden';
    this.rhythm();
    point(Math.max(0, (r.steps || []).findIndex(s => s.type === 'fact')));
    const words2 = { checked: 'Checked. Safe to send.', saved: 'Here is the reply. It changed after it was checked, so have it checked again before you send it.', draft: 'Here is a reply. No second checker has read it yet.', stopped: 'Stopped by the second checker. Do not send it.', refused: 'The desk did not write a reply. A person on the team will take it.' }[st];
    say(`${words2}${r.escalation && st !== 'refused' ? ' This one also goes to a person on the team.' : ''}`);
    window.__lastMoment = this.marks;
    if (this.meta.demo) return demo.done();
    if (this.meta.quiet) return;
    const main = $('#after [data-copy="reply"]', root) || $('#fixed-btn', root) || $('#reword-btn', root);
    main?.focus({ preventScroll: true });
  }

  fail(message) {
    if (this.dead) return;
    this.done = true;
    this.mark('done');
    this.tick('read', 'stop', 'The desk could not finish this one');
    const sk = $('#skip-btn', this.root); if (sk) sk.style.visibility = 'hidden';
    $('#after', this.root).innerHTML = `<div class="closing"><p class="verdict" style="--tone: var(--block)"><b>Something went wrong.</b>${esc(message)}</p><div class="actions"><button type="button" class="btn" data-again>Try again</button></div></div>`;
    say('The desk could not finish this one.');
    window.__lastMoment = this.marks;
    $('#after [data-again]', this.root)?.focus();
  }
}

// The box rises and becomes the customer's quote. Everything moves as one column, the way paper scrolls,
// so nothing passes over anything else. The first screen's heading goes up and out under the menu.
function showShell(m, meta, r) {
  const ask = $('#ask');
  const animate = !m.instant && !ask.hidden;
  const box = $('#msg').getBoundingClientRect();
  const h1 = $('.ask-main h1').getBoundingClientRect();
  const ghostHTML = animate ? `<h1>${$('.ask-main h1').innerHTML}</h1><p class="lede">${$('.ask-main .lede').innerHTML}</p>` : '';
  const ghostW = $('.ask-main').getBoundingClientRect().width;
  ask.hidden = true;
  const res = $('#result');
  res.hidden = false;
  res.innerHTML = shellHTML(meta, r);
  m.root = $('#result-in', res);
  scrollTo(0, 0);
  m.build(r);
  m.scrolling = Promise.resolve();
  if (!animate) return;
  const q = $('#said-q', res).getBoundingClientRect();
  const dy = (box.top + 4) - q.top;
  if (dy <= 0 || dy > 1400) return;
  const inner = m.root; const ir = inner.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'ghost-ask'; ghost.setAttribute('aria-hidden', 'true');
  ghost.innerHTML = ghostHTML;
  ghost.style.cssText = `left:${h1.left - ir.left}px;top:${(h1.top - box.top) + (q.top - ir.top) - 4}px;width:${ghostW}px;`;
  inner.prepend(ghost);
  m.scrolling = m.anim(inner, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: T.scroll, easing: 'cubic-bezier(.22, .9, .3, 1)' }).then(() => ghost.remove());
}

// Ask the desk. The answer comes back first, so every part of the stage has its real place before anything moves.
async function fetchLive(body) {
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
          if (ev.t === 'result') result = ev.result; else if (ev.t === 'error') error = ev.message; else if (ev.t !== 'start') events.push(ev);
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
  let slow = null;
  if (onAsk && !instant) { btn.classList.add('pressed'); slow = setTimeout(() => { if (my === asking) { btn.textContent = 'Reading the help pages...'; } }, 400); }
  const got = example ? await api('/api/example/stopped').then(r => ({ result: r }), e => ({ error: e.message })) : await fetchLive(body);
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
  moment?.stop(); moment = null; asking++;
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
    $('#filled').textContent = 'Watch: an example is going in the box.';
    await sleep(700);
    if (!this.running) return;
    btn.setAttribute('aria-pressed', 'true');
    this.typing = true;
    const box = $('#msg');
    for (let i = 1; i <= text.length && this.running; i += 2) { box.value = text.slice(0, i); await sleep(18); }
    this.typing = false;
    if (!this.running) return; // skipped while typing: the box stays as the skip left it
    box.value = text;
    pick(btn, { focus: false });
    $('#filled').textContent = 'That is the message. Now the desk answers it.';
    await sleep(1200);
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
    const was = this.running || !!$('#demo-bar');
    this.cancel();
    if (!was) return;
    if (!$('#result').hidden) back(); else { $('#msg').value = ''; picked = null; for (const b of $$('.tries-list button')) b.setAttribute('aria-pressed', 'false'); $('#filled').textContent = ''; $('#msg').focus({ preventScroll: true }); }
  },
  done() {
    const bar = $('#demo-bar'); if (!bar) return;
    $('#demo-say').innerHTML = '<b>That was an example.</b> The desk found the answer live. The second check was done earlier, on these exact words.';
    const b = $('#demo-skip2'); b.classList.remove('quiet'); b.id = 'try-own'; b.textContent = 'Now try your own';
    this.running = false;
  },
  cancel() { this.running = false; this.typing = false; $('#demo-skip').hidden = true; },
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
// What each customer writes back, keyed by the start of the choice they answer.
const WRITE_BACK = {
  'in-progress': [['Yes, an hour', 'Ugh. The first one went out after all, so my followers saw it twice.', 'Post again'], ['Look up the id', 'Thanks! I checked the id like you said. Now I know which case it is.', 'Check the id'], ['Tell them it is still', 'I waited another hour. Still nothing. Was the id even right?', 'Wait longer']],
  'unknown-outcome-resend': [['Send it again', 'Now I have two copies scheduled. The first one had gone through.', 'Send again'], ['Tell them a 504', 'You said it failed, so I sent it again. Now it is going to post twice.', 'Say it failed'], ['Check their scheduled', 'Found it in my scheduled posts. Glad I did not send it twice!', 'Look first']],
  'mcp-invalid-grant': [['Remove and re-add', 'I signed in to Blotato and added it again. It works now. Thank you!', 'Add it again'], ['Reconnect their Instagram', 'I reconnected Instagram, but Claude still shows the same error.', 'Reconnect'], ['Send them to the Fix', "I clicked that button and nothing happened. I don't even use n8n.", 'Fix button']],
  'published-not-visible': [['Tell them to publish', 'Oh no. It was on my other account, and now that one has it twice.', 'Post again'], ['Open Posts', 'Found it! It went to my second account. Thank you!', 'Check where'], ['Tell them Instagram', "Wait, is my account hidden? Now I'm really worried.", 'Guess']],
  'trial-api-key-charge': [['Promise a refund', "You said I'd get my money back. Now someone says they have to check first?", 'Promise'], ['Tell them it is their', "Okay, but you didn't have to make me feel bad about it.", 'Blame them'], ['Explain the documented', 'That makes sense now. Thanks for passing the charge to someone who can help.', 'Explain']],
};
function writeBack(d, k) {
  const row = (WRITE_BACK[d.entry] || [])[k];
  return row && d.choices[k].text.startsWith(row[0]) ? row[1] : null;
}
function verbOf(d, k) {
  const row = (WRITE_BACK[d.entry] || [])[k];
  return row && row[2] && d.choices[k].text.startsWith(row[0]) ? row[2] : `Stamp ${k + 1}`;
}
// A help sentence is shown in the game only when a beginner can read it.
const HARD = /\b(fallback|queue|downstream|OAuth|endpoint|validate|established?|submission ID|response)\b/i;

const game = {
  data: null, i: 0, score: 0, picks: [], phase: 'start', lockUntil: 0,
  async open() {
    if (!this.data) {
      $('#game-stage').innerHTML = '<p class="lede">Getting your desk ready.</p>';
      try { [this.data] = await Promise.all([api('/api/practice'), loadArt()]); } catch (e) { $('#game-stage').innerHTML = `<p>${esc(e.message)}</p>`; return; }
      // Every face is ready before the desk is shown, so no card waits for its picture.
      await preload(this.data.decisions.map(d => custOf(d).slot));
      this.startScreen();
    }
    if (this.phase === 'start') $('#game-go')?.focus({ preventScroll: true });
  },
  face(d, mood, size) {
    const c = custOf(d); const slot = mood ? `${c.slot}-${mood}` : c.slot;
    const alt = `${c.look}, ${mood === 'relieved' ? 'relieved and smiling' : mood === 'upset' ? 'upset' : 'waiting for an answer'}.`;
    return art(slot, alt, size);
  },
  tray() {
    const n = this.data.decisions.length;
    $('#tray').innerHTML = `<ol aria-label="The letters on your desk">${this.data.decisions.map((_, k) => {
      const p = this.picks[k]; const s = p ? (p.right ? 'right' : 'wrong') : k === this.i && this.phase !== 'start' && this.phase !== 'end' ? 'now' : '';
      return `<li data-s="${s}">${k + 1}${p ? `<span class="mini">${roundMark(p.right, k + 1, true)}</span>` : ''}<span class="sr-only">Customer ${k + 1}: ${p ? (p.right ? 'helped' : 'not helped') : k === this.i ? 'now' : 'still to come'}</span></li>`;
    }).join('')}</ol><p class="tally">Customers helped: <b>${this.score}</b> of ${n}. You earn a stamp for each one.</p>`;
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
    this.phase = 'start'; this.picks = []; this.score = 0; this.i = 0;
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
    const d = this.data.decisions[this.i]; this.phase = 'ask'; this.lock(700);
    const c = custOf(d); const n = this.data.decisions.length;
    this.tray();
    // Get this customer's other two moods ready, so the change is instant.
    await preload([`${c.slot}-relieved`, `${c.slot}-upset`]);
    const face = this.face(d, '', 280);
    const html = `<div class="round">
      <div class="cust">${face ? `<div class="face" id="face">${face}</div>` : ''}<div><p class="cname">${esc(c.who)}</p><p class="cmood" id="cmood">Waiting for your answer</p></div></div>
      <div class="letters">
        <article class="cust-letter" id="cust-letter" aria-labelledby="cust-from">
          <h2 class="from" id="cust-from" tabindex="-1"><span class="sr-only">Letter ${this.i + 1} of ${n}. ${esc(c.who)} writes: </span>Hi Blotato support,</h2>
          <blockquote>${esc(d.ticket)}</blockquote>
          <p class="sig">Thanks,<b>${esc(c.who)}</b></p>
        </article>
      </div>
      <div id="write-back"></div>
      <div class="stamps">
        <h2 id="move-h">What is your first move?</h2>
        <p class="stamps-hint">Press the stamp you would use. It prints on their letter.</p>
        <ol aria-labelledby="move-h">${d.choices.map((ch, k) => `<li><button type="button" class="choice" data-k="${k}"><span class="sface" aria-hidden="true"><span>${k + 1}</span></span><span class="sbody"><span class="sverb">${esc(verbOf(d, k))}</span><span class="ct"><span class="sr-only">Stamp ${k + 1}: </span>${esc(ch.text)}</span></span></button></li>`).join('')}</ol>
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
  answer(k) {
    if (this.phase !== 'ask' || this.locked()) return;
    const d = this.data.decisions[this.i]; const ch = d.choices[k]; if (!ch) return;
    this.phase = 'after'; this.lock(450);
    this.picks[this.i] = { k, right: !!ch.right };
    if (ch.right) this.score++;
    $$('#game-stage .choice').forEach((b, idx) => {
      b.disabled = true;
      const right = d.choices[idx].right;
      if (idx === k) b.classList.add('picked', right ? 'right' : 'wrong');
      if (right) b.classList.add('answer');
      if (idx !== k && !right) b.classList.add('dim');
      if (idx === k || right) b.insertAdjacentHTML('beforeend', `<span class="tag">${right ? (idx === k ? 'Your stamp. The right first move.' : 'The right first move') : 'Your stamp'}</span>`);
    });
    const c = custOf(d);
    // The stamp lands on their letter. On contact, their face changes and the paper gives a little.
    const letter = $('#cust-letter');
    letter.insertAdjacentHTML('beforeend', `<div class="stamp" data-tone="${ch.right ? 'helped' : 'oops'}">${postmark(ch.right ? 'helped' : 'oops', { center: ['LETTER', String(this.i + 1), `OF ${this.data.decisions.length}`], word: verbOf(d, k).toUpperCase(), label: `${STAMPS[ch.right ? 'helped' : 'oops'].label} Your stamp: ${verbOf(d, k).toLowerCase()}.` })}</div>`);
    const stamp = $('.stamp', letter);
    const contact = () => {
      const mood = this.face(d, ch.right ? 'relieved' : 'upset', 280);
      const faceBox = $('#face');
      if (mood && faceBox) { faceBox.innerHTML = mood; if (!reduced.matches) faceBox.animate([{ transform: 'scale(1.035)' }, { transform: 'none' }], { duration: 260, easing: EASE_OUT }); }
      $('#cmood').textContent = ch.right ? 'Relieved' : 'Upset';
      $('#cmood').className = `cmood ${ch.right ? 'ok' : 'no'}`;
    };
    if (!reduced.matches) {
      stamp.style.visibility = 'hidden';
      const r = stamp.getBoundingClientRect(); const lr = letter.getBoundingClientRect();
      const shade = document.createElement('div');
      shade.style.cssText = `position:absolute;left:${r.left - lr.left}px;top:${r.top - lr.top}px;width:${r.width}px;height:${r.height}px;border-radius:40%;background:radial-gradient(closest-side, rgba(25,30,45,.22), rgba(25,30,45,0));pointer-events:none;`;
      letter.append(shade);
      shade.animate([{ transform: 'scale(1.35)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 150, easing: EASE_IN, fill: 'forwards' }).finished.then(() => {
        shade.remove(); stamp.style.visibility = '';
        stamp.animate([{ transform: 'rotate(-7deg) scale(1.035)' }, { transform: 'rotate(-7deg) scale(1)' }], { duration: T.press, easing: 'cubic-bezier(.2,.8,.3,1)' });
        letter.animate([{ transform: 'rotate(-.8deg)' }, { transform: 'rotate(-.8deg) translateY(4px)' }, { transform: 'rotate(-.8deg)' }], { duration: T.nudge, easing: 'ease-out' });
        contact();
      }, () => {});
    } else contact();
    // They write back: a small letter of their own, slid up from below.
    const wb = writeBack(d, k);
    const last = this.i + 1 >= this.data.decisions.length;
    const p = d.source.page;
    const sent = p?.found && p.mark ? sentence(p) : { pre: '', mark: d.source.quote.replace(/^["\u201C]|["\u201D]$/g, '').replace(/`/g, ''), post: '' };
    // With a plain-words line in the data, the quote is always shown and the line explains it.
    const plainLine = d.source.plain ? String(d.source.plain) : '';
    const fits = !!plainLine || !HARD.test(`${sent.pre}${sent.mark}${sent.post}`);
    const quote = `<p class="x">${esc(sent.pre)}<mark>${esc(sent.mark)}</mark>${esc(sent.post)}</p>${plainLine ? `<p class="xplain">${esc(plainLine)}</p>` : ''}`;
    $('#write-back').innerHTML = `<article class="write-back" aria-labelledby="wb-h"><h3 class="sr-only" id="wb-h">${esc(c.who)} writes back</h3>${wb ? `<p class="wb">&ldquo;${esc(wb)}&rdquo;</p>` : ''}<p class="wsig">${esc(c.who)}</p><p class="what">${esc(ch.consequence)}</p></article>`;
    const wbEl = $('.write-back');
    $('#after-move').innerHTML = `<h3>${ch.right ? 'You got it.' : 'The right first move'}</h3><p class="right-move">${both(d.firstCheck)}</p>
      <div class="game-next"><button type="button" class="btn" id="game-next">${last ? 'See my shift report' : 'Open the next letter'}</button><span class="hint">or press Enter</span></div>
      ${fits ? `<div class="src">${quote}<p class="k">Blotato's help page says so.</p><a href="${esc(d.source.url)}" target="_blank" rel="noopener">Open the help page</a></div>` : `<div class="src"><p class="k">Blotato's help page explains why.</p><a href="${esc(d.source.url)}" target="_blank" rel="noopener">Open the help page</a></div>`}`;
    if (!reduced.matches) {
      const r = wbEl.getBoundingClientRect();
      wbEl.animate([{ transform: `translateY(${Math.max(140, innerHeight - r.top + 30)}px) rotate(1.2deg)` }, { transform: 'rotate(1.2deg)' }], { duration: 480, delay: 360, easing: EASE_OUT, fill: 'backwards' });
    }
    this.tray();
    say(`${ch.right ? 'Helped.' : 'Oops.'} ${c.who} writes back. ${wb || ''} ${ch.consequence}`);
    $('#game-next').focus({ preventScroll: true });
    // On a phone, bring their answer and the next button into view once the stamp has landed.
    if (!wide()) setTimeout(() => {
      const nb = $('#game-next'); if (!nb) return;
      const w = $('#write-back').getBoundingClientRect(); const b = nb.getBoundingClientRect();
      const top = Math.min(b.top, w.top); const bottom = Math.max(b.bottom, w.bottom);
      if (bottom > innerHeight - 12 || top < 0) scrollTo({ top: scrollY + (bottom - innerHeight + 24), behavior: reduced.matches ? 'auto' : 'smooth' });
    }, reduced.matches ? 0 : 520);
  },
  next() {
    if (this.phase !== 'after' || this.locked()) return;
    this.i++;
    if (this.i >= this.data.decisions.length) return this.end();
    this.round();
  },
  async end() {
    this.phase = 'end'; this.lock(); this.tray();
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
        <ol class="earned" aria-label="Your stamps">${this.data.decisions.map((d, k) => { const p = this.picks[k]; return `<li class="${p?.right ? 'got' : 'missed'}"><span class="em">${roundMark(!!p?.right, k + 1)}</span><span class="en">${esc(custOf(d).who)}</span><span class="sr-only">: ${p?.right ? 'helped' : 'missed'}</span></li>`; }).join('')}</ol>
        <div class="row"><button type="button" class="btn" id="game-again">Play the shift again</button><a class="btn-quiet" href="#answer">Answer a real message</a></div>
      </div>
      <div>
        <h3 class="learned-h">What you learned</h3>
        <ol class="learned">${this.data.decisions.map((d, k) => { const p = this.picks[k]; return `<li><span class="g ${p?.right ? 'ok' : 'no'}" aria-hidden="true">${p?.right ? '\u2713' : '\u2715'}</span><p><span class="sr-only">${p?.right ? 'You got this one.' : 'You missed this one.'} </span>${both(d.firstCheck)}</p><a href="${esc(d.source.url)}" target="_blank" rel="noopener">The help page that says so</a></li>`; }).join('')}</ol>
      </div>
    </div>`);
    if (!reduced.matches) {
      // The seals are pressed one after another: hidden until their turn, then on the paper at once.
      $$('.earned .em').forEach((el, k) => {
        el.style.visibility = 'hidden';
        setTimeout(() => { el.style.visibility = ''; el.animate([{ transform: `rotate(${k % 2 ? 6 : -9}deg) scale(1.05)` }, { transform: `rotate(${k % 2 ? 6 : -9}deg) scale(1)` }], { duration: T.press, easing: 'cubic-bezier(.2,.8,.3,1)' }); }, 520 + k * 170);
      });
    }
    say(`Your shift is over. You helped ${s} of ${n} customers.`);
    $('#score-h').focus({ preventScroll: true });
  },
};

// ---------------------------------------------------------------- wiring
function wire() {
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
  $('#stopped-btn').addEventListener('click', () => { demo.cancel(); start({ body: null, who: 'Someone who posts with n8n', text: (STATE?.tickets.find(x => x.id === 'T07')?.text) || 'My n8n workflow posts 50 videos at once.', example: true }); });
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
    if (e.target.closest('#fixed-btn')) { const t = STATE?.tickets.find(x => x.id === 'T07'); return start({ body: { id: 'T07' }, who: 'Someone who posts with n8n', text: t?.text || moment?.meta?.text || '' }); }
    if (e.target.closest('[data-again]')) { leave(); return; }
    const c = e.target.closest('[data-copy]'); if (c) return copy(c.dataset.copy, c);
    const more = e.target.closest('.page-toggle');
    if (more) {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'Show only the sentences' : 'Show more of each page';
      $('#stage')?.classList.toggle('all-open', open);
      moment?.rhythm();
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
  addEventListener('resize', () => { if (moment?.done) moment.rhythm(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (demo.running || ($('#demo-bar') && !moment?.done)) { demo.skip(); return; }
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
