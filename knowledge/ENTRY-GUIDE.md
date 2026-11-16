# How to write a Support Desk entry

An entry is one kind of customer question, with the reply the desk sends for it.
Every fact in that reply is a sentence copied from a Blotato help page, so a checker can prove it.

Entries live in `knowledge/entries/`, one JSON file per help-center area (`billing.json`, `rest-api.json`, and so on).
Add yours to the file for its area. For a new area, make a new file shaped like this:

```json
{ "area": "Analytics and the inbox", "entries": [ ] }
```

Two writers can work at the same time without touching each other, as long as each has their own file or their own entries.

## Before you start: get the help pages

```bash
node bin/support-desk.mjs docs --all
```

This reads every page in Blotato's help center into `.cache/docs/`, one at a time. Pages already there are skipped.
Each page is a JSON file. Its `text` field is what your quotes are checked against.

## The shape, with one full example

This is the real `canceled-status` entry from `knowledge/entries/posts-and-publishing.json`.

```json
{
  "id": "canceled-status",
  "kind": "non-technical",
  "title": "Posts show CANCELED",
  "phrasings": [
    "my posts show canceled in the calendar",
    "why does my post say CANCELED",
    "the post status changed to canceled, is it failing",
    "several scheduled posts are marked cancelled",
    "what does the canceled status mean on a post",
    "my post got cancelled and never went out",
    "calender shows canceld on my posts"
  ],
  "not_this": [
    "how do I cancel my subscription",
    "I canceled my plan",
    "how do I cancel a scheduled post"
  ],
  "anchors": [
    ["canceled", "cancelled"],
    ["post", "posts", "status", "calendar", "calender", "scheduled"]
  ],
  "needs_person_if": {
    "signals": ["tried-steps", "still-broken", "retried"],
    "phrases": ["did not delete", "never deleted", "did not remove", "never removed", "didn't cancel"]
  },
  "opening": "Good news first: nothing is broken.",
  "steps": [
    { "type": "fact", "text": "CANCELED is not a failure. It is a status.",
      "cite": { "url": "https://help.blotato.com/support/faqs", "quote": "No. CANCELED is a post status, not a publishing failure." } },
    { "type": "fact", "text": "It means the schedule was removed before the post went out: deleted from the calendar, moved back to drafts, or removed through the API.",
      "cite": { "url": "https://help.blotato.com/support/faqs", "quote": "A post is marked canceled when its schedule was removed before it published" } },
    { "type": "fact", "text": "Nothing went wrong on the social platform.",
      "cite": { "url": "https://help.blotato.com/support/faqs", "quote": "Nothing went wrong on the social platform." } },
    { "type": "fact", "text": "If you meant it to go out, open the post and schedule it again.",
      "cite": { "url": "https://help.blotato.com/support/faqs", "quote": "If you meant the post to go out, open it and schedule it again." } }
  ],
  "next": "Open the post and schedule it again if you still want it to go out.",
  "proof": "You will know it worked when the post shows as scheduled again in your calendar."
}
```

The customer gets: `Hi,`, the opening, the steps numbered 1 to 4, `Next step:` with your next line, the proof line, and a link to the first cited page.

### Every field

