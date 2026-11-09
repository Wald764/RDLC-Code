import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  coverageAssertionReasons,
  coverageFileReasons,
  coverageFiles,
} from './coverage-assertions.js';

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

test('every coverage*.json file is loaded and checked against its own authority', () => {
  const root = mkdtempSync(join(tmpdir(), 'rdlc-coverage-files-'));
  try {
    mkdirSync(join(root, 'tests/desktop'), { recursive: true });
    mkdirSync(join(root, 'specs/one'), { recursive: true });
    mkdirSync(join(root, 'specs/two'), { recursive: true });
    writeFileSync(join(root, 'specs/one/spec.md'), '# one');
    writeFileSync(
      join(root, 'cases.spec.ts'),
      `test('real assertion', () => { expect(1).toBe(1); });`,
    );
    const row = (id: string, test: string) => ({
      id,
      fixtures: [],
      oracle: 'Independent expected state',
      tests: [`cases.spec.ts::${test}`],
    });
    const put = (name: string, content: unknown) =>
      writeFileSync(
        join(root, 'tests/desktop', name),
        typeof content === 'string' ? content : JSON.stringify(content),
      );
    put('coverage.json', {
      authority: { spec: 'specs/one/spec.md' },
      rows: [row('ONE.1', 'real assertion')],
    });
    put('coverage-two.json', {
      authority: 'specs/two/',
      rows: [row('TWO.1', 'real assertion')],
    });
    put('not-coverage.json', '{ not read');
    put('coverage-notes.md', 'not read');
    assert.deepEqual(coverageFileReasons(root), []);
    assert.deepEqual(coverageFiles(root), [
      'coverage-two.json',
      'coverage.json',
    ]);

    // A failing row in the second file is reported against that file only.
    put('coverage-two.json', {
      authority: 'specs/two/',
      rows: [row('TWO.1', 'invented assertion')],
    });
    const second = coverageFileReasons(root);
    assert.equal(second.length, 1);
    assert.match(
      second[0] ?? '',
      /^coverage-two\.json: TWO\.1: no executable test/,
    );

    // A failing row in the first file is reported even when the second is clean.
    put('coverage-two.json', {
      authority: 'specs/two/',
      rows: [row('TWO.1', 'real assertion')],
    });
    put('coverage.json', {
      authority: { spec: 'specs/one/spec.md' },
      rows: [row('ONE.1', 'invented assertion')],
    });
    const first = coverageFileReasons(root);
    assert.equal(first.length, 1);
    assert.match(first[0] ?? '', /^coverage\.json: ONE\.1: no executable test/);

    // Each file is judged by its own authority: missing, absent, escaping.
    put('coverage.json', {
      authority: { spec: 'specs/one/spec.md' },
      rows: [row('ONE.1', 'real assertion')],
    });
    for (const [authority, pattern] of [
      ['specs/missing/', /authority .*specs\/missing\/.*cannot resolve/],
      [undefined, /authority is missing/],
      ['..', /authority .*escapes the candidate/],
    ] as const) {
      put('coverage-two.json', {
        ...(authority === undefined ? {} : { authority }),
        rows: [row('TWO.1', 'real assertion')],
      });
      const reasons = coverageFileReasons(root);
      assert.equal(reasons.length, 1, String(authority));
      assert.match(reasons[0] ?? '', /^coverage-two\.json: /);
      assert.match(reasons[0] ?? '', pattern);
    }

    // Malformed JSON is a reason, not a crash, and does not hide the other file.
    put('coverage-two.json', '{ broken');
    const malformed = coverageFileReasons(root);
    assert.equal(malformed.length, 1);
    assert.match(malformed[0] ?? '', /^coverage-two\.json: cannot load/);

    // No coverage file at all is rejected rather than silently passing.
    rmSync(join(root, 'tests/desktop/coverage.json'));
    rmSync(join(root, 'tests/desktop/coverage-two.json'));
    assert.match(coverageFileReasons(root).join('\n'), /no coverage\*\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
