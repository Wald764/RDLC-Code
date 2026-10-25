import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverageAssertionReasons } from './coverage-assertions.js';

test('coverage resolves actual nonempty test declarations, not comments, skips or invented IDs', () => {
  const root = mkdtempSync(join(tmpdir(), 'rdlc-coverage-assertions-'));
  try {
    writeFileSync(
      join(root, 'cases.spec.ts'),
      `
      import { test } from 'playwright/test';
      // test('comment-only', () => { expect(true).toBe(true); });
      test('real assertion', async () => { expect(1).toBe(1); });
      test.skip('skipped assertion', () => { expect(1).toBe(1); });
      describe.skip('unrun suite', () => { test('nested skip', () => { expect(1).toBe(1); }); });
      test('node skip', { skip: true }, () => { assert.ok(true); });
      test('quoted skip', { 'skip': true }, () => { assert.ok(true); });
      test('empty assertion', () => {});
      const label = 'string-only';
      export async function run() { assert.ok(true); }
    `,
    );
    const check = (title: string) =>
      coverageAssertionReasons(root, {
        rows: [
          {
            id: 'US1.1',
            fixtures: [],
            oracle: 'Independent expected state',
            tests: [`cases.spec.ts::${title}`],
          },
        ],
      });
    assert.deepEqual(check('real assertion'), []);
    assert.match(check('run').join('\n'), /no executable test/);
    mkdirSync(join(root, 'tests/vscode'), { recursive: true });
    writeFileSync(
      join(root, 'tests/vscode/cases.test.ts'),
      'export async function run() { assert.ok(true); }',
    );
    assert.deepEqual(
      coverageAssertionReasons(root, {
        rows: [
          {
            id: 'host',
            fixtures: [],
            oracle: 'Expected host state',
            tests: ['tests/vscode/cases.test.ts::run'],
          },
        ],
      }),
      [],
    );
    for (const title of [
      'comment-only',
      'skipped assertion',
      'nested skip',
      'node skip',
      'quoted skip',
      'empty assertion',
      'string-only',
      'US1.1-fake-id',
    ])
      assert.match(check(title).join('\n'), /no executable test/);
    mkdirSync(join(root, 'nested'));
    assert.match(
      coverageAssertionReasons(join(root, 'nested'), {
        rows: [
          {
            id: 'boundary',
            fixtures: [],
            oracle: 'No outside input',
            tests: ['../cases.spec.ts::real assertion'],
          },
        ],
      }).join('\n'),
      /escapes the candidate/,
    );
    assert.match(
      coverageAssertionReasons(root, {
        rows: [
          {
            id: 'US1.2',
            fixtures: [],
            oracle: 'Expected state',
            tests: [
              'missing.spec.ts::title',
              'invalid',
              '../outside.spec.ts::title',
            ],
          },
        ],
      }).join('\n'),
      /cannot resolve/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
