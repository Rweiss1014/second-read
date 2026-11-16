// The desk's playbook. The entries are data now: knowledge/entries/*.json, one file per help-center area.
// They are read and checked at start (src/entries.mjs). The full check, with every quote against its cached
// help page, is `node bin/support-desk.mjs check-entries`. How to write one: knowledge/ENTRY-GUIDE.md.
//
// This module keeps the old exports working (PLAYBOOK, PAGES, MONEY, matchEntry, TICKETS), so the page
// server and the practice shift need no change.
import { loadEntries } from '../src/entries.mjs';
import { createRouter } from '../src/route.mjs';

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
  triage: `${D}/start-with-an-ai-agent/agent-triage`,
};

export { MONEY } from '../src/signals.mjs';

export const PLAYBOOK = loadEntries().entries;
export const ENTRY_BY_ID = new Map(PLAYBOOK.map(e => [e.id, e]));
export const ROUTER = createRouter(PLAYBOOK);

// The full routing decision for a message: { decision, entry, guard, signals, candidates, reason, ... }.
export const routeMessage = (text) => ROUTER.route(text);

// The entry that takes this message (a guard's hand-over entry, or the topic entry), or null when the desk
// abstains. Kept for older callers.
export function matchEntry(text, playbook = PLAYBOOK) {
  const router = playbook === PLAYBOOK ? ROUTER : createRouter(playbook);
  return router.route(text).entry || null;
}

// The 12 sample tickets live in tickets.json; this re-export keeps imports in one place.
export { default as TICKETS } from './tickets.json' with { type: 'json' };
