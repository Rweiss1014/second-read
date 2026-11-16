// Support Desk page, round 2. No framework, no animation library: motion is written by hand with the
// Web Animations API, and only transform, opacity and background-size (the highlighter) move.
// Every beat of "the moment" waits for a real event from the desk (POST /api/ticket/live).

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
const EASE_THUD = 'cubic-bezier(0.55, 0, 0.85, 0.35)';
const T = { frame: 260, sheetIn: 400, line: 380, hold: 150, travel: 520, sheetOut: 300, write: 180, lineGap: 60, step: 230, wire: 240, proof: 220, stamp: 300, nudge: 170 };
const DEMO_ID = 'T02';

let STATE = null;
let ART = new Set();
let picked = null; // the example in the box: { id, who, text }
let moment = null;

function say(msg) { const el = $('#live'); el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; }); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------------------------------------------------------------- dates, in the viewer's own time
const fmt = (t, o) => new Date(t).toLocaleString('en-US', o);
const day = (t) => t ? fmt(t, { month: 'short', day: 'numeric' }) : '';
// "Sunday, Nov 15, at 1:00 pm"
function when(t) {
  const d = new Date(t);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');
  return `${fmt(t, { weekday: 'long' })}, ${fmt(t, { month: 'short', day: 'numeric' })}, at ${time}`;
}
const techTime = (t) => t ? fmt(t, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '';
// A date-only stamp written in UTC: say it plainly and never as a day in the future.
function seenDay(d) {
  const now = new Date();
  const utc = (x) => x.toISOString().slice(0, 10);
  if (d === utc(now)) return 'in the last day';
  if (d === utc(new Date(now - 864e5))) return 'in the last two days';
  return `on ${d} (a date in UTC)`;
}

// ---------------------------------------------------------------- plain words for the page's own text
// The customer's message and quoted help-page sentences stay exactly as written.
const PLAIN = [
  [/\bAPI Errors\b/g, 'Errors for developers'],
  [/\s*No entry is a candidate for this (?:message|ticket)\.?/g, ''],
  [/\bAPI or MCP access\b/g, 'access for other apps and AI helpers'],
  [/\bAPI keys?\b/g, (m) => m.endsWith('s') ? 'developer keys' : 'developer key'],
  [/\bthe API\b/g, "Blotato's developer tools"],
  [/\bAPI\b/g, 'developer tools'],
  [/\bMCP servers?\b/g, 'AI helper link'],
  [/\bMCP\b/g, 'AI helper'],
  [/\bOAuth\b/g, 'sign-in'],
  [/\bescalated\b/gi, 'handed over'],
  [/\bescalation\b/gi, 'handover'],
  [/\bescalate\b/gi, 'hand'],
  [/\bthe founder\b/g, 'Sabrina, who runs Blotato'],
  [/\s+[\u2014\u2013]\s+/g, ', '],
];
const plainWords = (s) => PLAIN.reduce((t, [re, to]) => t.replace(re, to), String(s ?? ''));
const both = (raw, plain = plainWords(raw)) => plain === raw ? esc(raw) : `<span class="plain-only">${esc(plain)}</span><span class="tech-only">${esc(raw)}</span>`;
const dash = (s) => String(s ?? '').replace(/\s+[\u2014\u2013]\s+/g, ', ');

// The reply as the letter shows it: dates read like a person wrote them, ids only in the technical view.
// (The copy button gives the exact text the checker read.)
function letterText(s) {
  return esc(s)
    .replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{1,2}) (\w{3}) (\d{4}) (\d\d):(\d\d):(\d\d) (?:UTC|GMT)\b/g, (m, d, mon, y, H, M, S) => {
      const t = Date.parse(`${mon} ${d}, ${y} ${H}:${M}:${S} GMT`);
      return Number.isNaN(t) ? m : `<span class="plain-only">${esc(when(t))}</span><span class="tech-only">${m}</span>`;
    })
    .replace(/ \(((?:post|id) [\w-]+)\)/g, '<span class="tech-only postid"> ($1)</span>');
}

// ---------------------------------------------------------------- the stamp: a postmark, set in type
let pmN = 0;
const STAMPS = {
  checked: { word: 'CHECKED', sub: 'SAFE TO SEND', ring: 'SUPPORT DESK \u2022 SECOND CHECKER \u2022 ', label: 'Checked by a second reader. Safe to send.' },
  stopped: { word: 'STOPPED', sub: 'DO NOT SEND', ring: 'SUPPORT DESK \u2022 SECOND CHECKER \u2022 ', label: 'Stopped by the second checker. Do not send.' },
  saved: { word: 'READ IT', sub: 'CHANGED SINCE ITS CHECK', ring: 'SUPPORT DESK \u2022 SECOND CHECKER \u2022 ', label: 'Changed since its second check. Read it first.' },
  draft: { word: 'DRAFT', sub: 'NOT CHECKED YET', ring: 'SUPPORT DESK \u2022 NOT CHECKED YET \u2022 ', label: 'A draft. No second checker has read it yet.' },
  handed: { word: 'HANDED', sub: 'TO A PERSON', ring: 'SUPPORT DESK \u2022 PASSED TO THE TEAM \u2022 ', label: 'Handed to a person on the team.' },
  helped: { word: 'HELPED', sub: 'GOOD FIRST MOVE', ring: 'YOUR FIRST SHIFT \u2022 SUPPORT DESK \u2022 ', label: 'Helped. A good first move.' },
  oops: { word: 'OOPS', sub: 'NOT THIS TIME', ring: 'YOUR FIRST SHIFT \u2022 SUPPORT DESK \u2022 ', label: 'Oops. Not this time.' },
};
function centerOf(t) {
  if (!t) return ['NOT', 'YET', ''];
  const d = new Date(t);
  return [fmt(d, { month: 'short' }).toUpperCase(), String(d.getDate()), String(d.getFullYear())];
}
function postmark(kind, { date = null, center = null, word = null, sub = null } = {}) {
  const s = { ...STAMPS[kind], ...(word ? { word, label: `${STAMPS[kind].label} Your stamp: ${word.toLowerCase()}.` } : {}), ...(sub ? { sub } : {}) }; const id = `pm${++pmN}`;
  const [top, big, bottom] = center || centerOf(date);
  return `<svg class="pm" viewBox="0 0 320 150" role="img" aria-label="${esc(s.label)}">
    <defs><path id="${id}" d="M75 75 m-55 0 a55 55 0 1 1 110 0 a55 55 0 1 1 -110 0"/></defs>
    <g fill="none" stroke="currentColor"><circle cx="75" cy="75" r="67" stroke-width="5"/><circle cx="75" cy="75" r="44" stroke-width="2"/>
    <rect x="156" y="31" width="158" height="88" rx="10" stroke-width="5"/><rect x="164" y="39" width="142" height="72" rx="5" stroke-width="1.6"/></g>
    <g fill="currentColor">
    <text font-size="11.5" font-weight="800" letter-spacing="1.6"><textPath href="#${id}" textLength="342" lengthAdjust="spacingAndGlyphs">${esc(s.ring)}</textPath></text>
    <text x="75" y="${big.length > 2 ? 72 : 62}" text-anchor="middle" font-size="12.5" font-weight="800" letter-spacing="1.5">${esc(top)}</text>
    <text x="75" y="${big.length > 2 ? 90 : 93}" text-anchor="middle" class="serif" font-size="${big.length > 2 ? 17 : 34}" font-weight="700">${esc(big)}</text>
    <text x="75" y="${big.length > 2 ? 104 : 108}" text-anchor="middle" font-size="11" font-weight="800" letter-spacing="1.5">${esc(bottom)}</text>
    <text x="235" y="84" text-anchor="middle" font-size="34" font-weight="900" textLength="128" lengthAdjust="spacingAndGlyphs">${esc(s.word)}</text>
    <text x="235" y="102" text-anchor="middle" font-size="11.5" font-weight="800" textLength="${s.sub.length > 14 ? 128 : 104}" lengthAdjust="spacingAndGlyphs">${esc(s.sub)}</text>
    </g></svg>`;
}
// A round postmark for the shift report and the desk tray.
function roundMark(right, n, small = false) {
  const id = `pm${++pmN}`;
  const ring = right ? 'HELPED \u2022 YOUR FIRST SHIFT \u2022 ' : 'MISSED \u2022 YOUR FIRST SHIFT \u2022 ';
  const glyph = right ? '<path d="M52 78 L69 95 L100 58" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M58 58 L92 92 M92 58 L58 92" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>';
  return `<svg viewBox="0 0 150 150" aria-hidden="true" data-tone="${right ? 'helped' : 'oops'}"><defs><path id="${id}" d="M75 75 m-55 0 a55 55 0 1 1 110 0 a55 55 0 1 1 -110 0"/></defs>
    <g fill="none" stroke="currentColor"><circle cx="75" cy="75" r="67" stroke-width="5"/><circle cx="75" cy="75" r="44" stroke-width="2"/></g>
    ${small ? '' : `<text fill="currentColor" font-size="12" font-weight="800" letter-spacing="1.6" font-family="Source Sans 3, sans-serif"><textPath href="#${id}" textLength="342" lengthAdjust="spacingAndGlyphs">${ring}</textPath></text>`}
    ${glyph}</svg>`;
}

