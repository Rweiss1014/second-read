import test from 'node:test';
import assert from 'node:assert/strict';
import { readEntryFiles } from '../src/entries.mjs';
import { renderDocEdit } from '../src/diagnose.mjs';

// A help-page fix can change a line without adding a sentence. The saved text must never say "undefined"
// or promise a sentence that is not there.
test('every proposed help-page edit renders without "undefined" or an empty add', () => {
  const all = readEntryFiles();
  const entries = (Array.isArray(all) ? all : Object.values(all).flat()).flatMap(x => x?.entries || x);
  const edits = entries.filter(e => e && e.docEdit);
  assert.ok(edits.length >= 8, `expected the 8 entries with a docEdit, found ${edits.length}`);
  for (const e of edits) {
    const text = renderDocEdit(e.docEdit);
    assert.doesNotMatch(text, /undefined/, e.id);
    if (!e.docEdit.add) assert.doesNotMatch(text, /Add under/, e.id);
  }
});

test('a change with no sentence to add renders the change only', () => {
  const text = renderDocEdit({ article: 'https://help.blotato.com/x', kind: 'change', before: 'a', after: 'b', note: 'n' });
  assert.match(text, /- a\n\+ b/);
  assert.doesNotMatch(text, /Add under|undefined/);
});
