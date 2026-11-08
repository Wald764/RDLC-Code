import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CANDIDATE_CELL_CHECKS,
  DESKTOP_CELL_CHECKS,
  EXPECTED_MATRIX,
  VISUAL_CELL_CHECKS,
  expectedChecks,
  type CellCheck,
} from '../tests/desktop/qa-classification.js';
import {
  collectTests,
  evaluatePr,
  loadStability,
  evaluateRelease,
  loadCells,
  renderMarkdown,
  runCli,
  type CellEvidence,
  type CellJson,
  type JobResults,
  type QaSummary,
  type StabilityRun,
} from './qa-gate.js';
import { collectCell } from './qa-collect.js';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const VSIX = 'c'.repeat(64);

const SUITES: Record<string, readonly string[]> = {
  probe: [
    'bootstrap.spec.ts',
    'security-observer.spec.ts',
    'native-drag.spec.ts',
  ],
  core: [
    'bootstrap.spec.ts',
    'workspace.spec.ts',
    'structure.spec.ts',
    'data.spec.ts',
    'coverage.spec.ts',
  ],
  authoring: [
    'components.spec.ts',
    'native-drag.spec.ts',
    'accessibility.spec.ts',
    'layout.spec.ts',
    'offline.spec.ts',
    'images.spec.ts',
  ],
  context: ['context.spec.ts'],
  visual: ['visual.spec.ts', 'layout.spec.ts'],
  // The installed run of a candidate covers every group (no `group` in its mode).
  candidate: [
    'bootstrap.spec.ts',
    'workspace.spec.ts',
    'structure.spec.ts',
    'data.spec.ts',
    'coverage.spec.ts',
    'components.spec.ts',
    'native-drag.spec.ts',
    'accessibility.spec.ts',
    'layout.spec.ts',
    'offline.spec.ts',
    'images.spec.ts',
    'context.spec.ts',
  ],
};

function report(files: readonly string[]) {
  return {
    stats: { expected: files.length, unexpected: 0, skipped: 0, flaky: 0 },
    suites: files.map((file) => ({
      file,
      specs: [
        {
          id: `${file}-1`,
          title: `${file.replace('.spec.ts', '')}-journey`,
          file,
          tests: [
            {
              expectedStatus: 'passed',
              status: 'expected',
              results: [{ status: 'passed' }],
            },
          ],
        },
      ],
    })),
  };
}

function run(
  kind: 'probe' | 'functional' | 'installed' | 'visual',
  files: readonly string[],
  name = `run-${kind}`,
) {
  return {
    name,
    status: {
      mode: {
        probe: kind === 'probe',
        packaged: kind === 'probe' || kind === 'installed',
        visual: kind === 'visual',
        updateBaselines: false,
        group: null,
      },
      required: [...files],
      missing: [],
      runnerExitCode: 0,
      reportComplete: true,
      validated: true,
      probeComplete: true,
      unvalidatedHostObserver: {
        platform: 'linux',
        supported: true,
        skipped: [],
      },
      unvalidatedPlatformSkips: { platform: 'linux', skipped: [] },
    } as Record<string, unknown>,
    report: report(files) as Record<string, unknown>,
  };
}

function green(
  checks: readonly CellCheck[],
  cell: Omit<CellJson, 'schema' | 'steps' | 'candidate'> & {
    candidate?: string;
  },
  suites: (check: CellCheck) => readonly string[],
): CellEvidence {
  const steps: Record<string, string> = {};
  const runs = [];
  for (const { check, step } of expectedChecks(
    checks,
    cell.os,
    cell.group ?? null,
  )) {
    steps[step] = 'success';
    if (check.run) runs.push(run(check.run, suites(check), `run-${check.id}`));
  }
  return { cell: { schema: 1, candidate: SHA, steps, ...cell }, runs };
}

const desktopSuites = (group: string) => (check: CellCheck) =>
  check.run === 'probe' ? SUITES['probe']! : SUITES[group]!;

function desktopCells(): CellEvidence[] {
  const cells: CellEvidence[] = [];
  for (const os of EXPECTED_MATRIX.os)
    for (const vscode of EXPECTED_MATRIX.vscode)
      for (const group of EXPECTED_MATRIX.group)
        cells.push(
          green(
            DESKTOP_CELL_CHECKS,
            { kind: 'desktop', os, vscode, group },
            desktopSuites(group),
          ),
        );
  cells.push(
    green(
      VISUAL_CELL_CHECKS,
      { kind: 'visual', os: 'ubuntu-24.04', vscode: '1.142.0' },
      () => SUITES['visual']!,
    ),
  );
  return cells;
}

const prJobs = (overrides: JobResults = {}): JobResults => ({
  quality: 'success',
  desktop: 'success',
  visual: 'success',
  'changed-specs': 'success',
  stability: 'success',
  ...overrides,
});

const pr = (
  cells: CellEvidence[],
  jobs: JobResults = prJobs(),
  candidate = SHA,
): QaSummary => evaluatePr({ candidate, jobs, cells });

function cellOf(
  cells: CellEvidence[],
  os: string,
  vscode: string,
  group: string,
): CellEvidence {
  const found = cells.find(
    (c) =>
      c.cell.kind === 'desktop' &&
      c.cell.os === os &&
      c.cell.vscode === vscode &&
      c.cell.group === group,
  );
  assert.ok(found);
  return found;
}

/** Mark one test of a run as failed and the step that ran it as failed. */
function failTest(
  evidence: CellEvidence,
  runName: string,
  step: string,
  file: string,
  title: string,
  message = 'Error: expect(locator).toBeVisible() failed',
  errorExtra: Record<string, unknown> = {},
): void {
  const target = evidence.runs.find((r) => r.name === runName);
  assert.ok(target, runName);
  const suites = (target.report as ReturnType<typeof report>).suites as {
    file: string;
    specs: { title: string; file: string; tests: Record<string, unknown>[] }[];
  }[];
  const suite = suites.find((s) => s.file === file);
  assert.ok(suite, file);
  suite.specs.push({
    title,
    file,
    tests: [
      {
        expectedStatus: 'passed',
        status: 'unexpected',
        results: [{ status: 'failed', error: { message, ...errorExtra } }],
      },
    ],
  });
  evidence.cell.steps[step] = 'failure';
  // What the real runner records as soon as one test fails (run-tests.ts):
  // a non-zero exit, an incomplete report and a run that is not validated.
  Object.assign(target.status as Record<string, unknown>, {
    runnerExitCode: 1,
    reportComplete: false,
    validated: false,
  });
}

// Realistic Playwright failure messages (custom message first, then the matcher).
const BUDGET =
  'expect(received).toBeGreaterThanOrEqual(expected)\n\nExpected: >= 95\nReceived: 87';
const SCALE =
  'the interface scale returns to the launched baseline\n\nexpect(received).toBeLessThanOrEqual(expected)\n\nExpected: <= 0.005\nReceived: 1';
const DRIFT =
  'nativeViewResize: unintended canvas origin drift within budget\n\nexpect(received).toBeLessThanOrEqual(expected)\n\nExpected: <= 1\nReceived: 3';