| Field | Needed? | What it is |
|---|---|---|
| `id` | yes | Lowercase words joined by hyphens. Unique across every file. |
| `kind` | yes | `non-technical`, `billing` or `technical`. |
| `title` | yes | One line a support person reads. The matcher also uses it. |
| `phrasings` | yes, at least 5 | Ways a customer might say it. See below. |
| `not_this` | no, but write some | Near misses that belong to another entry or to a person. |
| `anchors` | no, but use them | Words the message must contain. See below. |
| `needs_person_if` | yes, for an entry that answers | Signals that turn your answer into a hand-over. At least one named signal; phrases alone are not enough. `ignore` opts out of a default signal. |
| `opening` | yes | One or two warm sentences before the steps. |
| `steps` | yes, 3 to 5 | `fact`, `evidence` or `action` steps. |
| `next` | yes | Exactly one next step for the customer. |
| `proof` | yes | Starts with `You will know it` or `Still open:`. |
| `lookup` | no | A read-only account lookup: `recent-published`, `recent-activity`, `submission`, `reproduce-schedule` or `docs-search`. |
| `searchQueries` | with `docs-search` | The searches to run. |
| `escalate` | no | `{ "why", "causes": [...], "ruledOut": [...] }`. The reply also goes to a person, with a packet. |
| `docEdit` | no | A proposed help-doc change: `{ "article", "kind": "new" or "change", ... }`. |
| `noDocAnswer` | no | `true` when the docs do not answer it. The reply is a holding reply. |
| `holding` | no | Your own holding reply (`opening`, `steps`, `next`, `proof`) for when a signal fires. Without it, the one in `guards.json` for the hand-over's reason is used: `needs-person` (which thanks the customer for what they tried) for `tried-already` only, `possible-outage` for `outage`, and the neutral `handover` for every other reason. |
| `guard`, `priority` | rarely | Only for hand-over entries. Money entries use `"guard": "money"`, and a higher `priority` wins when its anchors are met. |
| `note` | no | A note for other writers. Never shown to customers. |
| `scope` | rarely | What your quotes cover beyond their own words, or do not cover: `{ "covers", "coversKinds", "not", "why" }`. See "Specifics must be covered". |

## The rules for the reply

1. **Every fact step quotes an exact sentence from the page it cites.** Copy it from the page. The check ignores Markdown, extra spaces and curly quotes, and nothing else. A word changed is a fail.
2. **A step says no more than its quote.** You may say it more plainly. You may not add a cause, a promise or a fact the quote does not hold. A fresh checker reads every reply against its quotes and blocks the ones that stretch.
3. **Three to five steps.** Customers follow that many.
4. **One next step.** One thing to do, in the `next` field. Do not put a second one in a step.
5. **A proof line.** Say what the customer will see when it worked (`You will know it worked when...`), or what is still open (`Still open: ...`).
6. **No promises.** No "promise", "guarantee", "this fixes it", "will be fixed", "definitely", no refund or credit, and no date or time for an outcome ("by Friday", "within 2 hours"). A fact step may repeat its quote's own words. Nothing else may.
7. **Kind, plain words.** Short full sentences. American spelling. No em dashes, no words that make a step sound easy, and no hype words. The script checker's list is `VOICE` in `src/checkreply.mjs`, and check-entries runs it on every line.
8. **Evidence steps** need a `lookup`, and use `{evidence}` where the lookup's finding goes: `"I checked your account: {evidence}"`.
9. **Action steps** say what we will do ("I am passing this to a person on the team"). They have no quote, so they may not state facts about Blotato.
10. **No retry before the platform is checked.** A line that tells the customer to retry, resend, repost, republish or try again fails unless an earlier step (or an earlier sentence of the same line) has them check the platform itself for the first post: "check your TikTok account itself", "open any returned platform URL and check the intended account on the platform". Blotato's Scheduled, Published and Failed lists alone do not show whether a post went out, and the publishing-status page says "Do not submit a replacement while the original outcome is unknown." When the first attempt was turned down for a known reason (a wrong field, a limit, an expired token), name the fix and leave out the "send it again". Retrying something that is not a post (an authorization, a checkout, a DM automation, a read) is not caught.

## Phrasings: how customers really say it

Write at least five. Eight to twelve is better.

- Mix short and long: "cancel?" and "how do I cancel my subscription before it renews".
- Write it the way a confused beginner would, and the way a developer would, with the error text.
- Add clumsy and misspelled ones: "cancle my subscribtion how", "calender shows canceld".
- Add a non-native one: "how I stop to pay for blotato".
- Write questions, not requests. "Please cancel my plan" is a request for a person, and a guard takes it before your entry (check-entries tells you).
- **Never copy a message from `eval/tickets.*.jsonl`.** Those are the exam. Write your own words. Nobody opens `eval/tickets.test.jsonl` at all.
- Two entries may not share a phrasing. Check-entries fails if they do.

## not_this: the near misses

A near miss shares words with your entry but belongs somewhere else.
For `canceled-status`, "how do I cancel my subscription" says "cancel" too, but it is about billing.

A near miss blocks your entry only when both are true:
- the message is about as close to the near miss as to your best phrasing, and
- the message uses a word that is in the near miss but in none of your phrasings.

