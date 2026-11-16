# Second Read

A desk for the person answering Blotato support tickets.

Paste a customer's message.
You get the diagnosis from Blotato's own help docs, and a reply a fresh checker has tried to break.
When a person has to decide, you also get an escalation packet or a proposed help-doc edit.

I built this new for my application to the Customer Support AI Engineer role, with Claude Code.
It is my first app on the Blotato API.

## What it builds on, and what it adds

It uses Blotato's own pieces:
- **Blotato's docs MCP server** (`https://help.blotato.com/~gitbook/mcp`): every fact in a reply is a sentence from a help page, read through `getPage`. Unanswered questions are searched with `searchDocumentation`.
- **Blotato's REST API**, read-only: post status, the post list, and schedule lookups. The desk refuses anything that is not a GET, and there is no switch to turn that off.
- **Blotato's hosted MCP server** (`https://mcp.blotato.com/mcp`): not called by the script. The skill lets Claude or Codex use its read-only tools for a deeper look. The setup lines are below.

What it adds on top:
- A reply with the four parts Blotato's own [Diagnose a support question](https://help.blotato.com/start-with-an-ai-agent/agent-triage) page asks for. They are the answer, the next supported action, what proves success or what is still open, and a link to the relevant help page.
- A shape of its own on top: three to five numbered steps, each tied to a help-page sentence or a lookup, and exactly one "Next step:" line. The page does not ask for that; I added it so a customer can follow along.
- Two checkers. A script checks that every quote is really on the cited page, and blocks the promise patterns listed below. A fresh AI checker reads only the reply, the page text and the evidence, and tries to break it.
- An escalation packet for the founder: what was asked, what was checked, the evidence, two likely causes, and what was ruled out.
- A proposed help-doc edit when the docs have no answer, or the wrong one.
- "Your first support shift": a five-decision practice for new support people, built from the same playbook.

Blotato's "Fix My Automation" button covers n8n. This desk is for the tickets it does not cover: MCP, REST and plain questions.

## Try it in 60 seconds (sample data, no key)

You need Node 20 or newer and an internet connection. The first run reads the cited help pages through Blotato's docs MCP server. No key is needed for that.

```bash
npm install
npm test
node bin/support-desk.mjs ticket --id T11 --mock
node bin/support-desk.mjs serve --mock
```

Then open http://localhost:5610. If that port is busy, add `--port 5611` to the last line.

Or run `npm start`: it opens the same page with sample data and prints the link. `npm run serve` opens it on a real account (it needs your key).

`--mock` means account lookups use made-up posts. The page says so at the top. The help docs are always the real ones.

## The commands

```bash
node bin/support-desk.mjs ticket "<customer message>"      # one ticket
node bin/support-desk.mjs ticket --id T01 --save-reply     # a sample ticket, plus the packet for the fresh checker
node bin/support-desk.mjs cleared T01                      # may this saved reply be sent?
node bin/support-desk.mjs packets --all --mock --out <dir> # a checker packet for every entry's reply, plus <dir>/index.json
node bin/support-desk.mjs record-check --dir <dir>         # save the checkers' passes into knowledge/checks/
node bin/support-desk.mjs shift                            # all 12 sample tickets, then desk/HANDOFF.md
node bin/support-desk.mjs morning                          # what failed in the last 24 hours, to desk/MORNING.md
node bin/support-desk.mjs logs                             # what the last run did, with request ids
node bin/support-desk.mjs docs                             # read every cited help page again
node bin/support-desk.mjs docs --all                       # read every page in Blotato's help center into the cache
node bin/support-desk.mjs check-entries                    # check every entry: quotes, shape, routing
node bin/support-desk.mjs serve                            # the local page
```

Add `--mock` to any of them to use sample account data.

## Connect a real key

Copy `.env.example` to `.env` and paste your key after `BLOTATO_API_KEY=`.
The desk only reads with it. It never posts, changes or deletes anything.
The key goes only into the request header. It is never printed, logged or saved, and a test checks that.

## How a ticket flows

