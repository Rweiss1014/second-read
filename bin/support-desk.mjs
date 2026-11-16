#!/usr/bin/env node
// support-desk: paste a customer's message, get the documented diagnosis, a checked reply,
// and the escalation packet or help-doc edit when a person has to decide.
//
//   support-desk ticket "<customer message>"   one ticket (or: ticket --id T06 for a sample ticket)
//        --save-reply      also write the fresh checker's packet (desk/reviews/<id>.packet.md): the reply,
//                          the cited page text and the status evidence, nothing else
//        --require-review  block the reply until the fresh checker's verdict for this exact text is in
//   support-desk cleared T10                   may the saved reply be sent? (needs a fresh-checker pass)
//   support-desk hash <reply.txt>              the hash a checker verdict must carry
//   support-desk shift                         all 12 sample tickets, then HANDOFF.md
//   support-desk morning                       what broke overnight, written to MORNING.md
//   support-desk logs                          a summary of the last run
//   support-desk docs                          refresh the cited help pages through Blotato's docs MCP
//   support-desk docs --all [--refresh]        read every page in the help index into the cache, politely
//   support-desk check-entries                 check every entry in knowledge/entries/ (shape and quotes)
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
  console.log(`\nScript checker: ${r.check.pass ? 'PASS' : 'BLOCKED'}`);
  for (const p of r.check.problems) console.log(`  - ${p}`);
  for (const c of r.check.citations) console.log(`  step ${c.step}: ${c.found ? 'found' : 'NOT FOUND'} on ${c.url}${c.fetchedAt ? ` (fetched ${c.fetchedAt.slice(0, 10)})` : ''}`);
  if (r.fresh) {
    const words = { passed: 'PASSED this exact text. Cleared to send.', 'passed-saved': 'passed the saved copy, not this run\'s text. Not cleared.', blocked: 'BLOCKED the saved copy. Not cleared.', stale: 'its verdict is for an older text. Not cleared.', none: 'not run yet. Not cleared to send.' };
    console.log(`Fresh checker: ${words[r.fresh.state]}`);
  }
  if (r.refused) console.log(`\n${r.refused}`);
  if (r.escalationText) console.log(`\n${r.escalationText}`);
  if (r.docEditText) console.log(`\n${r.docEditText}`);
}

async function main() {
  if (cmd === 'serve') { const { startServer } = await import('../src/server.mjs'); await startServer({ port: Number(flag('--port') || process.env.PORT || 5610) }); return; }
  if (cmd === 'check-entries') {
    // Every writer runs this before a commit: the shape of every entry, and every quote against its cached page.
    const { checkEntries } = await import('../src/entries.mjs');
    const r = checkEntries({ cacheDir: deskPaths().docsCache });
    for (const p of r.problems) console.log(`FAIL ${p}`);
    for (const w of r.warnings) console.log(`WARN ${w}`);
    console.log(`
${r.ok ? 'All entries pass.' : `${r.problems.length} problem(s). Nothing above is optional: fix each one, then run this again.`}`);
    console.log(`Entries: ${r.entries} in ${r.files} file(s). Help pages cited: ${r.pagesCited}. Help pages cached: ${r.pagesCached}.`);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (cmd === 'logs') { console.log(summarizeLastRun(deskPaths().logs).text); return; }
  if (cmd === 'cleared') {
    // support-desk cleared T10: may this saved reply be sent? Only with a fresh-checker pass for this exact text.
    const { clearedToSend } = await import('../src/checkreply.mjs');
    if (!positional[0]) { console.error('usage: support-desk cleared <ticket id>'); process.exitCode = 2; return; }
    const c = clearedToSend(deskPaths().reviews, positional[0]);
    if (!c.ok) {
      console.log(`NOT CLEARED: ${c.why}`);
      if (c.blocked) {
        // Mistakes teach: a reply the fresh checker blocked goes on the list, so the next run starts from it.
        const { recordFailure, ensureFailuresFile } = await import('../src/failures.mjs');
        ensureFailuresFile(deskPaths().failures);
        recordFailure(deskPaths().failures, { id: `checker-blocked-${positional[0]}`, title: `The fresh checker blocked the reply to ${positional[0]}`, why: c.findings[0] || 'no reason given', fix: 'Fix the playbook step or its quote, run the ticket again with --save-reply, and get a new verdict. Never send the blocked version.' });
        console.log('Recorded in known-failures.md.');
      }
      process.exitCode = 1; return;
    }
    console.log(`CLEARED to send (fresh checker passed it ${c.checkedAt || ''}).${c.notes.length ? `
Checker notes: ${c.notes.join(' | ')}` : ''}

${c.reply}`);
    return;
  }
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
      if (args.includes('--save-reply') && r.reply) {
        // The packet holds only the reply, the cited page text and the status evidence. Never the writer's notes.
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { buildPacket } = await import('../src/packet.mjs');
        const p = buildPacket(r, { mock: desk.mock });
        mkdirSync(desk.paths.reviews, { recursive: true });
        writeFileSync(join(desk.paths.reviews, `${p.name}.reply.txt`), r.reply);
        writeFileSync(join(desk.paths.reviews, `${p.name}.packet.md`), p.text);
        console.log(`\nFor the fresh checker: ${join(desk.paths.reviews, `${p.name}.packet.md`)}`);
        console.log(`Its verdict goes in:   ${join(desk.paths.reviews, `${p.name}.json`)}  (reply hash ${p.hash})`);
      }
      process.exitCode = r.entry && !r.check.pass ? 1 : 0;
    } else if (cmd === 'shift') {
      const results = await runShift(desk);
      for (const r of results) printResult(r);
      console.log(`\nShift done: ${results.length} tickets, ${results.filter(r => r.check.pass).length} replies passed the script check, ${results.filter(r => r.fresh?.state === 'passed').length} cleared by the fresh checker. Handoff: ${desk.paths.handoff}`);
    } else if (cmd === 'morning') {
      const m = await morning(desk);
      console.log(m.text);
      process.exitCode = m.error ? 1 : 0;
    } else if (cmd === 'docs' && args.includes('--all')) {
      // Every page in https://help.blotato.com/llms.txt, one at a time, into .cache/docs.
      const { cacheAllDocs } = await import('../src/desk.mjs');
      const r = await cacheAllDocs(desk, { refresh: args.includes('--refresh'), onPage: (p) => { if (!p.skipped) console.log(`${p.ok ? 'ok  ' : 'FAIL'} ${p.url}${p.via ? ` (${p.via})` : ''}`); } });
      console.log(`\nHelp index: ${r.total} pages. Newly cached: ${r.cached}. Already cached: ${r.skipped}. Failed: ${r.failed.length}.${r.stopped ? ' Stopped early after repeated errors.' : ''}`);
      for (const u of r.failed) console.log(`  failed: ${u}`);
      process.exitCode = r.failed.length ? 1 : 0;
    } else if (cmd === 'docs') {
      for (const p of await refreshDocs(desk)) console.log(`${p.ok ? 'ok  ' : 'FAIL'} ${p.url}${p.ok ? ` (${p.via}, ${p.fetchedAt})` : ''}`);
    } else {
      console.log('commands: ticket "<message>" | ticket --id T01 [--save-reply] | cleared T01 | shift | morning | logs | docs [--all] | check-entries | serve   (add --mock for sample account data)');
      process.exitCode = cmd ? 2 : 0;
    }
  } finally { await desk.close(); }
}

main().catch(e => { console.error(`ERROR: ${e.message}`); process.exitCode = 1; });