So put the telling word in it: "I canceled my **plan**" blocks a message about a plan, because no phrasing of `canceled-status` says "plan".
In the same example, "how do I cancel a scheduled post" cannot block on its own, because "scheduled" is also in one of the phrasings. There the anchors do the work: the message must say "canceled" or "cancelled", and "cancel" is not enough.
When a near miss shares all its words with your phrasings, reach for anchors instead.

## Anchors: words the message must have

`anchors` is a list of groups. The message must contain at least one word from **every** group.

```json
"anchors": [["linkedin", "linkdin"], ["company page", "business page", "page id", "page", "pages"]]
```

- Words are matched as written, not as stems. List each form you mean: `"cancel"`, `"canceled"`, `"cancelled"`.
- One wrong letter is allowed for words of five letters or more, so "subscribtion" matches "subscription". "post" does not match "posted". A word with a digit in it never gets that allowance: "20005" does not match "20003".
- A term written as `"/.../"` is a regular expression, for the few cases where word order matters. In JSON, write a word boundary as `\\b`. A single `\b` is a backspace character, and check-entries fails on it.
- An entry with anchors can answer at a lower score than one without. Anchors are the best guard against answering the wrong question, so most entries should have them.
- A regex anchor reads the message with its apostrophes kept: write `can.?t`, not `can t`, to match "can't" and "cant".

### An error entry needs its own error text in the anchors

An entry about one error or one cause must not be reachable on words that many problems share.
"I get a 403 when I post. Is my account flagged?" is not the adult-content entry's question, even though "flagged" is in its anchors.

- At least one anchor group must hold only this error's own words: its error text (`"session error"`, `"/temporarily restricted/"`), its code (`"20003"`, `"/\\b33005\\b/"`), or a combination that says this case (`"/how many (images|photos)/"`).
- Never let a group be met by a bare status code (`"403"`), a platform name alone, or a common symptom word ("failed", "error", "missing", "empty", "stuck", "limit", "flagged", "rejected", "timeout", "image", "video", "post", "account"). The full list is `GENERIC_WORDS` in `src/signals.mjs`.
- A bare status code is fine only for the entry about that status itself, and only when the title gives its meaning ("503 Service Unavailable").
- `check-entries` fails an error entry (one that cites an Errors or limitations page, or whose title says error, failed, rejected, invalid, exceeded, not found or unsupported) whose every group can be met by those words. It cannot judge every non-error entry, so check yours by hand: could a customer with a different problem meet every group?

### An entry for a failure with no error text: `symptom_only`

`post-failed-no-error-text` and `post-never-went-up` answer the most common ticket there is: "my post failed" with no error given. They give the first steps from the help pages and ask for the exact error.
Mark such an entry `"symptom_only": true`. When the message does carry an error text or a code (quoted text, `error: ...`, a 3 to 5 digit code, a `snake_case` name), that error decides the fix, so this entry hands over instead of answering, and the error's own entry (or a person) takes it.

## needs_person_if: when your answer is not enough

Your steps help a customer who has not tried them yet. When the customer already tried them, or the case is past what the docs cover, a person should take it.
The desk then sends a holding reply and an escalation packet instead of your steps.

```json
"needs_person_if": { "signals": ["tried-steps", "still-broken"], "phrases": ["removed and re-added", "re-approved"] }
```

The signals (in `src/signals.mjs`):

| Signal | Fires on |
|---|---|
| `tried-steps` | "I already tried", "I've checked", "I checked X, Y and Z", "removed and re-added", "incognito", "another browser", "copied the key again" |
| `still-broken` | "still not working", "still empty", "still shows up", "Still 401", "didn't help", "same error" after a retry |
| `retried` | "every time", "3 times", "third time", "in a row", "since Tuesday", "for two weeks" |
| `disputes-count` | "I only called it 3 times", "my logs show", "it says 10 but your page says 25" |
| `records-disagree` | "billing shows active", "the Accounts page shows connected" |
| `access-blocked` | "it won't let me", "locked out", "the reactivate screen blocks Settings" |
| `many-accounts` | "is something down", "4 accounts failing at once", "all 12 of my client accounts failed" |
| `follow-on` | "I resent it and now there are 2 posts", "we reconnected and now it says expired" |

