// Where things live, and the switches.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_URL = 'https://backend.blotato.com/v2';
export const DOCS_MCP_URL = 'https://help.blotato.com/~gitbook/mcp';
export const DOCS_BASE = 'https://help.blotato.com';

// BLOTATO_MOCK=1: account status comes from sample data shaped like the documented responses.
export const isMock = (env = process.env) => env.BLOTATO_MOCK === '1';
// The desk only reads. Every non-GET call is refused unless this is explicitly set to 0 (nothing in the desk needs it).
export const isReadOnly = (env = process.env) => env.SUPPORT_DESK_READ_ONLY !== '0';
// DOCS_OFFLINE=1: use only the local docs cache (tests, planes, no network).
export const isDocsOffline = (env = process.env) => env.DOCS_OFFLINE === '1';

export function deskPaths(env = process.env) {
  const dir = env.SUPPORT_DESK_DIR ? path.resolve(env.SUPPORT_DESK_DIR) : path.join(ROOT, 'desk');
  return {
    dir,
    failures: path.join(dir, 'known-failures.md'),
    handoff: path.join(dir, 'HANDOFF.md'),
    morning: path.join(dir, 'MORNING.md'),
    reviews: path.join(dir, 'reviews'),
    logs: path.join(dir, 'logs'),
    docsCache: env.DOCS_CACHE_DIR ? path.resolve(env.DOCS_CACHE_DIR) : path.join(ROOT, '.cache', 'docs'),
  };
}
