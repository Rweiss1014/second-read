// The desk's playbook: one entry per kind of ticket.
// Every "fact" step cites an exact sentence on a Blotato help page. The checker refuses the reply if that
// sentence is not on the page as fetched. "evidence" steps must rest on a status lookup made for this ticket.
// "action" steps say what we will do. The script checker blocks any line that matches its promise patterns.
// Quotes copied from Blotato's help center, read Nov 15, 2026.

const D = 'https://help.blotato.com';
export const PAGES = {
  faqs: `${D}/support/faqs`,
  errors: `${D}/support/errors`,
  auth: `${D}/api-and-mcp-concepts/authentication`,
  errorHandling: `${D}/api-and-mcp-concepts/error-handling`,
  rateLimits: `${D}/api-and-mcp-concepts/rate-limits`,
  publish: `${D}/rest-api-reference/publish-post`,
  getPost: `${D}/rest-api-reference/publish-post/get-post`,
  schedules: `${D}/rest-api-reference/schedules`,
  billing: `${D}/settings/billing-and-credits`,
  n8nFaqs: `${D}/integrations-and-automation-templates/n8n/faqs`,
  mcpSetup: `${D}/start-with-an-ai-agent/mcp/setup`,
  apiKeys: `${D}/settings/api-keys`,
};

const fact = (text, page, quote) => ({ type: 'fact', text, cite: { url: PAGES[page], quote } });
const evidence = (text, ref = 'status') => ({ type: 'evidence', text, ref });
const action = (text) => ({ type: 'action', text });

// Money taken, or money asked back. Any message that says so goes to a person (the charge-or-refund entry),
// even when it also asks something easy, like how to cancel. Found by review: "I canceled my plan last month
// but you charged me again. I want a refund." used to get cancel steps and no escalation.
export const MONEY = /\b(?:charg(?:e|ed|es|ing)|re-?charged|refunds?|refunded|(?:double|over|re)-?(?:billed|charged)|billed|paid (?:twice|two times|double)|(?:double|duplicate|extra|unexpected|unauthori[sz]ed|surprise) (?:payment|charge|invoice)s?|money (?:back|was taken|taken|out of)|took (?:my )?money|taken (?:my )?money|(?:payment|money) (?:was|got) (?:taken|deducted)|deducted|chargeback)\b/i;

