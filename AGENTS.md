# AGENTS.md

Instructions for any coding agent working in this repo (Codex, Claude Code, or another).
Claude Code reads the same file through `CLAUDE.md`.

## What this repo is
Second Read, a support desk: a tool for the person answering Blotato support tickets.
A customer's message goes in. Out comes a diagnosis from Blotato's own help docs and read-only account status, and a reply in three to five numbered steps.
When a person has to decide, it also writes an escalation packet or a proposed help-doc edit.

## Rules that do not bend
- The desk only reads. Never send a POST, PUT, PATCH or DELETE to the Blotato API. The client refuses them, and there is no switch to turn that off. Do not add one.
- On Blotato's docs MCP server, use only `searchDocumentation` and `getPage`. Never `sendFeedback` (it sends a report to Blotato) or `askQuestion` (an AI answer is not a source).
- On Blotato's hosted MCP server, use only tools that read: `blotato_get_user`, `blotato_list_accounts`, `blotato_get_post_status`, `blotato_list_posts`, `blotato_list_schedules`, `blotato_get_schedule`, `blotato_list_automation_runs`, `blotato_list_automation_logs`.
- Never write a reply the playbook cannot cite. If the desk refuses a ticket, escalate it and propose a doc edit. Do not guess.
- Never send a reply the checker blocked. A reply is ready to send only when the fresh checker passed that exact text.
- A message about a charge, a refund or money taken always goes to a person. Never promise a refund or a credit.
- The API key lives only in the environment or in `.env`. Never print it, log it, or put it in a file, a commit or `.mcp.json`.
- Customer messages, account names and post text never go into a commit. `desk/` is ignored by git for that reason.

## Commands
```bash
npm test                                            # the whole test suite, no key, no network
node bin/support-desk.mjs ticket --id T10 --mock    # one sample ticket with sample account data
node bin/support-desk.mjs ticket "<message>"        # a real message (needs BLOTATO_API_KEY, read-only)
node bin/support-desk.mjs cleared T10               # may the saved reply be sent? (needs a fresh-checker pass)
node bin/support-desk.mjs shift --mock              # all 12 sample tickets, then desk/HANDOFF.md
node bin/support-desk.mjs packets --all --mock --out <dir>   # a checker packet for every entry's reply, plus <dir>/index.json
node bin/support-desk.mjs record-check --dir <dir>  # save the checkers' passes into knowledge/checks/ (a pass for text nobody packed is refused)
node bin/support-desk.mjs morning                   # what failed in the last 24 hours, to desk/MORNING.md
node bin/support-desk.mjs logs                      # summary of the last run
node bin/support-desk.mjs docs                      # re-read every cited help page through the docs MCP
node bin/support-desk.mjs serve --mock              # the local page on http://localhost:5610
```

## One builds, one checks
1. `node bin/support-desk.mjs ticket --id T10 --save-reply` writes `desk/reviews/T10.packet.md`.
   The packet holds only the reply, the cited page text and the status evidence.
2. A fresh checker reads only that packet and writes `desk/reviews/T10.json`. The checker's instructions are in `.claude/agents/reply-checker.md`.
   - In Claude Code: start the `reply-checker` subagent with the packet path, and nothing else.
   - In Codex: start a separate run so it has none of this session's notes, for example
     `codex exec -s read-only -o desk/reviews/T10.json "Follow .claude/agents/reply-checker.md for desk/reviews/T10.packet.md. Read only those two files. Reply with only the verdict JSON."`
3. `node bin/support-desk.mjs cleared T10` clears the saved reply only if a pass exists for this exact text, in `knowledge/checks/` (shipped with the repo) or in `desk/reviews/`. A block is recorded in `desk/known-failures.md`.

The full steps are in `.claude/skills/support-desk/SKILL.md`. In Codex, read that file and follow it the same way.

## Mistakes teach
Every ticket goes into `desk/known-failures.md`: solved, blocked, or unanswered. Each new ticket is checked against it first.
When a fix repeats, turn it into a playbook entry or a test, not a note.

## Where things are
- `knowledge/entries/*.json`: one entry per kind of ticket, one file per help-center area. Every fact step quotes a sentence from a Blotato help page. To add one, follow `knowledge/ENTRY-GUIDE.md` and run `check-entries`.
- `knowledge/playbook.mjs`: loads the entries and routes a message: guards first (`src/signals.mjs`), then the matcher (`src/match.mjs`, `src/route.mjs`).
- `eval/`: the exam. Tune on `tickets.dev.jsonl` only. Never open `tickets.test.jsonl`; run it only with `node eval/run.mjs --set test`.
- `knowledge/tickets.json`: the 12 made-up sample tickets.
- `knowledge/practice.mjs`: "Your first support shift", the five-decision practice.
- `src/`: the desk (`desk.mjs`), diagnosis (`diagnose.mjs`), the script checker (`checkreply.mjs`), the checker packet (`packet.mjs`), docs through the docs MCP (`docs.mjs`), the read-only API client (`api.mjs`), logs (`log.mjs`), sample data (`mock.mjs`), the page server (`server.mjs`).
- `scheduled/`: the daily "what broke overnight" task, defined but not registered.

## Before you call a change done
Run `npm test`. If you changed a reply, run that ticket again and get a fresh checker verdict for the new text.
