import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  analyze,
  failingRows,
  strictProblems,
  firstErrorLine,
  loadReports,
  parseExpected,
  renderMarkdown,
  renderSummary,
  writeFlakeReport,
} from './flake-report.js';

const result = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  retry: 0,
  ...extra,
});

/** One spec per repeat entry, merged the way Playwright merges --repeat-each. */
const report = {
  suites: [
    {
      file: 'tests/desktop/data.spec.ts',
      specs: [
        {
          title: 'stable',
          file: 'tests/desktop/data.spec.ts',
          tests: [0, 1, 2, 3].map((repeatEachIndex) => ({
            repeatEachIndex,
            results: [result('passed')],
          })),
        },
        {
          title: 'flaky | pipe',
          file: 'tests/desktop/data.spec.ts',
          tests: [
            { results: [result('passed')] },
            {
              results: [
                result('failed', {
                  error: { message: '\u001b[31mExpected 1\u001b[0m\nmore' },
                }),
              ],
            },
            {
              results: [result('timedOut', { errors: [{ message: 'late' }] })],
            },
            { results: [result('passed')] },
          ],
        },
        {
          title: 'platform skipped',
          file: 'tests/desktop/data.spec.ts',
          tests: [
            {
              results: [
                result('skipped', {
                  annotations: [
                    { type: 'skip', description: 'UNVALIDATED here' },
                  ],
                }),
              ],
            },
          ],
        },
      ],
      suites: [
        {
          title: 'nested',
          specs: [
            {
              title: 'cut short',
              tests: [{ results: [result('interrupted')] }, { results: [] }],
            },
          ],
        },
      ],
    },
  ],
};

const status = {
  version: '1.142.0',
  mode: { probe: false, packaged: true, visual: false, group: 'core' },
  unvalidatedHostObserver: { platform: 'linux' },
  measurement: { repeatEach: 4, harnessErrors: [] },
};

test('counts runs, failures and rates per test and environment, worst first', () => {
  const summary = analyze([
    {
      path: 'flake-results-ubuntu-24.04-1.142.0-core-packaged/run-a/playwright-report.json',
      report,
      status,
    },
  ]);
  assert.equal(summary.repeatEach, 4);
  assert.deepEqual(
    summary.rows.map((row) => [row.title, row.runs, row.passes, row.failures]),
    [
      ['flaky | pipe', 4, 2, 2],
      ['stable', 4, 4, 0],
    ],
  );
  const flaky = summary.rows[0]!;
  assert.equal(flaky.failureRate, 0.5);
  assert.equal(flaky.timedOut, 1);
  assert.equal(flaky.firstError, 'Expected 1');
  assert.deepEqual(flaky.environment, {
    os: 'ubuntu-24.04',
    vscode: '1.142.0',
    group: 'core',
    mode: 'packaged',
  });
  const never = Object.fromEntries(
    summary.neverRan.map((row) => [row.title, row]),
  );
  assert.deepEqual(never['platform skipped']!.skipReasons, [
    'UNVALIDATED here',
  ]);
  assert.equal(never['cut short']!.interrupted, 1);
  assert.equal(never['cut short']!.skipped, 1);
  assert.equal(never['cut short']!.failureRate, null);
});

test('separates environments and falls back to the runner status labels', () => {
  const other = {
    ...status,
    version: 'stable',
    mode: { probe: true, packaged: true, group: 'core' },
    unvalidatedHostObserver: { platform: 'darwin' },
  };
  const summary = analyze([
    { path: 'a/playwright-report.json', report, status },
    { path: 'b/playwright-report.json', report, status: other },
  ]);
  const stable = summary.rows.filter((row) => row.title === 'stable');
  assert.deepEqual(
    stable
      .map(
        (row) =>
          `${row.environment.os}/${row.environment.vscode}/${row.environment.mode}`,
      )
      .sort(),
    ['linux/1.142.0/packaged', 'macos/stable/probe-packaged'],
  );
});

