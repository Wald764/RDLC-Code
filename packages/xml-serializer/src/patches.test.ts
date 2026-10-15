import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from './patches.js';
import type { PatchPlan } from '@rdlc/report-model/editing';

const source = '<a>😀old</a>';
const snapshot = {
  uri: 'fixture:patch',
  version: 2,
  source,
  eol: '\n' as const,
};
const plan: PatchPlan = {
  version: 2,
  footprint: [{ start: 5, end: 8 }],
  namespaceDependencies: [],
  patches: [
    {
      version: 2,
      start: 5,
      end: 8,
      expected: 'old',
      replacement: 'new &amp; safe',
    },
  ],
};
test('applies only sorted declared UTF-16 footprints without regenerating source', () => {
  assert.equal(applyPlan(snapshot, plan, {}), '<a>😀new &amp; safe</a>');
  assert.equal(applyPlan(snapshot, { ...plan, patches: [] }, {}), source);
});
test('rejects stale, overlapping, out-of-footprint, changed expected text, invalid ranges and namespaces', () => {
  for (const bad of [
    { ...plan, version: 1 },
    { ...plan, patches: [plan.patches[0]!, plan.patches[0]!] },
    { ...plan, footprint: [] },
    { ...plan, patches: [{ ...plan.patches[0]!, expected: 'bad' }] },
    { ...plan, patches: [{ ...plan.patches[0]!, start: 5.1 }] },
    { ...plan, patches: [{ ...plan.patches[0]!, start: -1 }] },
    { ...plan, patches: [{ ...plan.patches[0]!, version: 1 }] },
    {
      ...plan,
      namespaceDependencies: [{ nodeId: '2:1', prefix: 'p', uri: 'required' }],
    },
  ])
    assert.throws(() => applyPlan(snapshot, bad, {}));
});
