#!/usr/bin/env node
// support-desk: paste a customer's message, get the documented diagnosis, a checked reply,
// and the escalation packet or help-doc edit when a person has to decide.
//
//   support-desk ticket "<customer message>"   one ticket (or: ticket --id T06 for a sample ticket)
//        --save-reply      also save the reply text for the fresh checker (desk/reviews/<id>.reply.txt)
//        --require-review  block the reply until the fresh checker's verdict for this exact text is in
//   support-desk hash <reply.txt>              the hash a checker verdict must carry
//   support-desk shift                         all 12 sample tickets, then HANDOFF.md
//   support-desk morning                       what broke overnight, written to MORNING.md
//   support-desk logs                          a summary of the last run
//   support-desk docs                          refresh the cited help pages through Blotato's docs MCP
//   support-desk serve [--port 5610]           the local page
//
// Add --mock (or BLOTATO_MOCK=1) to use sample account data. The desk only reads; it never posts.
import { openDesk, handleTicket, runShift, morning, refreshDocs } from '../src/desk.mjs';
import { summarizeLastRun } from '../src/log.mjs';
import { deskPaths } from '../src/config.mjs';
import { TICKETS } from '../knowledge/playbook.mjs';

const args = process.argv.slice(2);
if (args.includes('--mock')) process.env.BLOTATO_MOCK = '1';
const cmd = args[0];
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--'));

function printResult(r) {
  console.log(`\n=== ${r.ticket.id || 'pasted'}: ${r.entry?.title || 'no playbook entry'}  [${r.status}]`);
  if (r.seenBefore?.length) console.log(`Seen before: ${r.seenBefore.map(f => `${f.id} x${f.times} (last ${f.lastSeen})`).join(', ')}`);
  if (r.evidence) console.log(`Lookup: ${r.evidence.calls.join(' | ') || 'none'}\n  ${r.evidence.summary}`);
  if (r.reply) console.log(`\n${r.reply}`);
  console.log(`\nChecker: ${r.check.pass ? 'PASS' : 'BLOCKED'}`);
  for (const p of r.check.problems) console.log(`  - ${p}`);
  for (const c of r.check.citations) console.log(`  step ${c.step}: ${c.found ? 'found' : 'NOT FOUND'} on ${c.url}${c.fetchedAt ? ` (fetched ${c.fetchedAt.slice(0, 10)})` : ''}`);
  if (r.refused) console.log(`\n${r.refused}`);
  if (r.escalationText) console.log(`\n${r.escalationText}`);
  if (r.docEditText) console.log(`\n${r.docEditText}`);
}

async function main() {
  if (cmd === 'serve') { const { startServer } = await import('../src/server.mjs'); await startServer({ port: Number(flag('--port') || process.env.PORT || 5610) }); return; }
  if (cmd === 'logs') { console.log(summarizeLastRun(deskPaths().logs).text); return; }
  if (cmd === 'hash') {
    // The fresh checker binds its verdict to the exact reply text: support-desk hash <reply.txt>
    const { readFileSync } = await import('node:fs');
    const { replyHash } = await import('../src/checkreply.mjs');
    if (!positional[0]) { console.error('usage: support-desk hash <reply-file>'); process.exitCode = 2; return; }
    console.log(replyHash(readFileSync(positional[0], 'utf8')));
    return;
  }
  const desk = openDesk();
  try {
    if (cmd === 'ticket') {
      const id = flag('--id');
      const t = id ? TICKETS.find(x => x.id === id) : { id: null, text: positional.join(' ') };
      if (!t || !t.text) { console.error('usage: support-desk ticket "<customer message>"  or  support-desk ticket --id T01'); process.exitCode = 2; return; }
      const r = await handleTicket(desk, t, { requireReview: args.includes('--require-review') });
      printResult(r);
      if (args.includes('--save-reply') && r.reply) { const { writeFileSync, mkdirSync } = await import('node:fs'); mkdirSync(desk.paths.reviews, { recursive: true }); const f = `${desk.paths.reviews}/${t.id || 'pasted'}.reply.txt`; writeFileSync(f, r.reply); console.log(`Reply saved for the fresh checker: ${f}`); }
      process.exitCode = r.entry && !r.check.pass ? 1 : 0;
    } else if (cmd === 'shift') {
      const results = await runShift(desk);
      for (const r of results) printResult(r);
      console.log(`\nShift done: ${results.length} tickets, ${results.filter(r => r.check.pass).length} replies passed the checker. Handoff: ${desk.paths.handoff}`);
    } else if (cmd === 'morning') {
      const m = await morning(desk);
      console.log(m.text);
      process.exitCode = m.error ? 1 : 0;
    } else if (cmd === 'docs') {
      for (const p of await refreshDocs(desk)) console.log(`${p.ok ? 'ok  ' : 'FAIL'} ${p.url}${p.ok ? ` (${p.via}, ${p.fetchedAt})` : ''}`);
    } else {
      console.log('commands: ticket "<message>" | ticket --id T01 | shift | morning | logs | docs | serve   (add --mock for sample account data)');
      process.exitCode = cmd ? 2 : 0;
    }
  } finally { await desk.close(); }
}

main().catch(e => { console.error(`ERROR: ${e.message}`); process.exitCode = 1; });
