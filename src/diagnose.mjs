// Diagnose one ticket from Blotato's own sources, never from guesses.
// 1. Match the ticket to a playbook entry (or to nothing).
// 2. Gather evidence: the cited help pages (through Blotato's docs MCP server) and, when the ticket is about
//    a post or an id, a read-only status lookup through the Blotato API.
// 3. Compose: a numbered reply, an escalation packet when a person must decide, a help-doc edit when the docs
//    have no answer or the wrong one.
import { matchEntry, PAGES } from '../knowledge/playbook.mjs';
import { listPosts, getSubmission, errorText } from './api.mjs';
import { explain } from './explain.mjs';

const PLATFORM_WORDS = ['instagram', 'linkedin', 'twitter', 'facebook', 'tiktok', 'youtube', 'threads', 'bluesky', 'pinterest', 'slack'];
const when = (t) => new Date(t).toUTCString().replace(' GMT', ' UTC');
const NAMES = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X (Twitter)', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', threads: 'Threads', bluesky: 'Bluesky', pinterest: 'Pinterest', slack: 'Slack' };
const nice = (p) => NAMES[p] || p;

async function lookup(kind, ticket, { client, docs, entry }) {
  const text = ticket.text;
  const ev = { kind, ok: false, lines: [], calls: [] };
  try {
    if (kind === 'recent-published') {
      const platform = PLATFORM_WORDS.find(p => new RegExp(`\\b${p}\\b`, 'i').test(text));
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const items = await listPosts(client, { since, status: ['published'] });
      ev.calls.push(`GET /v2/posts?status=published&since=${since.slice(0, 10)}: ${items.length} item(s)`);
      const mine = items.filter(i => !platform || i.platform === platform);
      const p = mine[0];
      ev.summary = p
        ? `Blotato shows ${mine.length} published ${nice(p.platform)} post${mine.length === 1 ? '' : 's'} in the last 7 days. The newest is from ${when(p.postTime)} (post ${p.id})${p.state?.postUrl ? `, with this link: ${p.state.postUrl}` : ', with no platform link returned'}.`
        : `Blotato shows no published ${platform ? nice(platform) + ' ' : ''}post in the last 7 days.`;
      ev.ok = true;
    }
    if (kind === 'recent-activity') {
      const since = new Date(Date.now() - 2 * 864e5).toISOString();
      const until = new Date(Date.now() + 14 * 864e5).toISOString();
      const items = await listPosts(client, { since, until });
      ev.calls.push(`GET /v2/posts?since=${since.slice(0, 10)}&until=${until.slice(0, 10)}: ${items.length} item(s)`);
      const platform = PLATFORM_WORDS.find(p => new RegExp(`\\b${p}\\b`, 'i').test(text));
      const same = platform ? items.filter(i => i.platform === platform) : items;
      const count = (t) => same.filter(i => i.state?.type === t).length;
      const where = platform ? `${nice(platform)} ` : '';
      ev.summary = same.length
        ? `from 2 days ago to 2 weeks ahead I see ${same.length} ${where}post${same.length === 1 ? '' : 's'}: ${count('scheduled')} scheduled, ${count('published')} published and ${count('failed')} failed. The newest is ${same[0].state?.type} for ${when(same[0].postTime)} (id ${same[0].id}).`
        : `I see no ${where}posts from 2 days ago to 2 weeks ahead.`;
      ev.ok = true;
    }
    if (kind === 'submission') {
      const id = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
      if (!id) { ev.summary = 'there is no submission id in the message, so I could not look it up.'; ev.missing = 'submission id'; return ev; }
      const s = await getSubmission(client, id);
      ev.calls.push(`GET /v2/posts/${id}: status "${s.status}" (request ${s.requestId})`);
      ev.status = s.status;
      ev.summary = `Blotato answers "${s.status}" for submission ${id}${s.errorMessage ? `, with the error "${s.errorMessage}"` : ''}${s.scheduledTime ? `, scheduled for ${when(s.scheduledTime)}` : ''}.`;
      if (s.status === 'failed') ev.explained = explain(s.errorMessage);
      ev.ok = true;
    }
    if (kind === 'reproduce-schedule') {
      const id = text.match(/schedules\/([A-Za-z0-9_-]+)/)?.[1];
      if (!id) { ev.summary = 'there is no schedule id in the message to reproduce.'; ev.missing = 'schedule id'; return ev; }
      const r = await client.get(`/schedules/${encodeURIComponent(id)}`);
      const msg = r.ok ? 'found' : errorText(r.data, r.status);
      ev.calls.push(`GET /v2/schedules/${id}: HTTP ${r.status} "${msg}"${r.data?.reqId ? ` (Blotato reqId ${r.data.reqId})` : ''}`);
      ev.status = r.status;
      ev.summary = `GET /v2/schedules/${id} answers HTTP ${r.status}: "${msg}".`;
      ev.ok = !r.ok && /bigint/i.test(msg); // reproduced = it fails the same way
      if (!ev.ok) ev.summary += ' That is not the error in the ticket, so this is not reproduced.';
    }
    if (kind === 'docs-search') {
      for (const q of entry?.searchQueries || [text.slice(0, 120)]) {
        const s = await docs.search(q);
        ev.calls.push(`docs MCP searchDocumentation "${q}": ${s.offline ? 'skipped (offline)' : `${s.results.length} result(s)`}`);
        ev.searched = [...(ev.searched || []), { query: q, offline: s.offline, results: s.results.slice(0, 5) }];
      }
      ev.ok = ev.searched.every(s => !s.offline);
      ev.summary = ev.ok
        ? `Searches: ${ev.searched.map(s => `"${s.query}" (top results: ${s.results.slice(0, 3).map(r => `"${r.title || r.url}"`).join(', ') || 'none'})`).join('; ')}.`
        : 'the docs search was offline, so nothing was searched.';
    }
  } catch (e) {
    ev.ok = false;
    ev.error = e.message;
    ev.summary = `the lookup failed: ${e.message}`;
    if (e.status) ev.calls.push(`HTTP ${e.status}${e.requestId ? ` (request ${e.requestId})` : ''}`);
  }
  return ev;
}

