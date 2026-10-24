import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentCatalog, filterComponents } from './components.js';

test('one inert catalog has exactly eleven unique kinds and three creators', () => {
  const entries = componentCatalog.flatMap((category) => category.entries);
  assert.equal(entries.length, 11);
  assert.equal(new Set(entries.map((entry) => entry.kind)).size, 11);
  assert.deepEqual(
    entries.filter((entry) => entry.creatable).map((entry) => entry.kind),
    ['textbox', 'table', 'dataset'],
  );
  assert.ok(
    entries
      .filter((entry) => !entry.creatable)
      .every((entry) => entry.reason?.includes('Code XML')),
  );
});

test('component filtering keeps category context, unavailable items and the original catalog', () => {
  assert.deepEqual(filterComponents(' tAbL '), [
    { label: 'Report items', entries: [componentCatalog[0]!.entries[1]!] },
  ]);
  assert.equal(filterComponents('image')[0]?.entries[0]?.creatable, false);
  assert.equal(filterComponents('not a component').length, 0);
  assert.equal(
    filterComponents('').flatMap((category) => category.entries).length,
    11,
  );
});
