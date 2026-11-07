import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  dependentsOf,
  discoverTests,
  distOfTest,
  loadGraph,
  parseArgs,
  refusal,
  selectQa,
  type QaMode,
  type WorkspaceGraph,
} from './qa.js';

const node = (
  dir: string,
  deps: string[],
  scripts: string[] = [],
): [string, WorkspaceGraph[string]] => [
  dir,
  { name: `@rdlc/${dir.split('/')[1]}`, dir, deps, scripts },
];
const graph: WorkspaceGraph = Object.fromEntries([
  node('packages/report-model', []),
  node('packages/xml-parser', ['packages/report-model']),
  node('packages/xml-serializer', ['packages/report-model']),
  node('packages/expressions', ['packages/report-model']),
  node('packages/renderer', ['packages/report-model']),
  node('packages/validation', [
    'packages/report-model',
    'packages/expressions',
  ]),
  node(
    'apps/designer',
    ['packages/report-model', 'packages/renderer'],
    ['typecheck', 'test'],
  ),
  node('apps/vscode-extension', [
    'packages/report-model',
    'packages/xml-parser',
    'packages/xml-serializer',
    'packages/validation',
    'packages/expressions',
    'packages/renderer',
  ]),
]);
const tests = [
  'packages/report-model/src/components.test.ts',
  'packages/xml-parser/src/parser.test.ts',
  'packages/xml-serializer/src/serializer.test.ts',
  'packages/expressions/src/analyze.test.ts',
  'packages/renderer/src/render.test.ts',
  'packages/validation/src/tables.test.ts',
  'apps/vscode-extension/src/clipboard.test.ts',
  'scripts/check-commits.test.ts',
  'scripts/desktop-matrix.test.ts',
  'scripts/qa.test.ts',
  'scripts/validate-release.test.ts',
  'tests/desktop/driver.test.ts',
  'tests/desktop/run-tests.test.ts',
  'tests/roundtrip/lexical.test.ts',
  'tests/compatibility/tables.test.ts',
  'tests/performance/editor.test.ts',
  'tests/release/version.test.ts',
  'tests/package/contents.test.ts',
];
const options = { tests, exists: () => true };
const select = (mode: QaMode, files: string[]) =>
  selectQa(mode, files, graph, options);
const text = (steps: { command: string[] }[]) =>
  steps.map((step) => step.command.join(' ')).join('\n');
const nodeTestFiles = (mode: QaMode, files: string[]) =>
  select(mode, files).steps.find((step) => step.id === 'node-tests')?.command ??
  [];

test('source change in one package selects only relevant tests', () => {
  const selection = select('quick', ['packages/xml-parser/src/parser.ts']);
  assert.deepEqual(
    selection.steps.map((step) => step.id),
    ['prettier', 'eslint', 'compile', 'node-tests'],
  );
  assert.deepEqual(
    nodeTestFiles('quick', ['packages/xml-parser/src/parser.ts']),
    [
      'node',
      '--test',
      'dist/apps/vscode-extension/src/clipboard.test.js',
      'dist/tests/compatibility/tables.test.js',
      'dist/tests/roundtrip/lexical.test.js',
      'packages/xml-parser/dist/parser.test.js',
    ],
  );
  const text_ = text(selection.steps);
  assert.doesNotMatch(text_, /renderer|expressions|validation|designer/);
  assert.equal(
    selection.steps.filter((step) => step.id === 'compile').length,
    1,
  );
  assert.deepEqual(
    selection.steps.find((step) => step.id === 'prettier')?.command.slice(-1),
    ['packages/xml-parser/src/parser.ts'],
  );
});

test('report-model change includes dependents, designer and roundtrip', () => {
  const selection = select('quick', ['packages/report-model/src/report.ts']);
  const files = nodeTestFiles('quick', ['packages/report-model/src/report.ts']);
  for (const expected of [
    'packages/report-model/dist/components.test.js',
    'packages/xml-parser/dist/parser.test.js',
    'packages/xml-serializer/dist/serializer.test.js',
    'packages/expressions/dist/analyze.test.js',
    'packages/renderer/dist/render.test.js',
    'packages/validation/dist/tables.test.js',
    'dist/apps/vscode-extension/src/clipboard.test.js',
    'dist/tests/roundtrip/lexical.test.js',
    'dist/tests/compatibility/tables.test.js',
  ])
    assert.ok(files.includes(expected), expected);
  assert.ok(
    selection.steps.some(
      (step) => text([step]) === 'pnpm --filter @rdlc/designer typecheck',
    ),
  );
  assert.ok(
    selection.steps.some(
      (step) => text([step]) === 'pnpm --filter @rdlc/designer test',
    ),
  );
  assert.deepEqual(dependentsOf(graph, 'packages/renderer'), [
    'apps/designer',
    'apps/vscode-extension',
  ]);
});