### Signals every entry has (you do not list them)

`retried`, `disputes-count`, `records-disagree`, `many-accounts`, `follow-on`, `cause-ruled-out`, `docs-wrong` and `pressure` apply to **every** entry that answers, whether you list them or not.
A repeat failure, a disputed count, an outage or "I did X and now Y" is never settled by your steps.
Two more since the second wave of entries:
- `cause-ruled-out`: the customer says the documented cause does not apply to them ("the URL has public DNS", "the file is only 20 MB, well under the limit", "curl from outside works", "the key is correct, no spaces", "that's not the cause"). Your steps would only repeat what they ruled out. It reads the customer's own words only, so a pasted error that says "use a public URL" is not a claim.
- `docs-wrong`: the customer says the help pages are wrong, outdated or contradict each other ("your example is invalid JSON", "two pages give different numbers, which is it?"). A person checks the docs.
- `records-disagree` now also fires on a pair anywhere in the message: a good state of one thing next to a bad state of the same thing ("I still have 900 credits" + "insufficient credits", "I'm on Creator, paid last week" + a 403 or "subscription not active", "shows connected" + "needs reconnecting").
Third tuner:
- `pressure`: a deadline with a threat ("fix this by Friday or we move to another tool"), a threat to leave ("we will cancel unless..."), or legal pressure ("legal action", "report you to consumer protection"). A deadline alone ("my boss wants it live by Monday") is not one.
- `tried-steps` also reads the steps told with "-ing" ("after clearing the cache", "logging out and back in") and "I told Claude exactly what you said".
- `still-broken` also reads the past and other end states: "still got two posts", "still locked", "still pending".
- `disputes-count` also fires on the customer's own count beside a limit that says it was reached: "the channel only has 12 posts" with "reached the maximum".
- The guards also take: "set my plan to...", "export all my posts", "make our limit higher", "sign our DPA", "fill out our vendor questionnaire", "please help me fix the email on my account"; someone else's key ("paste her API key"); an affiliate payout or commission that is missing; and money in passing ("I paid already" in a message that says something is wrong).
Their strong forms ("three days in a row", "is something down", "I only posted 3") fire on their own.
Their weak forms ("every time", "3 times", "since Monday") fire only when the same sentence says something is wrong, so "I post 3 times a day" is fine.
List one in `signals` to make all its forms fire for your entry.

If your entry truly answers one of those cases, opt out:

```json
"needs_person_if": { "signals": ["tried-steps", "still-broken"], "ignore": ["retried"] }
```

`check-entries` fails a phrasing of yours that a default signal hands to a person, and tells you which one.

Mark one when:
- your steps are what the customer would try first (almost every entry: `tried-steps`, `still-broken`),
- a repeat failure means something is wrong on our side (`retried`),
- the steps need a screen the customer may not reach (`access-blocked`),
- a specific charge, a staff-only action, or a record only staff can see would decide it. Money and staff-only requests are caught by the guards before your entry. Use `phrases` for anything else that is specific to your topic.

`phrases` are plain words, matched loosely (stems and one-letter typos). Write numbers both ways ("2 posts", "two posts").

## Docs-silent: your entry answers only what it names

Your entry does not answer when the customer asks about a specific thing your entry never mentions.
"Mentions" means anywhere in your title, phrasings, anchors, steps or quotes.
The desk hands the message to a person instead (the docs may be silent on it).

- **Named things**: a payment method (PayPal, Apple Pay), a platform or service outside Blotato's list (Reddit, Shopify), or a tool (Zapier, Canva, Google Drive). Also a platform feature (analytics, polls, alt text, retweets, Stories, DM automations), a language (Japanese), a file type (GIF, PDF) or an identifier (page id, account id, channel id). The lists are `NAMED_ITEMS` in `src/signals.mjs`. They match exactly, with no typo allowance.
- **Another platform**: if your title names a platform ("...for Instagram Reels"), a question about a platform you never mention is not yours.
- **A number**: "how many", "how long", "what is the limit" need a number in your steps. "How many do I have left?" is a where-to-look question and does not.
- **A capitalized name** after "with", "to", "via" ("pay with Payoneer") that no entry uses anywhere.

