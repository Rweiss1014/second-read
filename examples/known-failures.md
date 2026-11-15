# Known failures

Every problem this desk has seen: tickets it solved, replies its checker blocked, questions the docs could not answer.
Each has the date, the words that matched it or why it was blocked, and the fix. Every new ticket is checked against this list first.

## published-not-visible
- What happened: Says published, but the post is not on the platform
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "published"
- Fix: Answered with the "published-not-visible" playbook entry. Next step given to the customer: Open the post link above and tell me what you see.
- Source: https://help.blotato.com/support/faqs

## canceled-status
- What happened: Posts show CANCELED
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "CANCELED"
- Fix: Answered with the "canceled-status" playbook entry. Next step given to the customer: Open the post and schedule it again if you still want it to go out.
- Source: https://help.blotato.com/support/faqs

## linkedin-company-page
- What happened: Post to a LinkedIn company Page instead of a profile
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "LinkedIn"
- Fix: Answered with the "linkedin-company-page" playbook entry. Next step given to the customer: Check both ids are in the right fields, then send one test post.
- Source: https://help.blotato.com/support/errors

## trial-api-key-charge
- What happened: Charged after making an API key during the trial
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "trial"
- Fix: Answered with the "trial-api-key-charge" playbook entry. Next step given to the customer: Reply here if you want to cancel, and I will walk you through it.
- Source: https://help.blotato.com/settings/billing-and-credits

## cancel-subscription
- What happened: How to cancel (or pause) the subscription
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "cancel"
- Fix: Answered with the "cancel-subscription" playbook entry. Next step given to the customer: Open Settings > Billing > View Billing Portal.
- Source: https://help.blotato.com/support/faqs

## api-401
- What happened: API answers 401 Unauthorized
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "401"
- Fix: Answered with the "api-401" playbook entry. Next step given to the customer: Run that one read-only call and tell me the status code you get.
- Source: https://help.blotato.com/api-and-mcp-concepts/authentication

## rate-limit
- What happened: "Too many requests" from a workflow
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "too many requests"
- Fix: Answered with the "rate-limit" playbook entry. Next step given to the customer: Check which posts already went out, then turn the workflow back on with fewer at a time.
- Source: https://help.blotato.com/support/errors

## mcp-invalid-grant
- What happened: invalid_grant from the Blotato connector in Claude
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "connector"
- Fix: Answered with the "mcp-invalid-grant" playbook entry. Next step given to the customer: Re-add the connector, then ask Claude to list your Blotato accounts.
- Source: https://help.blotato.com/support/errors

## unknown-outcome-resend
- What happened: Timeout after creating a post: send it again?
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "timed out"
- Fix: Answered with the "unknown-outcome-resend" playbook entry. Next step given to the customer: Look for the post in your scheduled, published and failed posts, then tell me what you find.
- Source: https://help.blotato.com/support/errors

## in-progress
- What happened: Status stuck on in-progress
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "in-progress"
- Fix: Answered with the "in-progress" playbook entry. Next step given to the customer: Send me the time you created it and the account, and I will check the post list.
- Source: https://help.blotato.com/rest-api-reference/publish-post/get-post

## schedule-id-500
- What happened: Schedule lookup answers 500 "invalid input syntax for type bigint"
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "invalid input syntax"
- Fix: Answered with the "schedule-id-500" playbook entry. Next step given to the customer: Copy an id from your own GET /v2/schedules list, try that, and tell me what you get.
- Source: https://help.blotato.com/rest-api-reference/schedules

## sandbox-question
- What happened: Is there a test mode for the API?
- First seen: 2026-11-15
- Last seen: 2026-11-15
- Times seen: 1
- Matched words: "sandbox"
- Fix: Answered with the "sandbox-question" playbook entry. Next step given to the customer: Nothing to do on your side yet. I will reply here when I hear back.
- Source: https://help.blotato.com/start-with-an-ai-agent/mcp/setup