export const PLAYBOOK = [
  {
    id: 'published-not-visible', kind: 'non-technical', title: 'Says published, but the post is not on the platform',
    any: [/published/i], all: [/(can'?t|cannot|don'?t|not|isn'?t|no)\b.{0,25}\b(see|find|show|there|appear|visible)/i],
    lookup: 'recent-published',
    opening: 'Thanks for flagging this. Let\'s find out where the post went.',
    steps: [
      fact('"Published" means Blotato recorded a publishing result. On its own, that does not tell us why the post is missing from the feed.', 'faqs', 'Published means Blotato recorded a publishing result. It does not establish why the post is absent from a feed or why a platform URL is inaccessible.'),
      evidence('I checked your account: {evidence} If that is not the post you mean, tell me which one.'),
      fact('Open Posts > Published and confirm it went to the account or Page you meant.', 'faqs', 'Open Posts > Published and confirm the intended destination.'),
      fact('Then check that same account or Page on the platform itself.', 'faqs', 'Check the same account or Page on the social platform.'),
      fact('Please hold off on posting a replacement until we know what happened to this one.', 'faqs', 'Do not publish a replacement until the original result is understood.'),
    ],
    next: 'Open the post link above and tell me what you see.',
    proof: 'You will know it worked when you can open the post on the account it was meant for.',
  },
  {
    id: 'canceled-status', kind: 'non-technical', title: 'Posts show CANCELED',
    any: [/cancel+ed/i], all: [/(post|status|show|calendar|failing)/i], none: [/subscription|plan|billing|account\b.*\bcancel/i],
    opening: 'Good news first: nothing is broken.',
    steps: [
      fact('CANCELED is not a failure. It is a status.', 'faqs', 'No. CANCELED is a post status, not a publishing failure.'),
      fact('It means the schedule was removed before the post went out: deleted from the calendar, moved back to drafts, or removed through the API.', 'faqs', 'A post is marked canceled when its schedule was removed before it published'),
      fact('Nothing went wrong on the social platform.', 'faqs', 'Nothing went wrong on the social platform.'),
      fact('If you meant it to go out, open the post and schedule it again.', 'faqs', 'If you meant the post to go out, open it and schedule it again.'),
    ],
    next: 'Open the post and schedule it again if you still want it to go out.',
    proof: 'You will know it worked when the post shows as scheduled again in your calendar.',
  },
  {
    id: 'linkedin-company-page', kind: 'non-technical', title: 'Post to a LinkedIn company Page instead of a profile',
    any: [/linkedin/i], all: [/(company|business|brand)\s*page|page instead|not my (personal )?profile/i],
    opening: 'Yes, you can. It takes two ids instead of one.',
    steps: [
      fact('A LinkedIn company Page needs both your account id and the Page id.', 'errors', 'For LinkedIn company pages, you need both an accountId and a pageId.'),
      fact('Get the account id from GET /v2/users/me/accounts, then the Page id from GET /v2/users/me/accounts/{accountId}/subaccounts.', 'errors', 'Use `GET /v2/users/me/accounts` to get the accountId, then `GET /v2/users/me/accounts/{accountId}/subaccounts` to get the pageId.'),
      fact('Put the account id in post.accountId and the Page id in post.target.pageId.', 'errors', 'Pass accountId in `post.accountId` and pageId in `post.target.pageId`.'),
      fact('Watch for one common mix-up: the Page id going where the account id belongs.', 'errors', 'A common mistake is passing the pageId where accountId is expected.'),
      fact('If pageId is left out, the post goes to your personal profile.', 'publish', 'Omit to post to personal profile.'),
    ],
    next: 'Check both ids are in the right fields, then send one test post.',
    proof: 'You will know it worked when the test post shows on the company Page, not on your profile.',
  },
  {
    id: 'trial-api-key-charge', kind: 'billing', title: 'Charged after making an API key during the trial',
    any: [/trial/i], all: [/(charg|bill|paid|payment|invoice)/i], priority: 2,
    opening: 'I\'m sorry for the surprise. Here is what happened, and who will look at the charge.',
    steps: [
      fact('Making an API key ends the free trial right away and starts the paid plan, even with trial days left.', 'billing', 'your free trial ends at that moment and your paid subscription begins. This applies even if you have days remaining in your trial.'),
      fact('The free trial does not include API or MCP access.', 'auth', 'The free trial does not include API or MCP access.'),
      action('I am passing the charge question to a person on the team, with what I checked.'),
      fact('If you would rather not keep the plan, you can cancel in Settings > Billing > View Billing Portal.', 'faqs', 'Go to Settings > Billing and click "View Billing Portal" to cancel your subscription.'),
    ],
    next: 'Reply here if you want to cancel, and I will walk you through it.',
    proof: 'Still open: the charge itself. That is a decision for a person on the team, not for me.',
    escalate: {
      why: 'A charge or refund is a person\'s decision. The desk explains and hands it over.',
      causes: [
        { text: 'An API key was made during the trial, which starts the paid plan at once (documented).', cite: { url: PAGES.billing, quote: 'If you go to Settings > API and generate an API key, your free trial ends at that moment and your paid subscription begins.' } },
        { text: 'A payment problem such as a duplicate charge, which support refunds (documented).', cite: { url: PAGES.faqs, quote: 'If a duplicate payment went through, support refunds it.' } },
      ],
      ruledOut: ['Nothing ruled out yet: the desk cannot see payments. A person needs to open the billing record.'],
    },
  },
  {
    // Any message about money taken goes to a person, even when it also asks an easy question (how to cancel).
    // Blotato's triage page: "Separate published policy from the customer's verified subscription and payment state."
    // The desk cannot see payments, so it never promises a refund or a credit. It holds, and hands it over.
    id: 'charge-or-refund', kind: 'billing', title: 'A charge, a refund, or money taken',
    any: [MONEY], priority: 1,
    opening: 'I\'m sorry about the charge. A person on the team needs to look at your payment record, so I am handing this over.',
    steps: [
      action('I am passing your message about the charge to a person on the team, with what you told me.'),
      fact('Payments and refunds go through Stripe, the payment processor Blotato uses.', 'billing', 'Stripe is the payment processor Blotato uses for payments and refunds.'),
      fact('You can see every payment yourself: open Settings > Billing, select View Billing Portal, then scroll to INVOICE HISTORY.', 'billing', 'Open Settings > Billing, select View Billing Portal, then scroll to INVOICE HISTORY.'),
      fact('Please do not pay again while this is open.', 'faqs', 'Do not pay again'),
    ],
    next: 'Reply here with the date of the charge and the email on your account, so the team can find the payment.',
    proof: 'Still open: the charge itself, and what happens to it. That is a decision for a person on the team, not for me.',
    escalate: {
      why: 'A charge or refund is a person\'s decision. The desk cannot see payments, so it explains, holds, and hands it over. It never promises a refund or a credit.',
      causes: [
        { text: 'Stripe is still billing an older Incomplete or Expired subscription, which can charge again after a cancel (documented).', cite: { url: PAGES.faqs, quote: 'Stripe keeps trying to bill a previously Incomplete or Expired subscription on your account.' } },
        { text: 'A duplicate payment, which support refunds (documented).', cite: { url: PAGES.faqs, quote: 'If a duplicate payment went through, support refunds it.' } },
      ],
      ruledOut: ['Nothing ruled out yet: the desk cannot see payments. A person needs to open the billing record.'],
    },
  },
  {
    id: 'cancel-subscription', kind: 'billing', title: 'How to cancel (or pause) the subscription',
    any: [/cancel|pause|freeze|stop paying/i], all: [/(subscription|plan|account|billing|paying|membership)/i], none: [/trial/i],
    opening: 'Of course. Here is how, and one thing to check first.',
    steps: [
      fact('Go to Settings > Billing and click "View Billing Portal". You can cancel there.', 'faqs', 'Go to Settings > Billing and click "View Billing Portal" to cancel your subscription.'),
      fact('There is no long-term commitment, so you can cancel anytime.', 'faqs', 'There are no long-term commitments. You can cancel anytime.'),
      fact('There is no pause option, so the choice is to keep the plan or cancel it.', 'faqs', 'Blotato does not have a pause or freeze feature.'),
      fact('Before you confirm, check the date the cancellation takes effect. That is when access ends.', 'faqs', 'Check the cancellation\'s effective date before confirming when access ends.'),
    ],
    next: 'Open Settings > Billing > View Billing Portal.',
    proof: 'You will know it worked when the Billing Portal shows the cancellation and its end date.',
  },
  {
    id: 'api-401', kind: 'technical', title: 'API answers 401 Unauthorized',
    any: [/\b401\b|unauthori[sz]ed|invalid (api )?key|wrong (api )?key/i],
    opening: 'Let\'s check the key, one step at a time.',
    steps: [
      fact('A 401 means Blotato did not accept the key.', 'auth', '`401` or invalid credentials'),
      fact('Copy the full key again from Settings > API, including any = at the end.', 'auth', 'Copy the full key, including any trailing `=` characters.'),
      fact('Send it in the blotato-api-key header.', 'auth', 'Include the key in the `blotato-api-key` header of each request.'),
      fact('Test it with one read-only call: GET https://backend.blotato.com/v2/users/me/accounts.', 'auth', 'Call `GET https://backend.blotato.com/v2/users/me/accounts` to verify access.'),
      fact('A plan problem looks different: it answers 403 with a message about the subscription, not 401.', 'auth', '`403` with a subscription message'),
    ],
    next: 'Run that one read-only call and tell me the status code you get.',
    proof: 'You will know it worked when that call answers 200. An empty list still counts: it means no social accounts are connected yet.',
  },
  {
    id: 'rate-limit', kind: 'technical', title: '"Too many requests" from a workflow',
    any: [/too many requests|rate.?limit|\b429\b/i],
    opening: 'Your workflow is sending faster than Blotato accepts. The fix is to slow it down.',
    steps: [
      fact('That message means too many requests in one minute. Publishing and media uploads each allow 30 a minute.', 'errors', 'Rate limit exceeded. Upload Media: 30 requests/minute. Publish Post: 30 requests/minute.'),
      fact('Stop sending to that step, and if the error gives a time to wait, wait that long.', 'rateLimits', 'Wait for the retry interval when the response supplies one.'),
      fact('Before you run it again, check which posts already went out, so none are sent twice.', 'errorHandling', 'Retain the submission ID, inspect existing work'),
      fact('Then send fewer posts at a time when you turn the workflow back on.', 'rateLimits', 'Reduce concurrency and request frequency before resuming.'),
    ],
    next: 'Check which posts already went out, then turn the workflow back on with fewer at a time.',
    proof: 'You will know it worked when the workflow runs through with no "too many requests" errors.',
  },
  {
    id: 'mcp-invalid-grant', kind: 'technical', title: 'invalid_grant from the Blotato connector in Claude',
    any: [/invalid_grant|oauth|connector/i], all: [/(claude|chatgpt|mcp|cowork|connector)/i],
    opening: 'This one is about the connector\'s sign-in, not your social accounts.',
    steps: [
      fact('invalid_grant here means your Blotato MCP sign-in expired.', 'errors', 'Your Blotato MCP OAuth connection expired.'),
      fact('First, log into your Blotato account in your browser. The approval needs it.', 'mcpSetup', 'Make sure you are logged into your Blotato account in the browser. The OAuth approval requires an active Blotato session.'),
      fact('Then in Claude, open Customize > Connectors, remove the Blotato connector, add it again, and approve access.', 'errors', 'In Claude, open Customize > Connectors, remove and re-add the Blotato custom connector, and re-approve access via OAuth.'),
      fact('The Fix My Automation button will not help with this one. It only works for n8n.', 'n8nFaqs', 'it does not work for Make.com, Claude, MCP, or direct REST API calls.'),
    ],
    next: 'Re-add the connector, then ask Claude to list your Blotato accounts.',
    proof: 'You will know it worked when Claude answers with your account list. An empty list still counts: it means no social accounts are connected yet.',
  },
  {
    id: 'unknown-outcome-resend', kind: 'technical', title: 'Timeout after creating a post: send it again?',
    any: [/\b50[234]\b|timed? ?out|timeout|gateway/i], all: [/(again|resend|retry|twice|duplicate|re-?send|re-?run)/i],
    lookup: 'recent-activity',
    opening: 'Good call asking before sending it again.',
    steps: [
      fact('A timeout does not tell us whether the post was created, so please do not send it again yet.', 'errors', 'The downstream operation\'s outcome is not established by this response.'),
      evidence('I checked your account: {evidence}'),
      fact('Check your scheduled, published and failed posts for it first.', 'errorHandling', 'Check existing work before submitting again'),
      fact('Blotato has no documented way to mark a second send as the same post, so a resend can make a copy.', 'errorHandling', 'Blotato does not expose a documented client-supplied idempotency header for create-post requests.'),
      fact('If it shows as failed, fix the error first. Sending it again unchanged often fails the same way.', 'errorHandling', 'For a failed post, correct the error before a new submission. An unchanged retry often fails for the same reason.'),
    ],
    next: 'Look for the post in your scheduled, published and failed posts, then tell me what you find.',
    proof: 'You will know it is safe to send again once the first post is in none of those lists, or once its error is fixed.',
  },
  {
    id: 'in-progress', kind: 'technical', title: 'Status stuck on in-progress',
    any: [/in-?progress|in progress|stuck|still pending/i],
    lookup: 'submission',
    opening: 'Let\'s look at that id together. In-progress is a tricky status.',
    steps: [
      evidence('I looked it up: {evidence}'),
      fact('In-progress can also mean Blotato found no record for that id, so it does not prove the post exists or failed.', 'getPost', 'This fallback does not confirm a live queue job or validate a guessed submission ID.'),
      fact('Please check that the id came from the original create response.', 'getPost', 'Verify the ID came from the original create response.'),
      fact('A long wait is not proof it failed, so please do not post it again yet.', 'getPost', 'A polling deadline is not proof of failure.'),
      fact('Failed posts are also listed at https://my.blotato.com/posts?status=failed, so please look there too.', 'getPost', 'Failed posts are also visible at <https://my.blotato.com/posts?status=failed>'),
    ],
    next: 'Send me the time you created it and the account, and I will check the post list.',
    proof: 'Still open: whether this id belongs to a real post. The post list will tell us.',
  },
  {
    id: 'schedule-id-500', kind: 'technical', title: 'Schedule lookup answers 500 "invalid input syntax for type bigint"',
    any: [/bigint|invalid input syntax/i, /schedules\/sch_/i],
    lookup: 'reproduce-schedule',
    opening: 'Thank you for the exact error. I could reproduce it.',
    steps: [
      evidence('Same result here: {evidence}'),
      fact('Our docs show schedule ids like "sch_abc123" in their examples.', 'schedules', '"id": "sch_abc123"'),
      evidence('The error says the server expected a number (a bigint), so the id from the docs example will not work there.'),
      action('I am passing this to the founder with the steps to reproduce it and a suggested change to the docs.'),
    ],
    next: 'Copy an id from your own GET /v2/schedules list, try that, and tell me what you get.',
    proof: 'Still open: whether the API or the docs example is the one to change. The founder decides.',
    escalate: {
      why: 'The API and the docs disagree. Only the founder can say which one is right.',
      causes: [
        { text: 'The schedule endpoints expect a number id, while the docs examples show a text id.', cite: { url: PAGES.schedules, quote: '"id": "sch_abc123"' } },
        { text: 'The customer copied an id from a docs example instead of from their own GET /v2/schedules list.' },
      ],
      ruledOut: [
        { text: 'A bad key: a bad key answers 401, not 500.', cite: { url: PAGES.auth, quote: '`401` or invalid credentials' } },
      ],
    },
    docEdit: {
      article: PAGES.schedules,
      kind: 'change',
      before: '"id": "sch_abc123",',
      after: '"id": "5100001",',
      add: 'Schedule ids are numbers, sent as strings. Copy the id from GET /v2/schedules. An id that is not a number is rejected.',
      note: 'Seen on the real API on Nov 15, 2026 (GET /v2/schedules/<text id> answered 500 "invalid input syntax for type bigint"). The OpenAPI file types the id as a plain string. Confirm with the founder before publishing.',
    },
  },
  {
    id: 'sandbox-question', kind: 'technical', title: 'Is there a test mode for the API?',
    any: [/sandbox|test mode|test (api )?key|test account|without (actually )?(posting|publishing)|dry.?run/i],
    lookup: 'docs-search', searchQueries: ['sandbox test mode API key that does not publish', 'test API without posting to real account'],
    opening: 'Good question.',
    steps: [
      evidence('I searched our help docs, and the top results do not cover a test mode, so I will not guess.', 'docs-search'),
      action('I am passing your question to the team.'),
      fact('One thing to know before you test: making an API key during the free trial ends the trial and starts billing.', 'mcpSetup', 'Generating a key during a trial ends the trial and starts billing.'),
    ],
    next: 'Nothing to do on your side yet. I will reply here when I hear back.',
    proof: 'Still open: the answer itself.',
    noDocAnswer: true,
    escalate: {
      why: 'The docs do not answer this. The founder decides what the answer is.',
      causes: [{ text: 'There is no test mode, and the docs should say so.' }, { text: 'There is a way to test that is not documented yet.' }],
      ruledOut: [],
    },
    docEdit: {
      article: PAGES.apiKeys,
      kind: 'new',
      heading: 'Is there a test mode for the API?',
      add: '[Answer to confirm with the founder: is there a test mode, and if not, how should developers test safely?]',
      note: 'Two docs searches on Nov 15, 2026 found no page about a sandbox or test mode.',
    },
  },
];

// Pick the entry whose patterns match best. "any": at least one must match; "all": every one must match; "none": none may match.
// "priority" wins over score: a message about money taken always goes to a money entry (2: the trial charge,
// 1: any other charge or refund), never to a how-to entry that answers only the easy part.
export function matchEntry(text, playbook = PLAYBOOK) {
  let best = null;
  for (const e of playbook) {
    const any = (e.any || []).filter(re => re.test(text)).length;
    if (e.any?.length && !any) continue;
    if ((e.all || []).some(re => !re.test(text))) continue;
    if ((e.none || []).some(re => re.test(text))) continue;
    const score = any + (e.all || []).length;
    const priority = e.priority || 0;
    if (!best || priority > best.priority || (priority === best.priority && score > best.score)) best = { entry: e, score, priority };
  }
  return best?.entry || null;
}

// The 12 sample tickets live in tickets.json; this re-export keeps imports in one place.
export { default as TICKETS } from './tickets.json' with { type: 'json' };
