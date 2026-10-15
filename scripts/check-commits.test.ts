import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validCommitSubject } from './check-commits.js';

test('requires a shortcode, type and scope; accepts breaking subjects', () => {
  assert.ok(
    validCommitSubject(':sparkles: feat(parser)!: Preserve namespaces'),
  );
  for (const subject of [
    'feat(parser): Add tokens',
    ':sparkles: feat: Add tokens',
    '✨ feat(parser): Add tokens',
  ])
    assert.equal(validCommitSubject(subject), false);
});