// ---------------------------------------------------------------- art slots
// A picture shows only when public/art/<slot>.webp exists. Otherwise it leaves nothing at all.
function art(slot, alt, w, h = w, cls = '') {
  if (!ART.has(slot)) return '';
  return `<img${cls ? ` class="${cls}"` : ''} src="/art/${esc(slot)}.webp" alt="${esc(alt || '')}" width="${w}" height="${h}" decoding="async">`;
}
async function loadArt() {
  try { ART = new Set((await api('/api/art')).slots || []); } catch { /* none */ }
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
}

// ---------------------------------------------------------------- the first screen
const whoOf = (from) => { const w = String(from || '').replace(/\s*\(made up\)\s*$/, ''); return w ? w[0].toUpperCase() + w.slice(1) : 'A customer'; };
const EXTRA = [
  { text: 'I canceled my plan last month but you charged me again. I want a refund.', who: 'A customer who wants their money back', writer: 'A customer' },
  { text: "Blotato says my post is published but I can't see it on Instagram.", who: 'The second example, asked a new way', writer: 'A creator' },
  { text: 'Banana phone purple. Does it work on Tuesdays?', who: 'A message that makes no sense', writer: 'A customer' },
];

function exampleButton({ id, text, who, writer }) {
  return `<li><button type="button"${id ? ` data-id="${esc(id)}"` : ''} data-who="${esc(writer || who)}" aria-pressed="false"><span class="q" aria-hidden="true">&ldquo;</span><span class="t">${esc(text)}</span><span class="who">${esc(who)}</span></button></li>`;
}

