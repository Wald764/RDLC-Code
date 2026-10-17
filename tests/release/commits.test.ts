import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommit } from '../../scripts/check-commits.js';

test('scoped gitmoji commits preserve Conventional Commit breaking semantics', () => {
  assert.deepEqual(parseCommit(':sparkles: feat(editor)!: Add tables'), {
    type: 'feat',
    scope: 'editor',
    breaking: true,
  });
  assert.deepEqual(
    parseCommit(
      ':bug: fix(parser): Retain source\n\nBREAKING CHANGE: Reject old files',
    ),
    { type: 'fix', scope: 'parser', breaking: true },
  );
  assert.equal(
    parseCommit(':memo: docs(release): Explain recovery')?.breaking,
    false,
  );
  for (const subject of [
    'feat(editor): Add tables',
    '✨ feat(editor): Add tables',
    ':sparkles: feat: Add tables',
    ':bug: fix(editor): ',
    ':bug: fix(editor): Add tables\nInjected subject',
  ])
    assert.equal(parseCommit(subject), null);
});