test('a renderer change does not run the round-trip suites and designer-only changes skip the compile', () => {
  const renderer = nodeTestFiles('quick', ['packages/renderer/src/render.ts']);
  assert.ok(!renderer.some((file) => file.includes('roundtrip')));
  const designer = select('quick', ['apps/designer/src/app/app.ts']);
  assert.deepEqual(
    designer.steps.map((step) => step.id),
    ['prettier', 'eslint', 'typecheck:@rdlc/designer', 'test:@rdlc/designer'],
  );
});

test('script changes select their own test, release scripts add the release tests', () => {
  assert.deepEqual(nodeTestFiles('quick', ['scripts/desktop-matrix.ts']), [
    'node',
    '--test',
    'dist/scripts/desktop-matrix.test.js',
  ]);
  const release = nodeTestFiles('quick', ['scripts/validate-release.ts']);
  assert.ok(release.includes('dist/scripts/validate-release.test.js'));
  assert.ok(release.includes('dist/tests/release/version.test.js'));
  const untested = nodeTestFiles('quick', ['scripts/build.ts']);
  assert.ok(untested.includes('dist/scripts/check-commits.test.js'));
});

test('desktop changes run only the unit tests and print the Playwright hint', () => {
  const selection = select('quick', ['tests/desktop/data.spec.ts']);
  assert.deepEqual(nodeTestFiles('quick', ['tests/desktop/data.spec.ts']), [
    'node',
    '--test',
    'dist/tests/desktop/driver.test.js',
    'dist/tests/desktop/run-tests.test.js',
  ]);
  assert.match(
    selection.notes.join('\n'),
    /playwright test --config tests\/desktop\/playwright\.config\.ts data\.spec\.ts/,
  );
});

test('docs-only change runs format only', () => {
  const selection = select('quick', ['docs/qa.md', 'README.md']);
  assert.deepEqual(
    selection.steps.map((step) => step.id),
    ['prettier'],
  );
  assert.deepEqual(selection.steps[0]?.command.slice(-2), [
    'README.md',
    'docs/qa.md',
  ]);
});

test('no change runs nothing and deleted files are not formatted', () => {
  const none = select('quick', []);
  assert.deepEqual(none.steps, []);
  assert.match(none.notes.join(), /nothing to run/i);
  const deleted = selectQa('quick', ['docs/gone.md'], graph, {
    tests,
    exists: () => false,
  });
  assert.deepEqual(deleted.steps, []);
});

test('unknown path broadens conservatively', () => {
  for (const file of [
    'something/unknown.bin',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.base.json',
    'eslint.config.ts',
    'tests/fixtures/xml/a.rdlc',
  ]) {
    const selection = select('quick', [file]);
    const files = nodeTestFiles('quick', [file]);
    assert.ok(files.includes('dist/scripts/qa.test.js'), file);
    assert.ok(files.includes('packages/renderer/dist/render.test.js'), file);
    assert.ok(files.includes('dist/tests/release/version.test.js'), file);
    assert.ok(files.includes('dist/tests/performance/editor.test.js'), file);
    assert.ok(!files.some((f) => f.includes('tests/package')), file);
    assert.ok(
      selection.steps.some((step) => step.id === 'test:@rdlc/designer'),
      file,
    );
    assert.match(selection.notes.join(), /Broadened/);
  }
});

test('workflow changes select release and script tests', () => {
  const files = nodeTestFiles('quick', ['.github/workflows/ci.yml']);
  assert.ok(files.includes('dist/tests/release/version.test.js'));
  assert.ok(files.includes('dist/scripts/desktop-matrix.test.js'));
});

test('no Desktop, VS Code or package commands in quick or integration for any input', () => {
  const inputs = [
    [],
    ['docs/a.md'],
    ['packages/report-model/src/report.ts'],
    ['apps/vscode-extension/src/extension.ts'],
    ['apps/designer/src/app/app.ts'],
    ['scripts/qa.ts'],
    ['tests/desktop/data.spec.ts'],
    ['tests/vscode/activation.test.ts'],
    ['tests/package/contents.test.ts'],
    ['.github/workflows/ci.yml'],
    ['package.json'],
    ['unknown/file.txt'],
  ];
  const forbidden =
    /playwright|test:e2e|test:visual|test:package|dist\/tests\/package\/|dist\/scripts\/(?:package|download-vscode)\.js|dist\/tests\/desktop\/run-tests\.js|\.vsix/;
  const host = /dist\/tests\/vscode\//;
  for (const files of inputs) {
    const quick = text(select('quick', files).steps);
    assert.doesNotMatch(quick, forbidden, files.join());
    assert.doesNotMatch(quick, host, files.join());
    assert.doesNotMatch(quick, /dist\/scripts\/build\.js/, files.join());
    const integration = text(select('integration', files).steps);
    assert.doesNotMatch(integration, forbidden, files.join());
  }
});

