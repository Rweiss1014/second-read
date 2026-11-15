// Mock mode: an in-memory stand-in for the Blotato API, shaped exactly like the documented responses.
// Every name and id here is made up. Times are set relative to "now" so the sample never goes stale.
// Shapes from (read Nov 15, 2026):
//   GET  /users/me/accounts      https://help.blotato.com/rest-api-reference/accounts.md
//   GET  /posts                  https://help.blotato.com/rest-api-reference/publish-post/list-posts.md
//   GET  /posts/:submissionId    https://help.blotato.com/rest-api-reference/publish-post/get-post.md
//   POST /posts                  https://help.blotato.com/rest-api-reference/publish-post.md
//   GET/DELETE /schedules[/:id]  https://help.blotato.com/rest-api-reference/schedules.md

const H = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

export const MOCK_ACCOUNTS = [
  { id: '98432', platform: 'linkedin', fullname: 'Sample Creator', username: 'samplecreator' },
  { id: '98433', platform: 'twitter', fullname: 'Sample Creator', username: 'samplecreator' },
  { id: '98434', platform: 'bluesky', fullname: 'Sample Creator', username: 'samplecreator.bsky.social' },
  { id: '98435', platform: 'threads', fullname: 'Sample Creator', username: 'samplecreator' },
];

const acct = (id) => {
  const a = MOCK_ACCOUNTS.find(x => x.id === id);
  return a ? { id: a.id, name: a.fullname, subaccount: null } : null;
};

// Sample post times are anchored to the start of the current six-hour block, not to this exact second.
// A real post's time never moves, so a sample post's time should not move between two runs either.
// Otherwise the reply text changes on every run, and no checker verdict could ever match it.
const SIX_HOURS = 6 * H;
const steadyNow = () => Math.floor(Date.now() / SIX_HOURS) * SIX_HOURS;

