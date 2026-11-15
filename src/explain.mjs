// "Why did my post fail?" in plain, kind words.
// Every entry is tied to the page it comes from. Docs read Nov 15, 2026.
// An error that matches nothing here is shown exactly as Blotato sent it. We never guess.

const DOCS = 'https://help.blotato.com';

export const KNOWN_ERRORS = [
  {
    id: 'bad-key',
    match: [/^Unauthorized$/i, /Authorization failed - please check your credentials/i, /Wrong Blotato API Key/i],
    status: [401],
    title: 'Blotato did not recognize the API key',
    plain: 'The key was missing, cut short, or copied with an extra space.',
    next: 'Copy the whole key again from Settings > API, including any = at the end. Then run one read-only check before anything else.',
    source: `${DOCS}/api-and-mcp-concepts/authentication.md`,
    guard: 'key-check',
  },
  {
    id: 'plan-no-api',
    match: [/subscription/i],
    status: [403],
    title: 'The key works, but the plan does not include the API',
    plain: 'API access comes with paid plans. The free trial does not include it.',
    next: 'Check the plan in Settings > Billing. Nothing is wrong with the post itself.',
    source: `${DOCS}/api-and-mcp-concepts/authentication.md`,
  },
  {
    id: 'account-not-found',
    match: [/Account \S+ not found/i, /Wrong Account ID/i],
    title: 'The account id does not match a connected account',
    plain: 'The post named an account Blotato cannot find for this key. Ids change when an account is reconnected, and a LinkedIn page id is easy to put in the wrong field.',
    next: 'List your accounts again and copy the current id. For a LinkedIn company page, the account id goes in accountId and the page id goes in pageId.',
    source: `${DOCS}/support/errors.md`,
    guard: 'account-exists',
  },
  {
    id: 'wrong-page-id',
    match: [/Wrong Page ID/i],
    title: 'The page id is wrong',
    plain: 'Facebook posts need both the account id and the page id.',
    next: 'Copy the page id again with the "Copy Page ID" button, then send it again.',
    source: `${DOCS}/support/errors.md`,
  },
  {
    id: 'blotato-rate-limit',
    match: [/The service is receiving too many requests from you/i],
    status: [429],
    title: 'Too many requests in one minute',
    plain: 'Blotato allows 30 new posts a minute. This run went over that.',
    next: 'Wait a minute, then send fewer at a time. Nothing about the post needs to change.',
    source: `${DOCS}/api-and-mcp-concepts/rate-limits.md`,
    guard: 'pace-requests',
  },
  {
    id: 'platform-rate-limit',
    match: [/Exceeded rate limits/i],
    title: 'The social platform is slowing this account down',
    plain: 'This limit comes from the platform (for example LinkedIn or YouTube), not from Blotato.',
    next: 'Wait an hour, then retry from Posts > Failed. If it keeps happening, reconnect the account, then retry.',
    source: `${DOCS}/support/errors.md`,
  },
  {
    id: 'reconnect',
    match: [/Account requires reconnect/i, /has not authorized application/i, /invalid_grant/i],
    title: 'The account needs to be reconnected',
    plain: 'The sign-in Blotato holds for this account expired or was revoked, often after a password change.',
    next: 'Open Accounts in Blotato, click Reconnect on that account, approve it, then retry the post.',
    source: `${DOCS}/support/errors.md`,
  },
  {
    id: 'media-unreachable',
    match: [/Could not upload media to storage/i, /Failed to upload stream to Supabase/i],
    title: 'Blotato could not download the image or video',
    plain: 'The media link is usually not public, or it opens a preview page instead of the file.',
    next: 'Open the link in a private browser window. It should download the file itself. Drive and Dropbox share links need a direct download link.',
    source: `${DOCS}/support/errors.md`,
  },
  {
    id: 'media-conversion',
    match: [/Media conversion failed/i],
    title: 'The media could not be converted',
    plain: 'This message alone does not say why. Blotato also sends it when the download failed.',
    next: 'Check the media link first, then the file type against the platform rules. Check the post status before sending it again.',
    source: `${DOCS}/support/errors.md`,
  },
  {
    id: 'threads-one-media',
    match: [/Threads only supports a single image or a video/i],
    title: 'Threads takes one image or video per post',
    plain: 'The post had more than one media item.',
    next: 'Keep one item in the post. Put each extra image in its own post in additionalPosts.',
    source: `${DOCS}/rest-api-reference/publish-post/media.md`,
  },
  {
    id: 'invalid-json',
    match: [/Invalid JSON Error/i],
    title: 'The request was not valid JSON',
    plain: 'The docs say a wrong JSON shape is the most common cause of failed posts.',
    next: 'Compare the body with the Publish Post docs. Check it field by field.',
    source: `${DOCS}/rest-api-reference/publish-post.md`,
  },
  {
    id: 'outcome-unknown',
    match: [/Service Unavailable/i, /Gateway Timeout/i],
    status: [502, 503, 504],
    title: 'The outcome is not known yet',
    plain: 'The server timed out or was busy. The post may still have gone through.',
    next: 'Do not send it again yet. Check the queue first, then decide. Keep the request id for support.',
    source: `${DOCS}/support/errors.md`,
    guard: 'check-before-resend',
  },
  {
    id: 'not-a-schedule-id',
    match: [/invalid input syntax for type bigint/i],
    title: 'That is not a schedule id',
    plain: 'Blotato schedule ids are numbers. This one was not, so the server could not look it up.',
    next: 'Copy the id from the queue list (the number), not from a docs example.',
    source: 'Seen on the real API, Nov 15, 2026. Not in the docs, which show ids like "sch_abc123".',
    seenReal: true,
    guard: 'numeric-schedule-id',
  },
  {
    id: 'too-many-hashtags',
    match: [/maximum of 5 hashtags/i],
    title: 'Too many hashtags',
    plain: 'Blotato caps posts at 5 hashtags on purpose. It is Blotato\'s rule, not the platform\'s.',
    next: 'Trim to 5 hashtags or fewer and send it again.',
    source: `${DOCS}/support/errors.md`,
  },
];