function fillExamples() {
  const shown = new Set($$('#tries button').map(b => b.dataset.id));
  for (const b of $$('#tries button')) { const t = STATE.tickets.find(x => x.id === b.dataset.id); if (t) $('.t', b).textContent = t.text; }
  const order = ['T07', 'T11', 'T12', 'T10', 'T09', 'T06', 'T08', 'T03'];
  const rest = STATE.tickets.filter(t => !shown.has(t.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  $('#more-list').innerHTML = [...rest.map(t => exampleButton({ id: t.id, text: t.text, who: whoOf(t.from) })), ...EXTRA.map(exampleButton)].join('');
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
  const body = same && picked.id ? { id: picked.id } : { text };
  start({ body, who: same ? picked.who : null, text });
}

async function techHome() {
  try {
    const s = STATE || await api('/api/state');
    $('#tech-state').innerHTML = `
      <dt>Account data</dt><dd>${s.mock ? 'Sample data. No account is connected, so every account lookup reads made-up posts.' : 'A real Blotato account, read-only.'}</dd>
      <dt>Read-only</dt><dd>${s.readOnly ? 'Yes. The client refuses anything but GET, and there is no switch to change that.' : 'No'}</dd>
      <dt>Help pages on hand</dt><dd>${s.docs.pages} pages, read ${esc(s.docs.via.join(', ') || 'not yet')}${s.docs.newest ? `, newest ${esc(techTime(s.docs.newest))}` : ''}</dd>
      <dt>Problems on file</dt><dd>${s.failures}, checked first on every message</dd>`;
  } catch (e) { $('#tech-state').innerHTML = `<dt>Error</dt><dd>${esc(e.message)}</dd>`; }
}

// ---------------------------------------------------------------- what the result means
function stateOf(r) {
  if (!r.entry || !r.reply) return 'refused';
  if (!r.check.pass || r.fresh?.state === 'blocked') return 'stopped';
  if (r.fresh?.state === 'passed') return 'checked';
  if (r.fresh?.state === 'passed-saved') return 'saved';
  return 'draft';
}
const STAMP_OF = { checked: 'checked', stopped: 'stopped', saved: 'saved', draft: 'draft', refused: 'handed' };

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

// The whole sentence (or sentences) around a quote. Never a cut sentence, never "...".
function sentence(page) {
  const t = page.text; let [s, e] = page.mark;
  const before = t.slice(0, s);
  const m = before.match(/^[\s\S]*[.!?:]["')\]]?\s+/);
  let a = m ? m[0].length : 0;
  if (!m && /^\.\.\.\s/.test(t)) a = s;
  let b = e;
  if (!/[.!?]["')\]]?$/.test(t.slice(s, e).trim())) {
    const f = t.slice(e).match(/^[^.!?]{0,160}?[.!?]["')\]]?(?=\s|$)/);
    if (f) b = e + f[0].length;
  }
  return { pre: t.slice(a, s), mark: t.slice(s, e), post: t.slice(e, b) };
}
// Whole sentences only, up to about max letters: from the start (after) or from the end (before).
function wholeSentences(s, max, fromEnd) {
  const parts = String(s || '').replace(/^\.\.\.\s*/, '').replace(/\s*\.\.\.$/, '').match(/[^.!?]+[.!?:]+["')\]]?(\s+|$)/g) || [];
  const out = []; let n = 0;
  for (const p of fromEnd ? parts.reverse() : parts) { if (n + p.length > max && out.length) break; if (n + p.length > max * 1.6) break; out.push(p); n += p.length; }
  return (fromEnd ? out.reverse() : out).join('').trim();
}
const sentenceHTML = (page) => { const x = sentence(page); return `${esc(x.pre)}<mark>${esc(x.mark)}</mark>${esc(x.post)}`; };
function paragraphHTML(page) {
  const t = page.text; const [s, e] = page.mark;
  const clean = (x) => esc(String(x || '').replace(/^\.\.\.\s*/, '').replace(/\s*\.\.\.$/, ''));
  return `${page.before ? `<span class="dim">${clean(page.before)}</span> ` : ''}<span class="dim">${clean(t.slice(0, s))}</span><mark>${esc(t.slice(s, e))}</mark><span class="dim">${clean(t.slice(e))}</span>${page.after ? ` <span class="dim">${clean(page.after)}</span>` : ''}`;
}
function whereHTML(p, prev) {
  if (!p) return '';
  if (prev && prev.page && prev.page.title === p.title && prev.page.heading === p.heading) return 'The same help page';
  return `Help page: ${both(dash(p.title || 'Help page'))}${p.heading ? `, ${both(dash(p.heading))}` : ''}`;
}

function proofHTML(step, i, r, prev) {
  const n = i + 1;
  const cite = (r.check?.citations || []).find(c => c.step === n);
  const flagged = r.example?.plain?.names?.includes(n);
  const k = flagged ? `Step ${n}: the checker named this step` : null;
  if (step.type === 'fact') {
    const p = step.page;
    const x = p?.found && p.mark ? sentenceHTML(p) : `<mark>${esc(step.quote)}</mark>`;
    return `<p class="pk">${k ? `${k}. ` : ''}${whereHTML(p, prev)}</p>
      <p class="px">${x}</p>
      <p class="tech-only"><a href="${esc(step.url)}" target="_blank" rel="noopener">${esc(String(step.url).replace('https://', ''))}</a>${cite?.fetchedAt ? `, read ${esc(techTime(cite.fetchedAt))}` : ''}${cite?.via ? ` through ${esc(cite.via)}` : ''}. ${cite ? (cite.found ? 'Script check: the quote is on the page.' : 'Script check: the quote is NOT on the page.') : ''}</p>`;
  }
  if (step.type === 'evidence') {
    const search = r.evidence?.kind === 'docs-search';
    return `<p class="pk">${k || (search ? 'From a search of the help pages' : 'From their account')}</p>
      <p class="plain">${esc(plainEvidence(r.evidence))}</p>
      <p class="tech-only">${(r.evidence?.calls || []).map(c => `<code>${esc(c)}</code>`).join('<br>') || 'No call was made.'}</p>`;
  }
  return `<p class="pk">${k || 'Something the desk does'}</p>
    <p class="plain">${r.escalation ? 'The desk wrote a note for a person on the team. You can read it under the letter.' : 'This step is the desk\'s own action, so there is no page to quote.'}</p>`;
}

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
      if (/^Next step:/.test(line)) return `<p class="next${flagNext ? ' flag' : ''}">${letterText(line)}</p>`;
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
  if (trace.some(e => e.t === 'search')) parts.push("I searched the help pages for the question, and none of them answers it.");
  if (r.evidence && r.evidence.kind !== 'docs-search') parts.push(plainEvidence(r.evidence).replace(/^The desk /, 'I '));
  return parts.join(' ') || 'Nothing could be checked.';
}

function noteHTML(r, own = true) {
  const e = r.escalation; if (!e) return '';
  const li = (arr, none) => arr.length ? `<ul>${arr.map(c => { const x = splitCause(c); return `<li>${both(x.text)}${x.tag ? ` <span class="src-tag">(${x.tag})</span>` : ''}</li>`; }).join('')}</ul>` : `<p>${esc(none)}</p>`;
  const why = String(e.why).replace(/this ticket/g, 'this message');
  return `<section class="note" aria-labelledby="note-h">
    <h3 id="note-h">A person on the team needs to see this</h3>
    <p class="note-lead">The desk wrote this note for Sabrina, who runs Blotato. ${own ? 'Copy it and pass it on.' : 'Copy it and pass it on, so the customer gets an answer.'}</p>
    <div class="letterish">
      <p>Hi Sabrina,</p>
      <p>A customer wrote: &ldquo;${esc(e.asked)}&rdquo;</p>
      <span class="lbl">Why it needs you</span><p>${both(why)}</p>
      <span class="lbl">What I checked</span><p>${esc(plainChecked(r))}</p>
      <span class="lbl">What I think it is</span>${li(e.causes, 'Not known yet. The help pages have no answer, so I will not guess.')}
      ${e.ruledOut.length ? `<span class="lbl">What I ruled out</span>${li(e.ruledOut, '')}` : ''}
    </div>
    <button type="button" class="btn-quiet" data-copy="sabrina">Copy the note for Sabrina</button><span class="copied" data-copied="sabrina" aria-live="polite"></span>
  </section>`;
}

function docEditHTML(r) {
  const d = r.docEdit; if (!d || !r.entry) return '';
  const rawTitle = d.page?.title || d.article.replace(/^https:\/\/help\.blotato\.com\//, '');
  let sheet;
  if (d.kind === 'change') {
    const p = d.page;
    const ctx = p?.found && p.mark
      ? (() => { const t = p.text; const [s, e] = p.mark; let a = Math.max(0, s - 60); let z = Math.min(t.length, e + 90); if (a > 0) a = t.indexOf(' ', a) + 1 || a; if (z < t.length) z = t.lastIndexOf(' ', z) > e ? t.lastIndexOf(' ', z) : z; return `${esc(t.slice(a, s))}<span class="red-out">${esc(t.slice(s, e))}</span> <span class="red-in">${esc(d.after)}</span>${esc(t.slice(e, z))}`; })()
      : `<span class="red-out">${esc(d.before)}</span> <span class="red-in">${esc(d.after)}</span>`;
    sheet = `<p class="ctx">${ctx}</p><div class="red-new">${esc(d.add)}</div>`;
  } else {
    sheet = `<div class="red-new"><b>${both(d.heading)}</b>${both(d.add)}</div>`;
  }
  const heading = d.kind === 'change' ? 'A help page needs a fix' : "The help pages don't cover this yet";
  const lead = d.kind === 'change'
    ? `The desk found a help page that leads people the wrong way. Here is the change it suggests to the page "${both(rawTitle)}". Sabrina, who runs Blotato, decides if it goes in.`
    : `The desk suggests a new part for the help page "${both(rawTitle)}". Sabrina, who runs Blotato, writes the answer and decides if it goes in.`;
  return `<section class="note doc" aria-labelledby="doc-h">
    <h3 id="doc-h">${heading}</h3>
    <p class="note-lead">${lead}</p>
    <div class="page-sheet"><p class="ttl">Help page: ${both(rawTitle)}</p>${sheet}</div>
    <p class="red-note">In red pencil: what the desk would change. Nothing changes on the real help page until a person does it.</p>
  </section>`;
}

function verdictHTML(r, st) {
  const f = r.fresh || {};
  const on = f.checkedAt ? ` on ${esc(day(f.checkedAt))}` : '';
  const how = 'First a script made sure every quote is really on its help page. Then a second AI read the reply with only the help pages beside it, and looked for anything wrong.';
  if (st === 'checked') {
    const notes = (f.notes || []).length;
    return `<p class="verdict" style="--tone: var(--pass)"><b>Checked. Safe to send.</b>A second checker read this exact reply${on} and found no mistakes. You can copy it and send it.<span class="how-checked">${how}${notes ? ` It left ${notes === 1 ? 'one small note' : `${notes} small notes`}, which the technical view shows.` : ''}</span></p>`;
  }
  if (st === 'stopped') {
    const plain = r.example?.plain;
    const why = plain?.why || f.why || (r.check.problems || [])[0] || '';
    const more = plain?.more || [];
    return `<div class="verdict" style="--tone: var(--block)"><b>Stopped. Do not send this one.</b>A second checker found a mistake. ${esc(why)}${more.length ? `<ul>${more.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div>`;
  }
  if (st === 'saved') return `<p class="verdict" style="--tone: var(--navy)"><b>Read it once before you send it.</b>A second checker passed an earlier copy of this reply${on}. Today's look at the account changed a few words, so read it yourself first. Then you can send it.</p>`;
  if (st === 'refused') return '';
  return `<p class="verdict" style="--tone: var(--draft)"><b>Not checked yet. Read it before you send it.</b>${f.state === 'stale' ? 'This reply changed since it was checked.' : 'No second checker has read this reply yet.'} A script made sure every quote is on its help page, but read the whole reply yourself first.</p>`;
}

function techHTML(r) {
  const f = r.fresh || {};
  const calls = (r.trace || []).map(e => {
    if (e.t === 'page') return `<li><span class="what">docs MCP getPage ${esc(e.url)}</span><span class="meta">${e.ok ? `${e.fromCache ? 'from the local copy' : 'fetched now'}, read ${esc(techTime(e.fetchedAt))}` : 'could not be read'}, ${e.ms} ms</span></li>`;
    if (e.t === 'search') return `<li><span class="what">docs MCP searchDocumentation "${esc(e.query)}"</span><span class="meta">${e.offline ? 'skipped (offline)' : `${e.results} results`}, ${e.ms} ms</span></li>`;
    if (e.t === 'call') return `<li><span class="what">${esc(e.method)} ${esc(decodeURIComponent(e.path))}</span><span class="meta">HTTP ${esc(e.status ?? 'none')}, request id <code>${esc(e.requestId || 'none')}</code>${e.upstreamRequestId ? `, Blotato reqId <code>${esc(e.upstreamRequestId)}</code>` : ''}${e.error ? `, ${esc(e.error)}` : ''}, ${e.ms} ms${r.mock ? ', sample data' : ''}</span></li>`;
    return '';
  }).join('');
  const steps = (r.steps || []).map((s, i) => {
    const c = (r.check?.citations || []).find(x => x.step === i + 1);
    return `<li><span class="what">${esc(s.type)}${s.url ? ` ${esc(s.url)}` : ''}</span><span class="meta">${s.quote ? `"${esc(s.quote)}"` : esc(s.type === 'evidence' ? (r.evidence?.summary || '') : 'No source: an action the desk takes.')}${c ? ` ${c.found ? 'Found on the page' : 'NOT found on the page'}${c.fetchedAt ? `, page read ${esc(techTime(c.fetchedAt))}` : ''}.` : ''}</span></li>`;
  }).join('');
  const findings = f.findings || f.notes || [];
  const ex = r.example;
  const searched = (r.evidence?.searched || []).map(q => `<li><span class="what">"${esc(q.query)}"</span><span class="meta">${q.results.slice(0, 4).map(x => esc(x.title || x.url)).join(', ') || 'no results'}</span></li>`).join('');
  return `<section class="tech" aria-labelledby="tech-h">
    <h2 id="tech-h">Technical view</h2>
    <dl class="kv">
      <dt>Status</dt><dd>${esc(r.status)}</dd>
      <dt>Outcome</dt><dd><code>${esc(r.outcome)}</code></dd>
      <dt>Account data</dt><dd>${r.mock ? 'sample data, no account connected' : 'live, read-only'}</dd>
      ${(r.seenBefore || []).length ? `<dt>Seen before</dt><dd>${r.seenBefore.map(s => `${esc(s.title)}: ${s.times} time${s.times > 1 ? 's' : ''}, last ${esc(seenDay(s.lastSeen))}`).join('<br>')}</dd>` : ''}
    </dl>
    ${ex ? `<h3>About this example</h3><p>The first reply the desk wrote to this sample message on Nov 15, rebuilt byte for byte from that day's code. On every load the server hashes this text and compares it with the second checker's saved verdict. The desk was fixed after this verdict, and today's reply to the same message passed.</p><dl class="kv"><dt>Reply sha256</dt><dd><code>${esc(ex.replySha256)}</code></dd><dt>Matches the verdict</dt><dd>${ex.hashMatches ? 'yes, checked by the server just now' : 'NO'}</dd></dl>` : ''}
    <h3>Every read the desk made, in order</h3>
    ${calls ? `<ol class="calls">${calls}</ol>` : '<p>None recorded.</p>'}
    ${searched ? `<h3>What the help-page search found</h3><ol class="calls">${searched}</ol>` : ''}
    ${r.steps?.length ? `<h3>Each step and its source</h3><ol class="calls">${steps}</ol>` : ''}
    <h3>Script checker</h3>
    <p>${r.entry ? (r.check.pass ? 'Passed. Every quote is on its cited page. Every account step is backed by a lookup. No line makes a promise (a refund, a date, a sure outcome).' : `Blocked: ${esc((r.check.problems || []).join(' '))}`) : esc(r.check?.problems?.[0] || 'There was no reply to check.')}</p>
    ${r.reply ? `<h3>Second checker</h3>
    <dl class="kv"><dt>Where it stands</dt><dd><code>${esc(f.state || 'none')}</code></dd>${f.checkedAt ? `<dt>Checked</dt><dd>${esc(techTime(f.checkedAt))}</dd>` : ''}</dl>
    ${findings.length ? `<p>${f.state === 'blocked' ? 'Its findings:' : 'Its notes:'}</p><ul class="mono-list">${findings.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <h3>The exact text the checker read (what Copy gives you)</h3><pre>${esc(r.reply)}</pre>` : ''}
    ${r.escalationText ? `<h3>The note for a person, as the desk saved it</h3><pre>${esc(r.escalationText)}</pre>` : ''}
    ${r.docEditText ? `<h3>The proposed help-page edit, as the desk saved it</h3><pre>${esc(r.docEditText)}</pre>` : ''}
  </section>`;
}

// ---------------------------------------------------------------- the answer view
function shellHTML(meta) {
  return `<div class="said">
      <div><div class="who">${esc(meta.who ? `${meta.who} wrote` : 'The customer wrote')}</div>
      <blockquote id="said-q">${esc(meta.text)}</blockquote></div>
      <div class="said-btns">
        <button type="button" class="btn-quiet back" id="back">New message</button>
        ${meta.demo ? '' : '<button type="button" class="skip-btn" id="skip-btn">Skip to the answer</button>'}
      </div>
    </div>
    ${meta.demo ? `<div class="demo-bar" id="demo-bar"><p id="demo-say"><b>Watch the desk answer an example.</b> It is working on it live, right now.</p><button type="button" class="btn quiet" id="demo-skip2">Skip the example</button></div>` : ''}
    ${meta.example ? '<p class="example-tag">A saved example from Nov 15: the desk\'s first reply to this message. The second checker stopped it, and the desk was fixed.</p>' : ''}
    <div class="did-row"><ol class="did" id="did" aria-label="What the desk did"></ol></div>
    <div class="stage" id="stage"><div class="paper"><p class="paper-wait" id="paper-wait">The desk is reading Blotato's help pages for this message.</p></div></div>
    <div id="after"></div>`;
}

// The letter and its proofs: one grid row per step (wide), or each step then its proof (phone).
function stageHTML(r, hold) {
  const H = hold ? ' js-hold' : '';
  const st = stateOf(r);
  const stamp = `<div class="stamp${H}" data-tone="${STAMP_OF[st]}">${postmark(STAMP_OF[st], { date: st === 'draft' ? null : st === 'refused' ? Date.now() : r.fresh?.checkedAt })}</div>`;
  if (st === 'refused') {
    return { cls: 'single refusal', rows: 3, rowsN: 3, html: `
      <div class="lh${H}" style="--r:1;--rn:1">${stamp}
        <h2 id="letter-h">The desk did not write a reply to this one</h2>
        <dl>
          <dt>What happened</dt><dd>The desk looked through Blotato's help pages and found nothing that answers this message.</dd>
          <dt>Why that is the safe thing</dt><dd>It will not guess. A wrong answer can hurt a customer more than a slow one.</dd>
          <dt>Who gets it next</dt><dd>A person on the support team. The desk wrote them a note with what it looked for. You can read it below.</dd>
          <dt>What you can do now</dt><dd>Say the message another way, with a little more detail. Or try one of the examples.</dd>
        </dl>
      </div>
      <div class="ltail${H}" style="--r:2;--rn:2"><div class="actions refusal-actions"><button type="button" class="btn" id="reword-btn">Say it another way</button><button type="button" class="btn-quiet" data-again>Try one of the examples</button></div></div>` };
  }
  const { head, tail } = letterParts(r.reply);
  const steps = r.steps || [];
  const flags = r.example?.plain?.names || [];
  const n = steps.length;
  const title = r.outcome === 'no-answer' ? 'Here is a reply for now' : 'Here is the answer';
  const rows = steps.map((s, i) => {
    const fl = flags.includes(i + 1) ? ' flag' : '';
    const r1 = i + 2; const rn = 2 + i * 2;
    return `<div class="lstep${fl}" id="step-${i + 1}" data-i="${i}" tabindex="0" aria-describedby="proof-${i + 1}" style="--r:${r1};--rn:${rn}"><span class="num${H}" aria-hidden="true">${i + 1}</span><span class="txt${H}"><span class="sr-only">Step ${i + 1}. </span>${letterText(s.text)}</span></div>
      <i class="wire${fl}" data-i="${i}" aria-hidden="true" style="--r:${r1}"><i class="${H.trim()}"></i></i>
      <div class="proof${fl}${H}" id="proof-${i + 1}" data-i="${i}" style="--r:${r1};--rn:${rn + 1}">${proofHTML(s, i, r, steps[i - 1])}</div>`;
  }).join('');
  return { cls: '', rows: n + 2, rowsN: n * 2 + 2, html: `
    <div class="lh" style="--r:1;--rn:1">${stamp}<h2 id="letter-h" class="${H.trim()}">${title}</h2><div class="head${H}">${head.map(p => `<p>${letterText(p)}</p>`).join('')}</div></div>
    <div class="mh${H}" style="--r:1"><h2>How do we know?</h2><p>Each step's proof sits beside it, on the same line. Point at a step to light it up.</p><button type="button" class="link page-toggle" aria-expanded="false">Show the whole paragraph</button></div>
    ${rows}
    <div class="ltail${H}" style="--r:${n + 2};--rn:${n * 2 + 2}">${tailHTML(tail, r)}</div>` };
}

function closingHTML(r, st, demoRun) {
  const single = st === 'refused';
  let actions;
  if (st === 'stopped') {
    actions = `<button type="button" class="btn" id="fixed-btn">See the fixed reply</button><button type="button" class="btn-quiet" data-again>Answer another message</button>
      <p class="why-line">The desk never sends anything, and it will not let you copy a reply the checker stopped.</p>`;
  } else if (!single) {
    actions = `<button type="button" class="btn" data-copy="reply">${st === 'checked' ? 'Copy the answer' : 'Copy the reply'}</button><span class="copied" data-copied="reply" aria-live="polite"></span><button type="button" class="btn-quiet" data-again>Answer another message</button>
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

// Whole lines arrive, one after another. Never a clip that cuts letters.
function splitLines(el) {
  const toks = [];
  for (const node of [...el.childNodes]) {
    if (node.nodeType === 3) {
      const parts = node.textContent.split(/(\s+)/);
      const frag = document.createDocumentFragment();
      for (const p of parts) { if (!p) continue; if (/^\s+$/.test(p)) frag.append(p); else { const s = document.createElement('span'); s.textContent = p; frag.append(s); toks.push(s); } }
      node.replaceWith(frag);
    } else toks.push(node);
  }
  const lines = []; let top = null;
  for (const t of toks) {
    const rect = t.getClientRects()[0];
    if (rect && (top === null || Math.abs(rect.top - top) > 4)) { lines.push([]); top = rect.top; }
    if (!lines.length) lines.push([]);
    lines[lines.length - 1].push(t);
  }
  return lines.map(ws => {
    const ln = document.createElement('span'); ln.className = 'ln';
    ws[0].before(ln);
    let node = ln.nextSibling; const last = ws[ws.length - 1];
    while (node) { const next = node.nextSibling; ln.append(node); if (node === last) break; node = next; }
    return ln;
  });
}

class Moment {
  constructor(meta) {
    this.meta = meta; this.events = []; this.result = null; this.error = null;
    this.skipped = false; this.dead = false; this.done = false; this.instant = reduced.matches || !!meta.instant; this.anims = []; this.waiters = new Set();
    this.t0 = performance.now(); this.marks = {};
  }
  push(ev) {
    if (ev.t === 'result') this.result = ev.result;
    else if (ev.t === 'error') this.error = ev;
    else if (ev.t !== 'start') this.events.push(ev);
    this.poke();
  }
  poke() { for (const w of [...this.waiters]) w(); }
  until(test) {
    return new Promise(res => { const check = () => { if (this.dead || test()) { this.waiters.delete(check); res(); } }; this.waiters.add(check); check(); });
  }
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
    if (!el) return Promise.resolve();
    el.classList.remove('js-hold');
    if (this.fast) return Promise.resolve();
    const a = el.animate(kf, { fill: 'backwards', easing: EASE_OUT, ...opts });
    this.anims.push(a);
    return a.finished.then(() => {}, () => {});
  }
  skip() { if (this.done) return; this.skipped = true; for (const a of this.anims) { try { a.finish(); } catch { /* gone */ } } this.poke(); }
  stop() { this.dead = true; for (const a of this.anims) { try { a.cancel(); } catch { /* gone */ } } this.poke(); }
  mark(k) { this.marks[k] = Math.round(performance.now() - this.t0); }

  tick(key, state, text) {
    let li = $(`#did li[data-k="${key}"]`);
    if (!li) { li = document.createElement('li'); li.dataset.k = key; li.innerHTML = '<span class="g" aria-hidden="true"></span><span class="w"></span>'; $('#did').append(li); }
    li.dataset.s = state;
    $('.g', li).textContent = { done: '\u2713', wait: '', stop: '\u2715', needs: '\u2192', neutral: '', pending: '' }[state];
    $('.w', li).textContent = text;
  }

  // Whole lines of an element arrive one after another, then the element is put back as it was.
  async write(el, { dur = T.write, gap = T.lineGap } = {}) {
    if (!el) return;
    el.classList.remove('js-hold');
    if (this.fast) return;
    const keep = el.innerHTML;
    const lines = splitLines(el);
    const all = lines.map((ln, k) => this.anim(ln, [{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], { duration: dur, delay: k * gap }));
    await Promise.all(all);
    if (!this.dead) el.innerHTML = keep;
  }

  // The highlighter: one sweep, left to right, line after line.
  async sweep(mark, perLine = T.line) {
    if (!mark || this.fast) return;
    const lines = Math.max(1, mark.getClientRects().length);
    await this.anim(mark, [{ backgroundSize: '0% 100%' }, { backgroundSize: '100% 100%' }], { duration: Math.min(perLine * lines, 860), easing: lines > 1 ? 'linear' : EASE_MARK });
  }

  sheet(ev) {
    const s = document.createElement('div');
    s.className = 'sheet'; s.setAttribute('aria-hidden', 'true');
    s.innerHTML = `<p class="sh-site">Blotato help page</p><p class="sh-title">${both(dash(ev?.title || 'Help page'))}</p><p class="sh-wait">Reading the page.</p>`;
    $('#stage').append(s);
    return s;
  }

  async play() {
    const stage = $('#stage'); const paper = $('.paper', stage);
    this.tick('read', 'wait', "Reading Blotato's help pages");
    say('The desk is working on the answer.');
    // The letter's frame is there at once, so the page is never empty.
    this.anim(paper, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: T.frame }).then(() => this.mark('frame'));
    if (this.fast) this.mark('frame');
    await this.until(() => this.events.some(e => e.t === 'page') || this.result || this.error);
    if (this.dead) return;
    if (this.error) return this.fail(this.error.message);

    // The help page the desk opened is laid on the desk, where the eye is.
    let sheet = null;
    const firstPageEv = this.events.find(e => e.t === 'page');
    if (firstPageEv && !this.fast) {
      sheet = this.sheet(firstPageEv);
      this.anim(sheet, [{ opacity: 0, transform: 'translate(70px, 6px) rotate(2.5deg)' }, { opacity: 1, transform: 'rotate(-.6deg)' }], { duration: T.sheetIn, fill: 'both' });
      this.mark('sheet');
    }
    await this.until(() => this.result || this.error);
    if (this.dead) return;
    if (this.error) { sheet?.remove(); return this.fail(this.error.message); }

    const r = this.result;
    const trace = r.trace || [];
    const pages = new Set(trace.filter(e => e.t === 'page').map(e => e.url)).size;
    const searched = trace.some(e => e.t === 'search');
    const called = trace.some(e => e.t === 'call');
    const st = stateOf(r);
    const W = wide();
    // Every line of work this answer will show gets its place now, in order, so nothing moves later.
    if (called && st !== 'refused') this.tick('account', 'pending', '.');
    this.tick('write', 'pending', '.'); this.tick('check', 'pending', '.');

    // Build the whole letter now, held invisible, so nothing moves when its parts arrive.
    const built = stageHTML(r, !this.fast);
    stage.className = `stage built ${built.cls}`.trim();
    paper.style.setProperty('--rows', built.rows); paper.style.setProperty('--rowsn', built.rowsN);
    paper.insertAdjacentHTML('afterend', built.html);
    if (sheet) stage.append(sheet);
    $('#after').innerHTML = closingHTML(r, st, this.meta.demo);
    for (const el of $$('.closing, .notes', $('#after'))) if (!this.fast) el.classList.add('js-hold');

    const steps = r.steps || [];
    const firstFact = steps.findIndex(s => s.type === 'fact' && s.page?.found && s.page.mark);
    const proofOf = (i) => $(`.proof[data-i="${i}"]`, stage);

    // The sentence: the highlighter sweeps it, large, then it travels to the step it proves.
    if (sheet && firstFact >= 0) {
      const p = steps[firstFact].page; const x = sentence(p);
      const [s0] = p.mark; const cut = p.text.slice(0, s0).length - x.pre.length;
      const before = wholeSentences(`${p.before || ''} ${p.text.slice(0, cut)}`, 170, true);
      const after = wholeSentences(`${p.text.slice(s0 + x.mark.length + x.post.length)} ${p.after || ''}`, 190, false);
      sheet.innerHTML = `<p class="sh-site">Blotato help page</p><p class="sh-title">${both(dash(p.title || 'Help page'))}</p>${p.heading ? `<p class="sh-head">${both(dash(p.heading))}</p>` : ''}${before ? `<p class="sh-ctx">${esc(before)}</p>` : ''}<p class="sh-sent">${esc(x.pre)}<mark style="background-size:0% 100%">${esc(x.mark)}</mark>${esc(x.post)}</p>${after ? `<p class="sh-ctx sh-after">${esc(after)}</p>` : ''}`;
      const pw = $('#paper-wait'); if (pw) pw.textContent = 'The desk found the answer on this help page. Now it marks the exact sentence.';
      this.tick('read', 'done', pages === 1 ? "Read Blotato's help page" : `Read ${pages} of Blotato's help pages`);
      await this.wait(T.hold);
      this.mark('sweep');
      const m = $('mark', sheet);
      await this.sweep(m);
      m.style.backgroundSize = '';
      await this.wait(T.hold);
      this.travelling = this.travel(sheet, proofOf(firstFact));
      await this.wait(T.travel - 200);
    } else {
      if (sheet) await this.anim(sheet, [{ opacity: 1 }, { opacity: 0 }], { duration: T.sheetOut, fill: 'forwards' });
      sheet?.remove();
      this.tick('read', st === 'refused' && !pages ? 'done' : 'done', pages ? (pages === 1 ? "Read Blotato's help page" : `Read ${pages} of Blotato's help pages`) : searched ? "Searched Blotato's help pages" : 'No help page was needed');
    }

    if (st === 'refused') {
      this.tick('write', 'stop', 'Wrote no reply. It will not guess.');
      await this.write($('.lh h2', stage));
      for (const dd of $$('.lh dt, .lh dd', stage)) { this.write(dd, { dur: 160, gap: 40 }); await this.wait(110); }
      await this.wait(200);
    } else {
      this.tick('write', 'wait', 'Writing the reply');
      this.write($('#letter-h', stage), { dur: 220 });
      this.anim($('.mh', stage), [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
      await this.wait(120);
      this.write($('.head', stage), { dur: 180, gap: 60 });
      await this.travelling;
      await this.wait(80);
      for (let i = 0; i < steps.length; i++) {
        const pr = proofOf(i);
        if (steps[i].type === 'evidence' && called) this.tick('account', 'wait', 'Looking at their account');
        if (i !== firstFact) {
          this.anim(pr, [{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }], { duration: T.proof });
          this.sweep($('mark', pr), 260);
        }
        if (W) this.anim($(`.wire[data-i="${i}"] i`, stage), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: T.wire, delay: 60, easing: EASE_MARK });
        const row = $(`.lstep[data-i="${i}"]`, stage);
        if (!this.fast) row.classList.add('on'), pr.classList.add('on'), $(`.wire[data-i="${i}"]`, stage)?.classList.add('on');
        this.anim($('.num', row), [{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 120 });
        const w = this.write($('.txt', row), { gap: 60 });
        await this.wait((i === firstFact ? 100 : 0) + (steps.length > 4 ? 190 : T.step));
        if (steps[i].type === 'evidence' && called) this.tick('account', 'done', 'Looked at their account');
        w.then(() => { if (!this.done) { row.classList.remove('on'); pr.classList.remove('on'); $(`.wire[data-i="${i}"]`, stage)?.classList.remove('on'); } });
      }
      if (!called && searched) this.tick('read', 'done', pages ? "Read and searched the help pages" : "Searched Blotato's help pages");
      this.write($('.ltail', stage), { dur: 180, gap: 30 });
      this.tick('write', 'done', `Wrote ${steps.length} steps`);
      await this.wait(60);
    }

    // The stamp lands: pressed with weight, once.
    this.tick('check', 'wait', st === 'refused' ? 'Handing it to a person' : 'Looking for the second check');
    const stamp = $('.stamp', stage);
    const rot = W ? -7 : -6;
    this.mark('stampStart');
    await this.anim(stamp, [
      { opacity: 0, transform: `rotate(${rot - 5}deg) scale(1.7)` },
      { opacity: .9, offset: .6 },
      { opacity: 1, transform: `rotate(${rot}deg) scale(1)` },
    ], { duration: T.stamp, easing: EASE_THUD });
    this.mark('stampLanded');
    this.anim(stage, [{ transform: 'none' }, { transform: 'translateY(4px)' }, { transform: 'none' }], { duration: T.nudge, easing: 'ease-out', fill: 'none' });
    this.anim($('svg', stamp), [{ opacity: .72 }, { opacity: 1 }], { duration: 380, easing: 'ease-out', fill: 'none' });
    const f = r.fresh || {};
    if (st === 'checked') this.tick('check', 'done', `A second checker read it${f.checkedAt ? ` on ${day(f.checkedAt)}` : ''}`);
    else if (st === 'stopped') this.tick('check', 'stop', 'A second checker stopped it');
    else if (st === 'saved') this.tick('check', 'neutral', 'Changed since its second check');
    else if (st === 'refused') this.tick('check', 'needs', 'Passed to a person on the team');
    else this.tick('check', 'neutral', 'No second check yet');
    await this.wait(140);
    for (const el of $$('.closing, .notes', $('#after'))) this.anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 260 });
    this.finish(r);
  }

  async travel(sheet, proof) {
    if (!proof) { sheet.remove(); return; }
    const src = $('.sh-sent', sheet); const dst = $('.px', proof);
    proof.classList.remove('js-hold');
    if (this.fast) { sheet.remove(); return; }
    const A = src.getBoundingClientRect(); const B = dst.getBoundingClientRect();
    const s = Math.min(2.2, A.width / Math.max(1, B.width));
    dst.style.transformOrigin = '0 0'; proof.style.zIndex = '9';
    this.mark('travel');
    const go = this.anim(dst, [
      { transform: `translate(${A.left - B.left}px, ${A.top - B.top}px) scale(${s})`, opacity: 0 },
      { opacity: 1, offset: .22 },
      { transform: 'none', opacity: 1 },
    ], { duration: T.travel, easing: 'cubic-bezier(.33, 0, .15, 1)' });
    this.anim(src, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    const pw = $('#paper-wait'); if (pw) this.anim(pw, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).then(() => pw.remove());
    this.anim(sheet, [{ opacity: 1, transform: 'rotate(-.6deg)' }, { opacity: 0, transform: 'translate(-40px, 24px) rotate(-3deg)' }], { duration: T.sheetOut, delay: 90, fill: 'forwards', easing: 'cubic-bezier(.5,0,.75,0)' })
      .then(() => sheet.remove());
    for (const el of $$('.pk, .pw, .tech-only', proof)) this.anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: T.travel - 160 });
    await go;
    dst.style.transformOrigin = ''; proof.style.zIndex = '';
    if (this.fast) sheet.remove();
  }

  finish(r) {
    if (this.dead) return;
    this.done = true;
    this.mark('done');
    const host = $('#result');
    for (const el of $$('.js-hold', host)) el.classList.remove('js-hold');
    for (const m of $$('mark', host)) m.style.backgroundSize = '';
    $('.sheet', host)?.remove(); $('#paper-wait')?.remove();
    const sk = $('#skip-btn'); if (sk) sk.style.visibility = 'hidden';
    const st = stateOf(r);
    point(Math.max(0, (r.steps || []).findIndex(s => s.type === 'fact')));
    const words = { checked: 'Checked. Safe to send.', saved: 'Here is the reply. Read it once before you send it.', draft: 'Here is a draft. A second checker has not read it yet.', stopped: 'Stopped by the second checker. Do not send it.', refused: 'The desk did not write a reply. It passed the message to a person on the team.' }[st];
    say(`${words}${r.escalation && st !== 'refused' ? ' This one also goes to a person on the team.' : ''}`);
    if (this.meta.demo) return demo.done();
    const main = $('#after [data-copy="reply"]') || $('#fixed-btn') || $('#reword-btn') || $('#after [data-again]');
    main?.focus({ preventScroll: true });
  }

  fail(message) {
    this.done = true;
    this.tick('read', 'stop', 'The desk could not finish this one');
    const sk = $('#skip-btn'); if (sk) sk.style.visibility = 'hidden';
    $('#after').innerHTML = `<div class="closing"><p class="verdict" style="--tone: var(--block)"><b>Something went wrong.</b>${esc(message)}</p><div class="actions"><button type="button" class="btn" data-again>Try again</button></div></div>`;
    say('The desk could not finish this one.');
    $('#after [data-again]')?.focus();
  }
}

function showShell(meta) {
  const from = $('#msg').getBoundingClientRect();
  $('#ask').hidden = true;
  const res = $('#result');
  res.hidden = false;
  res.innerHTML = shellHTML(meta);
  scrollTo(0, 0);
  if (!history.state?.r) history.pushState({ r: 1 }, '', '#answer');
  // The box lifts and becomes the customer's quote.
  if (!reduced.matches && !meta.instant) {
    const q = $('#said-q'); const to = q.getBoundingClientRect();
    const dx = from.left - to.left; const dy = from.top - to.top;
    if (Math.abs(dy) < 1200) q.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: .4 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: EASE_OUT });
  }
}

async function start({ body, who, text, demo: isDemo = false, instant = false }) {
  moment?.stop();
  const m = moment = new Moment({ who, text, demo: isDemo, instant });
  showShell({ who, text, demo: isDemo, instant });
  const run = m.play();
  try {
    const res = await fetch('/api/ticket/live', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok || !res.body) { let msg = `HTTP ${res.status}`; try { msg = (await res.json()).error || msg; } catch { /* not json */ } m.push({ t: 'error', message: msg }); }
    else {
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) m.push(JSON.parse(line)); }
        if (done) break;
      }
      if (!m.result && !m.error) m.push({ t: 'error', message: 'The desk stopped before it finished. Try again.' });
    }
  } catch (e) { m.push({ t: 'error', message: `The desk could not be reached. ${e.message}` }); }
  await run;
  window.__lastMoment = m.marks;
  if (STATE) api('/api/state').then(s => { STATE = s; if (document.body.classList.contains('tech-on')) techHome(); }).catch(() => {});
}

async function startStopped() {
  moment?.stop();
  let r;
  try { r = await api('/api/example/stopped'); } catch (e) { $('#filled').textContent = `The example could not be loaded: ${e.message}`; return; }
  const m = moment = new Moment({ who: 'An n8n user', text: r.ticket.text, example: true });
  showShell({ who: 'An n8n user', text: r.ticket.text, example: true });
  const run = m.play();
  for (const ev of r.trace || []) m.push(ev);
  m.push({ t: 'result', result: r });
  await run;
  window.__lastMoment = m.marks;
}

// Back to the box. keepText: put the customer's words back so they can say it another way.
function back({ keepText = false, fromHistory = false } = {}) {
  const text = keepText ? (moment?.meta?.text || '') : '';
  moment?.stop(); moment = null;
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
  const text = kind === 'sabrina' ? (r.escalationText || '').replace(/^## Escalation\n\n/, '') : r.reply;
  const out = $(`[data-copied="${kind}"]`, btn.closest('section, .actions') || document);
  try { await navigator.clipboard.writeText(text); if (out) out.textContent = kind === 'sabrina' ? 'Copied. Paste it where Sabrina will see it.' : 'Copied. Paste it into your reply to the customer.'; }
  catch { if (out) out.textContent = 'Your browser blocked copying. Select the text and copy it by hand.'; }
}

// ---------------------------------------------------------------- the first-open example
// First visit only: the first example types itself in and the desk answers it, live, while you watch.
const demo = {
  running: false, skipped: false, typing: false,
  wanted() {
    const q = new URLSearchParams(location.search);
    if (q.has('nodemo')) return false;
    if (q.has('demo')) return true;
    return !store.get('sd-demo-seen') && location.hash !== '#practice';
  },
  async run() {
    if (this.running) return;
    this.running = true; this.skipped = false;
    store.set('sd-demo-seen', '1');
    const btn = $(`#tries button[data-id="${DEMO_ID}"]`);
    const text = $('.t', btn).textContent;
    if (reduced.matches) { pick(btn, { focus: false }); return this.go(btn, text, true); }
    $('#demo-skip').hidden = false;
    $('#filled').textContent = 'Watch: an example is going in the box.';
    await sleep(800);
    if (!this.running) return;
    btn.setAttribute('aria-pressed', 'true');
    this.typing = true;
    const box = $('#msg');
    for (let i = 1; i <= text.length && this.running && !this.skipped; i += 2) { box.value = text.slice(0, i); await sleep(17); }
    this.typing = false;
    if (!this.running) return;
    pick(btn, { focus: false });
    if (!this.skipped) {
      await sleep(320);
      if (!this.running) return;
      $('#answer-btn').animate([{ transform: 'none' }, { transform: 'scale(.97)' }, { transform: 'none' }], { duration: 200, easing: 'ease-out' });
      await sleep(160);
    }
    if (!this.running) return;
    this.go(btn, text, this.skipped);
  },
  go(btn, text, instant) {
    $('#demo-skip').hidden = true;
    start({ body: { id: DEMO_ID }, who: btn.dataset.who, text, demo: true, instant });
  },
  skip() {
    if (!this.running) return;
    if (this.typing || !moment) { this.skipped = true; return; }
    moment.skip();
  },
  done() {
    const bar = $('#demo-bar'); if (!bar) return;
    $('#demo-say').innerHTML = '<b>That was an example.</b> The desk answered it live, from Blotato\'s real help pages. Now try your own.';
    const b = $('#demo-skip2'); b.classList.remove('quiet'); b.id = 'try-own'; b.textContent = 'Now try your own';
    this.running = false;
    b.focus({ preventScroll: true });
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
    $('#tray').innerHTML = `<p class="tray-k">Letters on your desk</p><ol>${this.data.decisions.map((_, k) => {
      const p = this.picks[k]; const s = p ? (p.right ? 'right' : 'wrong') : k === this.i && this.phase !== 'start' && this.phase !== 'end' ? 'now' : '';
      return `<li data-s="${s}">${k + 1}${p ? `<span class="mini">${roundMark(p.right, k + 1, true)}</span>` : ''}<span class="sr-only">Customer ${k + 1}: ${p ? (p.right ? 'helped' : 'not helped') : k === this.i ? 'now' : 'still to come'}</span></li>`;
    }).join('')}</ol><p class="tally">Stamps earned: <b>${this.score}</b> of ${n}</p>`;
  },
  startScreen() {
    this.phase = 'start'; this.picks = []; this.score = 0; this.i = 0;
    this.tray();
    $('#game-stage').innerHTML = `<ol class="desk" aria-label="The five customers waiting">${this.data.decisions.map(d => {
      const c = custOf(d); const f = this.face(d, '', 120);
      return `<li>${f ? f.replace('<img', '<img class="dface"') : ''}<b>${esc(c.who)}</b><p class="dq">${esc(d.ticket)}</p></li>`;
    }).join('')}</ol>
    <div class="desk-go"><button type="button" class="btn" id="game-go">Start my shift</button><p class="key-hint">Keys <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> press the stamps. <kbd>Enter</kbd> opens the next letter.</p></div>`;
  },
  begin() { this.i = 0; this.score = 0; this.picks = []; this.round(); },
  lock(ms = 380) { this.lockUntil = performance.now() + ms; },
  locked() { return performance.now() < this.lockUntil; },
  round() {
    const d = this.data.decisions[this.i]; this.phase = 'ask'; this.lock();
    const c = custOf(d); const n = this.data.decisions.length;
    this.tray();
    // Get this customer's other two moods ready, so the change is instant.
    for (const m of ['relieved', 'upset']) if (ART.has(`${c.slot}-${m}`)) { const im = new Image(); im.src = `/art/${c.slot}-${m}.webp`; }
    const face = this.face(d, '', 280);
    $('#game-stage').innerHTML = `<div class="round">
      <div class="cust">${face ? `<div class="face" id="face">${face}</div>` : ''}<div><p class="cname">${esc(c.who)}</p><p class="cmood" id="cmood">Waiting for your answer</p></div></div>
      <div class="letters">
        <article class="cust-letter" id="cust-letter" aria-labelledby="cust-from">
          <p class="lt-top" aria-hidden="true"><span>Letter ${this.i + 1} of ${n}</span><span>To: Blotato support</span></p>
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
    if (!reduced.matches) {
      $('#cust-letter').animate([{ opacity: 0, transform: 'translateY(-40px) rotate(-4deg)' }, { opacity: 1, transform: 'rotate(-.5deg)' }], { duration: 460, easing: EASE_OUT });
      $('#face')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' });
    }
    say(`Letter ${this.i + 1} of ${n}. ${c.who} writes: ${d.ticket}`);
    $('#cust-from').focus({ preventScroll: true });
    if ($('#view-practice').getBoundingClientRect().top < 0) $('#view-practice').scrollIntoView({ block: 'start' });
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
    // The customer's face changes with what happened.
    const mood = this.face(d, ch.right ? 'relieved' : 'upset', 280);
    const faceBox = $('#face');
    if (mood && faceBox) {
      const old = $('img', faceBox);
      faceBox.insertAdjacentHTML('beforeend', mood);
      const fresh = faceBox.lastElementChild;
      if (reduced.matches) old?.remove();
      else fresh.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay: 260, easing: 'ease-out', fill: 'backwards' }).finished.then(() => old?.remove(), () => old?.remove());
    }
    $('#cmood').textContent = ch.right ? 'Relieved' : 'Upset';
    $('#cmood').className = `cmood ${ch.right ? 'ok' : 'no'}`;
    // The stamp lands on their letter.
    const letter = $('#cust-letter');
    letter.insertAdjacentHTML('beforeend', `<div class="stamp" data-tone="${ch.right ? 'helped' : 'oops'}">${postmark(ch.right ? 'helped' : 'oops', { center: ['LETTER', String(this.i + 1), `OF ${this.data.decisions.length}`], word: verbOf(d, k).toUpperCase() })}</div>`);
    const stamp = $('.stamp', letter);
    if (!reduced.matches) {
      stamp.animate([{ opacity: 0, transform: 'rotate(-12deg) scale(1.7)' }, { opacity: .9, offset: .6 }, { opacity: 1, transform: 'rotate(-7deg) scale(1)' }], { duration: T.stamp, delay: 90, easing: EASE_THUD, fill: 'backwards' });
      letter.animate([{ transform: 'rotate(-.8deg)' }, { transform: 'rotate(-.8deg) translateY(5px)' }, { transform: 'rotate(-.8deg)' }], { duration: T.nudge, delay: T.stamp + 90 });
    }
    // They write back.
    const wb = writeBack(d, k);
    $('#write-back').innerHTML = `<article class="write-back" aria-labelledby="wb-h"><h3 class="from" id="wb-h">${esc(c.who)} writes back:</h3>${wb ? `<p class="wb">&ldquo;${esc(wb)}&rdquo;</p>` : ''}<p class="what">${esc(ch.consequence)}</p></article>`;
    if (!reduced.matches) $('.write-back').animate([{ opacity: 0, transform: 'translateY(22px) rotate(1.5deg)' }, { opacity: 1, transform: 'rotate(.6deg)' }], { duration: 420, delay: 420, easing: EASE_OUT, fill: 'backwards' });
    const last = this.i + 1 >= this.data.decisions.length;
    const p = d.source.page;
    const sent = p?.found && p.mark ? sentence(p) : { pre: '', mark: d.source.quote.replace(/^["\u201C]|["\u201D]$/g, '').replace(/`/g, ''), post: '' };
    const fits = !HARD.test(`${sent.pre}${sent.mark}${sent.post}`);
    const quote = `<p class="x">${esc(sent.pre)}<mark>${esc(sent.mark)}</mark>${esc(sent.post)}</p>`;
    $('#after-move').innerHTML = `<h3>${ch.right ? 'You got it.' : 'The right first move'}</h3><p class="right-move">${both(d.firstCheck)}</p>
      <div class="game-next"><button type="button" class="btn" id="game-next">${last ? 'See my shift report' : 'Open the next letter'}</button><span class="hint">or press Enter</span></div>
      <div class="src"><p class="k">${fits ? "Blotato's help page says" : "Blotato's help page explains why"}</p>${fits ? quote : `<div class="tech-only">${quote}</div>`}<a href="${esc(d.source.url)}" target="_blank" rel="noopener">Open the help page</a></div>`;
    this.tray();
    say(`${ch.right ? 'Helped.' : 'Oops.'} ${c.who} writes back. ${wb || ''} ${ch.consequence}`);
    $('#game-next').focus({ preventScroll: true });
    const ws = $('#write-back').getBoundingClientRect();
    if (ws.bottom > innerHeight && !wide()) $('#write-back').scrollIntoView({ block: 'nearest' });
  },
  next() {
    if (this.phase !== 'after' || this.locked()) return;
    this.i++;
    if (this.i >= this.data.decisions.length) return this.end();
    this.round();
  },
  end() {
    this.phase = 'end'; this.lock(); this.tray();
    const n = this.data.decisions.length; const s = this.score;
    const line = s === n ? 'A clean shift. Every customer got the right first move, so nobody posted twice and nobody waited for nothing.'
      : s >= n - 1 ? 'A good shift. One customer had a rough moment. Here is the right first move for each one.'
      : 'Every wrong move here is a real way a support message goes sideways. Here is the right first move for each one, so next time you will know.';
    const title = s === n ? 'You are ready for a real shift.' : s >= n - 1 ? 'Nearly ready for a real shift.' : s >= 2 ? 'A good start. Play once more.' : 'Every pro starts here. Play once more.';
    const pic = art('shift-end', 'A desk at dusk with five stamped envelopes, a mug, a highlighter and a lamp.', 1200, 600, 'report-art');
    $('#game-stage').innerHTML = `<div class="report">
      <div class="report-paper">
        ${pic}
        <p class="report-k">Shift report</p>
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
    </div>`;
    if (!reduced.matches) {
      $$('.earned .em').forEach((el, k) => el.animate([{ opacity: 0, transform: `rotate(${k % 2 ? 6 : -9}deg) scale(1.6)` }, { opacity: 1, transform: `rotate(${k % 2 ? 6 : -9}deg) scale(1)` }], { duration: T.stamp, delay: 300 + k * 160, easing: EASE_THUD, fill: 'backwards' }));
    }
    say(`Your shift is over. You helped ${s} of ${n} customers.`);
    $('#score-h').focus({ preventScroll: true });
    $('#view-practice').scrollIntoView({ block: 'start' });
  },
};

// ---------------------------------------------------------------- wiring
function wire() {
  addEventListener('hashchange', route);
  addEventListener('popstate', () => { if (!history.state?.r && !$('#result').hidden) back({ fromHistory: true }); });
  $('#ask-form').addEventListener('submit', (e) => { e.preventDefault(); demo.cancel(); submit(); });
  $('#msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
  $('#msg').addEventListener('input', () => {
    if (picked && $('#msg').value !== picked.text) { picked = null; for (const b of $$('.tries-list button')) b.setAttribute('aria-pressed', 'false'); }
    $('#filled').textContent = '';
  });
  $('#msg').addEventListener('pointerdown', () => { if (demo.typing) { demo.cancel(); $('#msg').value = ''; $('#filled').textContent = ''; } });
  $('#tries').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { demo.cancel(); pick(b); } });
  $('#more-list').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b); });
  $('#more-btn').addEventListener('click', () => {
    const open = $('#more-btn').getAttribute('aria-expanded') !== 'true';
    $('#more-btn').setAttribute('aria-expanded', String(open)); $('#more').hidden = !open;
    $('#more-btn').textContent = open ? 'Show fewer examples' : 'Show more examples';
  });
  $('#stopped-btn').addEventListener('click', startStopped);
  $('#demo-skip').addEventListener('click', () => demo.skip());
  $('#watch-btn').addEventListener('click', () => { demo.running = false; demo.run(); });

  document.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-tech-switch]'); if (sw) return setTech(sw.getAttribute('aria-checked') !== 'true');
    if (e.target.closest('#back')) return leave();
    if (e.target.closest('#skip-btn')) return moment?.skip();
    if (e.target.closest('#demo-skip2')) return demo.skip();
    if (e.target.closest('#try-own')) return leave();
    if (e.target.closest('#reword-btn')) return back({ keepText: true });
    if (e.target.closest('#fixed-btn')) { const t = STATE?.tickets.find(x => x.id === 'T07'); return start({ body: { id: 'T07' }, who: 'An n8n user', text: t?.text || moment?.meta?.text || '' }); }
    if (e.target.closest('[data-again]')) { leave(); if (e.target.closest('.refusal-actions')) $('#tries').scrollIntoView({ block: 'center' }); return; }
    const c = e.target.closest('[data-copy]'); if (c) return copy(c.dataset.copy, c);
    const more = e.target.closest('.page-toggle');
    if (more) {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'Show only the sentence' : 'Show the whole paragraph';
      for (const pr of $$('#stage .proof')) {
        const step = moment?.result?.steps?.[Number(pr.dataset.i)];
        if (step?.page?.found && step.page.mark) $('.px', pr).innerHTML = open ? paragraphHTML(step.page) : sentenceHTML(step.page);
      }
      return;
    }
    const step = e.target.closest('.lstep');
    if (step && !e.target.closest('a') && moment?.done) point(Number(step.dataset.i));
    if (e.target.closest('#game-go')) return game.begin();
    if (e.target.closest('#game-next')) return game.next();
    if (e.target.closest('#game-again')) return game.begin();
    const ch = e.target.closest('.choice'); if (ch && !ch.disabled) return game.answer(Number(ch.dataset.k));
  });
  // Pointing at a step (or its proof) makes the pair stand out.
  const over = (e) => { if (!moment?.done) return; const el = e.target.closest?.('.lstep, .proof'); if (el) point(Number(el.dataset.i)); };
  document.addEventListener('mouseover', over);
  document.addEventListener('focusin', (e) => { const s = e.target.closest?.('.lstep'); if (s && moment?.done) point(Number(s.dataset.i)); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (demo.running) { demo.skip(); return; }
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
  const wantDemo = demo.wanted() && location.hash !== '#practice';
  if (wantDemo) demo.run();
  try {
    STATE = await api('/api/state');
    fillExamples();
    if (!STATE.mock) $('#sample-note').textContent = "A real Blotato account is connected. The desk only reads it. The help pages are Blotato's real ones.";
    if (document.body.classList.contains('tech-on')) techHome();
  } catch (e) {
    $('#sample-note').textContent = `The desk could not be reached: ${e.message}`;
  }
})();
