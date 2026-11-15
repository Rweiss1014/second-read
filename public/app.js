// Support Desk page. No framework, no animation library: the motion is written by hand with the
// Web Animations API, and only transform, opacity, clip-path (small parts) and background-size move.
// Every beat of "the moment" waits for a real event from the desk (POST /api/ticket/live).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (t) => t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
const dayTime = (t) => t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const wide = () => matchMedia('(min-width: 901px)').matches;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_MARK = 'cubic-bezier(0.65, 0, 0.35, 1)';
const EASE_THUD = 'cubic-bezier(0.5, 0, 0.75, 0)';
const T = { press: 360, read: 420, sweep: 840, line: 560, account: 350, reveal: 240, paper: 300, step: 160, write: 240, wire: 240, verdict: 160, stamp: 220, nudge: 120 };

let STATE = null;
let ART = new Set();
let picked = null; // the example in the box: { id, who, text }
let moment = null;

function say(msg) { const el = $('#live'); el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; }); }

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------------------------------------------------------------- art slots
// A slot shows art only when public/art/<slot>.webp exists. Otherwise it leaves nothing at all.
function art(slot, alt, size) {
  if (!ART.has(slot)) return '';
  return `<img src="/art/${esc(slot)}.webp" alt="${esc(alt || '')}"${size ? ` width="${size}" height="${size}"` : ''} decoding="async">`;
}
function fillSlots(root = document) {
  for (const el of $$('[data-slot]', root)) el.innerHTML = art(el.dataset.slot, el.dataset.alt);
  if (ART.has('app-mark') && !$('#brand img')) {
    $('#brand').insertAdjacentHTML('afterbegin', art('app-mark', '', 32));
    const link = document.createElement('link'); link.rel = 'icon'; link.href = '/art/app-mark.webp'; document.head.append(link);
  }
}

// ---------------------------------------------------------------- views and the switch
function route() {
  const practice = location.hash === '#practice';
  $('#view-answer').hidden = practice;
  $('#view-practice').hidden = !practice;
  $('#nav-answer').toggleAttribute('aria-current', !practice);
  $('#nav-practice').toggleAttribute('aria-current', practice);
  if (!practice) $('#nav-answer').setAttribute('aria-current', 'page'); else $('#nav-practice').setAttribute('aria-current', 'page');
  document.title = practice ? 'Practice game, Support Desk' : 'Support Desk';
  if (practice) game.open();
  else requestAnimationFrame(layoutAnswer);
}

function setTech(on, save = true) {
  document.body.classList.toggle('tech-on', on);
  for (const b of $$('[data-tech-switch]')) b.setAttribute('aria-checked', String(on));
  if (save) store.set('sd-tech', on ? '1' : '0');
  if (on) techHome();
  requestAnimationFrame(layoutAnswer);
}

// ---------------------------------------------------------------- the first screen
const whoOf = (from) => { const w = String(from || '').replace(/\s*\(made up\)\s*$/, ''); return w ? w[0].toUpperCase() + w.slice(1) : 'A customer'; };
const EXTRA = [
  { text: 'I canceled my plan last month but you charged me again. I want a refund.', who: 'A customer who wants their money back', writer: 'A customer' },
  { text: "Blotato says my post is published but I can't see it on Instagram.", who: 'The first example, asked a new way', writer: 'A creator' },
  { text: 'Banana phone purple. Does it work on Tuesdays?', who: 'A message that makes no sense', writer: 'A customer' },
];

function exampleButton({ id, text, who, writer }) {
  return `<li><button type="button"${id ? ` data-id="${esc(id)}"` : ''} data-who="${esc(writer || who)}" aria-pressed="false"><span class="q" aria-hidden="true">&ldquo;</span><span class="t">${esc(text)}</span><span class="who">${esc(who)}</span></button></li>`;
}

