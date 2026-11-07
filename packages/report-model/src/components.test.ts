import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentCatalog, filterComponents } from './components.js';

test('one inert catalog has exactly eleven unique kinds and four creators', () => {
  const entries = componentCatalog.flatMap((category) => category.entries);
  assert.equal(entries.length, 11);
  assert.equal(new Set(entries.map((entry) => entry.kind)).size, 11);
  assert.deepEqual(
    entries.filter((entry) => entry.creatable).map((entry) => entry.kind),
    ['textbox', 'table', 'image', 'dataset'],
  );
  assert.ok(
    entries
      .filter((entry) => !entry.creatable)
      .every((entry) => entry.reason?.includes('Code XML')),
  );
  const image = entries.find((entry) => entry.kind === 'image')!;
  assert.equal(image.creatable, true);
  assert.equal(image.reason, null);
});

test('component filtering keeps category context, unavailable items and the original catalog', () => {
  assert.deepEqual(filterComponents(' tAbL '), [
    { label: 'Report items', entries: [componentCatalog[0]!.entries[1]!] },
  ]);
  assert.equal(filterComponents('image')[0]?.entries[0]?.creatable, true);
  assert.equal(filterComponents('not a component').length, 0);
  assert.equal(
    filterComponents('').flatMap((category) => category.entries).length,
    11,
  );
});
