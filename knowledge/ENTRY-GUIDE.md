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
| `needs_person_if` | yes, for an entry that answers | Signals that turn your answer into a hand-over. |
| `opening` | yes | One or two warm sentences before the steps. |
| `steps` | yes, 3 to 5 | `fact`, `evidence` or `action` steps. |
| `next` | yes | Exactly one next step for the customer. |
| `proof` | yes | Starts with `You will know it` or `Still open:`. |
| `lookup` | no | A read-only account lookup: `recent-published`, `recent-activity`, `submission`, `reproduce-schedule` or `docs-search`. |
| `searchQueries` | with `docs-search` | The searches to run. |
| `escalate` | no | `{ "why", "causes": [...], "ruledOut": [...] }`. The reply also goes to a person, with a packet. |
| `docEdit` | no | A proposed help-doc change: `{ "article", "kind": "new" or "change", ... }`. |
| `noDocAnswer` | no | `true` when the docs do not answer it. The reply is a holding reply. |
| `holding` | no | Your own holding reply (`opening`, `steps`, `next`, `proof`) for when a signal fires. Without it, the shared one in `guards.json` is used. |
| `guard`, `priority` | rarely | Only for hand-over entries. Money entries use `"guard": "money"`, and a higher `priority` wins when its anchors are met. |
| `note` | no | A note for other writers. Never shown to customers. |

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
- One wrong letter is allowed for words of five letters or more, so "subscribtion" matches "subscription". "post" does not match "posted".
- A term written as `"/.../"` is a regular expression, for the few cases where word order matters. In JSON, write a word boundary as `\\b`. A single `\b` is a backspace character, and check-entries fails on it.
- An entry with anchors can answer at a lower score than one without. Anchors are the best guard against answering the wrong question, so most entries should have them.

## needs_person_if: when your answer is not enough

Your steps help a customer who has not tried them yet. When the customer already tried them, or the case is past what the docs cover, a person should take it.
The desk then sends a holding reply and an escalation packet instead of your steps.

```json
"needs_person_if": { "signals": ["tried-steps", "still-broken"], "phrases": ["removed and re-added", "re-approved"] }
```

The signals (in `src/signals.mjs`):

| Signal | Fires on |
|---|---|
| `tried-steps` | "I already tried", "I've checked", "I checked X, Y and Z", "removed and re-added", "incognito", "another browser" |
| `still-broken` | "still not working", "still empty", "didn't help", "same error" after a retry |
| `retried` | "every time", "3 times", "third time", "in a row", "since Tuesday", "for two weeks" |
| `disputes-count` | "I only called it 3 times", "my logs show" |
| `records-disagree` | "billing shows active", "the Accounts page shows connected" |
| `access-blocked` | "it won't let me", "locked out", "the reactivate screen blocks Settings" |
| `many-accounts` | "is something down", "4 accounts failing at once" |

Mark one when:
- your steps are what the customer would try first (almost every entry: `tried-steps`, `still-broken`),
- a repeat failure means something is wrong on our side (`retried`),
- the steps need a screen the customer may not reach (`access-blocked`),
- a specific charge, a staff-only action, or a record only staff can see would decide it. Money and staff-only requests are caught by the guards before your entry. Use `phrases` for anything else that is specific to your topic.

`phrases` are plain words, matched loosely (stems and one-letter typos).

## What happens before your entry is even scored

1. **Guards** run first and always win: money taken or asked back, someone else's data, a key or the desk's settings, a request for us to post, delete or change something. They go to the hand-over entries in `guards.json` and `billing.json`.
2. **Words aimed at the desk** ("ignore your rules", "[SYSTEM NOTE: ...]", hidden comments) are cut out. Only the real question is matched.
3. **The matcher** scores every entry. Your entry answers only above the threshold and clearly ahead of the runner-up. Otherwise a person gets the message with the top three candidates.
4. **Your signals** run. If one fires, the customer gets the holding reply.
5. **Every question** in the message must belong to your entry. If one does not, the desk answers your part and hands over the rest, or hands over the whole message.

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
| `"proof" must start with...` | Start it with `You will know it` or `Still open:`. |