const SCREENSHOT =
  'US6.2 themes reference\n\nScreenshot comparison failed:\n\n  1432 pixels (ratio 0.02 of all image pixels) are different.\n\nExpected: /ref/a.png\nReceived: /out/a.png';

test('green evidence is mergeable and the summary has the documented shape', () => {
  const summary = pr(desktopCells());
  assert.equal(summary.status, 'MERGEABLE');
  assert.deepEqual(
    Object.keys(summary).sort(),
    [
      'accepted',
      'blocking',
      'candidate',
      'informational',
      'missing',
      'mode',
      'status',
      'unvalidated',
    ].sort(),
  );
  assert.equal(summary.candidate, SHA);
  assert.equal(summary.mode, 'pr');
  for (const list of [
    summary.blocking,
    summary.informational,
    summary.missing,
    summary.accepted,
    summary.unvalidated,
  ])
    assert.deepEqual(list, []);
});

test('a critical Desktop test failure makes the PR NOT MERGEABLE', () => {
  const cells = desktopCells();
  failTest(
    cellOf(cells, 'ubuntu-24.04', '1.142.0', 'authoring'),
    'run-e2e-functional',
    'e2e-linux',
    'components.spec.ts',
    'US4.2-insert-once',
  );
  const summary = pr(cells, prJobs({ desktop: 'failure' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.deepEqual(
    summary.blocking.map((item) => item.id),
    ['components.spec.ts::US4.2-insert-once'],
  );
  assert.equal(summary.blocking[0]!.scope, 'ubuntu-24.04/1.142.0/authoring');
  assert.equal(runCliExit(summary), 1);
});

const runCliExit = (summary: QaSummary): number =>
  summary.status === 'NOT MERGEABLE' || summary.status === 'NOT PUBLISHABLE'
    ? 1
    : 0;

test('an informational Desktop test failure keeps the PR MERGEABLE and is listed', () => {
  const cells = desktopCells();
  failTest(
    cellOf(cells, 'macos-15', 'stable', 'authoring'),
    'run-e2e-functional',
    'e2e-other',
    'layout.spec.ts',
    'FR-028-scaling',
    SCALE,
  );
  failTest(
    cellOf(cells, 'ubuntu-24.04', 'stable', 'core'),
    'run-e2e-installed',
    'installed-linux',
    'structure.spec.ts',
    'SC-003-timing',
    BUDGET,
  );
  const summary = pr(cells, prJobs({ desktop: 'failure' }));
  assert.equal(summary.status, 'MERGEABLE');
  assert.deepEqual(summary.blocking, []);
  assert.deepEqual(summary.informational.map((item) => item.id).sort(), [
    'layout.spec.ts::FR-028-scaling',
    'structure.spec.ts::SC-003-timing',
  ]);
  for (const item of summary.informational)
    assert.ok(item.justification, 'justification is reported');
  assert.match(renderMarkdown(summary), /MERGEABLE/);
});

test('a critical failure beside an informational one still blocks, and unexplained step failures block', () => {
  const cells = desktopCells();
  const cell = cellOf(cells, 'windows-2022', '1.142.0', 'authoring');
  failTest(
    cell,
    'run-e2e-functional',
    'e2e-other',
    'layout.spec.ts',
    'US6.3-frame-stability',
    DRIFT,
  );
  failTest(
    cell,
    'run-e2e-functional',
    'e2e-other',
    'accessibility.spec.ts',
    'US6.1-keyboard-journey',
  );
  // A correctness failure of SC-003-timing is not the timing budget.
  const timing = cellOf(cells, 'ubuntu-24.04', '1.142.0', 'core');
  failTest(
    timing,
    'run-e2e-functional',
    'e2e-linux',
    'structure.spec.ts',
    'SC-003-timing',
    'Error: expect(locator).toBeVisible() failed',
  );
  // A step failure the report cannot explain.
  cellOf(cells, 'ubuntu-24.04', '1.142.0', 'context').cell.steps[
    'installed-linux'
  ] = 'failure';
  const summary = pr(cells, prJobs({ desktop: 'failure' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  const ids = summary.blocking.map((item) => item.id).sort();
  assert.deepEqual(ids, [
    'accessibility.spec.ts::US6.1-keyboard-journey',
    'cell:e2e-installed',
    'structure.spec.ts::SC-003-timing',
  ]);
  assert.deepEqual(
    summary.informational.map((item) => item.id),
    ['layout.spec.ts::US6.3-frame-stability'],
  );
});

test('a failed build, package, provisioning or host suite blocks; skipped steps are not success', () => {
  for (const [step, id] of [
    ['build', 'cell:build'],
    ['package', 'cell:package'],
    ['download-vscode', 'cell:vscode-provisioning'],
    ['vscode-linux', 'cell:vscode-host'],
    ['package-tests-linux', 'cell:package-tests'],
    ['prepare-linux', 'cell:linux-environment'],
  ] as const) {
    for (const outcome of ['failure', 'skipped', 'cancelled']) {
      const cells = desktopCells();
      cellOf(cells, 'ubuntu-24.04', '1.142.0', 'core').cell.steps[step] =
        outcome;
      const summary = pr(cells, prJobs({ desktop: 'failure' }));
      assert.equal(summary.status, 'NOT MERGEABLE', `${step} ${outcome}`);
      assert.ok(
        summary.blocking.some((item) => item.id === id),
        id,
      );
    }
  }
});

test('missing critical evidence blocks: missing cell, missing report, missing step result, skipped desktop job', () => {
  const dropped = desktopCells().filter(
    (c) =>
      !(
        c.cell.os === 'macos-15' &&
        c.cell.vscode === 'stable' &&
        c.cell.group === 'context'
      ),
  );
  let summary = pr(dropped, prJobs({ desktop: 'success' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.deepEqual(
    summary.missing.map((item) => [item.id, item.scope]),
    [['cell:evidence', 'macos-15/stable/context']],
  );

  const noReport = desktopCells();
  cellOf(noReport, 'windows-2022', 'stable', 'core').runs = [];
  summary = pr(noReport);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.deepEqual(
    summary.missing.map((item) => item.id),
    ['cell:probe', 'cell:e2e-functional', 'cell:e2e-installed'],
  );

  const noStep = desktopCells();
  delete cellOf(noStep, 'ubuntu-24.04', 'stable', 'core').cell.steps['package'];
  summary = pr(noStep);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.ok(summary.missing.some((item) => item.id === 'cell:package'));

  const truncated = desktopCells();
  const cell = cellOf(truncated, 'ubuntu-24.04', 'stable', 'authoring');
  (cell.runs[0]!.status as { required: string[] }).required.push(
    'extra.spec.ts',
  );
  summary = pr(truncated);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.missing[0]!.detail, /spec files absent/);

  summary = pr([], prJobs({ quality: 'failure', desktop: 'skipped' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.deepEqual(
    summary.missing.map((item) => item.id),
    ['job:desktop'],
    'one entry instead of one per cell',
  );
  assert.deepEqual(
    summary.blocking.map((item) => item.id),
    ['job:quality'],
  );
});

test('job classification: quality and changed-specs are critical, visual is informational, Required inputs fail closed', () => {
  let summary = pr(desktopCells(), prJobs({ visual: 'failure' }));
  assert.equal(summary.status, 'MERGEABLE');
  assert.deepEqual(
    summary.informational.map((i) => i.id),
    ['job:visual'],
  );
  // Its failure means the stability evidence is missing.
  summary = pr(desktopCells(), prJobs({ 'changed-specs': 'failure' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.deepEqual(
    summary.blocking.map((i) => i.id),
    ['job:changed-specs'],
  );
  summary = pr(desktopCells(), prJobs({ quality: 'cancelled' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  summary = pr(desktopCells(), prJobs({ brand_new_job: 'failure' }));
  assert.equal(summary.status, 'NOT MERGEABLE', 'unknown jobs are critical');
  summary = pr(desktopCells(), { quality: 'success' });
  assert.equal(summary.status, 'NOT MERGEABLE', 'desktop result is required');
});

test('a critical test inside the informational visual job still blocks, its layout failures do not', () => {
  const cells = desktopCells();
  const visual = cells.find((c) => c.cell.kind === 'visual')!;
  failTest(
    visual,
    'run-visual',
    'visual',
    'visual.spec.ts',
    'US6.2-themes',
    SCREENSHOT,
  );
  let summary = pr(cells, prJobs({ visual: 'failure' }));
  assert.equal(summary.status, 'MERGEABLE');
  assert.ok(summary.informational.some((i) => i.id.endsWith('US6.2-themes')));
  (visual.runs[0]!.report as ReturnType<typeof report>).suites.push(
    ...(report(['workspace.spec.ts']) as ReturnType<typeof report>).suites.map(
      (suite) => {
        suite.specs[0]!.tests[0] = {
          expectedStatus: 'passed',
          status: 'unexpected',
          results: [{ status: 'failed' }],
        } as never;
        return suite;
      },
    ),
  );
  summary = pr(cells, prJobs({ visual: 'failure' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.deepEqual(
    summary.blocking.map((i) => i.id),
    ['workspace.spec.ts::workspace-journey'],
  );
});

test('a candidate SHA mismatch is blocking', () => {
  const cells = desktopCells();
  cellOf(cells, 'ubuntu-24.04', '1.142.0', 'core').cell.candidate = OTHER;
  const summary = pr(cells);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.equal(summary.blocking[0]!.id, 'candidate-sha');
});

test('documented platform skips are UNVALIDATED, never blocking and never failures', () => {
  const cells = desktopCells();
  const context = cellOf(cells, 'macos-15', '1.142.0', 'context');
  const first = context.runs[0]!;
  const suites = (first.report as ReturnType<typeof report>).suites;
  suites[0]!.specs.push({
    id: 'skip-1',
    title: 'US5.3-two-views',
    file: 'context.spec.ts',
    tests: [
      {
        expectedStatus: 'skipped',
        status: 'skipped',
        results: [{ status: 'skipped' }],
      },
    ],
  } as never);
  const summary = pr(cells);
  assert.equal(summary.status, 'MERGEABLE');
  assert.deepEqual(
    summary.unvalidated.map((i) => i.id),
    ['context.spec.ts::US5.3-two-views'],
  );
});

/** Add one skipped test (as Playwright reports it) to the first run of a cell. */
function addSkip(evidence: CellEvidence, file: string, title: string): void {
  const suites = (evidence.runs[0]!.report as ReturnType<typeof report>).suites;
  suites[0]!.specs.push({
    id: `skip-${title}`,
    title,
    file,
    tests: [
      {
        expectedStatus: 'skipped',
        status: 'skipped',
        results: [{ status: 'skipped' }],
      },
    ],
  } as never);
}

test('the gate verifies skips itself: file, title and platform, whatever the runner reports', () => {
  const lie = (evidence: CellEvidence, title: string) => {
    const status = evidence.runs[0]!.status as {
      unvalidatedPlatformSkips: { skipped: string[] };
      unvalidatedHostObserver: { skipped: string[] };
    };
    status.unvalidatedPlatformSkips.skipped = [title];
    status.unvalidatedHostObserver.skipped = [title];
  };
  const cases: [string, string, string, string, boolean][] = [
    // os, vscode, file, title, allowed
    ['macos-15', 'stable', 'context.spec.ts', 'US5.3-two-views', true],
    [
      'windows-2022',
      'stable',
      'offline.spec.ts',
      'SC-009-monitored-offline',
      true,
    ],
    ['macos-15', 'stable', 'offline.spec.ts', 'SC-009-monitored-offline', true],
    // Wrong platform: the macOS-only skip on Linux and Windows.
    ['ubuntu-24.04', 'stable', 'context.spec.ts', 'US5.3-two-views', false],
    ['windows-2022', 'stable', 'context.spec.ts', 'US5.3-two-views', false],
    // The host observer exists on Linux: no skip there.
    [
      'ubuntu-24.04',
      'stable',
      'offline.spec.ts',
      'SC-009-monitored-offline',
      false,
    ],
    // Wrong file for an allowlisted title.
    ['macos-15', 'stable', 'components.spec.ts', 'US5.3-two-views', false],
    // A title that is not allowlisted at all.
    ['macos-15', 'stable', 'context.spec.ts', 'US5.2-anything', false],
    [
      'macos-15',
      'stable',
      'accessibility.spec.ts',
      'US6.1-keyboard-journey',
      false,
    ],
  ];
  for (const [os, vscode, file, title, allowed] of cases) {
    const cells = desktopCells();
    const cell = cellOf(
      cells,
      os,
      vscode,
      file === 'context.spec.ts' ? 'context' : 'core',
    );
    addSkip(cell, file, title);
    // The runner claims the skip is fine either way.
    lie(cell, title);
    const summary = pr(cells);
    const label = `${os} ${file}::${title}`;
    if (allowed) {
      assert.equal(summary.status, 'MERGEABLE', label);
      assert.deepEqual(
        summary.unvalidated.map((i) => i.id),
        [`${file}::${title}`],
        label,
      );
    } else {
      assert.equal(summary.status, 'NOT MERGEABLE', label);
      assert.ok(
        summary.blocking.some((i) => i.id === `${file}::${title}`),
        label,
      );
      assert.deepEqual(summary.unvalidated, [], label);
    }
  }
});

test('only the error message decides a failure signature, never the snippet, and every error must match', () => {
  const cells = desktopCells();
  // The snippet quotes the timing assertion next to a source-bytes failure.
  failTest(
    cellOf(cells, 'ubuntu-24.04', '1.142.0', 'core'),
    'run-e2e-functional',
    'e2e-linux',
    'structure.spec.ts',
    'SC-003-timing',
    'expect(received).toBe(expected) // Object.is equality\n\nExpected: "<a/>"\nReceived: "<b/>"',
    {
      snippet:
        '  631 | .toBe(original);\n> 634 | ).toBeGreaterThanOrEqual(95);\n\nExpected: >= 95\nReceived: 88',
      stack: 'Error: Expected: >= 95\nReceived: 88',
    },
  );
  // Two errors: the budget one and a no-edit one.
  const target = cellOf(cells, 'ubuntu-24.04', 'stable', 'authoring');
  failTest(
    target,
    'run-e2e-functional',
    'e2e-linux',
    'layout.spec.ts',
    'FR-029-stability',
    SCALE,
  );
  const spec = (
    target.runs.find((r) => r.name === 'run-e2e-functional')!
      .report as ReturnType<typeof report>
  ).suites
    .find((suite) => suite.file === 'layout.spec.ts')!
    .specs.at(-1)!;
  (spec.tests[0] as { results: { errors?: unknown }[] }).results[0]!.errors = [
    { message: SCALE },
    { message: 'a refused edit stays uncommitted\n\nExpected: 0\nReceived: 1' },
  ];
  const summary = pr(cells, prJobs({ desktop: 'failure' }));
  assert.deepEqual(summary.informational, []);
  assert.deepEqual(summary.blocking.map((item) => item.id).sort(), [
    'layout.spec.ts::FR-029-stability',
    'structure.spec.ts::SC-003-timing',
  ]);
});

test('a derived job that failed with nothing to explain it blocks (desktop, candidate-qa, quality, stability)', () => {
  let summary = pr(desktopCells(), prJobs({ desktop: 'failure' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.deepEqual(
    summary.blocking.map((item) => item.id),
    ['job:desktop'],
  );
  assert.match(summary.blocking[0]!.detail, /unexplained job failure/);

  summary = release({ jobs: releaseJobs({ 'candidate-qa': 'failure' }) });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.deepEqual(
    summary.blocking.map((item) => item.id),
    ['job:candidate-qa'],
  );

  summary = release({ jobs: releaseJobs({ quality: 'failure' }) });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.deepEqual(
    summary.blocking.map((item) => item.id),
    ['job:quality'],
  );
  // The CI summary listing an informational failure explains it.
  summary = release({
    jobs: releaseJobs({ quality: 'failure' }),
    ci: [
      ciFile(
        ciSummary({
          informational: [{ id: 'job:visual', kind: 'job', detail: 'failed' }],
        }),
      ),
    ],
    readiness: record({ qaExceptions: [exception('job:visual')] }),
  });
  assert.equal(summary.status, 'PUBLISHABLE');
});

test('runner-status.json is read: a non-zero exit with no failing test blocks, an incomplete report is missing evidence', () => {
  let cells = desktopCells();
  const run = (list: CellEvidence[]) =>
    cellOf(list, 'ubuntu-24.04', '1.142.0', 'authoring').runs.find(
      (r) => r.name === 'run-e2e-functional',
    )!;
  (run(cells).status as Record<string, unknown>)['runnerExitCode'] = 1;
  let summary = pr(cells);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.blocking[0]!.detail, /exited with code 1/);

  cells = desktopCells();
  (run(cells).status as Record<string, unknown>)['reportComplete'] = false;
  summary = pr(cells);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.missing[0]!.detail, /incomplete Playwright report/);

  cells = desktopCells();
  (run(cells).status as Record<string, unknown>)['validated'] = false;
  summary = pr(cells);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.blocking[0]!.detail, /did not validate/);

  cells = desktopCells();
  delete (run(cells).status as Record<string, unknown>)['runnerExitCode'];
  summary = pr(cells);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.missing[0]!.detail, /no runnerExitCode/);

  // A non-zero exit explained by a failing (informational) test stays mergeable.
  cells = desktopCells();
  const target = cellOf(cells, 'ubuntu-24.04', '1.142.0', 'authoring');
  failTest(
    target,
    'run-e2e-functional',
    'e2e-linux',
    'layout.spec.ts',
    'FR-028-scaling',
    SCALE,
  );
  const status = run(cells).status as Record<string, unknown>;
  status['runnerExitCode'] = 1;
  status['validated'] = false;
  summary = pr(cells, prJobs({ desktop: 'failure' }));
  assert.equal(summary.status, 'MERGEABLE');
});

test('regression: a failing test makes the runner record reportComplete false; informational failures stay informational', () => {
  const realistic = (cells: CellEvidence[]) => {
    const status = cellOf(
      cells,
      'ubuntu-24.04',
      '1.142.0',
      'authoring',
    ).runs.find((r) => r.name === 'run-e2e-functional')!.status as Record<
      string,
      unknown
    >;
    assert.equal(status['runnerExitCode'], 1);
    assert.equal(status['reportComplete'], false);
    assert.equal(status['validated'], false);
  };
  // PR: a lone informational failure is MERGEABLE.
  let cells = desktopCells();
  failTest(
    cellOf(cells, 'ubuntu-24.04', '1.142.0', 'authoring'),
    'run-e2e-functional',
    'e2e-linux',
    'layout.spec.ts',
    'FR-028-scaling',
    SCALE,
  );
  realistic(cells);
  let summary = pr(cells, prJobs({ desktop: 'failure' }));
  assert.equal(summary.status, 'MERGEABLE');
  assert.deepEqual(summary.missing, []);
  assert.deepEqual(summary.blocking, []);
  assert.equal(summary.informational.length, 1);
  // A critical failure blocks.
  cells = desktopCells();
  failTest(
    cellOf(cells, 'ubuntu-24.04', '1.142.0', 'authoring'),
    'run-e2e-functional',
    'e2e-linux',
    'components.spec.ts',
    'US4.2-insert-once',
  );
  summary = pr(cells, prJobs({ desktop: 'failure' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.deepEqual(summary.missing, []);
  // An informational failure plus an absent required spec file is missing.
  cells = desktopCells();
  const authoring = cellOf(cells, 'ubuntu-24.04', '1.142.0', 'authoring');
  failTest(
    authoring,
    'run-e2e-functional',
    'e2e-linux',
    'layout.spec.ts',
    'FR-028-scaling',
    SCALE,
  );
  const target = authoring.runs.find((r) => r.name === 'run-e2e-functional')!;
  const suites = (target.report as ReturnType<typeof report>).suites;
  suites.splice(
    suites.findIndex((suite) => suite.file === 'offline.spec.ts'),
    1,
  );
  summary = pr(cells, prJobs({ desktop: 'failure' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.missing[0]!.detail, /absent.*offline\.spec\.ts/);
  // The runner's own `required` list is not the only reference: a status that
  // omits it cannot hide the absent suite.
  (target.status as Record<string, unknown>)['required'] = [];
  summary = pr(cells, prJobs({ desktop: 'failure' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.missing[0]!.detail, /absent.*offline\.spec\.ts/);
  // A test with no single final result is missing evidence, not a pass.
  cells = desktopCells();
  const lost = cellOf(cells, 'ubuntu-24.04', '1.142.0', 'authoring');
  failTest(
    lost,
    'run-e2e-functional',
    'e2e-linux',
    'layout.spec.ts',
    'FR-028-scaling',
    SCALE,
  );
  const lostSuites = (
    lost.runs.find((r) => r.name === 'run-e2e-functional')!
      .report as ReturnType<typeof report>
  ).suites;
  lostSuites[0]!.specs.push({
    id: 'never-ran',
    title: 'never-ran',
    file: lostSuites[0]!.file,
    tests: [{ expectedStatus: 'passed', status: 'unexpected', results: [] }],
  } as never);
  summary = pr(cells, prJobs({ desktop: 'failure' }));
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.ok(
    summary.missing.some((i) => /no single final result/.test(i.detail)),
  );
  // Release: the candidate failure needs an exception, with the same status.
  const candidate = () => {
    const cell = candidateCell();
    failTest(
      cell,
      'run-visual',
      'visual',
      'visual.spec.ts',
      'US6.2-themes',
      SCREENSHOT,
    );
    return cell;
  };
  const jobs = releaseJobs({ 'candidate-qa': 'failure' });
  summary = release({ jobs, cells: [candidate()] });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.deepEqual(summary.missing, []);
  assert.deepEqual(summary.blocking, []);
  summary = release({
    jobs,
    cells: [candidate()],
    readiness: record({
      qaExceptions: [exception('visual.spec.ts::US6.2-themes')],
    }),
  });
  assert.equal(summary.status, 'PUBLISHABLE');
  assert.deepEqual(summary.missing, []);
});

// ---------------------------------------------------------------------------
// Stability gate

function stabilityRun(
  os: string,
  failures: { file: string; title: string; message?: string }[],
  status: Record<string, unknown> = {},
): StabilityRun {
  const files = [...new Set(failures.map((failure) => failure.file))];
  return {
    name: `flake-results-${os}-1.142.0-core-functional/run-1/playwright-report.json`,
    os,
    status: {
      mode: {
        probe: false,
        packaged: false,
        visual: false,
        updateBaselines: false,
        group: null,
        measure: true,
        repeatEach: 5,
        // The stability plan restricts a run to the changed specs.
        specs: files.length > 0 ? files : ['structure.spec.ts'],
      },
      runnerExitCode: failures.length > 0 ? 1 : 0,
      reportComplete: failures.length === 0,
      ...status,
    },
    report: {
      suites: [
        ...(files.length === 0
          ? [
              {
                file: 'a.spec.ts',
                specs: [
                  {
                    title: 'fine',
                    file: 'a.spec.ts',
                    tests: [
                      {
                        expectedStatus: 'passed',
                        status: 'expected',
                        results: [{ status: 'passed' }],
                      },
                    ],
                  },
                ],
              },
            ]
          : []),
        ...files.map((file) => ({
          file,
          specs: failures
            .filter((failure) => failure.file === file)
            .map((failure) => ({
              title: failure.title,
              file,
              tests: [
                {
                  expectedStatus: 'passed',
                  status: 'unexpected',
                  results: [
                    {
                      status: 'failed',
                      error: { message: failure.message ?? 'boom' },
                    },
                  ],
                },
              ],
            })),
        })),
      ],
    },
  };
}

/** `auto` declares exactly the spec files the runs reported (none: structure.spec.ts). */
const prStability = (
  jobs: JobResults,
  stability: StabilityRun[],
  changedSpecs: string | null = 'auto',
): QaSummary => {
  const reported = [
    ...new Set(
      stability.flatMap((run) =>
        (collectTests(run.report) ?? []).map((test) => test.file),
      ),
    ),
  ].filter((file) => file !== 'a.spec.ts');
  const specs =
    changedSpecs === 'auto'
      ? reported.length > 0
        ? reported.join(',')
        : 'structure.spec.ts'
      : changedSpecs;
  return evaluatePr({
    candidate: SHA,
    jobs,
    cells: desktopCells(),
    stability,
    ...(specs === null ? {} : { changedSpecs: specs }),
  });
};

test('stability is judged per test: critical blocks, informational-only is listed, no evidence fails closed', () => {
  const failed = prJobs({ stability: 'failure' });
  // A critical test failing the strict repeat blocks.
  let summary = prStability(failed, [
    stabilityRun('ubuntu-24.04', [
      { file: 'components.spec.ts', title: 'US4.2-insert-once' },
    ]),
  ]);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.deepEqual(
    summary.blocking.map((i) => [i.id, i.scope]),
    [['components.spec.ts::US4.2-insert-once', 'ubuntu-24.04/stability']],
  );
  // The timing budget alone is informational: mergeable, listed.
  summary = prStability(failed, [
    stabilityRun('ubuntu-24.04', [
      { file: 'structure.spec.ts', title: 'SC-003-timing', message: BUDGET },
    ]),
  ]);
  assert.equal(summary.status, 'MERGEABLE');
  assert.deepEqual(
    summary.informational.map((i) => i.id),
    ['structure.spec.ts::SC-003-timing'],
  );
  // The same test failing for another reason blocks.
  summary = prStability(failed, [
    stabilityRun('ubuntu-24.04', [
      { file: 'structure.spec.ts', title: 'SC-003-timing', message: 'boom' },
    ]),
  ]);
  assert.equal(summary.status, 'NOT MERGEABLE');
  // Failure with no per-test evidence: fail closed.
  summary = prStability(failed, []);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.blocking[0]!.detail, /unexplained job failure/);
  // Failure with a clean report: still unexplained.
  summary = prStability(failed, [stabilityRun('ubuntu-24.04', [])]);
  assert.equal(summary.status, 'NOT MERGEABLE');
  // An incomplete or unreadable report is missing evidence.
  summary = prStability(prJobs(), [
    stabilityRun('ubuntu-24.04', [], { reportComplete: false }),
  ]);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.ok(summary.missing.length > 0);
  summary = prStability(prJobs({ stability: 'cancelled' }), []);
  assert.equal(summary.status, 'NOT MERGEABLE');
  // A skip outside the documented platform skips fails the strict repeat.
  const skipped = stabilityRun('ubuntu-24.04', []);
  (
    (skipped.status as Record<string, unknown>)['mode'] as Record<
      string,
      unknown
    >
  )['specs'] = ['context.spec.ts', 'a.spec.ts'];
  (skipped.report as { suites: { specs: unknown[] }[] }).suites[0]!.specs.push({
    title: 'US5.3-two-views',
    file: 'context.spec.ts',
    tests: [
      {
        expectedStatus: 'skipped',
        status: 'skipped',
        results: [{ status: 'skipped' }],
      },
    ],
  });
  summary = prStability(prJobs(), [skipped]);
  assert.equal(summary.status, 'NOT MERGEABLE');
  const darwin = { ...skipped, os: 'macos-15' };
  summary = prStability(prJobs(), [darwin]);
  assert.equal(summary.status, 'MERGEABLE');
  assert.deepEqual(
    summary.unvalidated.map((i) => i.id),
    ['context.spec.ts::US5.3-two-views'],
  );
});

test('regression: stability informational failures with a realistic runner status', () => {
  const failed = prJobs({ stability: 'failure' });
  const budget = () =>
    stabilityRun('ubuntu-24.04', [
      { file: 'structure.spec.ts', title: 'SC-003-timing', message: BUDGET },
    ]);
  const run = budget();
  assert.deepEqual(
    [
      (run.status as Record<string, unknown>)['runnerExitCode'],
      (run.status as Record<string, unknown>)['reportComplete'],
    ],
    [1, false],
  );
  const summary = prStability(failed, [run]);
  assert.equal(summary.status, 'MERGEABLE');
  assert.deepEqual(summary.missing, []);
  assert.equal(summary.informational.length, 1);
  // Release: the CI summary carries it; it needs an exception.
  const ci = ciSummary({ informational: summary.informational });
  const jobs = releaseJobs({ quality: 'failure' });
  assert.equal(release({ jobs, ci: [ciFile(ci)] }).status, 'NOT PUBLISHABLE');
  assert.equal(
    release({
      jobs,
      ci: [ciFile(ci)],
      readiness: record({
        qaExceptions: [exception('structure.spec.ts::SC-003-timing')],
      }),
    }).status,
    'PUBLISHABLE',
  );
  // A failing critical test blocks; an absent spec file next to an
  // informational failure is missing evidence.
  assert.equal(
    prStability(failed, [
      stabilityRun('ubuntu-24.04', [
        { file: 'components.spec.ts', title: 'US4.2-insert-once' },
      ]),
    ]).status,
    'NOT MERGEABLE',
  );
  const partial = budget();
  (partial.status as Record<string, unknown>)['mode'] = {
    probe: false,
    packaged: false,
    visual: false,
    measure: true,
    group: 'core',
    specs: ['structure.spec.ts', 'data.spec.ts'],
  };
  const incomplete = prStability(failed, [partial]);
  assert.equal(incomplete.status, 'NOT MERGEABLE');
  assert.match(incomplete.missing[0]!.detail, /absent.*data\.spec\.ts/);
});

test('stability with changed specs needs runs with a mode that cover every changed spec', () => {
  const ok = () =>
    stabilityRun('ubuntu-24.04', [
      { file: 'structure.spec.ts', title: 'SC-003-timing', message: BUDGET },
    ]);
  // Success, specs changed, no run at all: missing critical evidence.
  let summary = prStability(prJobs(), [], 'structure.spec.ts');
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.missing[0]!.detail, /no flake-results run/);
  // A run that does not cover one of the changed specs.
  summary = prStability(
    prJobs({ stability: 'failure' }),
    [ok()],
    'structure.spec.ts,data.spec.ts',
  );
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.missing[0]!.detail, /do not cover.*data\.spec\.ts/);
  // A run without a mode.
  const noMode = ok();
  delete (noMode.status as Record<string, unknown>)['mode'];
  summary = prStability(
    prJobs({ stability: 'failure' }),
    [noMode],
    'structure.spec.ts',
  );
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.ok(summary.missing.some((i) => /no mode/.test(i.detail)));
  // Complete coverage across several runs is fine.
  const data = stabilityRun('windows-2022', []);
  data.report = {
    suites: [
      {
        file: 'data.spec.ts',
        specs: [
          {
            title: 'US3.1-ok',
            file: 'data.spec.ts',
            tests: [
              {
                expectedStatus: 'passed',
                status: 'expected',
                results: [{ status: 'passed' }],
              },
            ],
          },
        ],
      },
    ],
  };
  ((data.status as Record<string, unknown>)['mode'] as Record<string, unknown>)[
    'specs'
  ] = ['data.spec.ts'];
  summary = prStability(
    prJobs({ stability: 'failure' }),
    [ok(), data],
    'structure.spec.ts,data.spec.ts',
  );
  assert.equal(summary.status, 'MERGEABLE');
  assert.deepEqual(summary.missing, []);
  // Only a spec of the pinned visual job changed: nothing is owed.
  assert.equal(prStability(prJobs(), [], 'visual.spec.ts').status, 'MERGEABLE');
});

test('a measurement narrowing in a cell or candidate status never reduces the expected suites', () => {
  const narrow = (evidence: CellEvidence, name: string) => {
    const run = evidence.runs.find((r) => r.name === name)!;
    const status = run.status as Record<string, unknown> & {
      mode: Record<string, unknown>;
    };
    status.mode['measure'] = true;
    status.mode['specs'] = ['bootstrap.spec.ts'];
    status['required'] = [];
    return run;
  };
  const cells = desktopCells();
  const cell = cellOf(cells, 'ubuntu-24.04', '1.142.0', 'core');
  const target = narrow(cell, 'run-e2e-functional');
  const suites = (target.report as ReturnType<typeof report>).suites;
  suites.splice(
    suites.findIndex((suite) => suite.file === 'data.spec.ts'),
    1,
  );
  let summary = pr(cells);
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.match(summary.missing[0]!.detail, /absent.*data\.spec\.ts/);
  // Candidate-qa too.
  const candidate = candidateCell();
  const run = narrow(candidate, 'run-e2e-installed');
  const candidateSuites = (run.report as ReturnType<typeof report>).suites;
  candidateSuites.splice(
    candidateSuites.findIndex((suite) => suite.file === 'data.spec.ts'),
    1,
  );
  summary = release({ cells: [candidate] });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
});

test('a skipped stability job is fine only when no Desktop spec changed', () => {
  const skipped = prJobs({ stability: 'skipped' });
  assert.equal(prStability(skipped, [], '').status, 'MERGEABLE');
  assert.equal(prStability(skipped, [], '  ').status, 'MERGEABLE');
  let summary = prStability(skipped, [], 'structure.spec.ts');
  assert.equal(summary.status, 'NOT MERGEABLE');
  assert.equal(summary.missing[0]!.id, 'job:stability');
  summary = prStability(skipped, [], null);
  assert.equal(summary.status, 'NOT MERGEABLE', 'unknown outputs fail closed');
  // Skipped because the detection failed: that failure blocks, once.
  summary = prStability(
    prJobs({ stability: 'skipped', 'changed-specs': 'failure' }),
    [],
    '',
  );
  assert.deepEqual(
    summary.blocking.map((i) => i.id),
    ['job:changed-specs'],
  );
});

test('stability runs are loaded from the downloaded flake-results artifacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-qa-stability-'));
  try {
    const run = stabilityRun('windows-2022', [
      { file: 'data.spec.ts', title: 'US3.1-anything' },
    ]);
    const target = join(
      directory,
      'flake-results-windows-2022-stable-core-functional',
      'run-9-abcd',
    );
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, 'playwright-report.json'),
      JSON.stringify(run.report),
    );
    writeFileSync(
      join(target, 'runner-status.json'),
      JSON.stringify(run.status),
    );
    const loaded = loadStability(directory);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.os, 'windows-2022');
    assert.equal(
      loaded[0]!.name,
      'flake-results-windows-2022-stable-core-functional/run-9-abcd/playwright-report.json',
    );
    const summary = prStability(prJobs({ stability: 'failure' }), loaded);
    assert.deepEqual(
      summary.blocking.map((i) => i.id),
      ['data.spec.ts::US3.1-anything'],
    );
    assert.deepEqual(loadStability(join(directory, 'absent')), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('collectTests never reports a flaky or unexpected test as passed', () => {
  const base = report(['a.spec.ts']);
  assert.equal(collectTests(base)![0]!.passed, true);
  for (const status of ['flaky', 'unexpected', 'skipped']) {
    const copy = structuredClone(base);
    copy.suites[0]!.specs[0]!.tests[0]!.status = status;
    assert.equal(collectTests(copy)![0]!.passed, false, status);
  }
  assert.equal(collectTests({}), null);
  assert.equal(collectTests({ suites: [null] }), null);
});

// ---------------------------------------------------------------------------
// Release

const record = (extra: Record<string, unknown> = {}, evidence = {}) =>
  `# Readiness\n\n\`\`\`json\n${JSON.stringify({
    candidate: SHA,
    version: '1.2.3',
    evidence,
    ...extra,
  })}\n\`\`\`\n`;

function candidateCell(): CellEvidence {
  return green(
    CANDIDATE_CELL_CHECKS,
    {
      kind: 'candidate',
      os: 'ubuntu-24.04',
      vscode: '1.142.0',
      vsixSha256: VSIX,
    },
    (check) =>
      check.run === 'probe'
        ? SUITES['probe']!
        : check.run === 'visual'
          ? SUITES['visual']!
          : SUITES['candidate']!,
  );
}

const ciSummary = (extra: Partial<QaSummary> = {}): QaSummary => ({
  candidate: SHA,
  mode: 'pr',
  status: 'MERGEABLE',
  blocking: [],
  informational: [],
  accepted: [],
  unvalidated: [],
  missing: [],
  ...extra,
});

const ciFile = (summary: unknown, sha = SHA) => ({
  path: `qa-ci/qa-summary-${sha}/qa-summary.json`,
  summary,
});

const releaseJobs = (overrides: JobResults = {}): JobResults => ({
  validation: 'success',
  canonical: 'success',
  quality: 'success',
  'candidate-qa': 'success',
  ...overrides,
});

function release(
  overrides: {
    jobs?: JobResults;
    cells?: CellEvidence[];
    ci?: { path: string; summary: unknown }[];
    readiness?: string | null;
    vsix?: string;
  } = {},
): QaSummary {
  return evaluateRelease({
    candidate: SHA,
    jobs: overrides.jobs ?? releaseJobs(),
    cells: overrides.cells ?? [candidateCell()],
    ciSummaries: overrides.ci ?? [ciFile(ciSummary())],
    readinessMarkdown:
      overrides.readiness === undefined ? record() : overrides.readiness,
    vsixSha256: overrides.vsix ?? VSIX,
  });
}

const exception = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  issue: 'https://github.com/Wald764/RDLC-Code/issues/42',
  reason: 'Known rendering difference on the pinned runner',
  acceptedBy: 'Wald764',
  acceptedOn: '2026-11-07',
  ...extra,
});

test('release: everything green is FULLY VALIDATED', () => {
  const summary = release();
  assert.equal(summary.status, 'FULLY VALIDATED');
  assert.equal(summary.mode, 'release');
  assert.deepEqual(summary.blocking.concat(summary.missing), []);
});

test('release: a critical candidate failure is NOT PUBLISHABLE', () => {
  const cell = candidateCell();
  failTest(
    cell,
    'run-e2e-installed',
    'installed',
    'workspace.spec.ts',
    'US1.1-new-open-report',
  );
  const summary = release({
    jobs: releaseJobs({ 'candidate-qa': 'failure' }),
    cells: [cell],
  });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.deepEqual(
    summary.blocking.map((i) => [i.id, i.origin]),
    [['workspace.spec.ts::US1.1-new-open-report', 'candidate']],
  );
  // Neither validation, canonical nor a cancelled candidate job can be ignored.
  for (const jobs of [
    releaseJobs({ validation: 'failure' }),
    releaseJobs({ canonical: 'skipped' }),
    releaseJobs({ 'candidate-qa': 'cancelled' }),
    releaseJobs({ 'candidate-qa': 'skipped' }),
  ])
    assert.equal(release({ jobs }).status, 'NOT PUBLISHABLE');
});

test('release: an unaccepted informational failure is NOT PUBLISHABLE, an accepted one is PUBLISHABLE but not FULLY VALIDATED', () => {
  const informational = () => {
    const cell = candidateCell();
    failTest(
      cell,
      'run-visual',
      'visual',
      'visual.spec.ts',
      'US6.2-themes',
      SCREENSHOT,
    );
    return release({
      jobs: releaseJobs({ 'candidate-qa': 'failure' }),
      cells: [cell],
    });
  };
  assert.equal(informational().status, 'NOT PUBLISHABLE');
  assert.deepEqual(
    informational().informational.map((i) => i.id),
    ['visual.spec.ts::US6.2-themes'],
  );
  const cell = candidateCell();
  failTest(
    cell,
    'run-visual',
    'visual',
    'visual.spec.ts',
    'US6.2-themes',
    SCREENSHOT,
  );
  const accepted = release({
    jobs: releaseJobs({ 'candidate-qa': 'failure' }),
    cells: [cell],
    readiness: record({
      qaExceptions: [exception('visual.spec.ts::US6.2-themes')],
    }),
  });
  assert.equal(accepted.status, 'PUBLISHABLE');
  assert.deepEqual(accepted.informational, []);
  assert.equal(accepted.accepted.length, 1);
  assert.equal(accepted.accepted[0]!.exception?.issue, exception('x').issue);
  // The exception must cover the failing scope.
  const wrongScope = release({
    jobs: releaseJobs({ 'candidate-qa': 'failure' }),
    cells: [cell],
    readiness: record({
      qaExceptions: [
        exception('visual.spec.ts::US6.2-themes', {
          scope: 'macos-15/stable',
        }),
      ],
    }),
  });
  assert.equal(wrongScope.status, 'NOT PUBLISHABLE');
  const rightScope = release({
    jobs: releaseJobs({ 'candidate-qa': 'failure' }),
    cells: [cell],
    readiness: record({
      qaExceptions: [
        exception('visual.spec.ts::US6.2-themes', {
          scope: 'ubuntu-24.04/1.142.0',
        }),
      ],
    }),
  });
  assert.equal(rightScope.status, 'PUBLISHABLE');
});

test('release: CI informational failures need an exception too; informational CI jobs do not skip the gate inputs', () => {
  const ci = ciSummary({
    informational: [
      {
        id: 'job:visual',
        kind: 'job',
        detail: 'job result: failure',
      },
      {
        id: 'layout.spec.ts::FR-028-scaling',
        kind: 'test',
        scope: 'macos-15/stable/authoring',
        detail: 'failed',
      },
    ],
  });
  const input = { jobs: releaseJobs({ quality: 'failure' }), ci: [ciFile(ci)] };
  assert.equal(release(input).status, 'NOT PUBLISHABLE');
  const covered = release({
    ...input,
    readiness: record({
      qaExceptions: [
        exception('job:visual'),
        exception('layout.spec.ts::FR-028-scaling', {
          scope: 'macos-15/stable',
        }),
      ],
    }),
  });
  assert.equal(covered.status, 'PUBLISHABLE');
  assert.equal(covered.accepted.length, 2);
});

test('release: missing or unusable CI qa-summary, SHA mismatch and a non-mergeable CI are blocking', () => {
  let summary = release({ ci: [] });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.equal(summary.missing[0]!.id, 'ci:qa-summary');
  summary = release({ ci: [ciFile(null)] });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  summary = release({ ci: [ciFile(ciSummary({ candidate: OTHER }))] });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.equal(summary.blocking[0]!.id, 'ci:candidate-sha');
  summary = release({ ci: [ciFile(ciSummary(), OTHER)] });
  assert.equal(summary.status, 'NOT PUBLISHABLE', 'summary of another commit');
  summary = release({
    ci: [
      ciFile(
        ciSummary({
          status: 'NOT MERGEABLE',
          blocking: [{ id: 'job:quality', kind: 'job', detail: 'failed' }],
        }),
      ),
    ],
  });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.deepEqual(
    summary.blocking.map((i) => i.id),
    ['ci:status', 'job:quality'],
  );
});

test('release: missing candidate evidence or tested bytes that differ from the canonical VSIX are blocking', () => {
  let summary = release({ cells: [] });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.equal(summary.missing[0]!.id, 'cell:evidence');
  const noReport = candidateCell();
  noReport.runs = [];
  summary = release({ cells: [noReport] });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.deepEqual(
    summary.missing.map((i) => i.id),
    ['cell:probe', 'cell:e2e-installed', 'cell:visual'],
  );
  summary = release({ vsix: 'd'.repeat(64) });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.equal(summary.blocking[0]!.id, 'canonical:vsix-sha256');
  summary = release({ vsix: '' });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  const stale = candidateCell();
  stale.cell.candidate = OTHER;
  assert.equal(release({ cells: [stale] }).status, 'NOT PUBLISHABLE');
  const unverified = candidateCell();
  unverified.cell.steps['bind'] = 'failure';
  summary = release({ cells: [unverified] });
  assert.equal(summary.status, 'NOT PUBLISHABLE');
  assert.ok(summary.blocking.some((i) => i.id === 'cell:canonical-bytes'));
});

test('release: an exception on a critical check or test is rejected', () => {
  for (const id of [
    'job:quality',
    'job:canonical',
    'components.spec.ts::US4.2-insert-once',
    'accessibility.spec.ts::US6.1-keyboard-journey',
    'cell:probe',
  ]) {
    const summary = release({
      readiness: record({ qaExceptions: [exception(id)] }),
    });
    assert.equal(summary.status, 'NOT PUBLISHABLE', id);
    assert.equal(summary.blocking[0]!.id, 'release-readiness', id);
  }
  assert.equal(
    release({ readiness: null }).status,
    'NOT PUBLISHABLE',
    'no readiness record',
  );
});

test('release: UNVALIDATED skips and accepted-failure evidence give PUBLISHABLE, never FULLY VALIDATED', () => {
  const ci = ciSummary({
    unvalidated: [
      {
        id: 'context.spec.ts::US5.3-two-views',
        kind: 'test',
        scope: 'macos-15/stable/context',
        detail: 'UNVALIDATED',
      },
    ],
  });
  let summary = release({ ci: [ciFile(ci)] });
  assert.equal(summary.status, 'PUBLISHABLE');
  assert.equal(summary.unvalidated.length, 1);
  summary = release({
    readiness: record(
      {},
      {
        'cross-os': {
          status: 'accepted-failure',
          path: 'docs/validation/x.md',
          candidate: SHA,
          issue: 'https://github.com/Wald764/RDLC-Code/issues/7',
          reason: 'macOS runner unavailable',
        },
      },
    ),
  });
  assert.equal(summary.status, 'PUBLISHABLE');
  assert.equal(summary.accepted[0]!.id, 'evidence:cross-os');
});

// ---------------------------------------------------------------------------
// Files and CLI

function writeCell(root: string, name: string, evidence: CellEvidence): void {
  const directory = join(root, name);
  mkdirSync(join(directory, 'runs'), { recursive: true });
  writeFileSync(join(directory, 'cell.json'), JSON.stringify(evidence.cell));
  for (const entry of evidence.runs) {
    const target = join(directory, 'runs', entry.name);
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, 'runner-status.json'),
      JSON.stringify(entry.status),
    );
    writeFileSync(
      join(target, 'playwright-report.json'),
      JSON.stringify(entry.report),
    );
  }
}

test('the CLI reads downloaded evidence, writes qa-summary.json and exits 1 only on blocking or missing evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-qa-gate-'));
  const saved = { ...process.env };
  const quiet = console.log;
  try {
    const cells = desktopCells();
    cells.forEach((cell, index) =>
      writeCell(join(directory, 'evidence'), `qa-cell-${index}`, cell),
    );
    process.env['QA_NEEDS'] = JSON.stringify(
      Object.fromEntries(
        Object.entries(prJobs()).map(([id, result]) => [id, { result }]),
      ),
    );
    delete process.env['GITHUB_STEP_SUMMARY'];
    delete process.env['GITHUB_OUTPUT'];
    console.log = () => undefined;
    const out = join(directory, 'qa-summary.json');
    const args = [
      'pr',
      '--candidate',
      SHA,
      '--evidence',
      join(directory, 'evidence'),
      '--out',
      out,
    ];
    assert.equal(runCli(args), 0);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).status, 'MERGEABLE');

    rmSync(join(directory, 'evidence', 'qa-cell-0'), { recursive: true });
    assert.equal(runCli(args), 1, 'a missing cell fails the gate');
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).status, 'NOT MERGEABLE');

    const summaryFile = join(directory, 'step-summary.md');
    process.env['GITHUB_STEP_SUMMARY'] = summaryFile;
    runCli(args);
    assert.match(readFileSync(summaryFile, 'utf8'), /NOT MERGEABLE/);

    // An unreadable cell is blocking evidence, not silently ignored.
    mkdirSync(join(directory, 'evidence', 'broken'));
    writeFileSync(join(directory, 'evidence', 'broken', 'cell.json'), '{');
    const loaded = loadCells(join(directory, 'evidence'));
    assert.equal(loaded.errors.length, 1);
    assert.throws(() => runCli(['pr', '--candidate', 'abc']));
  } finally {
    console.log = quiet;
    process.env = saved;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('qa-collect keeps step outcomes, run reports and the candidate identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-qa-collect-'));
  try {
    const artifacts = join(directory, 'artifacts');
    mkdirSync(join(artifacts, 'run-1234-abcd'), { recursive: true });
    mkdirSync(join(artifacts, 'playwright'), { recursive: true });
    writeFileSync(join(artifacts, 'run-1234-abcd', 'runner-status.json'), '{}');
    writeFileSync(
      join(artifacts, 'run-1234-abcd', 'playwright-report.json'),
      '{}',
    );
    writeFileSync(join(artifacts, 'run-1234-abcd', 'trace.zip'), 'large');
    const out = join(directory, 'qa-evidence');
    collectCell(
      {
        QA_KIND: 'desktop',
        QA_CANDIDATE: SHA,
        QA_OS: 'macos-15',
        QA_VSCODE: 'stable',
        QA_GROUP: 'core',
        QA_STEP_DOWNLOAD_VSCODE: 'success',
        QA_STEP_PACKAGE_TESTS_OTHER: 'skipped',
        QA_STEP_PROBE_LINUX: '',
      },
      artifacts,
      out,
    );
    const cell = JSON.parse(readFileSync(join(out, 'cell.json'), 'utf8'));
    assert.deepEqual(cell, {
      schema: 1,
      candidate: SHA,
      kind: 'desktop',
      os: 'macos-15',
      vscode: 'stable',
      group: 'core',
      steps: {
        'download-vscode': 'success',
        'package-tests-other': 'skipped',
        'probe-linux': '',
      },
    });
    const loaded = loadCells(out);
    assert.equal(loaded.errors.length, 0);
    assert.equal(loaded.cells.length, 1);
    assert.deepEqual(
      loaded.cells[0]!.runs.map((r) => r.name),
      ['run-1234-abcd'],
    );
    assert.equal(
      readFileSync(
        join(out, 'runs', 'run-1234-abcd', 'runner-status.json'),
        'utf8',
      ),
      '{}',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