If your entry truly answers questions about a Blotato feature or an id in that list, name it in a phrasing or an anchor.
**Things outside Blotato are different** (a payment method, another platform or service, a tool, a device, a language, a file type): a phrasing no longer claims them. Only your quotes and steps, or a declared `scope` (below), can. A writer's phrasing that names OneDrive does not make a Google Drive quote answer a OneDrive question.
If you give a number, quote the sentence or the table row that holds it. A table row works: `"| Queued scheduled posts | 200 | 1,000 | 3,000 |"`.

## Specifics must be covered (third tuner)

The desk answers only when the customer's own specifics are covered by what it would say: your quotes, the steps that restate them, your title and reply lines, and your declared scope. Phrasings and anchors bridge ordinary wording ("hook up" for "connect"), but they do not cover a specific. The check is in `src/coverage.mjs`; it reads the customer's questions (with the sentence before a question that points back, like "for that one"), or the whole message when it asks nothing in question form. Pasted code, links, quoted text and pasted error lines are left out.

A specific is:

| Specific | Not covered when | Example that is handed over |
|---|---|---|
| A rare word the question turns on | No quote or step of yours uses it, and few entries use it at all. Plain conversation ("confused", "tomorrow", "summer"), short words, numbers and the action right after "I", "we" or "it" do not count. With no question in the message, it takes two such words. | "Can I make the source links show as numbered **footnotes**?" |
| A platform | Your title names a platform, or your quotes go platform by platform, and never name this one. A quote about "other platforms" or "platforms other than..." speaks for all. | "Does the first comment work on **Threads**?" against a list of other platforms |
| A plan or billing period | Your quotes name tiers (Starter, Creator, Agency, trial) and not this one; or periods (monthly, yearly) and not this one. | "If I pay **yearly**, do I get all the credits at once?" against monthly figures |
| An HTTP status | Your quotes give status codes and not this one. | "I get a **429**" against a 401 entry |
| An API route | The customer asks about a `/v2/...` route your quotes never name (a route most entries quote, like `/v2/posts`, does not count). | "What is the rate limit on **/v2/schedules**?" |
| A named screen, button or product | A capitalized word inside the question (not an acronym, not a plan or platform) that your quotes never use. | "When I click **Duplicate**..." |
| A price | "How much does it cost", "what is the price" and your quotes give no amount. | |
| A ship date | "When will you add", "release date", "roadmap" and your quotes give no date and do not say it is not announced. | |
| Your scope says no | The question names a term in `scope.not`. | |

With two or more questions, each is checked on its own. A question with a gap is handed over (`partly-covered`) and the entry may still answer the others. When every question has a gap, the desk says the docs may be silent (`docs-silent`, with `whyDetail.kind` naming which specific).

### Declaring scope: `scope`

Most entries need nothing: the quotes are the scope. Add `scope` only when your quotes cover more than their own words, or less than a reader would think.

```json
"scope": {
  "covers": ["hubspot", "salesforce"],
  "coversKinds": ["platform or service"],
  "not": ["refund policy"],
  "why": "These are CRMs; the quote says Zapier or Make.com connects your CRM."
}
```

| Field | What it does |
|---|---|
| `covers` | Terms your quotes cover without using the words. A term already in your quotes or steps fails check-entries (it is not needed). |
| `coversKinds` | Whole kinds your quotes speak for: `payment method`, `platform or service`, `tool`, `platform feature`, `language`, `identifier`, `device`, `file type`, or `platform`. `supported-platforms` uses `platform or service`, because its FAQ says the list is exhaustive. |
| `not` | Terms your quotes do not cover even though they look close. A question naming one is handed over. |
| `why` | Needed with `covers` or `coversKinds`: which quote covers them, in one sentence. A reviewer checks it against the page. |

Never add a cover to make a test or an exam message pass. If the page does not say it, reword the phrasing instead.

The check reads the customer's questions. When those are too short to stand alone ("Is that wrong?"), it reads the whole message, leaving out pasted JSON, code and links.
When two entries are too close to call and this check stops exactly one of them on a named thing, the other one answers. A missing number never decides a tie.