test('renders sorted markdown, escapes cells and lists harness errors', () => {
  const summary = analyze(
    [
      {
        path: 'a/playwright-report.json',
        report,
        status: {
          ...status,
          measurement: {
            repeatEach: 4,
            harnessErrors: ['no readable Playwright JSON report'],
          },
        },
      },
    ],
    ['broken/playwright-report.json'],
  );
  const markdown = renderMarkdown(summary);
  assert.match(markdown, /\| flaky \\\| pipe \| linux \|/);
  assert.match(markdown, /\| 4 \| 2 \| 2 \| 50\.0% \| Expected 1 \|/);
  assert.ok(markdown.indexOf('flaky') < markdown.indexOf('| stable |'));
  assert.match(markdown, /## Tests that never ran/);
  assert.match(markdown, /UNVALIDATED here/);
  assert.match(markdown, /## Harness errors/);
  assert.match(markdown, /broken\/playwright-report\.json/);
  assert.equal(firstErrorLine(undefined), null);
});

test('reads a report directory and writes the markdown and JSON outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rdlc-flake-'));
  try {
    const run = join(
      root,
      'in',
      'flake-results-windows-2022-stable-context-functional',
      'run-1',
    );
    await mkdir(run, { recursive: true });
    await writeFile(
      join(run, 'playwright-report.json'),
      JSON.stringify(report),
    );
    await writeFile(
      join(run, 'runner-status.json'),
      JSON.stringify({
        ...status,
        version: 'stable',
        mode: {
          probe: false,
          packaged: false,
          visual: false,
          group: 'context',
        },
      }),
    );
    await mkdir(join(root, 'in', 'bad'), { recursive: true });
    await writeFile(join(root, 'in', 'bad', 'playwright-report.json'), '{');
    const loaded = await loadReports(join(root, 'in'));
    assert.equal(loaded.loaded.length, 1);
    assert.deepEqual(loaded.unreadable, ['bad/playwright-report.json']);
    const written = await writeFlakeReport(join(root, 'in'), join(root, 'out'));
    assert.equal(written.rows[0]!.environment.os, 'windows-2022');
    assert.equal(written.rows[0]!.environment.mode, 'functional');
    const json = JSON.parse(
      await readFile(join(root, 'out/flake-report.json'), 'utf8'),
    );
    assert.equal(json.rows.length, 2);
    assert.match(
      await readFile(join(root, 'out/flake-report.md'), 'utf8'),
      /Desktop flake hunt/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const cleanReport = {
  suites: [
    {
      specs: [
        {
          title: 'solid',
          file: 'a.spec.ts',
          tests: [
            { results: [result('passed')] },
            { results: [result('passed')] },
          ],
        },
      ],
    },
  ],
};

test('flags incomplete and missing environments and keeps test failures non-fatal', () => {
  const expected = parseExpected({
    include: [
      {
        os: 'ubuntu-24.04',
        vscode: '1.142.0',
        group: 'core',
        mode: 'packaged',
      },
      { os: 'macos-15', vscode: 'stable', group: 'core', mode: 'functional' },
      {
        os: 'windows-2022',
        vscode: 'stable',
        group: 'context',
        mode: 'functional',
      },
    ],
  });
  const complete = analyze(
    [
      {
        path: 'flake-results-windows-2022-stable-context-functional/playwright-report.json',
        report: {
          ...cleanReport,
          suites: [
            {
              specs: [
                {
                  title: 'f',
                  file: 'a.spec.ts',
                  tests: [{ results: [result('failed')] }],
                },
              ],
            },
          ],
        },
        status: null,
      },
    ],
    [],
    [expected[2]!],
  );
  // A failing test alone is data, not an incomplete measurement.
  assert.equal(complete.complete, true);
  assert.equal(complete.rows[0]!.failureRate, 1);

  const summary = analyze(
    [
      {
        path: 'flake-results-ubuntu-24.04-1.142.0-core-packaged/run/playwright-report.json',
        report,
        status,
      },
    ],
    [],
    expected,
  );
  assert.equal(summary.complete, false);
  assert.deepEqual(
    summary.missing.map((item) => item.os),
    ['macos-15', 'windows-2022'],
  );
  assert.equal(summary.incomplete.length, 1);
  assert.match(summary.incomplete[0]!.reasons.join(';'), /1 interrupted/);
  assert.match(
    summary.incomplete[0]!.reasons.join(';'),
    /1 test\(s\) never started/,
  );
  const markdown = renderMarkdown(summary);
  assert.match(markdown, /INCOMPLETE MEASUREMENT/);
  assert.match(markdown, /macos-15 \/ stable \/ core \/ functional: no report/);
  assert.match(markdown, /\| INCOMPLETE \|/);
  assert.doesNotMatch(renderMarkdown(complete), /INCOMPLETE/);
});

test('the step summary is truncated to the top unstable tests and points to the artifact', () => {
  const specs = Array.from({ length: 60 }, (_, index) => ({
    title: `unstable ${String(index).padStart(2, '0')}`,
    file: 'a.spec.ts',
    tests: [{ results: [result('passed')] }, { results: [result('failed')] }],
  }));
  const full = analyze([
    {
      path: 'x/playwright-report.json',
      report: { suites: [{ specs }] },
      status: null,
    },
  ]);
  const text = renderSummary(full);
  assert.equal(text.match(/^\| unstable /gm)?.length, 25);
  assert.match(text, /top 25 of 60/);
  assert.match(text, /`flake-report` artifact/);
  assert.ok(Buffer.byteLength(text) < 1024 * 1024);
  assert.throws(() => parseExpected({}), /include/);
  assert.throws(() => parseExpected({ include: [{ os: 'x' }] }), /without/);
});

test('the strict gate counts every row with a failure and ignores passing rows', () => {
  const failing = analyze([
    {
      path: 'flake-results-ubuntu-24.04-1.142.0-core-functional/playwright-report.json',
      report: {
        suites: [
          {
            specs: [
              {
                title: 'ok',
                file: 'a.spec.ts',
                tests: [{ results: [result('passed')] }],
              },
              {
                title: 'bad',
                file: 'a.spec.ts',
                tests: [
                  { results: [result('passed')] },
                  { results: [result('timedOut')] },
                ],
              },
            ],
          },
        ],
      },
      status: null,
    },
  ]);
  assert.deepEqual(
    failingRows(failing).map((row) => row.title),
    ['bad'],
  );
  assert.deepEqual(failingRows(analyze([])), []);
});

test('the strict gate reports missing repetitions and skips outside the documented ones', () => {
  const entry = (tests: unknown[], repeatEach: number) =>
    analyze([
      {
        path: 'flake-results-ubuntu-24.04-1.142.0-core-functional/playwright-report.json',
        report: {
          suites: [{ specs: [{ title: 't', file: 'a.spec.ts', tests }] }],
        },
        status: { measurement: { repeatEach } },
      },
    ]);
  const pass = { results: [result('passed')] };
  const allowed = {
    results: [
      result('skipped', {
        annotations: [
          { type: 'skip', description: 'UNVALIDATED on darwin: x' },
        ],
      }),
    ],
  };
  assert.deepEqual(strictProblems(entry([pass, pass, pass], 3)), []);
  // Allowed skips count as repetitions.
  assert.deepEqual(strictProblems(entry([allowed, allowed, allowed], 3)), []);
  assert.match(
    strictProblems(entry([pass, pass], 3)).join(';'),
    /2 execution\(s\) for 3/,
  );
  assert.equal(strictProblems(entry([pass, pass, pass, pass], 3)).length, 1);
  const rogue = strictProblems(
    entry(
      [
        pass,
        pass,
        {
          results: [
            result('skipped', {
              annotations: [{ type: 'skip', description: 'flaky, skip it' }],
            }),
          ],
        },
      ],
      3,
    ),
  );
  assert.match(rogue.join(';'), /outside the documented skips: flaky/);
  // Without declared repeats only the skip reasons can be judged.
  assert.deepEqual(
    strictProblems(
      analyze([
        {
          path: 'x/playwright-report.json',
          report: {
            suites: [
              { specs: [{ title: 't', file: 'a.spec.ts', tests: [pass] }] },
            ],
          },
          status: null,
        },
      ]),
    ),
    [],
  );
});