function fillExamples() {
  const shown = new Set($$('#tries button').map(b => b.dataset.id));
  // Keep the first four exactly as the desk has them, so they run as the sample messages.
  for (const b of $$('#tries button')) { const t = STATE.tickets.find(x => x.id === b.dataset.id); if (t) $('.t', b).textContent = t.text; }
  const order = ['T11', 'T12', 'T10', 'T09', 'T06', 'T07', 'T08', 'T03'];
  const rest = STATE.tickets.filter(t => !shown.has(t.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  $('#more-list').innerHTML = [...rest.map(t => exampleButton({ id: t.id, text: t.text, who: whoOf(t.from) })), ...EXTRA.map(exampleButton)].join('');
}

function pick(btn) {
  const text = $('.t', btn).textContent;
  $('#msg').value = text;
  picked = { id: btn.dataset.id || null, who: btn.dataset.who || null, text };
  for (const b of $$('.tries-list button')) b.setAttribute('aria-pressed', String(b === btn));
  $('#filled').textContent = 'It is in the box. Press "Answer it" when you are ready.';
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
      <dt>Account data</dt><dd>${s.mock ? 'Sample data (<code>--mock</code>). No account is connected. Every account lookup reads made-up posts.' : 'A real Blotato account, read-only.'}</dd>
      <dt>Read-only</dt><dd>${s.readOnly ? 'Yes. The API client refuses anything but GET, and there is no switch to change that.' : 'No'}</dd>
      <dt>Help pages on hand</dt><dd>${s.docs.pages} pages, read ${esc(s.docs.via.join(', ') || 'not yet')}${s.docs.newest ? `, newest ${esc(dayTime(s.docs.newest))}` : ''}</dd>
      <dt>Problems on file</dt><dd>${s.failures} in <code>desk/known-failures.md</code>, checked first on every message</dd>`;
  } catch (e) { $('#tech-state').innerHTML = `<dt>Error</dt><dd>${esc(e.message)}</dd>`; }
}

// A small Markdown reader for the packets: headings, bold, lists, quotes, diff blocks.
function md(text) {
  const out = []; let inCode = false; let list = false;
  for (const raw of String(text || '').split('\n')) {
    if (raw.startsWith('```')) { if (list) { out.push('</ul>'); list = false; } out.push(inCode ? '</pre>' : '<pre>'); inCode = !inCode; continue; }
    if (inCode) { const cls = raw.startsWith('+') ? 'add' : raw.startsWith('-') ? 'del' : ''; out.push(`<span class="${cls}">${esc(raw)}</span>\n`); continue; }
    const l = esc(raw).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(https:\/\/[^\s)"&]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    if (/^- /.test(raw)) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${l.slice(2)}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (/^### /.test(raw)) out.push(`<h3>${l.slice(4)}</h3>`);
    else if (/^## /.test(raw)) out.push(`<h2>${l.slice(3)}</h2>`);
    else if (/^# /.test(raw)) out.push(`<h2>${l.slice(2)}</h2>`);
    else if (/^&gt; /.test(l)) out.push(`<blockquote>${l.slice(5)}</blockquote>`);
    else if (raw.trim()) out.push(`<p>${l}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

// ---------------------------------------------------------------- plain words for the result
const cleared = (r) => r.check?.pass && r.fresh?.state === 'passed';
function stateOf(r) {
  if (!r.entry) return 'refused';
  if (!r.check.pass || r.fresh?.state === 'blocked') return 'stopped';
  if (r.fresh?.state === 'passed') return 'checked';
  return 'waiting';
}

function plainEvidence(ev) {
  if (!ev) return 'The desk did not need to look at the account for this one.';
  const s = ev.summary || '';
  if (ev.kind === 'recent-published') {
    const first = s.split(/\.\s/)[0].replace(/^Blotato shows /, '');
    const d = s.match(/from \w{3}, (\d{1,2}) (\w{3}) \d{4}/);
    return `${first[0].toUpperCase()}${first.slice(1)}.${d ? ` The newest went out on ${d[2]} ${d[1]}.` : ''}`;
  }
  if (ev.kind === 'recent-activity') return s.replace(/^from/, 'From').replace(/ I see /, ', the account shows ').replace(/\s*\(id [^)]*\)/g, '');
  if (ev.kind === 'submission') return ev.missing ? 'There was no post number in the message, so the desk could not look it up.' : `The desk looked up this post. Blotato says it is "${ev.status}".`;
  if (ev.kind === 'reproduce-schedule') return ev.missing ? 'There was nothing in the message the desk could try again.' : ev.ok ? 'The desk tried the same request on the account and got the same error back.' : 'The desk tried the same request and got a different answer back.';
  if (ev.kind === 'docs-search') {
    const titles = [...new Set((ev.searched || []).flatMap(q => q.results.slice(0, 2).map(x => x.title)).filter(Boolean))].slice(0, 3);
    return `The desk searched Blotato's help pages${titles.length ? `. The closest pages it found: ${titles.join(', ')}` : ''}.`;
  }
  return s;
}

function stepLabel(step, r) {
  if (step.type === 'fact') return "From Blotato's help page";
  if (step.type === 'evidence') return r.evidence?.kind === 'docs-search' ? 'From a search of the help pages' : 'From their account';
  return "The desk's own step";
}

// The sentence inside its paragraph, trimmed for the margin. Dim around it, bright in it.
function contextHTML(page, pad = 48) {
  const t = page.text; const [s, e] = page.mark;
  let a = Math.max(0, s - pad); let b = Math.min(t.length, e + pad);
  if (a > 0) { const sp = t.indexOf(' ', a); a = sp >= 0 && sp < s ? sp + 1 : a; }
  if (b < t.length) { const sp = t.lastIndexOf(' ', b); b = sp > e ? sp : b; }
  const pre = (a > 0 && !t.slice(a).startsWith('...') ? '... ' : '') + t.slice(a, s);
  const post = t.slice(e, b) + (b < t.length && !t.slice(0, b).endsWith('...') ? ' ...' : '');
  return `${esc(pre)}<mark>${esc(t.slice(s, e))}</mark>${esc(post)}`;
}
function fullContextHTML(page) {
  const t = page.text; const [s, e] = page.mark;
  return `${page.before ? `${esc(page.before)} ` : ''}${esc(t.slice(0, s))}<mark>${esc(t.slice(s, e))}</mark>${esc(t.slice(e))}${page.after ? ` ${esc(page.after)}` : ''}`;
}

function proofHTML(step, i, r, mode, prev) {
  const n = i + 1;
  const cite = (r.check?.citations || []).find(c => c.step === n);
  const flagged = r.example?.plain?.names?.includes(n);
  if (step.type === 'fact') {
    const p = step.page;
    const samePlace = prev && prev.page && p && prev.page.title === p.title && prev.page.heading === p.heading;
    const where = !p ? '' : samePlace ? 'The same help page, a little further on' : `${p.title || 'Help page'}${p.heading ? `: ${p.heading}` : ''}`;
    const x = p?.found && p.mark ? contextHTML(p) : `<mark>${esc(step.quote)}</mark>`;
    return `<p class="k">Step ${n}, from Blotato's help page${flagged ? ': the checker named this step' : ''}</p>
      ${where ? `<p class="where" title="${esc(`${p.title || ''}${p.heading ? `: ${p.heading}` : ''}`)}">${esc(where)}</p>` : ''}
      <p class="x" data-short="1">${x}</p>
      <p class="tech-only"><a href="${esc(step.url)}" target="_blank" rel="noopener">${esc(String(step.url).replace('https://', ''))}</a>${cite?.fetchedAt ? `, read ${esc(dayTime(cite.fetchedAt))}` : ''}${cite?.via ? ` (${esc(cite.via)})` : ''}. ${cite ? (cite.found ? 'Script check: the quote is on the page.' : 'Script check: the quote is NOT on the page.') : ''}</p>`;
  }
  if (step.type === 'evidence') {
    const search = r.evidence?.kind === 'docs-search';
    return `<p class="k">Step ${n}, ${search ? 'from a search of the help pages' : 'from their account'}${flagged ? ': the checker named this step' : ''}</p>
      <p class="plain">${esc(plainEvidence(r.evidence))}</p>
      <p class="tech-only">${(r.evidence?.calls || []).map(c => `<code>${esc(c)}</code>`).join('<br>') || 'No call was made.'}</p>`;
  }
  return `<p class="k">Step ${n}, something the desk does${flagged ? ': the checker named this step' : ''}</p>
    <p class="plain">${r.escalation ? 'The desk wrote a note for Sabrina with everything it checked. You can read it under the answer.' : 'This step is the desk\'s own action, so there is no page to quote.'}</p>`;
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
      if (/^Next step:/.test(line)) return `<p class="next${flagNext ? ' flag' : ''}">${esc(line)}</p>`;
      const m = line.match(/^Help page: (https:\/\/\S+)$/);
      if (m) return `<p class="helplink">Help page: <a href="${esc(m[1])}" target="_blank" rel="noopener">${esc(m[1].replace('https://', ''))}</a></p>`;
      return `<p>${esc(line)}</p>`;
    }).join('');
  }).join('');
}

function splitCause(c) {
  const guess = /\(Not documented: a guess to confirm\.\)/.test(c);
  const [text] = c.replace(/\s*\(Not documented: a guess to confirm\.\)/, '').split(/ Source: https?:\/\//);
  const sourced = / Source: https?:\/\//.test(c);
  return { text: (sourced ? text.replace(/\s*\(documented\)/g, '') : text).trim(), tag: guess ? 'a guess to check' : sourced ? 'from the help page' : '' };
}

function plainChecked(r, trace) {
  const pages = new Set((trace || []).filter(e => e.t === 'page').map(e => e.url)).size;
  const parts = [];
  if (pages) parts.push(`I read ${pages === 1 ? "one of Blotato's help pages" : `${pages} of Blotato's help pages`}.`);
  if ((trace || []).some(e => e.t === 'search')) parts.push('I searched the help pages for the question.');
  if (r.evidence && r.evidence.kind !== 'docs-search') parts.push(plainEvidence(r.evidence).replace(/^The desk /, 'I '));
  return parts.join(' ') || 'Nothing could be checked.';
}

function sabrinaHTML(r, own = true) {
  const e = r.escalation; if (!e) return '';
  const li = (arr, none) => arr.length ? `<ul>${arr.map(c => { const x = splitCause(c); return `<li>${esc(x.text)}${x.tag ? ` <span class="src-tag">(${x.tag})</span>` : ''}</li>`; }).join('')}</ul>` : `<p>${esc(none)}</p>`;
  const why = String(e.why).replace(/this ticket/g, 'this message');
  return `<section class="note-card sabrina" aria-labelledby="sab-h">
    <h3 id="sab-h">This one needs Sabrina</h3>
    <div class="letterish">
      <p>Hi Sabrina,</p>
      <p>A customer wrote: &ldquo;${esc(e.asked)}&rdquo;</p>
      <span class="lbl">Why it needs you</span><p>${esc(why)}</p>
      <span class="lbl">What I checked</span><p>${esc(plainChecked(r, r.trace))}</p>
      <span class="lbl">What I think it is</span>${li(e.causes, 'Not known yet. The help pages have no answer, so I will not guess.')}
      ${e.ruledOut.length ? `<span class="lbl">What I ruled out</span>${li(e.ruledOut, '')}` : ''}
    </div>
    ${own ? '<button type="button" class="btn-quiet" data-copy="sabrina">Copy the note for Sabrina</button> <span class="copied" data-copied="sabrina" aria-live="polite"></span>' : ''}
  </section>`;
}

function docEditHTML(r) {
  const d = r.docEdit; if (!d || !r.entry) return '';
  const title = d.page?.title || d.article.replace(/^https:\/\/help\.blotato\.com\//, '');
  let sheet;
  if (d.kind === 'change') {
    const p = d.page;
    const ctx = p?.found && p.mark
      ? (() => { const t = p.text; const [s, e] = p.mark; let a = Math.max(0, s - 60); let z = Math.min(t.length, e + 90); if (a > 0) a = t.indexOf(" ", a) + 1 || a; if (z < t.length) z = t.lastIndexOf(" ", z) > e ? t.lastIndexOf(" ", z) : z; return `${a > 0 ? "... " : ""}${esc(t.slice(a, s))}<span class="red-out">${esc(t.slice(s, e))}</span> <span class="red-in">${esc(d.after)}</span>${esc(t.slice(e, z))}${z < t.length ? " ..." : ""}`; })()
      : `<span class="red-out">${esc(d.before)}</span> <span class="red-in">${esc(d.after)}</span>`;
    sheet = `<p class="ctx">${ctx}</p><div class="red-new">${esc(d.add)}</div>`;
  } else {
    sheet = `<div class="red-new"><b>${esc(d.heading)}</b>${esc(d.add)}</div>`;
  }
  const heading = d.kind === 'change' ? 'A help page needs a fix' : "The help pages don't cover this yet";
  const lead = d.kind === 'change'
    ? `The desk found a help page that leads people the wrong way. Here is the change it suggests to the page "${esc(title)}". Sabrina decides if it goes in.`
    : `The desk suggests a new entry for the help page "${esc(title)}". Sabrina writes the answer and decides if it goes in.`;
  return `<section class="note-card doc" aria-labelledby="doc-h">
    <h3 id="doc-h">${heading}</h3>
    <p>${lead}</p>
    <div class="page-sheet"><p class="ttl">Help page: ${esc(title)}</p>${sheet}</div>
    <p class="red-note">In red pencil: what the desk would change. Nothing changes on the real help page until a person does it.</p>
  </section>`;
}

function checkerHTML(r) {
  const f = r.fresh || {};
  const st = stateOf(r);
  if (st === 'refused') return '';
  if (st === 'checked') {
    const notes = (f.notes || []).length;
    return `<p class="checker-note"><strong>Who checked it?</strong> First, a script made sure every quote is really on its help page. Then a second AI read this exact reply with only the help pages beside it, and tried to find a mistake. It found none${f.checkedAt ? ` on ${esc(day(f.checkedAt))}` : ''}.${notes ? ` It left ${notes === 1 ? 'one small note' : `${notes} small notes`}, which you can read in the technical details.` : ''}</p>`;
  }
  if (st === 'stopped') {
    const plain = r.example?.plain;
    const why = plain?.why || f.why || (r.check.problems || [])[0] || '';
    const more = plain?.more || [];
    return `<div class="checker-note stopped"><p><strong>Stopped by the second checker.</strong> A second AI read this reply with only the help pages beside it, and tried to find a mistake. It found one. ${esc(why)}</p>${more.length ? `<p>It also said:</p><ul>${more.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div>`;
  }
  if (f.state === 'passed-saved') return `<p class="checker-note"><strong>Changed since its second check.</strong> A second AI checked an earlier copy of this reply${f.checkedAt ? ` on ${esc(day(f.checkedAt))}` : ''}. Today's account lookup changed a few words, so read it yourself before you send it.</p>`;
  if (f.state === 'stale') return '<p class="checker-note"><strong>This reply changed since it was checked.</strong> Check it again before you send it.</p>';
  return '<p class="checker-note"><strong>Not checked by a second reader yet.</strong> A script made sure every quote is really on its help page. A second AI has not read this exact reply yet, so treat it as a draft and read it yourself before you send it.</p>';
}

function techHTML(r) {
  const f = r.fresh || {};
  const calls = (r.trace || []).map(e => {
    if (e.t === 'page') return `<li><span class="what">docs MCP getPage ${esc(e.url)}</span><span class="meta">${e.ok ? `${e.fromCache ? 'from the local copy' : 'fetched now'}, read ${esc(dayTime(e.fetchedAt))} via ${esc(e.via)}` : 'could not be read'}, ${e.ms} ms</span></li>`;
    if (e.t === 'search') return `<li><span class="what">docs MCP searchDocumentation "${esc(e.query)}"</span><span class="meta">${e.offline ? 'skipped (offline)' : `${e.results} results`}, ${e.ms} ms</span></li>`;
    if (e.t === 'call') return `<li><span class="what">${esc(e.method)} ${esc(decodeURIComponent(e.path))}</span><span class="meta">HTTP ${esc(e.status ?? 'none')}, request id <code>${esc(e.requestId || 'none')}</code>${e.upstreamRequestId ? `, Blotato reqId <code>${esc(e.upstreamRequestId)}</code>` : ''}${e.error ? `, ${esc(e.error)}` : ''}, ${e.ms} ms${r.mock ? ', sample data' : ''}</span></li>`;
    return '';
  }).join('');
  const steps = (r.steps || []).map((s, i) => {
    const c = (r.check?.citations || []).find(x => x.step === i + 1);
    return `<li><span class="what">${esc(s.type)}${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ''}</span><span class="meta">${s.quote ? `"${esc(s.quote)}"` : esc(s.type === 'evidence' ? (r.evidence?.summary || '') : 'No source: an action the desk takes.')}${c ? ` ${c.found ? 'Found on the page' : 'NOT found on the page'}${c.fetchedAt ? `, page read ${esc(dayTime(c.fetchedAt))}` : ''}.` : ''}</span></li>`;
  }).join('');
  const findings = f.findings || f.notes || [];
  const name = f.name || (r.ticket?.id || 'pasted');
  const mock = r.mock ? ' --mock' : '';
  const cmd = r.ticket?.id ? `node bin/support-desk.mjs ticket --id ${r.ticket.id} --save-reply${mock}` : `node bin/support-desk.mjs ticket "${String(r.ticket?.text || '').replace(/["\\$`]/g, c => '\\' + c)}" --save-reply${mock}`;
  const ex = r.example;
  return `<section class="tech" aria-labelledby="tech-h">
    <h2 id="tech-h">Technical details</h2>
    <dl class="kv">
      <dt>Status</dt><dd>${esc(r.status)}</dd>
      <dt>Outcome</dt><dd><code>${esc(r.outcome)}</code></dd>
      <dt>Playbook entry</dt><dd>${r.entry ? `<code>${esc(r.entry.id)}</code> (${esc(r.entry.kind)}): ${esc(r.entry.title)}` : 'none matched'}</dd>
      <dt>Ticket</dt><dd><code>${esc(r.ticket?.id || name)}</code></dd>
      <dt>Account data</dt><dd>${r.mock ? 'sample data, no account connected' : 'live, read-only'}</dd>
      ${(r.seenBefore || []).length ? `<dt>Seen before</dt><dd>${r.seenBefore.map(s => `${esc(s.title)}: ${s.times} time${s.times > 1 ? 's' : ''}, last ${esc(s.lastSeen)}`).join('<br>')}</dd>` : ''}
    </dl>
    ${ex ? `<h3>About this example</h3><p>${esc(ex.about)}</p><dl class="kv"><dt>Verdict file</dt><dd><code>${esc(ex.verdictFile)}</code></dd><dt>Reply sha256</dt><dd><code>${esc(ex.replySha256)}</code></dd><dt>Hash matches this text</dt><dd>${ex.hashMatches ? 'yes, checked by the server just now' : 'NO'}</dd></dl>` : ''}
    <h3>Calls the desk made, in order</h3>
    ${calls ? `<ol class="calls">${calls}</ol>` : '<p>None recorded.</p>'}
    ${r.steps?.length ? `<h3>Each step and its source</h3><ol class="calls">${steps}</ol>` : ''}
    <h3>Script checker</h3>
    <p>${r.entry ? (r.check.pass ? 'Passed. Every quote is on its cited page. Every account step is backed by a lookup. No line makes a promise (a refund, a date, a sure outcome).' : `Blocked: ${esc((r.check.problems || []).join(' '))}`) : esc(r.check?.problems?.[0] || 'There was no reply to check.')}</p>
    ${r.reply ? `<h3>Fresh checker</h3>
    <dl class="kv"><dt>Where it stands</dt><dd><code>${esc(f.state || 'none')}</code></dd>${f.checkedAt ? `<dt>Checked</dt><dd>${esc(f.checkedAt)}</dd>` : ''}<dt>Verdict file</dt><dd><code>${ex ? esc(ex.verdictFile) : `desk/reviews/${esc(name)}.json`}</code></dd></dl>
    ${findings.length ? `<p>${f.state === 'blocked' ? 'Its findings:' : 'Its notes:'}</p><ul class="mono-list">${findings.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` : ''}
    ${r.escalationText ? `<h3>Escalation packet</h3><pre>${esc(r.escalationText)}</pre>` : ''}
    ${r.docEditText ? `<h3>Proposed help-doc edit</h3><pre>${esc(r.docEditText)}</pre>` : ''}
    ${!ex ? `<h3>Run it yourself</h3><pre>${esc(cmd)}\n# then give the packet it prints to the reply-checker subagent, and:\nnode bin/support-desk.mjs cleared ${esc(name)}</pre>` : ''}
    <details class="raw"><summary>The raw response</summary><pre>${esc(JSON.stringify(r, null, 1))}</pre></details>
  </section>`;
}

// ---------------------------------------------------------------- the answer, built whole, then played
function shellHTML(meta) {
  return `<div class="said">
      <button type="button" class="btn-quiet back" id="back">New message</button>
      <div class="who">${esc(meta.who ? `${meta.who} wrote` : 'The customer wrote')}</div>
      <blockquote id="said-q">${esc(meta.text)}</blockquote>
    </div>
    ${meta.example ? `<p class="example-tag">A saved example from Nov 15: the desk's first reply to this message. The second checker stopped it, and the desk was fixed.</p>` : ''}
    <ol class="did" id="did" aria-label="What the desk did"></ol>
    <p class="skip" id="skip"><button type="button" class="btn-quiet" id="skip-btn">Skip to the answer</button></p>
    <div id="answer-host"></div>`;
}

function answerHTML(r, hold) {
  const H = hold ? ' js-hold' : '';
  const st = stateOf(r);
  if (st === 'refused') return refusedHTML(r, H);
  const { head, tail } = letterParts(r.reply);
  const steps = r.steps || [];
  const flags = r.example?.plain?.names || [];
  const stamp = st === 'checked' ? `<div class="stamp${H}" role="img" aria-label="Checked by a second reader. Safe to send."><b>Checked</b><span>Safe to send</span></div>`
    : st === 'stopped' ? `<div class="stamp stopped${H}" role="img" aria-label="Stopped by the second checker. Do not send."><b>Stopped</b><span>Do not send</span></div>`
    : `<p class="waiting-tag${H}">Waiting for a second check</p>`;
  const title = r.outcome === 'no-answer' ? 'Here is a reply for now' : 'Here is the answer';
  const stepsHTML = steps.map((s, i) => `<li class="step${flags.includes(i + 1) ? ' flag' : ''}${H}" id="step-${i + 1}" data-i="${i}" tabindex="0" aria-describedby="card-${i + 1}">
      <span class="num" aria-hidden="true">${i + 1}</span><span class="sr-only">Step ${i + 1}. </span><span class="txt">${esc(s.text)}</span>
      <span class="src">${esc(stepLabel(s, r))}</span>
      <div class="inline-proof${H}" data-i="${i}">${proofHTML(s, i, r, 'inline', steps[i - 1])}</div>
    </li>`).join('');
  const cards = steps.map((s, i) => `<div class="card${flags.includes(i + 1) ? ' flag' : ''}${H}" id="card-${i + 1}" data-i="${i}">${proofHTML(s, i, r, 'card', steps[i - 1])}</div>`).join('');
  const wires = steps.map((_, i) => `<i class="wire${flags.includes(i + 1) ? ' flag' : ''}${H}" data-i="${i}" aria-hidden="true"><b class="h1"></b><b class="v"></b><b class="h2"></b></i>`).join('');
  const st2 = st;
  const actions = st2 === 'stopped'
    ? `<p class="stop-line">Fix it before you send it.</p><button type="button" class="btn-quiet" data-again>Answer another</button>`
    : `<button type="button" class="btn" data-copy="reply">${st2 === 'checked' ? 'Copy the answer' : 'Copy the draft'}</button><span class="copied" data-copied="reply" aria-live="polite"></span><button type="button" class="btn-quiet" data-again>Answer another</button>`;
  return `<div class="answer">
      <article class="letter${H}" aria-labelledby="letter-h">
        ${stamp}
        <h2 id="letter-h">${title}</h2>
        <div class="body">
          ${head.map(p => `<p>${esc(p)}</p>`).join('')}
          <ol class="steps">${stepsHTML}</ol>
          <div class="tail${H}">${tailHTML(tail, r)}</div>
        </div>
      </article>
      <aside class="margin" aria-labelledby="proof-h">
        <h2 id="proof-h">How do we know?</h2>
        <p class="hint">Each step's proof sits beside it, joined by a line. Point at a step to make its proof stand out.</p>
        <button type="button" class="link page-toggle" aria-expanded="false">Show more of each help page</button>
        ${cards}
      </aside>
      ${wires}
    </div>
    <div class="after${H}">
      ${checkerHTML(r)}
      ${sabrinaHTML(r)}
      ${docEditHTML(r)}
    </div>
    <div class="actions${H}">
      ${actions}
      <p class="why-line">${st2 === 'checked' ? 'The desk never sends anything. You copy the answer and send it yourself.' : st2 === 'stopped' ? 'The desk never sends anything, and it will not let you copy a reply the checker stopped.' : 'Read it yourself first. The desk never sends anything. You copy it and send it yourself.'}</p>
      ${switchHTML(2)}
    </div>
    ${techHTML(r)}`;
}

function refusedHTML(r, H) {
  const found = (r.evidence?.searched || []).flatMap(q => q.results).filter((x, i, a) => x.url && a.findIndex(y => y.url === x.url) === i).slice(0, 4);
  return `<div class="answer">
      <article class="letter refused-note${H}" aria-labelledby="letter-h">
        <h2 id="letter-h">The desk will not answer this one</h2>
        <div class="body">
          <p>It could not match this message to anything it knows from Blotato's help pages, so it wrote no reply. It will not guess.</p>
          <p>It searched the help pages, and it passed the message to Sabrina with what it found.</p>
          <p>If you know what the customer means, ask them to say a little more, then try again.</p>
        </div>
      </article>
      <aside class="margin${H}" aria-labelledby="proof-h">
        <h2 id="proof-h">What the desk found</h2>
        <p class="hint">The closest help pages. None of them answers the message.</p>
        ${found.length ? `<ul class="results-list">${found.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url)}</a><p>${esc(String(x.excerpt || '').slice(0, 140))}...</p></li>`).join('')}</ul>` : '<p>The search found nothing.</p>'}
      </aside>
    </div>
    <div class="after${H}">${sabrinaHTML(r, false)}</div>
    <div class="actions${H}">
      <button type="button" class="btn" data-copy="sabrina">Copy the note for Sabrina</button><span class="copied" data-copied="sabrina" aria-live="polite"></span>
      <button type="button" class="btn-quiet" data-again>Answer another</button>
      <p class="why-line">The desk never sends anything. You pass the note on yourself.</p>
      ${switchHTML(3)}
    </div>
    ${techHTML(r)}`;
}

function switchHTML(n) {
  const on = document.body.classList.contains('tech-on');
  return `<div class="switch-row"><button type="button" class="switch" role="switch" aria-checked="${on}" data-tech-switch aria-describedby="switch-hint-${n}"><span class="track" aria-hidden="true"><span class="knob"></span></span><span class="switch-label">Show the technical details</span></button><span class="switch-hint" id="switch-hint-${n}">For engineers: the calls, ids and checkers' notes.</span></div>`;
}

// Proofs line up with their steps (wide screens). Steps move down when a proof needs the room.
function layoutAnswer() {
  const ans = $('#result .answer');
  if (!ans || $('#result').hidden || !ans.offsetParent) return;
  const steps = $$('.step', ans); const cards = $$('.margin .card', ans); const wires = $$('.wire', ans);
  for (const s of steps) s.style.marginTop = '';
  for (const c of cards) c.style.marginTop = '';
  if (!wide()) return;
  // A proof starts level with its step, or right under the proof before it. Steps never move.
  for (let i = 0; i < steps.length; i++) {
    const c = cards[i]; if (!c) continue;
    const sTop = steps[i].getBoundingClientRect().top; const cTop = c.getBoundingClientRect().top;
    if (cTop < sTop) c.style.marginTop = `${sTop - cTop}px`;
  }
  const A = ans.getBoundingClientRect(); const L = $('.letter', ans).getBoundingClientRect();
  steps.forEach((s, i) => {
    const w = wires[i]; const c = cards[i]; if (!w || !c) return;
    const S = s.getBoundingClientRect(); const C = c.getBoundingClientRect();
    const ys = S.top - A.top + 21; const yc = C.top - A.top + 21;
    const x0 = L.right - A.left + 10; const width = Math.max(0, C.left - L.right - 26);
    const top = Math.min(ys, yc); const h = Math.abs(yc - ys);
    Object.assign(w.style, { left: `${x0}px`, top: `${top}px`, width: `${width}px`, height: `${h + 2}px` });
    const mid = Math.round(width * 0.45);
    Object.assign($('.h1', w).style, { left: '0px', top: `${ys - top}px`, width: `${mid + 2}px`, height: '2px' });
    Object.assign($('.v', w).style, { left: `${mid}px`, top: '0px', width: '2px', height: `${h + 2}px`, display: h > 1 ? 'block' : 'none' });
    Object.assign($('.h2', w).style, { left: `${mid}px`, top: `${yc - top}px`, width: `${width - mid}px`, height: '2px' });
  });
}

function point(i) {
  const host = $('#answer-host'); if (!host) return;
  for (const el of $$('.step, .card, .wire', host)) el.classList.toggle('on', i !== null && Number(el.dataset.i) === i);
}

// Split a highlighted sentence into one mark per line, so the highlighter can sweep line by line.
function markLines(mark) {
  const words = mark.textContent.split(/(\s+)/);
  mark.innerHTML = words.map(w => /^\s+$/.test(w) ? w : `<span>${esc(w)}</span>`).join('');
  const lines = []; let top = null;
  for (const node of [...mark.childNodes]) {
    if (node.nodeType === 1) { const t = node.offsetTop; if (top === null || Math.abs(t - top) > 4) { lines.push([]); top = t; } }
    if (lines.length) lines[lines.length - 1].push(node.textContent); else lines.push([node.textContent]);
  }
  const frag = document.createDocumentFragment(); const out = [];
  lines.forEach((ws, k) => {
    const m = document.createElement('mark'); m.textContent = ws.join(''); frag.append(m); out.push(m);
    if (k < lines.length - 1 && !/\s$/.test(m.textContent)) frag.append(' ');
  });
  mark.replaceWith(frag);
  return out;
}

class Moment {
  constructor(meta) {
    this.meta = meta; this.events = []; this.result = null; this.error = null;
    this.skipped = false; this.dead = false; this.instant = reduced.matches; this.anims = []; this.waiters = new Set();
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
  wait(ms) {
    if (this.instant || this.skipped) return Promise.resolve();
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
    if (this.instant || this.skipped || this.dead) return Promise.resolve();
    const a = el.animate(kf, { fill: 'backwards', easing: EASE_OUT, ...opts });
    this.anims.push(a);
    return a.finished.then(() => {}, () => {});
  }
  skip() { if (this.done) return; this.skipped = true; for (const a of this.anims) { try { a.finish(); } catch { /* gone */ } } this.poke(); }
  stop() { this.dead = true; for (const a of this.anims) { try { a.cancel(); } catch { /* gone */ } } this.poke(); }

  tick(key, state, text) {
    let li = $(`#did li[data-k="${key}"]`);
    if (!li) { li = document.createElement('li'); li.dataset.k = key; li.innerHTML = '<span class="g" aria-hidden="true"></span><span class="w"></span>'; $('#did').append(li); }
    li.dataset.s = state;
    $('.g', li).textContent = { done: '\u2713', wait: '\u25CB', stop: '\u2715', needs: '\u2192', neutral: '\u25CB' }[state];
    $('.w', li).textContent = text;
  }

  async play() {
    const reveal = (el, ms = 300) => this.anim(el, [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: ms });
    const write = (el, ms = T.write) => this.anim(el, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: ms, easing: EASE_MARK });
    this.tick('read', 'wait', "Reading Blotato's help pages");
    say('The desk is working on the answer.');
    // Beat 0 (the box becomes the quote) runs while the desk reads; the reading beat holds at least T.read.
    const began = performance.now();
    await this.until(() => this.events.length || this.result || this.error);
    await this.wait(Math.max(0, T.read - (performance.now() - began)));
    if (!this.result && !this.error) this.tick('read', 'wait', this.events.some(e => e.t === 'page') ? "Reading Blotato's help pages, then writing the reply" : "Reading Blotato's help pages");
    await this.until(() => this.result || this.error);
    if (this.dead) return;
    if (this.error) return this.fail(this.error.message);

    const r = this.result;
    const trace = r.trace || [];
    const pages = new Set(trace.filter(e => e.t === 'page').map(e => e.url)).size;
    const searched = trace.some(e => e.t === 'search');
    const called = trace.some(e => e.t === 'call');
    const st = stateOf(r);
    this.tick('read', 'done', pages ? (pages === 1 ? "Read Blotato's help page" : `Read ${pages} of Blotato's help pages`) : searched ? "Searched Blotato's help pages" : 'Read nothing: no help page was needed');

    const host = $('#answer-host');
    host.innerHTML = answerHTML(r, !this.instant && !this.skipped);
    fillSlots(host);
    layoutAnswer();
    const W = wide();
    const steps = $$('.step', host);
    const cardOf = (i) => W ? $(`.card[data-i="${i}"]`, host) : $(`.inline-proof[data-i="${i}"]`, host);
    const firstFact = (r.steps || []).findIndex(s => s.type === 'fact' && s.page?.found);
    const evIdx = (r.steps || []).findIndex(s => s.type === 'evidence');

    // Beats 1 and 2 (wide): the first proof opens on its page, and the highlighter finds the sentence.
    if (W && st !== 'refused') {
      if (firstFact >= 0) { const c = cardOf(firstFact); await reveal(c, T.reveal); await this.sweep(c, T.sweep); }
    } else if (st === 'refused') {
      await reveal($('.margin', host), 300);
    }

    // Beat 3: the account (or the search), only when the desk really looked.
    if (called || (searched && st !== 'refused')) {
      this.tick('account', 'wait', called ? 'Looking at their account' : 'Searching the help pages');
      if (W && evIdx >= 0) { const c = cardOf(evIdx); reveal(c, T.reveal); await write($('.plain', c), T.account); }
      else await this.wait(T.account);
      this.tick('account', 'done', called ? 'Looked at their account' : 'Searched the help pages');
    }

    // Beat 4: the letter opens and each step is written beside its proof.
    if (st === 'refused') {
      this.tick('write', 'wait', 'Deciding if it can answer');
      await this.anim($('.letter', host), [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: T.paper });
      this.tick('write', 'stop', 'Wrote no reply: it will not guess');
    } else {
      this.tick('write', 'wait', 'Writing the reply');
      await this.anim($('.letter', host), [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: T.paper });
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        write(s);
        const c = cardOf(i);
        if (c && c.classList.contains('js-hold')) {
          reveal(c, T.write).then(() => (!W && i === firstFact ? this.sweep(c, T.sweep) : this.sweep(c, 300)));
        }
        this.anim($(`.wire[data-i="${i}"]`, host), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: T.wire, delay: 80 });
        if (!this.instant && !this.skipped) { s.classList.add('on'); setTimeout(() => s.classList.remove('on'), T.write + 80); }
        await this.wait(!W && i === firstFact ? T.sweep : T.step);
      }
      await write($('.tail', host), T.write);
      const n = steps.length;
      this.tick('write', 'done', r.outcome === 'no-answer' ? `Wrote a reply for now, in ${n} steps` : `Wrote ${n} steps`);
    }

    // Beat 5: the second checker's verdict lands.
    if (st !== 'refused') {
      this.tick('check', 'wait', "Looking for the second checker's verdict");
      await this.wait(T.verdict);
      const stamp = $('.stamp', host);
      if (stamp) {
        const rot = W ? -7 : -4;
        await this.anim(stamp, [
          { opacity: 0, transform: `rotate(${rot - 3}deg) scale(1.12)` },
          { opacity: 1, offset: 0.3 },
          { opacity: 1, transform: `rotate(${rot}deg) scale(1)` },
        ], { duration: T.stamp, easing: EASE_THUD });
        this.anim($('.letter', host), [{ transform: 'none' }, { transform: 'translateY(2px)' }, { transform: 'none' }], { duration: T.nudge, easing: 'ease-out', fill: 'none' });
      } else {
        await this.anim($('.waiting-tag', host), [{ opacity: 0 }, { opacity: 1 }], { duration: T.state || 200 });
      }
      const f = r.fresh || {};
      if (st === 'checked') this.tick('check', 'done', `A second checker read this exact reply${f.checkedAt ? ` on ${day(f.checkedAt)}` : ''}`);
      else if (st === 'stopped') this.tick('check', 'stop', 'A second checker stopped it');
      else if (f.state === 'passed-saved' || f.state === 'stale') this.tick('check', 'neutral', 'Changed since its second check');
      else this.tick('check', 'neutral', 'Not read by a second checker yet');
    }
    if (r.escalation) this.tick('sabrina', 'needs', 'This one needs Sabrina');
    if (r.docEdit && r.entry) this.tick('doc', 'needs', r.docEdit.kind === 'change' ? 'Suggested a fix to a help page' : "The help pages don't cover this yet");
    this.finish(r);
  }

  async sweep(card, total) {
    const mark = card && $('mark', card);
    if (!mark) return;
    if (this.instant || this.skipped) return;
    const lines = markLines(mark);
    const per = Math.min(T.line, total / lines.length);
    for (const l of lines) l.style.backgroundSize = '0% 100%';
    for (const l of lines) {
      l.style.backgroundSize = '';
      await this.anim(l, [{ backgroundSize: '0% 100%' }, { backgroundSize: '100% 100%' }], { duration: per, easing: EASE_MARK });
    }
  }

  finish(r) {
    if (this.dead) return;
    this.done = true;
    const host = $('#result');
    for (const el of $$('.js-hold', host)) el.classList.remove('js-hold');
    for (const m of $$('mark', host)) m.style.backgroundSize = '';
    $('#skip').hidden = true;
    layoutAnswer();
    const st = stateOf(r);
    const words = { checked: 'Checked. Safe to send.', waiting: 'Here is a draft. A second checker has not read it yet.', stopped: 'Stopped by the second checker. Do not send it.', refused: 'The desk will not answer this one. It wrote a note for Sabrina.' }[st];
    say(`${words}${r.escalation && st !== 'refused' ? ' This one also needs Sabrina.' : ''}`);
    const main = $('#answer-host [data-copy]') || $('#answer-host [data-again]');
    main?.focus({ preventScroll: true });
  }

  fail(message) {
    this.done = true;
    this.tick('read', 'stop', 'The desk could not finish this one');
    $('#skip').hidden = true;
    $('#answer-host').innerHTML = `<div class="note-card"><h3>Something went wrong</h3><p>${esc(message)}</p><button type="button" class="btn" data-again>Try again</button></div>`;
    say('The desk could not finish this one.');
    $('#answer-host [data-again]')?.focus();
  }
}