1. The desk checks `desk/known-failures.md` first. If it has seen this kind of ticket, it shows a "Seen before" line with what was done last time. The reply itself does not change.
2. It finds the playbook entry for the ticket, reads the cited help pages, and makes the read-only lookup the ticket needs.
3. It writes the reply. The script checker blocks it if a quote is not on its page, or if a status step has no lookup behind it.
   It also blocks it if any line of the reply matches one of its promise patterns:
   - the words promise, guarantee or "assure you"
   - a refund or credit ("refund you", "credit your account", "you will get a full refund")
   - an outcome stated as sure ("this fixes it", "will be fixed", "will work", "definitely", "never happens again")
   - a date or time for an outcome ("by Friday", "within 2 hours", "will be resolved in 3 days")

   A step that quotes a help page may repeat the page's own words. Promise words beyond the quote still block. A promise worded some other way is left to the fresh checker.
4. With `--save-reply`, it writes a packet for the fresh checker: the reply, the page text and the evidence. Never my notes.
5. The fresh checker (`.claude/agents/reply-checker.md`) writes a pass or block, tied to the exact reply text.
6. `cleared` lets the reply go only if the fresh checker passed that exact text. A block goes into `known-failures.md`.
   The page and the shift handoff say "ready to send" only then. Before that, they say the script check passed and the fresh check has not run yet.
7. If no entry is a clear match, the desk does not write a reply. It hands the message to a person with its top three candidates, and proposes a doc edit.

## Answers that come from the customer's own account

Some questions are about the customer's own account, not about how Blotato works.
"Did my posts go out?" and "Which accounts do I have connected?" are two of them.

For these, the desk reads the answer straight from Blotato, read-only:
- **Did my posts go out?** It lists the last 7 days of posts. It says how many went out and how many failed, gives the newest one with its link, and gives the error text of the newest failure. If nothing went out in 7 days, it looks back 60 days, so "none" is never the whole answer. It also says what is still scheduled.
- **Which accounts are connected?** It names each connected account by platform. Ask about one platform ("is my Pinterest connected?") and it says yes or no plainly.

The words around the facts were passed once by the fresh checker, as a template.
The facts are filled in from the account each time, so no model writes them and they cannot drift.
The page says both: "A second checker read the words of this reply" and "The facts in step 1 come straight from the customer's own account."

## The reader: a model that picks an entry, or says none (off by default)

Word matching misses a question asked in new words. The reader puts a language model where it helps, and keeps it from writing anything.
The reply is still the entry's saved text, which a fresh checker passed. The model only chooses which saved reply, or none.

1. The guards and the hand-over signals run first, exactly as before. The model never sees those messages.
2. A script picks up to about ten candidate entries: the matcher's best five (its threshold ignored) and the best five from a plain search over each entry's whole text.
3. One model call picks ONE entry that answers every point of the message, and copies, for each point, the sentence from that entry that covers it. "None" is a good answer.
4. A script checks the pick: the id is a candidate, every sentence is in that entry's own quotes or steps word for word, the entry's own hand-over signals still apply, and the coverage rules find no gap the pick leaves open. If anything fails, a person gets the message, as before.
5. Optional: a second, separate call reads only the message and the chosen reply and tries to find what it leaves unanswered. Any real objection hands the message over.
6. Any error, timeout or unreadable answer leaves the matcher's own decision exactly as it was.

Turn it on with environment variables (or the same flags on `eval/run.mjs`):

| Variable | Values | Default |
|---|---|---|
| `SUPPORT_DESK_READER` | `off`, `claude-cli` (the Claude Code CLI, signed in on this machine), `anthropic` (the Messages API) | `off` |
| `SUPPORT_DESK_READER_MODEL` | `haiku`, `sonnet`, or a full model id | `sonnet` |
| `SUPPORT_DESK_REFUTER` | `new` (only picks the matcher would not make itself), `on` (every pick), `off` | `new` |
| `SUPPORT_DESK_REFUTER_MODEL` | as above | the reader's model |
| `SUPPORT_DESK_READER_PROMPT` | `pick-r1`, `pick-r2` | `pick-r2` |
| `SUPPORT_DESK_READER_CACHE` | a folder for saved verdicts | `desk/reader-cache` |
| `ANTHROPIC_API_KEY` | your key, for the `anthropic` backend only | none |

```bash
SUPPORT_DESK_READER=claude-cli SUPPORT_DESK_READER_MODEL=sonnet node bin/support-desk.mjs ticket "<customer message>" --mock
node eval/run.mjs --set dev2 --reader claude-cli --model sonnet            # the exam, with the reader
node eval/run.mjs --set dev2 --reader claude-cli --model sonnet --cache-only 1   # the same numbers from the saved verdicts, no model call
```

