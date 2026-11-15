// The Blotato key: read from the environment, or from a .env file in the repo folder.
// It is never printed, never logged, never written. redact() scrubs it from any text we save.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

export const KEY_NAME = 'BLOTATO_API_KEY';

// Reads NAME=value from a .env file. Handles "export ", quotes, CRLF, a BOM and # comments.
// Two lines for the same name is an error, and the error never carries a value.
export function readEnvFile(name, file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return undefined; }
  let found;
  let count = 0;
  for (const line of raw.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m || m[1] !== name) continue;
    count++;
    let v = m[2].trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    found = v;
  }
  if (count > 1) throw new Error(`${name} appears ${count} times in ${path.basename(file)}. Keep exactly one line.`);
  return found || undefined;
}

// Order: the process environment first, then <repo>/.env. Returns undefined when there is no key.
export function loadKey({ env = process.env, envFile = path.join(ROOT, '.env') } = {}) {
  const fromEnv = (env[KEY_NAME] || '').trim();
  if (fromEnv) return fromEnv;
  return readEnvFile(KEY_NAME, envFile);
}

// Remove the key (and anything that looks like a header carrying it) from text before it is saved or shown.
export function redact(text, key) {
  let s = String(text ?? '');
  if (key && key.length >= 4) s = s.split(key).join('[hidden key]');
  return s.replace(/(blotato-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[hidden key]');
}