export async function diagnose(ticket, { client, docs, agent = 'Support' }) {
  const entry = matchEntry(ticket.text);
  const out = { ticket, entry: entry ? { id: entry.id, kind: entry.kind, title: entry.title } : null, pages: {}, evidence: null };

  if (!entry) {
    // No playbook entry: search the docs, refuse to guess, propose a help-doc edit and hand it to a person.
    const ev = await lookup('docs-search', ticket, { client, docs, entry: { searchQueries: [ticket.text.slice(0, 120)] } });
    out.evidence = ev;
    out.outcome = 'no-answer';
    out.reply = null;
    out.refused = 'No playbook entry matches, so the desk will not write a reply. See the docs search and the proposed help-doc edit.';
    out.docEdit = {
      article: PAGES.faqs, kind: 'new', heading: ticket.text.split(/[.?!]/)[0].slice(0, 90) + '?',
      add: '[Answer to confirm with the founder.]',
      note: `No playbook entry matched. ${ev.summary}`,
    };
    out.escalation = buildEscalation(ticket, null, out, { why: 'The desk has no documented answer for this ticket.', causes: [], ruledOut: [] });
    return out;
  }

  // Read every page the entry cites (once), so the checker can verify each quote.
  const urls = new Set(entry.steps.filter(s => s.cite).map(s => s.cite.url));
  for (const c of [...(entry.escalate?.causes || []), ...(entry.escalate?.ruledOut || [])]) if (c?.cite) urls.add(c.cite.url);
  if (entry.docEdit) urls.add(entry.docEdit.article);
  for (const u of urls) out.pages[u] = await docs.getPage(u);

  if (entry.lookup) out.evidence = await lookup(entry.lookup, ticket, { client, docs, entry });

  const steps = entry.steps.map(s => ({ ...s, text: s.text.replace('{evidence}', out.evidence?.summary || 'no lookup was made') }));
  const name = (ticket.name || '').trim();
  out.steps = steps;
  out.next = entry.next;
  out.proof = entry.proof;
  // Blotato's own response contract (start-with-an-ai-agent/agent-triage): answer, the next supported action,
  // what proves success or what is still open, and a link to the relevant section.
  out.helpLink = (steps.find(s => s.cite) || {}).cite?.url || (entry.docEdit?.article ?? null);
  out.reply = [
    `Hi${name ? ' ' + name : ''},`,
    '',
    entry.opening,
    '',
    ...steps.map((s, i) => `${i + 1}. ${s.text}`),
    '',
    `Next step: ${entry.next}`,
    entry.proof,
    ...(out.helpLink ? [`Help page: ${out.helpLink}`] : []),
    '',
    `Thanks,`,
    agent,
  ].join('\n');
  out.outcome = entry.escalate ? 'escalate' : 'reply';
  if (entry.noDocAnswer) out.outcome = 'no-answer';
  if (entry.escalate) out.escalation = buildEscalation(ticket, entry, out, entry.escalate);
  if (entry.docEdit) out.docEdit = { ...entry.docEdit, pageFetchedAt: out.pages[entry.docEdit.article]?.fetchedAt, beforeFound: entry.docEdit.before ? (out.pages[entry.docEdit.article]?.text || '').includes(entry.docEdit.before) : undefined };
  return out;
}