The `claude-cli` backend runs `claude -p` with no tools, no MCP servers, no CLAUDE.md, no hooks and no saved session, in an empty folder. It sends the customer's message and the candidates' own text, nothing else.
Every verdict is saved under a hash of the prompt version, the model, the message and the candidates, so a second run costs nothing and gives the same answer. The saved file holds the hash and the verdict, not the message.
The result of every ticket has a `reader` field: backend, model, candidates, the pick or none, each point with its sentence, the refuter's verdict, and whether it came from the cache. Two reason codes are new: `reader-abstained` and `reader-refuted` (see `knowledge/ENTRY-GUIDE.md`).

## The composer: an answer from any help page, every sentence proven, then a second read (off by default)

The saved entries quote only 36 of Blotato's 278 help pages, so for most questions no saved reply holds the answer.
The composer writes one from the pages themselves, and the script proves every step before anyone sees it.

It runs only when the guards and the hand-over signals did not take the message, and no saved entry answered it (the matcher or the reader).

1. **The script finds the passages.** Every cached help page is split into citable units: a heading, a sentence, a list item, a table row. A plain BM25 search ranks the passages. A fast model may first write three to five search queries in the pages' own words; the script ranks for the message and for each query and merges the lists. The writer sees the top 16 passages from up to 5 pages, every unit numbered S1, S2, ...
2. **The writer** (one model call) says whether the passages answer everything the customer asked, lists what was asked, and writes 1 to 5 short steps, each with the ids of the sentences that prove it. "Not answerable" is a good outcome.
3. **The script verifies, never trusts.** The draft is dropped (a person gets the message, as before) unless every id exists and its sentence is on the cached page word for word; every step cites at least one; every number, URL, route, file type, plan, platform, name with digits, quoted label, menu path and capitalized name in a step is also in that step's own sentences; every thing asked is tied to a step; no quote sends the customer to support; the script checker (promises, retries, shape) passes on the assembled reply; and the coverage rules find no gap the quotes leave open.
4. **The second read** (a fresh call, another prompt, no memory of the first) sees the message, the assembled reply and the full help-page sections cited, and tries to break it. Any real objection hands the message to a person.
5. The greeting, the opening line, the fixed lines that keep the 3-to-5-step shape, the next step, the "Still open:" line, the help-page links and the sign-off are the script's. Only the step sentences are the model's.

A composed reply is never one of the saved, pre-checked replies. Its result says `path: "composed"`, carries every step with its sentences and pages, the script checks and the second reader's verdict, and its state is `checked-live` (the second read passed it just now), never the fresh checker's `passed`.
Two reason codes are new: `compose-unverified` and `second-read-objected`.

| Variable | Values | Default |
|---|---|---|
| `SUPPORT_DESK_COMPOSER` | `off`, `claude-cli`, `anthropic` | `off` |
| `SUPPORT_DESK_COMPOSER_MODEL` | the writer's model: `haiku`, `sonnet`, or a full id | `sonnet` |
| `SUPPORT_DESK_SECOND_READ` | `on`, `off` | `on` |
| `SUPPORT_DESK_SECOND_READ_MODEL` | the second reader's model | the writer's |
| `SUPPORT_DESK_COMPOSER_EXPAND` | the search step, `on` or `off` | `on` |
| `SUPPORT_DESK_COMPOSER_EXPAND_MODEL` | its model | `haiku` |
| `SUPPORT_DESK_COMPOSER_CACHE` | a folder for saved verdicts | `desk/composer-cache` |

```bash
SUPPORT_DESK_READER=claude-cli SUPPORT_DESK_COMPOSER=claude-cli node bin/support-desk.mjs ticket "<customer message>" --mock
node eval/run.mjs --set dev2 --reader claude-cli --composer claude-cli          # the exam, both on
node eval/run.mjs --set dev2 --reader claude-cli --composer claude-cli --cache-only 1 --composer-cache-only 1   # the same numbers, no model call
```

The calls go through the same backends and the same kind of verdict cache as the reader: no tools, and files named by a hash of the prompt version, the model, the message and the passages. A saved file never holds the message itself, but it does hold the model's own words (what it found asked, its steps, its search queries), which can paraphrase the message. Keep the cache folder as private as `desk/`.

