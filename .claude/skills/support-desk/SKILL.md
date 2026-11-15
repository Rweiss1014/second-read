---
name: support-desk
description: Answer one Blotato customer ticket the way the Support Desk does. Diagnose from Blotato's own help docs and read-only account status, write a reply in three to five numbered steps, have a fresh checker try to break it, and escalate or propose a help-doc edit when a person has to decide. Use when someone pastes a customer's message, asks "why did my post fail?", or says "work the support queue".
---

# Support Desk

One ticket at a time. One builds, one checks. Nothing is posted, changed or deleted on anyone's account.

## 1. Read what this desk already learned
Open `desk/known-failures.md`. If this kind of ticket is on it, read what was done last time. The script shows it as a "Seen before" line; it does not change the reply.

## 2. Diagnose with evidence
Run the script. It reads the cited help pages through Blotato's docs MCP server and makes only read-only status calls:

```bash
node bin/support-desk.mjs ticket "<the customer's words>" --save-reply
# or a sample ticket:
node bin/support-desk.mjs ticket --id T10 --save-reply
```

Add `--mock` when there is no Blotato key. Account lookups then use sample data, and the output says so.

A message about a charge, a refund or money taken always gets a holding reply and an escalation packet, never how-to steps. Never promise a refund or a credit.

If the script says it refused (no playbook entry matched), stop here. Do not write a reply of your own. Send the escalation packet and the proposed help-doc edit it printed to the founder.

If you have Blotato's MCP servers connected, you may use them to look further, read-only only:
- `blotato-docs`: `searchDocumentation` and `getPage`. Never `sendFeedback` (it sends a report) or `askQuestion` (an AI answer is not a source).
- `blotato`: only `blotato_get_user`, `blotato_list_accounts`, `blotato_get_post_status`, `blotato_list_posts`, `blotato_list_schedules`, `blotato_get_schedule`, `blotato_list_automation_runs`, `blotato_list_automation_logs`. Never a tool that creates, updates, deletes, posts or sends.

Anything you learn this way goes into the playbook as a cited step, so the script can check it next time. It never goes straight into a reply.

## 3. One builds, one checks
The script's own checker already ran. Every quoted sentence must be on the cited page, and every status step must rest on a lookup that worked.
It also blocks any line of the reply that matches its promise patterns.
They catch promise or guarantee words, a refund or credit, and an outcome stated as sure ("this fixes it", "will be fixed").
They also catch a date or time for an outcome ("by Friday", "within 2 hours"). A step may repeat its own help-page quote. Anything worded another way is for the fresh checker to catch.

Now get the deeper read. Start the `reply-checker` subagent with ONLY the packet path the script printed (`desk/reviews/<id>.packet.md`). Do not give it your notes, the playbook, or this conversation.

When it has written its verdict, ask the send gate:

```bash
node bin/support-desk.mjs cleared T10
```

It clears the reply only if the checker passed that exact saved text. If the checker blocked it, the gate says why and records it in `desk/known-failures.md`. Fix the playbook step or its citation, run step 2 again, and check again. Never send a blocked reply.

(`ticket --require-review` does the same check on a fresh run. Use it for replies with no live lookup; a live lookup can change the text between runs.)

## 4. Hand it over
- Reply cleared (the fresh checker passed this exact text): copy it to the customer. Until then it is a draft.
- Escalation packet printed: send it to the founder as it is. It already has what was asked, what was checked, the evidence, two likely causes and what was ruled out.
- Proposed help-doc edit printed: it is a proposal for a person to approve. Nothing is published by the desk.

## 5. End of shift
```bash
node bin/support-desk.mjs shift     # every sample ticket, then desk/HANDOFF.md
node bin/support-desk.mjs logs      # what the last run did, with request ids to quote
```

The next person starts from `desk/HANDOFF.md`, not from the logs.

## Done means
- The reply passed the script checker and the fresh checker passed that exact text, or the ticket was refused and escalated.
- `desk/known-failures.md` has the ticket (the script writes it).
- Nothing was sent to Blotato except GET requests.
