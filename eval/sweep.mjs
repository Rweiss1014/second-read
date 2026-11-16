// The threshold curve: sweep the answer bar (score threshold and margin) on the tuning sets and print, for
// each setting, how many answers the desk gives, how many are right and how many wrong.
//   node eval/sweep.mjs [--sets dev2,dev]
import { loadEntries } from '../src/entries.mjs';
import { createRouter, THRESHOLD, THRESHOLD_UNANCHORED, MARGIN } from '../src/route.mjs';
import { readSet, simulate, tally } from './sim.mjs';

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const sets = opt('sets', 'dev2,dev').split(',');
const thresholds = opt('t', '0.25,0.30,0.35,0.40,0.45,0.50,0.55,0.60').split(',').map(Number);
const margins = opt('m', '0.06,0.10,0.15,0.20').split(',').map(Number);
const entries = loadEntries().entries;
const data = Object.fromEntries(sets.map(s => [s, readSet(s)]));
console.log(`Now: threshold ${THRESHOLD} (unanchored ${THRESHOLD_UNANCHORED}), margin ${MARGIN}`);
console.log(`| threshold | margin | ${sets.map(s => `${s} answers | ${s} right | ${s} wrong | ${s} wrong share`).join(' | ')} |`);
console.log(`|${'---|'.repeat(2 + sets.length * 4)}`);
for (const t of thresholds) for (const m of margins) {
  const router = createRouter(entries, { threshold: t, thresholdUnanchored: Math.max(t, THRESHOLD_UNANCHORED), margin: m });
  const cells = sets.map(s => { const x = tally(simulate(router, data[s])); return `${x.answers} | ${x.answersRight} | ${x.wrong} | ${Math.round(1000 * x.wrong / x.n) / 10}%`; });
  console.log(`| ${t.toFixed(2)} | ${m.toFixed(2)} | ${cells.join(' | ')} |`);
}