## The 12 sample tickets

They are made up, and they cover the three kinds in the job post: non-technical, billing, and mildly technical.

| | Ticket | What the desk does |
|---|---|---|
| T01 | "Says published, but I can't find it" | Reply, with the post it found |
| T02 | "My posts show CANCELED" | Reply |
| T03 | "Post to our LinkedIn company Page?" | Reply |
| T04 | "Charged after making an API key on the trial" | Reply, and escalates the charge |
| T05 | "Cancel or pause my plan?" | Reply |
| T06 | "401 Unauthorized" | Reply |
| T07 | "Too many requests" from n8n | Reply |
| T08 | `invalid_grant` from the connector in Claude | Reply |
| T09 | "Timed out. Send it again?" | Reply, with what it found in the account |
| T10 | "Stuck on in-progress" | Reply, with the real lookup |
| T11 | Schedule lookup answers 500 "bigint" | Reproduces it, escalates, proposes a doc edit |
| T12 | "Is there a test mode?" | Holding reply, escalates, proposes a new FAQ entry |

A message that matches none of them clearly gets no reply. It is escalated with the docs search it ran and the matcher's top three candidates. A message asking us to post, delete or change something, asking for someone else's data or a key, or giving the desk instructions, goes to a person with a short holding reply. So does a message from someone who already tried the steps.

A message about a charge, a refund or money taken always goes to a person, even when it also asks something easy, like how to cancel. It gets a short holding reply, every line from the help docs, and an escalation packet. The desk cannot see payments, so it never promises a refund or a credit.

All 12 replies passed the fresh checker, after two rounds of fixes. More on that below.

## Use it in Claude Code or Codex

Claude Code reads `CLAUDE.md`, the `support-desk` skill and the `reply-checker` subagent in `.claude/`.
Codex reads `AGENTS.md`, which has the same steps and rules.

Blotato's docs MCP server is already in `.mcp.json`. It needs no key.