function buildEscalation(ticket, entry, out, esc) {
  const checked = [];
  for (const [u, p] of Object.entries(out.pages || {})) checked.push(p ? `Read ${u} (${p.via}, fetched ${p.fetchedAt.slice(0, 10)})` : `Could not read ${u}`);
  for (const c of out.evidence?.calls || []) checked.push(c);
  const cite = (c) => typeof c === 'string' ? c : `${c.text}${c.cite ? ` Source: ${c.cite.url}, which says: ${c.cite.quote.replace(/`/g, '')}` : ' (Not documented: a guess to confirm.)'}`;
  return {
    asked: ticket.text,
    kind: entry?.kind || 'unknown',
    why: esc.why,
    checked,
    evidence: out.evidence?.summary ? [out.evidence.summary] : [],
    causes: (esc.causes || []).slice(0, 2).map(cite),
    ruledOut: (esc.ruledOut || []).map(cite),
  };
}

export function renderEscalation(e) {
  if (!e) return '';
  const list = (a) => a.length ? a.map(x => `- ${x}`).join('\n') : '- nothing';
  return `## Escalation\n\n**What was asked**\n> ${e.asked}\n\n**Why it needs a person**\n${e.why}\n\n**What was checked**\n${list(e.checked)}\n\n**Evidence**\n${list(e.evidence)}\n\n**Two most likely causes**\n${list(e.causes)}\n\n**Ruled out**\n${list(e.ruledOut)}\n`;
}

export function renderDocEdit(d) {
  if (!d) return '';
  const lines = [`## Proposed help-doc edit`, '', `Article: ${d.article}${d.pageFetchedAt ? ` (as fetched ${d.pageFetchedAt.slice(0, 10)})` : ''}`, ''];
  if (d.kind === 'change') {
    lines.push('```diff', `- ${d.before}`, `+ ${d.after}`, '```', '', 'Add under the response table:', '', `> ${d.add}`);
    if (d.beforeFound === false) lines.push('', '(The "before" line was not found on the page as fetched. Check the page again before editing.)');
  } else {
    lines.push('New entry:', '', `> ### ${d.heading}`, `> ${d.add}`);
  }
  lines.push('', `Why: ${d.note}`, '', 'Status: a proposal for a person to approve. Nothing is published by the desk.');
  return lines.join('\n') + '\n';
}