// Returns { known: true, ... } with plain words, or { known: false, raw } with the exact text and where to look.
export function explain(errorText, { status } = {}) {
  const text = String(errorText ?? '').trim();
  for (const e of KNOWN_ERRORS) {
    if (e.match.some(re => re.test(text)) || (status && e.status?.includes(status) && !text.replace(/HTTP \d+/, '').trim())) {
      const { match, status: _s, ...rest } = e;
      return { known: true, raw: text, ...rest };
    }
  }
  if (status && !text) {
    for (const e of KNOWN_ERRORS) if (e.status?.includes(status)) { const { match, status: _s, ...rest } = e; return { known: true, raw: `HTTP ${status}`, ...rest }; }
  }
  return {
    known: false,
    raw: text || (status ? `HTTP ${status}` : '(no error text)'),
    title: 'I do not recognize this error yet',
    plain: 'Here it is exactly as Blotato sent it. I would rather show it to you than guess.',
    next: 'Open Logs in the Blotato dashboard and find this request. Its payload and response say more. If you ask support, include the request id.',
    source: `${DOCS}/api-and-mcp-concepts/error-handling.md`,
  };
}

// Not an error: a submission still says in-progress.
export function explainInProgress({ scheduledFor, ageMinutes } = {}) {
  return {
    known: true,
    id: 'in-progress',
    title: 'Blotato has no result for this yet',
    plain: 'In-progress can mean it is still publishing. It can also mean Blotato found no record for this id at all. It is not proof of failure, and not proof it exists.',
    next: ageMinutes > 15
      ? 'It has been a while. Check the post list for this time and account, and open Logs in the dashboard. Do not send it again until you know.'
      : 'Check again in a minute or two. Blotato asks for at least 10 seconds between checks.',
    source: `${DOCS}/rest-api-reference/publish-post/get-post.md`,
    scheduledFor,
  };
}
