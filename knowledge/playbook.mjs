// The desk's playbook: one entry per kind of ticket.
// Every "fact" step cites an exact sentence on a Blotato help page. The checker refuses the reply if that
// sentence is not on the page as fetched. "evidence" steps must rest on a status lookup made for this ticket.
// "action" steps say what we will do, and may not promise anything.
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

export const PLAYBOOK = [
  {
    id: 'published-not-visible', kind: 'non-technical', title: 'Says published, but the post is not on the platform',
    any: [/published/i], all: [/(can'?t|cannot|don'?t|not|isn'?t|no)\b.{0,25}\b(see|find|show|there|appear|visible)/i],
    lookup: 'recent-published',
    opening: 'Thanks for flagging this. Let\'s find out where the post went.',
    steps: [
      fact('"Published" means Blotato got a result back from the platform. It does not tell us why the post is missing from the feed.', 'faqs', 'Published means Blotato recorded a publishing result. It does not establish why the post is absent from a feed or why a platform URL is inaccessible.'),
      evidence('I checked your account: {evidence}'),
      fact('Open Posts > Published and confirm it went to the account or Page you meant.', 'faqs', 'Open Posts > Published and confirm the intended destination.'),
      fact('Then check that same account or Page on the platform itself.', 'faqs', 'Check the same account or Page on the social platform.'),
      fact('Please hold off on posting a replacement until we know what happened to this one.', 'faqs', 'Do not publish a replacement until the original result is understood.'),
    ],
    next: 'Open the post link above and tell me what you see.',
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
  },
  {
    id: 'linkedin-company-page', kind: 'non-technical', title: 'Post to a LinkedIn company Page instead of a profile',
    any: [/linkedin/i], all: [/(company|business|brand)\s*page|page instead|not my (personal )?profile/i],
    opening: 'Yes, you can. It takes two ids instead of one.',
    steps: [
      fact('A LinkedIn company Page needs both your account id and the Page id.', 'errors', 'For LinkedIn company pages, you need both an accountId and a pageId.'),
      fact('Get the account id from GET /v2/users/me/accounts.', 'errors', 'Use `GET /v2/users/me/accounts` to get the accountId'),
      fact('Get the Page id from that account\'s subaccounts, and send it as pageId.', 'errors', 'Pass accountId in `post.accountId` and pageId in `post.target.pageId`.'),
      fact('If you leave pageId out, the post goes to your personal profile.', 'publish', 'Omit to post to personal profile.'),
    ],
    next: 'Add the Page id as pageId and send one test post.',
  },
  {
    id: 'trial-api-key-charge', kind: 'billing', title: 'Charged after making an API key during the trial',
    any: [/trial/i], all: [/(charg|bill|paid|payment|invoice)/i],
    opening: 'I\'m sorry for the surprise. Here is what happened, and who will look at the charge.',
    steps: [
      fact('Making an API key ends the free trial right away and starts the paid plan, even with trial days left.', 'billing', 'your free trial ends at that moment and your paid subscription begins. This applies even if you have days remaining in your trial.'),
      fact('That is because the API is not part of the free trial.', 'auth', 'The free trial does not include API or MCP access.'),
      action('I have passed your question about the charge to the team, so a person can look at your account.'),
      fact('If you would rather not keep the plan, you can cancel in Settings > Billing > View Billing Portal.', 'faqs', 'Go to Settings > Billing and click "View Billing Portal" to cancel your subscription.'),
    ],
    next: 'Reply here if you want to cancel, and I will walk you through it.',
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
  },
  {
    id: 'api-401', kind: 'technical', title: 'API answers 401 Unauthorized',
    any: [/\b401\b|unauthori[sz]ed|invalid (api )?key|wrong (api )?key/i],
    opening: 'A 401 almost always comes down to how the key was copied. Let\'s check it in one minute.',
    steps: [
      fact('A 401 means Blotato did not accept the key.', 'auth', '`401` or invalid credentials'),
      fact('Copy the full key again from Settings > API, including any = at the end.', 'auth', 'Copy the full key, including any trailing `=` characters.'),
      fact('Send it in the blotato-api-key header.', 'auth', 'Include the key in the `blotato-api-key` header of each request.'),
      fact('Test it with one read-only call: GET https://backend.blotato.com/v2/users/me/accounts.', 'auth', 'Call `GET https://backend.blotato.com/v2/users/me/accounts` to verify access.'),
      fact('If you are still on the free trial, the API is not included yet.', 'auth', 'The free trial does not include API or MCP access.'),
    ],
    next: 'Run that one read-only call and tell me the status code you get.',
  },
  {
    id: 'rate-limit', kind: 'technical', title: '"Too many requests" from a workflow',
    any: [/too many requests|rate.?limit|\b429\b/i],
    opening: 'Your workflow is sending faster than Blotato accepts. The fix is to slow it down.',
    steps: [
      fact('That message means too many requests in one minute. Publishing allows 30 a minute.', 'errors', 'Rate limit exceeded. Upload Media: 30 requests/minute. Publish Post: 30 requests/minute.'),
      fact('Stop sending to that step for a moment.', 'rateLimits', 'Stop requests to the limited route after `429`.'),
      fact('Then send fewer posts at a time before you turn the workflow back on.', 'rateLimits', 'Reduce concurrency and request frequency before resuming.'),
      fact('If it is an n8n workflow, the Fix My Automation button in Logs can help repair it.', 'errorHandling', 'For n8n requests, the dashboard\'s FIX MY AUTOMATION action helps repair the workflow.'),
    ],
    next: 'Add a pause between posts and run the workflow again.',
  },
  {
    id: 'mcp-invalid-grant', kind: 'technical', title: 'invalid_grant from the Blotato connector in Claude',
    any: [/invalid_grant|oauth|connector/i], all: [/(claude|chatgpt|mcp|cowork|connector)/i],
    opening: 'This one is about the connector\'s sign-in, not your social accounts.',
    steps: [
      fact('invalid_grant here means your Blotato MCP sign-in expired.', 'errors', 'Your Blotato MCP OAuth connection expired.'),
      fact('In Claude, open Customize > Connectors, remove the Blotato connector, add it again, and approve access.', 'errors', 'In Claude, open Customize > Connectors, remove and re-add the Blotato custom connector, and re-approve access via OAuth.'),
      fact('Make sure you are logged into Blotato in the same browser first.', 'mcpSetup', 'Make sure you are logged into your Blotato account in the browser.'),
      fact('The Fix My Automation button will not help with this one. It only works for n8n.', 'n8nFaqs', 'it does not work for Make.com, Claude, MCP, or direct REST API calls.'),
    ],
    next: 'Re-add the connector, then ask Claude to list your Blotato accounts.',
  },
  {
    id: 'unknown-outcome-resend', kind: 'technical', title: 'Timeout after creating a post: send it again?',
    any: [/\b50[234]\b|timed? ?out|timeout|gateway/i], all: [/(again|resend|retry|twice|duplicate|re-?send|re-?run)/i],
    lookup: 'recent-activity',
    opening: 'Good call asking before sending it again.',
    steps: [
      fact('A timeout does not tell us whether the post was created, so please do not send it again yet.', 'errors', 'The downstream operation\'s outcome is not established by this response.'),
      evidence('I checked your account: {evidence}'),
      fact('Check your scheduled and published posts for it first.', 'errorHandling', 'Check existing work before submitting again'),
      fact('Blotato has no setting that marks a second send as the same post, so a resend can make a copy.', 'errorHandling', 'Blotato does not expose a documented client-supplied idempotency header for create-post requests.'),
      fact('Only send it again once you know the first one is not there.', 'errors', 'Check the original submission or creation before retrying a write.'),
    ],
    next: 'Look for the post in your queue, then tell me whether it is there.',
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
      fact('Check Posts > Failed in the dashboard too.', 'getPost', 'Failed posts are also visible at'),
    ],
    next: 'Send me the time you created it and the account, and I will check the post list.',
  },
  {
    id: 'schedule-id-500', kind: 'technical', title: 'Schedule lookup answers 500 "invalid input syntax for type bigint"',
    any: [/bigint|invalid input syntax/i, /schedules\/sch_/i],
    lookup: 'reproduce-schedule',
    opening: 'Thank you for the exact error. I could reproduce it.',
    steps: [
      evidence('Same result here: {evidence}'),
      fact('Our docs show schedule ids like "sch_abc123" in their examples.', 'schedules', '"id": "sch_abc123"'),
      evidence('The error says the server expected a number, so please try the number id from your own GET /v2/schedules list.'),
      action('I have sent this to the founder with the steps to reproduce it, and a fix for the docs.'),
    ],
    next: 'Try the number id from your own schedules list and tell me what you get.',
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
      evidence('I searched our help docs and found nothing about a test mode, so I will not guess.', 'docs-search'),
      action('I have asked the team, and I will reply here with a clear answer.'),
      action('In the meantime, read-only calls like listing your accounts do not post anything.'),
    ],
    next: 'Nothing to do on your side yet. I will reply here.',
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
      add: '[Answer to confirm with the founder.] Until then: read-only calls such as GET /v2/users/me/accounts and GET /v2/posts do not publish anything.',
      note: 'Two docs searches on Nov 15, 2026 found no page about a sandbox or test mode.',
    },
  },
];

// Pick the entry whose patterns match best. "any": at least one must match; "all": every one must match; "none": none may match.
export function matchEntry(text, playbook = PLAYBOOK) {
  let best = null;
  for (const e of playbook) {
    const any = (e.any || []).filter(re => re.test(text)).length;
    if (e.any?.length && !any) continue;
    if ((e.all || []).some(re => !re.test(text))) continue;
    if ((e.none || []).some(re => re.test(text))) continue;
    const score = any + (e.all || []).length;
    if (!best || score > best.score) best = { entry: e, score };
  }
  return best?.entry || null;
}

// The 12 sample tickets live in tickets.json; this re-export keeps imports in one place.
export { default as TICKETS } from './tickets.json' with { type: 'json' };