function showShell(meta) {
  const from = $('#msg').getBoundingClientRect();
  const fromTop = from.top + scrollY;
  $('#ask').hidden = true;
  const res = $('#result');
  res.hidden = false;
  res.innerHTML = shellHTML(meta);
  scrollTo(0, 0);
  // Beat 0: the box lifts and becomes the customer's quote.
  if (!reduced.matches) {
    const q = $('#said-q'); const to = q.getBoundingClientRect();
    const dx = from.left - to.left; const dy = fromTop - (to.top + scrollY);
    if (Math.abs(dy) < 1200) q.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: T.press, easing: EASE_OUT });
  }
}

async function start({ body, who, text }) {
  moment?.stop();
  const m = moment = new Moment({ who, text });
  showShell({ who, text });
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
  if (STATE) api('/api/state').then(s => { STATE = s; if (document.body.classList.contains('tech-on')) techHome(); }).catch(() => {});
}

async function startStopped() {
  moment?.stop();
  let r;
  try { r = await api('/api/example/stopped'); } catch (e) { alert(`The example could not be loaded: ${e.message}`); return; }
  const m = moment = new Moment({ who: 'An n8n user', text: r.ticket.text, example: true });
  showShell({ who: 'An n8n user', text: r.ticket.text, example: true });
  const run = m.play();
  for (const ev of r.trace || []) m.push(ev);
  m.push({ t: 'result', result: r });
  await run;
}