`check-entries` fails a phrasing of yours that this check stops.

## Numbers and codes match exactly

An anchor, a phrase or a near miss with a digit in it (an error code, a status, an amount, a count) matches only that exact token.
"20005" never matches "20003", and "504" never matches "500". You do not need a regex anchor for that.

A count in an error entry's title is part of the error: when your title says "the maximum number of 25 posts" and the message says "26 posts" (and never "25 posts"), your entry does not answer. Put the error's exact count in your title, written as digits followed by its word ("25 posts", "120 seconds").

When two entries tie and the message pastes an error text or code, an error entry whose title shares two or more words with the message wins over an entry that is not about an error.

## Quoted text is not a request

Words the customer pasted or quoted (an error message, a platform notice such as "Please reconnect your account") are not read as a request to us.
A real request next to them still is: 'It says "token expired". Can you reset my key?' goes to a person.

## What happens before your entry is even scored

1. **Guards** run first and always win: money taken or asked back, someone else's data, a key or the desk's settings, a request for us to post, delete or change something. They go to the hand-over entries in `guards.json` and `billing.json`.
2. **Words aimed at the desk** ("ignore your rules", "[SYSTEM NOTE: ...]", hidden comments) are cut out. Only the real question is matched.
3. **The matcher** scores every entry. Your entry answers only above the threshold and clearly ahead of the runner-up. Otherwise a person gets the message with the top three candidates.
4. **Your signals** run, and the default ones every entry has. If one fires, the customer gets the holding reply.
5. **The docs-silent check** runs: the thing asked about must be something your entry names. If not, a person gets the message.
6. **The specifics check** runs: what the customer asks about must be in your quotes, steps or declared scope (see "Specifics must be covered"). A question with a gap is handed over.
7. **Every question** in the message must belong to your entry. If one does not, the desk answers your part and hands over the rest, or hands over the whole message.

Also before matching: a message not in English (Spanish, Portuguese, French, German or Italian function words, or mostly a non-Latin script) goes to a person. Quoted or pasted text is left out of that check, so an English message with a foreign error or account name stays English. A sentence that only thanks or agrees ("Thanks for the scheduling help!") is left out of matching, so the topic it names cannot pull the message to its entry.

## Why a message was handed over: the reason codes

Every route result has `why` (a stable code) and `whyDetail` (its details, or null) beside the human `reason` text. An answer has `why: null`. A page maps each code to a plain sentence; never rename one.

| `why` | Meaning | `whyDetail` |
|---|---|---|
| `money` | A charge, refund or money taken: the money guard. | `{ words }` |
| `others-data` | Asks for someone else's data or account. | `{ words }` |
| `secret` | Asks for a key, a password or the desk's own settings. | `{ words }` |
| `staff-action` | Asks us to post, delete, reconnect or change something. | `{ words }` |
| `desk-instructions` | Gives the desk instructions and asks no real question. | `{ words }` |
| `tried-already` | Already tried the steps, still broken, a repeat failure, "I did X and now Y", or the documented cause does not apply. | `{ signal, words }` (signal: tried-steps, still-broken, retried, follow-on, cause-ruled-out) |
| `outage` | Many accounts failing at once, "is something down". | `{ signal: 'many-accounts', words }` |
| `records-disagree` | Two of Blotato's records disagree, or the customer disputes a count. | `{ signal, words }` (records-disagree or disputes-count) |
| `docs-wrong` | Says the help pages are wrong or contradict each other. | `{ signal, words }` |
| `access-blocked` | Cannot reach the screen the steps need. | `{ signal, words }` |
| `past-docs` | A phrase the entry itself lists as needing a person. | `{ signal: 'phrase', words }` |
| `docs-silent` | Asks about a named thing or a number the closest entry never gives, or a specific its quotes do not cover. | `{ kind, item, nearest }` (kind: a named-item kind, `number`, `name`, or from the specifics check `specific`, `platform`, `plan`, `error code`, `endpoint`, `price`, `date`, `outside scope`) |
| `tie` | Two entries too close to choose between. | `{ candidates: [{ id, title, score }, ...] }` |
| `partly-covered` | Asks more than one thing; an entry covers only part. A `partial` answer carries it for the part handed over. | `{ question, nearest? }` |
| `not-english` | Not written in English. | `{ language }` |
| `pressure` | A deadline with a threat, a threat to leave, or legal pressure. | `{ signal: 'pressure', words }` |
| `no-coverage` | No entry covers it: nothing close enough, the entry matched only the background, or a no-error-text entry met an error text. | null, or `{ question, nearest }` or `{ error, nearest }` |
| `nonsense` | No words the desk knows, or no question. | null |

