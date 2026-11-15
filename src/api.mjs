// One small Blotato client. Real mode uses fetch with the blotato-api-key header.
// Mock mode (BLOTATO_MOCK=1) answers from fixtures shaped exactly like the documented responses.
// The desk only reads: every call that is not a GET is refused before the key or network is used.
// There is no switch to turn that off.
// Docs read Nov 15, 2026: https://help.blotato.com/rest-api-reference/api-reference.md
import { BASE_URL, isMock } from './config.mjs';
import { loadKey, redact } from './env.mjs';
import { newRequestId } from './log.mjs';
import { createMockApi } from './mock.mjs';

export class ApiError extends Error {
  constructor(message, { status, requestId, data } = {}) { super(message); this.status = status; this.requestId = requestId; this.data = data; }
}

export function createClient({ env = process.env, logger, fetchImpl = globalThis.fetch, mockApi } = {}) {
  const mock = isMock(env);
  const api = mock ? (mockApi || createMockApi()) : null;
  let key;

  async function request(method, pathname) {
    method = String(method).toUpperCase();
    const requestId = newRequestId();
    const log = (entry) => logger?.write({ action: 'api', method, path: pathname, requestId, ...entry });
    if (method !== 'GET') {
      const msg = `Refused ${method} ${pathname}: the support desk only reads. Nothing was sent.`;
      log({ status: null, ok: false, error: msg });
      throw new ApiError(msg, { requestId });
    }
    if (mock) {
      const r = api.handle(method, pathname);
      log({ status: r.status, ok: r.status < 400, upstreamRequestId: r.data?.reqId, error: r.status >= 400 ? errorText(r.data, r.status) : undefined });
      return { ...r, ok: r.status < 400, requestId };
    }
    if (!key) key = loadKey({ env });
    if (!key) {
      const msg = 'No BLOTATO_API_KEY found. Put it in your environment or in a .env file in this folder, or run with BLOTATO_MOCK=1 to try sample data.';
      log({ status: null, ok: false, error: msg });
      throw new ApiError(msg, { requestId });
    }
    let res;
    try {
      res = await fetchImpl(BASE_URL + pathname, {
        method,
        headers: { 'blotato-api-key': key, accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
    } catch (e) {
      // The raw error can carry request details. Say only what failed. Only GETs get this far, so a retry is safe.
      const msg = `Network error or timeout on ${method} ${pathname}. Safe to try again: it only reads.`;
      log({ status: null, ok: false, error: msg });
      throw new ApiError(msg, { requestId });
    }
    // Scrub the key from the body before anything else touches it, in case a server ever echoes it back.
    const text = redact(await res.text(), key);
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = { raw: redact(text.slice(0, 500), key) }; } }
    // Blotato error bodies carry a reqId (seen on the real API); support asks for it.
    const upstreamId = data?.reqId || [...res.headers.entries()].find(([h]) => /request-?id/i.test(h))?.[1];
    log({ status: res.status, ok: res.ok, upstreamRequestId: upstreamId, error: res.ok ? undefined : errorText(data, res.status) });
    return { status: res.status, ok: res.ok, data, requestId, upstreamRequestId: upstreamId };
  }

  return { request, mock, readOnly: true, get: (p) => request('GET', p) };
}

export function errorText(data, status) {
  if (!data) return `HTTP ${status}`;
  return redact(String(data.message || data.error?.message || data.error || data.errorMessage || data.raw || JSON.stringify(data)).slice(0, 500));
}

// One submission's status. Docs: an unknown id also answers "in-progress", so in-progress proves nothing.
// https://help.blotato.com/rest-api-reference/publish-post/get-post.md
export async function getSubmission(client, id) {
  const r = await client.get(`/posts/${encodeURIComponent(id)}`);
  if (!r.ok) throw new ApiError(`Status lookup failed: ${errorText(r.data, r.status)}`, { status: r.status, requestId: r.requestId, data: r.data });
  return { ...r.data, requestId: r.requestId };
}

// Pages through GET /posts (docs: cursor-based, limit max 250).
export async function listPosts(client, { since, until, status } = {}) {
  const items = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams();
    if (since) q.set('since', since);
    if (until) q.set('until', until);
    for (const s of status || []) q.append('status', s);
    q.set('limit', '100');
    if (cursor) q.set('cursor', cursor);
    const r = await client.get(`/posts?${q}`);
    if (!r.ok) throw new ApiError(`Listing posts failed: ${errorText(r.data, r.status)}`, { status: r.status, requestId: r.requestId, data: r.data });
    items.push(...(r.data?.items || []));
    cursor = r.data?.cursor;
    if (!cursor) break;
  }
  return items;
}

export async function listAccounts(client) {
  const r = await client.get('/users/me/accounts');
  if (!r.ok) throw new ApiError(`Listing accounts failed: ${errorText(r.data, r.status)}`, { status: r.status, requestId: r.requestId, data: r.data });
  return r.data?.items || [];
}
