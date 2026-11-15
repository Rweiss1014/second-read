# Shift handoff

Written Sun, 15 Nov 2026 21:32:53 GMT (run-20261115213251-f024). Account data is sample data, no account connected.

## Tickets (12)
- T01 (non-technical): Says published, but the post is not on the platform. Status: reply: cleared to send (the fresh checker passed this exact text).
- T02 (non-technical): Posts show CANCELED. Status: reply: cleared to send (the fresh checker passed this exact text).
- T03 (non-technical): Post to a LinkedIn company Page instead of a profile. Status: reply: cleared to send (the fresh checker passed this exact text).
- T04 (billing): Charged after making an API key during the trial. Status: reply: cleared to send (the fresh checker passed this exact text) + escalated.
- T05 (billing): How to cancel (or pause) the subscription. Status: reply: cleared to send (the fresh checker passed this exact text).
- T06 (technical): API answers 401 Unauthorized. Status: reply: cleared to send (the fresh checker passed this exact text).
- T07 (technical): "Too many requests" from a workflow. Status: reply: cleared to send (the fresh checker passed this exact text).
- T08 (technical): invalid_grant from the Blotato connector in Claude. Status: reply: cleared to send (the fresh checker passed this exact text).
- T09 (technical): Timeout after creating a post: send it again. Status: reply: cleared to send (the fresh checker passed this exact text).
- T10 (technical): Status stuck on in-progress. Status: reply: cleared to send (the fresh checker passed this exact text).
- T11 (technical): Schedule lookup answers 500 "invalid input syntax for type bigint". Status: reply: cleared to send (the fresh checker passed this exact text) + escalated.
- T12 (technical): Is there a test mode for the API. Status: holding reply: cleared to send (the fresh checker passed this exact text) + escalated.

## Cleared to send: the fresh checker passed this exact text (12)
- T01 (non-technical). Next step for the customer: Open the post link above and tell me what you see.
- T02 (non-technical). Next step for the customer: Open the post and schedule it again if you still want it to go out.
- T03 (non-technical). Next step for the customer: Check both ids are in the right fields, then send one test post.
- T04 (billing). Next step for the customer: Reply here if you want to cancel, and I will walk you through it.
- T05 (billing). Next step for the customer: Open Settings > Billing > View Billing Portal.
- T06 (technical). Next step for the customer: Run that one read-only call and tell me the status code you get.
- T07 (technical). Next step for the customer: Check which posts already went out, then turn the workflow back on with fewer at a time.
- T08 (technical). Next step for the customer: Re-add the connector, then ask Claude to list your Blotato accounts.
- T09 (technical). Next step for the customer: Look for the post in your scheduled, published and failed posts, then tell me what you find.
- T10 (technical). Next step for the customer: Send me the time you created it and the account, and I will check the post list.
- T11 (technical). Next step for the customer: Copy an id from your own GET /v2/schedules list, try that, and tell me what you get.
- T12 (technical). Next step for the customer: Nothing to do on your side yet. I will reply here when I hear back.

## Script check passed, waiting on the fresh check (0)
- none

## Blocked by the checker (0)
- none

## Waiting on the founder (3)
- T04 (billing): A charge or refund is a person's decision. The desk explains and hands it over.
- T11 (technical): The API and the docs disagree. Only the founder can say which one is right.
- T12 (technical): The docs do not answer this. The founder decides what the answer is.

## Help-doc edits proposed (2)
- https://help.blotato.com/rest-api-reference/schedules: change an example
- https://help.blotato.com/settings/api-keys: new entry "Is there a test mode for the API?"

## Next step
Send the 3 escalation packet(s) to the founder, then the cleared replies.