When the desk hands over without a tie, `candidates` still lists up to three close entries (`id`, `title`, `score`), only ones scoring 0.1 or more, never a guard.

## Check your work

```bash
node bin/support-desk.mjs check-entries        # every entry: shape, quotes, routing
npm test                                       # the whole suite, which runs check-entries too
node bin/support-desk.mjs ticket "how do I cancel my plan" --mock   # see what a customer would get
```

`check-entries` names the file, the entry and the reason for every problem, and ends with a count of entries and pages.

## The most common failures

| check-entries says | What to do |
|---|---|
| `the quote "..." is not on https://help.blotato.com/...` | Copy the sentence again from the page's `text` in `.cache/docs/`. A changed word, a dropped "the", or a sentence joined from two places all fail. |
| `the page ... is not cached` | Run `node bin/support-desk.mjs docs --all`. Check the url has no `.md`, `#section` or trailing slash. |
| `the reply would have 2 numbered steps` | Three to five. Split a long step, or merge two short ones. |
| `makes a promise or a guarantee` / `makes an outcome nobody has checked` | Say what the customer will see, not what will happen: "You will know it worked when...". |
| `"phrasings" needs at least five ways` | Write more, in customers' words. |
| `the phrasing "..." is the same as one in ...` | Two entries overlap. Make each phrasing say what is different about your case. |
| `does not meet this entry's own anchors` | Your phrasing lacks every word in one anchor group. Add the word to the group, or reword the phrasing. |
| `is taken by the staff-action guard` | Write the phrasing as a question ("how do I delete..."), not a request ("please delete..."). |
| `routes to "other-entry" instead` | Your entry and that one overlap. Add a `not_this` with the telling word, or tighten your anchors. |
| `an entry that answers needs "needs_person_if"` | Add at least `"signals": ["tried-steps", "still-broken"]`. |
| `has a control character` | You wrote `\b` in JSON. Write `\\b`. |
| `unknown field "phrasing"` | A typo in a field name. The message lists the known fields. |
| `has placeholder text` | A `[...]`, TODO or TBD is in a line a customer reads. Write the real words. |
| `matches almost any message` | A regex anchor like `/./` guards nothing. Name the words. |
| `makes something reported as done that nobody has confirmed` | "We have fixed this" or "a refund is on the way" is never ours to say. Say who will look at it. |
| `WARN ... shares no words with its quote` | Not a failure. A plain rewrite can be faithful with other words, but look twice: does the step say what the quote says, and no more? |
| `"proof" must start with...` | Start it with `You will know it` or `Still open:`. |
| `is handed to a person by the default "retried" signal` | Your phrasing describes a repeat failure. Reword it, or add the signal to `needs_person_if.ignore` if your steps truly answer that case. |
| `is stopped by the docs-silent check` | Your phrasing names something (or asks for a number) that your steps never give. Add the fact with its quote, or reword the phrasing. |
| `"x" in "needs_person_if.ignore" is not a default signal` | Only `retried`, `disputes-count`, `records-disagree`, `many-accounts`, `follow-on`, `cause-ruled-out`, `docs-wrong` and `pressure` can be ignored. |
| `tells the customer to retry before any earlier step has them check the platform itself` | Add a step before it that checks the platform (cite the publishing-status page), or, when the first try was turned down for a known reason, drop the "try again" and keep the fix. See rule 10. |
| `the anchors can all be met by words many problems share` | Your error entry could answer "403" or "my Instagram post failed". Make one anchor group hold only this error's own text or code. See "An error entry needs its own error text". |
| `"scope.covers" and "scope.coversKinds" need "scope.why"` | Say which quote covers them, in one sentence. If no quote does, take the cover out and reword the phrasing instead. |