To add Blotato's hosted MCP server, use the lines from Blotato's [setup page](https://help.blotato.com/start-with-an-ai-agent/mcp/setup) (read Nov 15, 2026):

```bash
# Claude Code (sign in through /mcp afterwards)
claude mcp add --transport http blotato https://mcp.blotato.com/mcp

# Codex CLI
codex mcp add blotato --url https://mcp.blotato.com/mcp
codex mcp login blotato
```

To add the docs server to Codex the same way:

```bash
codex mcp add blotato-docs --url https://help.blotato.com/~gitbook/mcp
```

Keep API keys out of `.mcp.json`. Blotato's page says the same.

## The daily "what broke overnight" check

`scheduled/what-broke-overnight.ps1` runs `morning`, which lists posts that failed in the last 24 hours and explains each one.
`scheduled/what-broke-overnight.xml` is the Windows Task Scheduler definition. The file has the one `schtasks` line to register it and a cron line for Mac or Linux.
Nothing in this repo registers it for you.

## What is proven against the real API, and what is not

I built this with Claude Code. Claude Code ran these read-only calls against my real Blotato account, with my key, while we built it on Nov 15, 2026:

| Call | Answer |
|---|---|
| `GET /v2/users/me/accounts` | 200 |
| `GET /v2/users/me/accounts` with a wrong key | 401 `{"message":"Unauthorized"}` |
| `GET /v2/posts` | 200 |
| `GET /v2/schedules?limit=5` | 200 |
| `GET /v2/posts/<an id that does not exist>` | 200, `in-progress` |
| `GET /v2/schedules/sch_abc123` | 500, `invalid input syntax for type bigint` |
| `GET /v2/posts?status=failed` for the last 24 hours | 200 |

Claude Code also ran tickets T10 and T11 and the morning note end to end against the real API, the same day.

On Nov 16, 2026, the two account answers ran against my real account, read-only.
"Which accounts do I have connected?" named all 7 connected accounts.
"Did my posts go out?" said none went out in the last 7 days, then gave my newest post, from earlier in the month, with its link.

Not proven yet:
- Anything with a real customer's ticket. The 12 tickets are made up.
- The sample posts behind `--mock`. They follow the documented shapes, but they are not real data.
- The hosted MCP server. The desk does not call it, and I have not run the skill with it connected.
- Running the fresh checker from Codex. Every fresh-checker run so far was a Claude Code subagent, started by Claude Code while we built this.
- The scheduled task. It is defined, not registered.

## Two things I noticed in Blotato's docs

- The schedules page shows ids like `"sch_abc123"`. The live API reads a schedule id as a number, and a text id answers 500, not 404. Ticket T11 reproduces it and proposes the doc edit.
- The [Claude Code tutorial page](https://help.blotato.com/integrations-and-automation-templates/claude-code) adds the server with `claude mcp add blotato --url ...`. `claude mcp add --help` lists no `--url` option. The [setup page](https://help.blotato.com/start-with-an-ai-agent/mcp/setup) uses `--transport http`, which does.

## The MCP servers I used while building this, and why

<!-- TO CONFIRM BEFORE PUBLISHING: this list holds only what the build log shows. Add or remove in your own words. -->
- **Blotato's docs MCP server.** The desk reads every cited help page through it, so each reply quotes the docs instead of guessing.
- Headless page checks used the Playwright library, not an MCP server.

## The hardest part

<!-- TO CONFIRM BEFORE PUBLISHING, IN YOUR OWN WORDS. Drawn only from the build log. -->
Getting a reply that is checked, not only cited.

My script checker passed all 12 replies. Every quote was really on its page.
Then a fresh checker read each reply with only the page text and the evidence. It blocked 9 of 12.

The quotes were real. The steps said more than the quotes did.
One reply said "Published" means Blotato got a result back from the platform. The page says Blotato "recorded a publishing result."
Another told a customer with a 401 that the free trial might be the cause. The page says a plan problem answers 403.
Two next steps could have made a customer send a post twice.

I fixed each one from the page's own words. The second round passed 9 of 10. The last one passed on the third read.

## How I debugged it

<!-- TO CONFIRM BEFORE PUBLISHING, IN YOUR OWN WORDS. Drawn only from the build log. -->
- **Read-only calls against the real API.** The docs show schedule ids like `sch_abc123`. A real lookup with one answered 500 "invalid input syntax for type bigint". That became ticket T11.
- **The request id in every log line.** Blotato's error bodies carry a `reqId`. The log keeps it, so a ticket can quote it.
- **Tests that try to break it.** One test checks that the key never shows up in an error. It failed at first: an error message could have carried the key. Now the key is scrubbed from every response before anything reads it.
- **Reading the checker's findings, not only its verdict.** One block was my bug, not the reply's: my packet stripped underscores, so the checker saw `schabc123`. I fixed the packet.

## What is not done

- More entries. Thirteen kinds of tickets is a start, not the help center. The format for the rest is in `knowledge/ENTRY-GUIDE.md`.
- A refused ticket can still have an answer in the docs. "Can Blotato post to my Mastodon server?" is refused, because no entry matches and the search's top results miss it. Blotato's FAQ does answer it: its platform list says Blotato does not publish outside that list. So the proposed FAQ entry for it is not needed. The desk is safe here, since it refuses instead of guessing, but a person still has to look.
- The sample posts in `--mock` are fixed. They do not come from a recording of a real account.
- The known-failures list counts every run, including test runs on your own machine.

## Where things live

- `knowledge/entries/*.json`: one file per help-center area, one entry per kind of ticket, each step tied to a help-page sentence. How to write one: `knowledge/ENTRY-GUIDE.md`.
- `knowledge/playbook.mjs`: loads and checks the entries, and routes each message (guards, matcher, signals).
- `knowledge/tickets.json`: the 12 sample tickets.
- `knowledge/checks/`: saved passes from the fresh checker, one small file per checked reply text (named by its sha256). A reply counts as checked when its exact text has a pass here or in `desk/reviews/`. See its README.
- `knowledge/practice.mjs`: the practice shift.
- `src/`: the desk, diagnosis, both checkers, the docs client, the read-only API client, logs and sample data.
- `examples/`: a shift handoff, a morning note, the known-failures list, a checker packet (T02) with its pass, and a first-round block (T07).
- `LEARNED-FROM.md`: the ideas I borrowed, and from whom.

## What git leaves out, and why

- `.env`: your key.
- `desk/`: customer messages, replies and logs. They should not land in a commit.
- `.cache/`: copies of Blotato's help pages. They are Blotato's to publish, so the desk fetches them on your first run instead.

## License

MIT. See `LICENSE`.