export function createMockApi({ now = steadyNow } = {}) {
  const t0 = now();
  // Scheduled posts live here (the schedules list). The docs show ids like "sch_abc123", but the real API
  // treats schedule ids as numbers (checked Nov 15, 2026), so the mock uses number strings.
  const schedules = new Map();
  const addSchedule = (id, at, accountId, platform, text) => schedules.set(id, {
    id, scheduledAt: iso(at),
    account: { id: accountId, name: 'Sample Creator', username: 'samplecreator', profileImageUrl: 'https://example.com/avatar.png', subaccountId: null, subId: null, subaccountName: null },
    draft: { accountId, content: { text, mediaUrls: [], platform }, target: { targetType: platform } },
  });
  addSchedule('5100001', t0 + 72 * H, '98432', 'linkedin', 'Three things I check before I schedule anything. Number one: can I still delete it tomorrow?');
  addSchedule('5100002', t0 + 20 * H, '98433', 'twitter', 'Tiny habit: write the post, sleep on it, then schedule it.');

  // Published and failed posts (from the list-posts docs: ids are distinct per state).
  const history = [
    { id: '71002', postTime: iso(t0 - 5 * H), platform: 'instagram', text: 'Behind the scenes of our spring launch.', mediaUrls: ['https://example.com/sample-image.jpg'], account: { id: '98436', name: 'Sample Creator', subaccount: null },
      state: { type: 'published', postUrl: 'https://example.com/sample-instagram-post', analytics: null } },
    { id: '71001', postTime: iso(t0 - 50 * H), platform: 'linkedin', text: 'What I learned turning a checklist into a two-minute practice game.', mediaUrls: [], account: acct('98432'),
      state: { type: 'published', postUrl: 'https://example.com/sample-published-post', analytics: null } },
    { id: '81001', postTime: iso(t0 - 26 * H), platform: 'twitter', text: 'Five posts in one minute, what could go wrong?', mediaUrls: [], account: acct('98433'),
      state: { type: 'failed', errorMessage: 'The service is receiving too many requests from you' } },
    { id: '81002', postTime: iso(t0 - 6 * H), platform: 'linkedin', text: 'A post sent with an old account id.', mediaUrls: [], account: null,
      state: { type: 'failed', errorMessage: 'Account 98499 not found' } },
    { id: '81003', postTime: iso(t0 - 3 * H), platform: 'bluesky', text: 'A post whose error is not in the table yet.', mediaUrls: [], account: acct('98434'),
      state: { type: 'failed', errorMessage: 'Unsupported media type' } },
  ];

  // Submission ids from POST /posts, for GET /posts/:id.
  const submissions = new Map([
    ['b7d1c0de-0000-4000-8000-000000000001', { status: 'published', publicUrl: 'https://example.com/sample-published-post' }],
    ['b7d1c0de-0000-4000-8000-000000000002', { status: 'failed', errorMessage: 'Account 98499 not found' }],
  ]);
  let seq = 0;

  function listPosts(query) {
    const q = new URLSearchParams(query);
    const since = q.get('since') ? Date.parse(q.get('since')) : t0 - 7 * 24 * H;
    const until = q.get('until') ? Date.parse(q.get('until')) : t0 + 7 * 24 * H;
    if (Number.isNaN(since) || Number.isNaN(until)) return { status: 422, data: { message: 'Invalid since or until value' } };
    const statuses = q.getAll('status');
    const platforms = q.getAll('platform');
    const sched = [...schedules.values()].map(s => ({ id: s.id, postTime: s.scheduledAt, platform: s.draft.content.platform, text: s.draft.content.text, mediaUrls: s.draft.content.mediaUrls, account: acct(s.draft.accountId), state: { type: 'scheduled' } }));
    let items = [...sched, ...history].filter(p => { const t = Date.parse(p.postTime); return t >= since && t <= until; });
    if (statuses.length) items = items.filter(p => statuses.includes(p.state.type));
    if (platforms.length) items = items.filter(p => platforms.includes(p.platform));
    items.sort((a, b) => Date.parse(b.postTime) - Date.parse(a.postTime));
    return { status: 200, data: { items } }; // one page: no cursor means the end of the list
  }

  function createPost(body) {
    const p = body?.post;
    const problems = [];
    if (!p || typeof p !== 'object') problems.push('post is required');
    else {
      if (!p.accountId) problems.push('post.accountId is required');
      if (typeof p.content?.text !== 'string') problems.push('post.content.text is required');
      if (!Array.isArray(p.content?.mediaUrls)) problems.push('post.content.mediaUrls must be an array');
      if (!p.content?.platform) problems.push('post.content.platform is required');
      if (!p.target?.targetType) problems.push('post.target.targetType is required');
      if (p.content?.platform && p.target?.targetType && p.content.platform !== p.target.targetType) problems.push('content.platform must match target.targetType');
    }
    // "Validation error, often 422" (error-handling docs). The mock's message wording is our own.
    if (problems.length) return { status: 422, data: { message: problems.join('; ') } };
    seq++;
    const postSubmissionId = `b7d1c0de-0000-4000-8000-${String(100 + seq).padStart(12, '0')}`;
    if (!body.scheduledTime) {
      // Docs: with no scheduledTime and no useNextFreeSlot, the post publishes immediately.
      submissions.set(postSubmissionId, { status: 'published', publicUrl: 'https://example.com/sample-published-post' });
      return { status: 201, data: { postSubmissionId } };
    }
    const at = Date.parse(body.scheduledTime);
    const id = String(5100100 + seq);
    addSchedule(id, at, String(p.accountId), p.content.platform, p.content.text);
    submissions.set(postSubmissionId, { status: 'scheduled', scheduledTime: iso(at), scheduleId: id });
    return { status: 201, data: { postSubmissionId, scheduledTime: iso(at) } };
  }

  function handle(method, pathname, body) {
    const [p, query = ''] = pathname.split('?');
    if (method === 'GET' && p === '/users/me/accounts') {
      const platform = new URLSearchParams(query).get('platform');
      return { status: 200, data: { items: MOCK_ACCOUNTS.filter(a => !platform || a.platform === platform) } };
    }
    if (method === 'GET' && p === '/posts') return listPosts(query);
    if (method === 'POST' && p === '/posts') return createPost(body);
    let m = p.match(/^\/posts\/([^/]+)$/);
    if (method === 'GET' && m) {
      const s = submissions.get(m[1]);
      // Docs: when nothing matches, the lookup returns in-progress. That is not proof the post exists.
      if (!s) return { status: 200, data: { postSubmissionId: m[1], status: 'in-progress' } };
      const { scheduleId, ...rest } = s;
      if (rest.status === 'scheduled' && scheduleId && !schedules.has(scheduleId)) return { status: 200, data: { postSubmissionId: m[1], status: 'in-progress' } };
      return { status: 200, data: { postSubmissionId: m[1], ...rest } };
    }
    if (method === 'GET' && p === '/schedules') { const items = [...schedules.values()].filter(s => Date.parse(s.scheduledAt) > now()).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)); return { status: 200, data: { items, count: String(items.length) } }; }
    m = p.match(/^\/schedules\/([^/]+)$/);
    // Seen on the real API (Nov 15, 2026), not in the docs: a non-number schedule id answers 500, not 404.
    if (m && !/^\d+$/.test(m[1])) return { status: 500, data: { statusCode: 500, message: `invalid input syntax for type bigint: "${m[1]}"`, reqId: 'mock-req-0001' } };
    if (m && method === 'GET') return schedules.has(m[1]) ? { status: 200, data: { schedule: schedules.get(m[1]) } } : { status: 404, data: null };
    if (m && method === 'DELETE') { if (!schedules.has(m[1])) return { status: 404, data: null }; schedules.delete(m[1]); return { status: 204, data: null }; }
    return { status: 404, data: null };
  }

  return { handle, schedules, submissions };
}