function back() {
  moment?.stop(); moment = null;
  $('#result').hidden = true; $('#result').innerHTML = '';
  $('#ask').hidden = false;
  $('#msg').value = ''; picked = null; $('#filled').textContent = '';
  for (const b of $$('.tries-list button')) b.setAttribute('aria-pressed', 'false');
  scrollTo(0, 0);
  $('#msg').focus();
}

async function copy(kind, btn) {
  const r = moment?.result; if (!r) return;
  const text = kind === 'sabrina' ? (r.escalationText || '').replace(/^## Escalation\n\n/, '') : r.reply;
  const out = $(`[data-copied="${kind}"]`, btn.closest('section, .actions') || document);
  try { await navigator.clipboard.writeText(text); if (out) out.textContent = kind === 'sabrina' ? 'Copied. Paste it where Sabrina will see it.' : 'Copied. Paste it into your reply to the customer.'; }
  catch { if (out) out.textContent = 'Your browser blocked copying. Select the text and copy it by hand.'; }
}

// ---------------------------------------------------------------- the practice game
const FACES = { 'in-progress': ['cust-dev-waiting', 'A developer'], 'unknown-outcome-resend': ['cust-dev-timeout', 'Another developer'], 'mcp-invalid-grant': ['cust-claude-user', 'A marketer who uses Claude'], 'published-not-visible': ['cust-creator', 'A young creator'], 'trial-api-key-charge': ['cust-coach', 'A coach on the free trial'] };

const game = {
  data: null, i: 0, score: 0, picks: [], phase: 'start',
  async open() {
    if (!this.data) {
      try { this.data = await api('/api/practice'); } catch (e) { $('#game-stage').innerHTML = `<p>${esc(e.message)}</p>`; return; }
      this.queue();
    }
    if (this.phase === 'start') $('#game-go').focus({ preventScroll: true });
  },
  queue() {
    const q = $('#game-queue'); if (!q) return;
    q.innerHTML = this.data.decisions.map((d, k) => {
      const [slot, who] = FACES[d.entry] || ['', 'A customer'];
      const face = art(slot, '', 56);
      return `<li${face ? ' class="has-face"' : ''}>${face ? `<span class="qface">${face}</span>` : `<span class="qn" aria-hidden="true">${k + 1}</span>`}<span class="qw"><b>${esc(who)}</b><span class="qt">${esc(d.ticket)}</span></span></li>`;
    }).join('');
  },
  begin() { this.i = 0; this.score = 0; this.picks = []; $('#game-bar').hidden = false; this.round(); },
  pips() {
    $('#pips').innerHTML = this.data.decisions.map((_, k) => {
      const p = this.picks[k]; const s = p ? (p.right ? 'right' : 'wrong') : k === this.i && this.phase !== 'end' ? 'now' : '';
      return `<li data-s="${s}"><span class="sr-only">Customer ${k + 1}: ${p ? (p.right ? 'helped' : 'not helped') : k === this.i ? 'now' : 'still to come'}</span></li>`;
    }).join('');
    $('#score-now').innerHTML = `Helped: <b>${this.score}</b> of ${this.data.decisions.length}`;
  },
  round() {
    const d = this.data.decisions[this.i]; this.phase = 'ask';
    const [slot, who] = FACES[d.entry] || ['', 'A customer'];
    const face = art(slot, `${who}, waiting for an answer`, 160);
    this.pips();
    $('#game-stage').innerHTML = `<div class="round${face ? ' has-art' : ''}">
      ${face ? `<div class="face" id="face">${face}</div>` : ''}
      <div>
        <article class="cust-letter" id="cust-letter" aria-labelledby="cust-from">
          <p class="from" id="cust-from">Customer ${this.i + 1} of ${this.data.decisions.length}. <b>${esc(who)}</b> writes:</p>
          <blockquote>${esc(d.ticket)}</blockquote>
        </article>
        <h2 class="ask-move" id="move-h">What is your first move?</h2>
        <ol class="choices" aria-labelledby="move-h">${d.choices.map((c, k) => `<li><button type="button" class="choice" data-k="${k}"><span class="key" aria-hidden="true">${k + 1}</span><span class="ct"><span class="sr-only">Choice ${k + 1}: </span>${esc(c.text)}</span></button></li>`).join('')}</ol>
        <div class="happened" id="happened"></div>
      </div>
    </div>`;
    if (!reduced.matches) $('#cust-letter').animate([{ opacity: 0, transform: 'translateY(-16px) rotate(-.6deg)' }, { opacity: 1, transform: 'none' }], { duration: T.press, easing: EASE_OUT });
    say(`Customer ${this.i + 1} of ${this.data.decisions.length}. ${who} writes: ${d.ticket}`);
    $('#game-stage .choice').focus({ preventScroll: true });
    $('#view-practice').scrollIntoView({ block: 'start' });
  },
  answer(k) {
    if (this.phase !== 'ask') return;
    const d = this.data.decisions[this.i]; const c = d.choices[k]; if (!c) return;
    this.phase = 'after';
    this.picks[this.i] = { k, right: !!c.right };
    if (c.right) this.score++;
    $$('#game-stage .choice').forEach((b, idx) => {
      b.disabled = true; b.setAttribute('aria-disabled', 'true');
      const right = d.choices[idx].right;
      if (idx === k) b.classList.add('picked', right ? 'right' : 'wrong');
      if (right) b.classList.add('answer');
      if (idx !== k && !right) b.classList.add('dim');
      if (idx === k || right) b.insertAdjacentHTML('beforeend', `<span class="tag">${right ? (idx === k ? 'Your move. The right first move.' : 'The right first move') : 'Your move'}</span>`);
    });
    const [slot, who] = FACES[d.entry] || ['', 'The customer'];
    const mood = art(`${slot}-${c.right ? 'relieved' : 'upset'}`, `${who}, ${c.right ? 'relieved' : 'upset'}`, 160);
    if (mood && $('#face')) $('#face').innerHTML = mood;
    const letter = $('#cust-letter');
    letter.insertAdjacentHTML('beforeend', c.right ? '<div class="stamp" role="img" aria-label="Helped"><b>Helped</b><span>Good first move</span></div>' : '<div class="stamp stopped" role="img" aria-label="Oops"><b>Oops</b><span>Not this time</span></div>');
    const stamp = $('.stamp', letter);
    if (!reduced.matches) {
      const rot = -7;
      stamp.animate([{ opacity: 0, transform: `rotate(${rot - 3}deg) scale(1.12)` }, { opacity: 1, offset: 0.3 }, { opacity: 1, transform: `rotate(${rot}deg) scale(1)` }], { duration: T.stamp, easing: EASE_THUD, fill: 'backwards' });
      letter.animate([{ transform: 'none' }, { transform: 'translateY(2px)' }, { transform: 'none' }], { duration: T.nudge, delay: T.stamp });
    }
    const feel = c.right ? `${who} is relieved.` : `${who} is upset.`;
    const last = this.i + 1 >= this.data.decisions.length;
    const q = /^["\u201C]/.test(d.source.quote) ? d.source.quote.replace(/^["\u201C]|["\u201D]$/g, '') : d.source.quote;
    $('#happened').innerHTML = `<h3 tabindex="-1" id="happened-h">${c.right ? 'Good move. Here is what happened.' : 'Here is what happened.'}</h3>
      <p class="feel ${c.right ? 'ok' : 'no'}">${esc(feel)}</p><p class="what">${esc(c.consequence)}</p>
      <div class="source-card"><p class="k">What Blotato's help page says</p><p class="x"><mark>${esc(q.replace(/`/g, ''))}</mark></p><a href="${esc(d.source.url)}" target="_blank" rel="noopener">Open the help page</a></div>
      <div class="game-next"><button type="button" class="btn" id="game-next">${last ? 'See my score' : 'Next customer'}</button><span class="hint">or press Enter</span></div>`;
    this.pips();
    say(`${c.right ? 'Good move.' : 'Not this time.'} ${c.consequence}`);
    $('#game-next').focus({ preventScroll: true });
    $('#happened').scrollIntoView({ block: 'nearest' });
  },
  next() {
    if (this.phase !== 'after') return;
    this.i++;
    if (this.i >= this.data.decisions.length) return this.end();
    this.round();
  },
  end() {
    this.phase = 'end'; this.pips();
    const n = this.data.decisions.length; const s = this.score;
    const line = s === n ? 'A clean shift. Every customer got the right first move, so nobody posted twice and nobody waited for nothing.'
      : s >= n - 1 ? 'A good shift. One customer had a rough moment. Here is the right first move for each one.'
      : 'Every wrong move here is a real way a support message goes sideways. Here is the right first move for each one, so next time you will know.';
    const title = s === n ? 'You are ready for a real shift.' : s >= n - 1 ? 'Nearly ready for a real shift.' : s >= 2 ? 'A good start. Play once more.' : 'Every pro starts here. Play once more.';
    $('#game-stage').innerHTML = `<div class="score-card">
      <div class="art-slot wide">${art('shift-end', 'A tidy desk at dusk, five stamped letters stacked beside a mug')}</div>
      <h2 class="score-big" tabindex="-1" id="score-h">${s} of ${n} customers helped</h2>
      <p class="score-title">${esc(title)}</p>
      <p class="score-say">${esc(line)}</p>
      <h3 class="ask-move">What you learned</h3>
      <ol class="learned">${this.data.decisions.map((d, k) => { const p = this.picks[k]; return `<li><span class="g ${p?.right ? 'ok' : 'no'}" aria-hidden="true">${p?.right ? '\u2713' : '\u2715'}</span><p><span class="sr-only">${p?.right ? 'You got this one.' : 'You missed this one.'} </span>${esc(d.firstCheck)}</p><a href="${esc(d.source.url)}" target="_blank" rel="noopener">The help page that says so</a></li>`; }).join('')}</ol>
      <div class="row"><button type="button" class="btn" id="game-again">Play the shift again</button><a class="btn-quiet" href="#answer" style="display:inline-flex;align-items:center">Answer a real message</a></div>
    </div>`;
    say(`Your shift is over. ${s} of ${n} customers helped.`);
    $('#score-h').focus({ preventScroll: true });
    $('#view-practice').scrollIntoView({ block: 'start' });
  },
};

// ---------------------------------------------------------------- wiring
function wire() {
  addEventListener('hashchange', route);
  $('#ask-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  $('#msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
  $('#msg').addEventListener('input', () => {
    if (picked && $('#msg').value !== picked.text) { picked = null; for (const b of $$('.tries-list button')) b.setAttribute('aria-pressed', 'false'); }
    $('#filled').textContent = '';
  });
  $('#tries').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b); });
  $('#more-list').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b); });
  $('#more-btn').addEventListener('click', () => {
    const open = $('#more-btn').getAttribute('aria-expanded') !== 'true';
    $('#more-btn').setAttribute('aria-expanded', String(open)); $('#more').hidden = !open;
    $('#more-btn').textContent = open ? 'Show fewer examples' : 'Show more examples';
  });
  $('#stopped-btn').addEventListener('click', startStopped);
  $('#shift-btn').addEventListener('click', async () => {
    const b = $('#shift-btn'); b.disabled = true; $('#handoff').innerHTML = '<p>Running 12 sample messages...</p>';
    try { const s = await api('/api/shift', {}); $('#handoff').innerHTML = md(s.handoff); STATE = await api('/api/state'); techHome(); }
    catch (e) { $('#handoff').innerHTML = `<p>${esc(e.message)}</p>`; }
    b.disabled = false;
  });
  $('#logs-btn').addEventListener('click', async () => { const l = await api('/api/logs'); $('#handoff').innerHTML = `<pre>${esc(l.text)}</pre>`; });

  document.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-tech-switch]'); if (sw) return setTech(sw.getAttribute('aria-checked') !== 'true');
    if (e.target.closest('#back')) return back();
    if (e.target.closest('#skip-btn')) return moment?.skip();
    if (e.target.closest('[data-again]')) return back();
    const c = e.target.closest('[data-copy]'); if (c) return copy(c.dataset.copy, c);
    const more = e.target.closest('.page-toggle');
    if (more) {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'Show less of each help page' : 'Show more of each help page';
      for (const card of $$('.margin .card')) {
        const step = moment?.result?.steps?.[Number(card.dataset.i)];
        if (step?.page?.found && step.page.mark) $('.x', card).innerHTML = open ? fullContextHTML(step.page) : contextHTML(step.page);
      }
      return layoutAnswer();
    }
    const step = e.target.closest('.step');
    if (step && !e.target.closest('a')) point(step.classList.contains('on') ? null : Number(step.dataset.i));
    if (e.target.closest('#game-go')) return game.begin();
    if (e.target.closest('#game-next')) return game.next();
    if (e.target.closest('#game-again')) return game.begin();
    const ch = e.target.closest('.choice'); if (ch && !ch.disabled) return game.answer(Number(ch.dataset.k));
  });
  // Pointing at a step (or its proof) makes the pair stand out.
  const over = (e) => { if (!moment?.done) return; const el = e.target.closest('.step, .card'); if (el) point(Number(el.dataset.i)); };
  const out = (e) => { if (!moment?.done) return; const el = e.target.closest('.step, .card'); if (el && !el.contains(e.relatedTarget)) point(null); };
  document.addEventListener('mouseover', over); document.addEventListener('mouseout', out);
  document.addEventListener('focusin', (e) => { const s = e.target.closest?.('.step'); if (s && moment?.done) point(Number(s.dataset.i)); });
  document.addEventListener('focusout', (e) => { if (e.target.closest?.('.step') && !e.relatedTarget?.closest?.('.step')) point(null); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && moment && !moment.done && !$('#result').hidden) { moment.skip(); return; }
    if ($('#view-practice').hidden) return;
    if (e.target.matches?.('textarea, input')) return;
    if (game.phase === 'ask' && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); game.answer(Number(e.key) - 1); }
    else if (game.phase === 'after' && e.key === 'Enter' && !e.target.closest?.('button, a')) { e.preventDefault(); game.next(); }
  });
  let raf = 0;
  addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layoutAnswer); });
  document.fonts?.ready.then(layoutAnswer);
}

(async () => {
  wire();
  setTech(store.get('sd-tech') === '1', false);
  route();
  try {
    const [s, a] = await Promise.all([api('/api/state'), api('/api/art').catch(() => ({ slots: [] }))]);
    STATE = s; ART = new Set(a.slots || []);
    fillExamples(); fillSlots();
    if (!s.mock) $('#sample-note').textContent = "A real Blotato account is connected. The desk only reads it. The help pages are Blotato's real ones.";
    if (document.body.classList.contains('tech-on')) techHome();
  } catch (e) {
    $('#sample-note').textContent = `The desk could not be reached: ${e.message}`;
  }
})();