test('integration runs the broad set and the VS Code host only when the extension is affected', () => {
  const hostRun = (files: string[]) =>
    text(select('integration', files).steps).includes(
      'node dist/tests/vscode/run-tests.js',
    );
  assert.equal(hostRun(['packages/report-model/src/report.ts']), true);
  assert.equal(hostRun(['apps/vscode-extension/src/extension.ts']), true);
  assert.equal(hostRun(['tests/vscode/activation.test.ts']), true);
  assert.equal(hostRun(['package.json']), true);
  assert.equal(hostRun(['docs/a.md']), false);
  assert.equal(hostRun(['scripts/qa.ts']), false);
  assert.equal(hostRun(['apps/designer/src/app/app.ts']), false);
  assert.equal(hostRun([]), false);
  const ids = select('integration', ['docs/a.md']).steps.map((s) => s.id);
  assert.deepEqual(ids, [
    'prettier',
    'eslint',
    'compile',
    'typecheck:@rdlc/designer',
    'node-tests',
    'test:@rdlc/designer',
    'build',
  ]);
});

test('release keeps to the critical release checks and optionally validates a tag', () => {
  const plain = select('release', []);
  assert.deepEqual(
    plain.steps.map((step) => step.id),
    ['compile', 'release-tests', 'build', 'package', 'package-tests'],
  );
  assert.doesNotMatch(text(plain.steps), /playwright|desktop\/run-tests/);
  const tagged = selectQa('release', [], graph, { tests, tag: 'v0.3.0' });
  assert.equal(
    tagged.steps.at(-1)?.command.join(' '),
    'node dist/scripts/validate-release.js v0.3.0',
  );
});

test('full requires --confirm-full and never starts from quick or integration', () => {
  assert.match(
    refusal(parseArgs(['full'])) ?? '',
    /--confirm-full.*GitHub Actions/s,
  );
  assert.equal(refusal(parseArgs(['full', '--confirm-full'])), undefined);
  assert.equal(refusal(parseArgs(['full', '--plan'])), undefined);
  assert.equal(refusal(parseArgs(['quick'])), undefined);
  assert.throws(() => parseArgs(['quick', '--confirm-full']), /only valid/);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./qa.js', import.meta.url)), 'full'],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GitHub Actions/);
  const full = select('full', []).steps.map((step) => step.id);
  for (const id of [
    'package',
    'test:vscode',
    'test:package',
    'test:e2e',
    'test:visual',
  ])
    assert.ok(full.includes(id), id);
});

test('arguments are validated', () => {
  assert.deepEqual(parseArgs(['quick', '--plan', '--base', 'origin/main']), {
    mode: 'quick',
    plan: true,
    confirmFull: false,
    base: 'origin/main',
    tag: undefined,
  });
  assert.equal(parseArgs(['--', 'quick', '--base=main']).base, 'main');
  assert.equal(parseArgs(['quick', '--base', 'HEAD~3']).base, 'HEAD~3');
  for (const bad of [
    [],
    ['nope'],
    ['quick', '--wat'],
    ['quick', '--base', '--output=x'],
    ['quick', '--base', 'a..b'],
    ['quick', '--base=-x'],
    ['quick', '--tag', 'v1.0.0'],
    ['release', '--tag', '1.0'],
  ])
    assert.throws(() => parseArgs(bad), Error, bad.join(' '));
  assert.equal(parseArgs(['release', '--tag', 'v1.2.3']).tag, 'v1.2.3');
});

test('the real workspace graph and test index follow the repository', () => {
  const real = loadGraph();
  assert.deepEqual(real['packages/validation']?.deps, [
    'packages/expressions',
    'packages/report-model',
  ]);
  assert.ok(
    dependentsOf(real, 'packages/report-model').includes('apps/designer'),
  );
  assert.ok(real['apps/designer']?.scripts.includes('typecheck'));
  assert.ok(discoverTests(process.cwd(), real).includes('scripts/qa.test.ts'));
  assert.equal(
    distOfTest('packages/renderer/src/render.test.ts'),
    'packages/renderer/dist/render.test.js',
  );
  assert.equal(distOfTest('scripts/qa.test.ts'), 'dist/scripts/qa.test.js');
});
