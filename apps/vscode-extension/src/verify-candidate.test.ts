import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCandidate } from './verify-candidate.js';
import type { PatchPlan } from '@rdlc/report-model/editing';

test('candidate verification reparses and verifies intention before any host mutation', () => {
  const snapshot = {
    uri: 'fixture:verify',
    version: 4,
    source: '<a xmlns:p="urn:p">old<p:b/></a>',
    eol: '\n' as const,
  };
  const start = snapshot.source.indexOf('old');
  const plan: PatchPlan = {
    version: 4,
    patches: [
      {
        version: 4,
        start,
        end: start + 3,
        expected: 'old',
        replacement: 'new',
      },
    ],
    footprint: [{ start, end: start + 3 }],
    namespaceDependencies: [{ nodeId: '4:1', prefix: 'p', uri: 'urn:p' }],
  };
  assert.equal(
    verifyCandidate(
      snapshot,
      plan,
      (candidate) => candidate.root?.text === 'new',
    ).source,
    snapshot.source.replace('old', 'new'),
  );
  assert.throws(() => verifyCandidate(snapshot, plan, () => false));
  assert.throws(() =>
    verifyCandidate(
      snapshot,
      { ...plan, patches: [{ ...plan.patches[0]!, replacement: '<' }] },
      () => true,
    ),
  );
  assert.throws(() =>
    verifyCandidate(
      snapshot,
      {
        ...plan,
        namespaceDependencies: [{ nodeId: '4:1', prefix: 'p', uri: 'wrong' }],
      },
      () => true,
    ),
  );
});

test('namespace edits cannot silently reinterpret untouched descendants', () => {
  const snapshot = {
    uri: 'fixture:namespace',
    version: 1,
    source: '<a xmlns:p="urn:old"><p:b/></a>',
    eol: '\n' as const,
  };
  const start = snapshot.source.indexOf('urn:old');
  const plan: PatchPlan = {
    version: 1,
    patches: [
      {
        version: 1,
        start,
        end: start + 7,
        expected: 'urn:old',
        replacement: 'urn:new',
      },
    ],
    footprint: [{ start, end: start + 7 }],
    namespaceDependencies: [],
  };
  assert.throws(
    () => verifyCandidate(snapshot, plan, () => true),
    /namespace/i,
  );
});
