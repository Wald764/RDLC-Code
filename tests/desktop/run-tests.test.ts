import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  completeDesktopReport,
  completeDriverCapabilities,
  deriveSecurityObserverCapability,
  desktopArguments,
  desktopPlaywrightArguments,
  measurementCompleteness,
  measurementGlobalTimeout,
  MEASURE_GLOBAL_TIMEOUT_CAP_MS,
  measurementHarnessErrors,
  playwrightStats,
  FUNCTIONAL_CAPABILITIES as FUNCTIONAL,
  mergeProbeCapabilities,
  DESKTOP_GROUPS,
  requiredDesktopSuites,
  runDesktop,
  sweepAfterRun,
} from './run-tests.js';
import { REFERENCE_ENVIRONMENT, type EnvironmentIdentity } from './evidence.js';

const referenceEnvironment: EnvironmentIdentity = {
  os: 'linux',
  osImage: 'ubuntu-24.04',
  vscodeVersion: '1.142.0',
  vscodeBuild: REFERENCE_ENVIRONMENT.vscodeBuild,
  vscodeHash: 'b'.repeat(64),
  driverVersion: 'playwright@1.64.1',
  locale: 'en-US',
  timezone: 'UTC',
  theme: 'vs-dark',
  fonts: 'fonts-dejavu-core 2.37',
  display: {
    width: 1440,
    height: 1000,
    dpr: 1,
    interfaceScale: 100,
    reportZoom: 100,
  },
};

function makeProbe(environment: EnvironmentIdentity, screenshot = 'passed') {
  return {
    validated: true,
    identity: {
      version: environment.vscodeVersion,
      build: environment.vscodeBuild,
      executableSha256: 'b'.repeat(64),
    },
    environment,
    capabilities: {
      ...Object.fromEntries(FUNCTIONAL.map((key) => [key, 'passed'])),
      screenshotComparison: screenshot,
    },
  };
}

test('a successful runner cannot override missing or unrun mandatory driver capabilities', () => {
  const probe = makeProbe(referenceEnvironment);
  assert.equal(completeDriverCapabilities(probe), true);
  for (const key of [...FUNCTIONAL, 'screenshotComparison'])
    assert.equal(
      completeDriverCapabilities({
        ...probe,
        capabilities: { ...probe.capabilities, [key]: 'unrun' },
      }),
      false,
      key,
    );
  assert.equal(
    completeDriverCapabilities({ ...probe, validated: false }),
    false,
  );
  assert.equal(
    completeDriverCapabilities({
      ...probe,
      identity: { ...probe.identity, build: null },
    }),
    false,
  );
  assert.equal(
    completeDriverCapabilities({ ...probe, environment: undefined }),
    false,
  );
  assert.equal(completeDriverCapabilities(null), false);
});

test('pixels are recorded only on the pinned reference environment; elsewhere only functional capabilities gate', () => {
  const stable = { ...referenceEnvironment, vscodeVersion: '1.143.1' };
  // Non-reference: visual is unrun (never passed) and the entry gates on functional capabilities.
  assert.equal(completeDriverCapabilities(makeProbe(stable, 'unrun')), true);
  // A claimed pixel pass on a non-reference environment is rejected, not trusted.
  assert.equal(completeDriverCapabilities(makeProbe(stable, 'passed')), false);
  assert.equal(completeDriverCapabilities(makeProbe(stable, 'failed')), false);
  for (const key of FUNCTIONAL) {
    const probe = makeProbe(stable, 'unrun');
    assert.equal(
      completeDriverCapabilities({
        ...probe,
        capabilities: { ...probe.capabilities, [key]: 'failed' },
      }),
      false,
      key,
    );
  }
  const windows = { ...referenceEnvironment, os: 'win32' };
  assert.equal(completeDriverCapabilities(makeProbe(windows, 'unrun')), true);
  // Reference environment: a missing comparison is a failure, not an unrun pass.
  assert.equal(
    completeDriverCapabilities(makeProbe(referenceEnvironment, 'unrun')),
    false,
  );
});

test('the security observer capability is derived from the same-run security spec, never claimed by bootstrap', () => {
  const ok = {
    validated: true,
    captureComplete: true,
    checks: { nativeHost: 'passed' },
    failures: [],
  };
  assert.deepEqual(deriveSecurityObserverCapability(ok), {
    outcome: 'passed',
    reason: null,
  });
  const missing = deriveSecurityObserverCapability(null, 'linux');
  assert.equal(missing.outcome, 'unrun');
  assert.match(missing.reason ?? '', /did not produce/);
  assert.equal(
    deriveSecurityObserverCapability({ ...ok, captureComplete: false }).outcome,
    'failed',
  );
  const failed = deriveSecurityObserverCapability({
    ...ok,
    validated: false,
    failures: ['no host blocking'],
  });
  assert.equal(failed.outcome, 'failed');
  assert.match(failed.reason ?? '', /no host blocking/);
  const unsupportedRecord = {
    validated: false,
    captureComplete: false,
    checks: { nativeHost: 'unsupported' },
    failures: ['Native host process-tree attach is unsupported: win32'],
  };
  const offLinux = deriveSecurityObserverCapability(unsupportedRecord, 'win32');
  assert.equal(offLinux.outcome, 'unsupported');
  assert.match(offLinux.reason ?? '', /win32/);
  // Linux keeps the observer mandatory: unsupported capture is a failure.
  assert.equal(
    deriveSecurityObserverCapability(unsupportedRecord, 'linux').outcome,
    'failed',
  );
  // A skipped spec leaves no record: unsupported off Linux, unrun on Linux.
  for (const platform of ['win32', 'darwin'] as const)
    assert.equal(
      deriveSecurityObserverCapability(null, platform).outcome,
      'unsupported',
    );
  assert.equal(
    deriveSecurityObserverCapability(null, 'linux').outcome,
    'unrun',
  );

  const bootstrap = makeProbe(referenceEnvironment);
  // Bootstrap claims a pass; without the security spec result it is overridden.
  const merged = mergeProbeCapabilities(bootstrap, null, 'linux');
  assert.equal(merged.capabilities.securityObserver, 'unrun');
  assert.equal(completeDriverCapabilities(merged), false);
  assert.equal(
    completeDriverCapabilities(mergeProbeCapabilities(bootstrap, ok, 'linux')),
    true,
  );
  assert.equal(
    completeDriverCapabilities(
      mergeProbeCapabilities(
        bootstrap,
        { ...ok, validated: false, failures: ['x'] },
        'linux',
      ),
    ),
    false,
  );
});

test('unsupported host observation is recorded as unvalidated off Linux and still fails on Linux', () => {
  const stable = { ...referenceEnvironment, vscodeVersion: '1.143.1' };
  for (const os of ['win32', 'darwin']) {
    const environment = { ...stable, os };
    const merged = mergeProbeCapabilities(
      makeProbe(environment, 'unrun'),
      null,
      os as NodeJS.Platform,
    );
    assert.equal(merged.capabilities.securityObserver, 'unsupported');
    assert.equal(completeDriverCapabilities(merged), true, os);
    // Only the security observer may be unsupported; other capabilities gate.
    assert.equal(
      completeDriverCapabilities({
        ...merged,
        capabilities: { ...merged.capabilities, launch: 'unsupported' },
      }),
      false,
      os,
    );
  }
  // On Linux an unsupported or missing observer never validates.
  for (const record of [
    null,
    {
      validated: false,
      captureComplete: false,
      checks: { nativeHost: 'unsupported' },
      failures: ['unsupported'],
    },
  ])
    assert.equal(
      completeDriverCapabilities(
        mergeProbeCapabilities(makeProbe(stable, 'unrun'), record, 'linux'),
      ),
      false,
    );
  assert.equal(
    completeDriverCapabilities({
      ...makeProbe(stable, 'unrun'),
      capabilities: {
        ...makeProbe(stable, 'unrun').capabilities,
        securityObserver: 'unsupported',
      },
    }),
    false,
  );
});

test('only host-observer journeys may be skipped, and only off Linux', () => {
  const entry = (title: string, status: 'passed' | 'skipped') => ({
    id: title,
    title,
    file: 'offline.spec.ts',
    tests: [
      {
        expectedStatus: status,
        status: status === 'passed' ? 'expected' : 'skipped',
        results: [{ status }],
      },
    ],
  });
  const report = (specs: ReturnType<typeof entry>[], skipped: number) => ({
    stats: {
      expected: specs.length - skipped,
      skipped,
      unexpected: 0,
      flaky: 0,
    },
    suites: [{ file: 'offline.spec.ts', specs }],
  });
  const mixed = report(
    [entry('other', 'passed'), entry('FR-030-trust', 'skipped')],
    1,
  );
  const seen: string[] = [];
  assert.equal(
    completeDesktopReport(mixed, ['offline.spec.ts'], 'win32', seen),
    true,
  );
  assert.deepEqual(seen, ['FR-030-trust']);
  assert.equal(
    completeDesktopReport(mixed, ['offline.spec.ts'], 'darwin'),
    true,
  );
  // Linux still rejects every skip.
  assert.equal(
    completeDesktopReport(mixed, ['offline.spec.ts'], 'linux'),
    false,
  );
  // A skip of any other journey is rejected everywhere.
  assert.equal(
    completeDesktopReport(
      report([entry('other', 'passed'), entry('other-skip', 'skipped')], 1),
      ['offline.spec.ts'],
      'win32',
    ),
    false,
  );
  // The reported skip count must match the accepted skips.
  assert.equal(
    completeDesktopReport(
      { ...mixed, stats: { ...mixed.stats, skipped: 2 } },
      ['offline.spec.ts'],
      'win32',
    ),
    false,
  );
});

test('platform-scoped skips are accepted only on their listed platforms', () => {
  const entry = (title: string, status: 'passed' | 'skipped') => ({
    id: title,
    title,
    file: 'context.spec.ts',
    tests: [
      {
        expectedStatus: status,
        status: status === 'passed' ? 'expected' : 'skipped',
        results: [{ status }],
      },
    ],
  });
  const report = (title: string) => ({
    stats: { expected: 1, skipped: 1, unexpected: 0, flaky: 0 },
    suites: [
      {
        file: 'context.spec.ts',
        specs: [entry('other', 'passed'), entry(title, 'skipped')],
      },
    ],
  });
  const us53 = report('US5.3-two-views');
  const seen: string[] = [];
  const host: string[] = [];
  assert.equal(
    completeDesktopReport(us53, ['context.spec.ts'], 'darwin', host, seen),
    true,
  );
  assert.deepEqual(seen, ['US5.3-two-views']);
  assert.deepEqual(host, []);
  for (const platform of ['win32', 'linux'] as const)
    assert.equal(
      completeDesktopReport(us53, ['context.spec.ts'], platform),
      false,
    );
  assert.equal(
    completeDesktopReport(
      report('unlisted-skip'),
      ['context.spec.ts'],
      'darwin',
    ),
    false,
  );
});

test('Desktop reports reject missing, empty, skipped, flaky or failed execution', () => {
  const report = {
    stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
    suites: [
      {
        file: 'bootstrap.spec.ts',
        specs: [
          {
            id: 'bootstrap',
            file: 'bootstrap.spec.ts',
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
  assert.equal(completeDesktopReport(report, ['bootstrap.spec.ts']), true);
  assert.equal(completeDesktopReport(report, ['offline.spec.ts']), false);
  for (const stats of [
    { expected: 0 },
    { skipped: 1 },
    { unexpected: 1 },
    { flaky: 1 },
  ])
    assert.equal(
      completeDesktopReport(
        { ...report, stats: { ...report.stats, ...stats } },
        ['bootstrap.spec.ts'],
      ),
      false,
    );
  assert.equal(completeDesktopReport(null, ['bootstrap.spec.ts']), false);
  assert.equal(
    completeDesktopReport(
      {
        ...report,
        suites: [{ file: 'bootstrap.spec.ts', specs: [], suites: [{}] }],
      },
      ['bootstrap.spec.ts'],
    ),
    false,
  );
  assert.equal(
    completeDesktopReport(
      { ...report, stats: { ...report.stats, expected: 2 } },
      ['bootstrap.spec.ts'],
    ),
    false,
  );
  assert.equal(
    completeDesktopReport(
      { ...report, suites: [{ file: 'bootstrap.spec.ts', specs: [{}] }] },
      ['bootstrap.spec.ts'],
    ),
    false,
  );
});

test('Desktop modes preserve pnpm separators and reject ambiguous or unknown flags', () => {
  assert.deepEqual(desktopArguments(['--', '--probe', '--packaged'], {}), {
    probe: true,
    packaged: true,
    visual: false,
    updateBaselines: false,
    group: null,
  });
  assert.throws(() => desktopArguments(['--update-snapshots']), /Unknown/);
  assert.throws(
    () => desktopArguments(['--probe', '--visual']),
    /cannot be combined/,
  );
  assert.deepEqual(requiredDesktopSuites(desktopArguments(['--probe'])), [
    'bootstrap.spec.ts',
    'security-observer.spec.ts',
    'native-drag.spec.ts',
  ]);
});

test('CI groups partition the functional journeys without dropping one', () => {
  const all = requiredDesktopSuites(desktopArguments([], {}));
  assert.equal(all.length, 11);
  const parts = Object.keys(DESKTOP_GROUPS).map((group) =>
    requiredDesktopSuites(
      desktopArguments(['--packaged'], { RDLC_DESKTOP_GROUP: group }),
    ),
  );
  assert.deepEqual(parts.flat().sort(), [...all].sort(), 'union is complete');
  assert.equal(new Set(parts.flat()).size, all.length, 'groups are disjoint');
  assert.throws(
    () => desktopArguments([], { RDLC_DESKTOP_GROUP: 'visual' }),
    /Unknown RDLC_DESKTOP_GROUP/,
  );
  // Probe and visual modes keep their own fixed suites in any group job.
  assert.deepEqual(
    requiredDesktopSuites(
      desktopArguments(['--probe'], { RDLC_DESKTOP_GROUP: 'core' }),
    ),
    ['bootstrap.spec.ts', 'security-observer.spec.ts', 'native-drag.spec.ts'],
  );
});

test('baseline generation is explicit, isolated and never automatic in CI', () => {
  const update = desktopArguments(['--update-baselines'], {}, 'linux');
  assert.equal(update.updateBaselines, true);
  assert.deepEqual(requiredDesktopSuites(update), ['bootstrap.spec.ts']);
  assert.throws(
    () => desktopArguments(['--update-baselines'], { CI: 'true' }, 'linux'),
    /CI/,
  );
  assert.throws(
    () =>
      desktopArguments(
        ['--update-baselines'],
        {
          CI: 'true',
          RDLC_ALLOW_CI_BASELINE_UPDATE: '0',
        },
        'linux',
      ),
    /CI/,
  );
  assert.equal(
    desktopArguments(
      ['--update-baselines'],
      { CI: 'true', RDLC_ALLOW_CI_BASELINE_UPDATE: '1' },
      'linux',
    ).updateBaselines,
    true,
  );
  for (const other of ['--probe', '--visual', '--packaged'])
    assert.throws(
      () => desktopArguments(['--update-baselines', other], {}, 'linux'),
      /cannot be combined/,
    );
  const normal = desktopPlaywrightArguments(
    desktopArguments(['--probe']),
    '/c.ts',
    ['a.spec.ts'],
  );
  assert.ok(!normal.some((arg) => arg.startsWith('--update-snapshots')));
  assert.deepEqual(
    desktopPlaywrightArguments(update, '/c.ts', ['bootstrap.spec.ts']).filter(
      (arg) => arg.startsWith('--update-snapshots'),
    ),
    ['--update-snapshots=all'],
  );
});

test('baseline generation is refused before launch when the reference cannot match', async () => {
  // Platform and version are known before anything launches.
  assert.throws(
    () => desktopArguments(['--update-baselines'], {}, 'win32'),
    /platform win32 is not the reference environment/,
  );
  assert.throws(
    () => desktopArguments(['--update-baselines'], {}, 'darwin'),
    /platform/,
  );
  assert.throws(
    () =>
      desktopArguments(
        ['--update-baselines'],
        { VSCODE_VERSION: 'stable' },
        'linux',
      ),
    /version stable is not the reference 1.142.0/,
  );
  assert.equal(
    desktopArguments(
      ['--update-baselines'],
      { VSCODE_VERSION: '1.142.0' },
      'linux',
    ).updateBaselines,
    true,
  );
  // The refusal happens before any artifact directory or Desktop launch exists.
  const root = await mkdtemp(join(tmpdir(), 'rdlc-desktop-refuse-'));
  try {
    await assert.rejects(
      runDesktop(['--update-baselines'], root, {}, 'win32'),
      /platform/,
    );
    await assert.rejects(
      readFile(join(root, '.vscode-test/desktop-artifacts/runner-status.json')),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing mandatory Desktop assertions return failure and remain unvalidated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rdlc-desktop-missing-'));
  try {
    assert.equal(await runDesktop(['--probe'], root), 1);
    const status = JSON.parse(
      await readFile(
        join(root, '.vscode-test/desktop-artifacts/runner-status.json'),
        'utf8',
      ),
    );
    assert.equal(status.validated, false);
    const historical = await readFile(
      join(status.artifactDir, 'runner-status.json'),
      'utf8',
    );
    assert.equal(JSON.parse(historical).validated, false);
    assert.deepEqual(status.missing, [
      'bootstrap.spec.ts',
      'security-observer.spec.ts',
      'native-drag.spec.ts',
    ]);
    assert.equal(await runDesktop(['--probe'], root), 1);
    const next = JSON.parse(
      await readFile(
        join(root, '.vscode-test/desktop-artifacts/runner-status.json'),
        'utf8',
      ),
    );
    assert.notEqual(next.artifactDir, status.artifactDir);
    assert.equal(
      await readFile(join(status.artifactDir, 'runner-status.json'), 'utf8'),
      historical,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the runner sweeps leftover host blocking rules on Linux only and never throws', async () => {
  const logs: string[] = [];
  const log = (message: string) => logs.push(message);
  let calls = 0;
  const removed = (count: number) => () => {
    calls++;
    return { removed: count, skipped: null };
  };
  assert.match(sweepAfterRun('linux', removed(2), log), /removed 2/);
  assert.equal(calls, 1);
  assert.match(sweepAfterRun('win32', removed(2), log), /skipped/);
  assert.equal(calls, 1, 'no sweep off Linux');
  // A missing sudo/iptables is reported, not thrown.
  const failing = () => {
    throw new Error('sudo: a password is required');
  };
  assert.match(sweepAfterRun('linux', failing, log), /unavailable: sudo/);
  assert.equal(logs.length, 3);
  assert.ok(logs.every((line) => line.startsWith('Host blocking sweep: ')));
  // Without a Playwright child there is nothing to sweep and the status says so.
  const root = await mkdtemp(join(tmpdir(), 'rdlc-desktop-sweep-'));
  try {
    assert.equal(await runDesktop(['--probe'], root, {}, 'linux', failing), 1);
    const status = JSON.parse(
      await readFile(
        join(root, '.vscode-test/desktop-artifacts/runner-status.json'),
        'utf8',
      ),
    );
    assert.equal(status.hostBlockingSweep, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('--repeat-each is validated from 1 to 10 and forwarded to Playwright', () => {
  for (const n of [1, 5, 10])
    assert.equal(
      desktopArguments(['--measure', `--repeat-each=${n}`], {}).repeatEach,
      n,
    );
  assert.throws(
    () => desktopArguments(['--repeat-each=3'], {}),
    /requires --measure/,
  );
  for (const bad of [
    '--repeat-each=0',
    '--repeat-each=11',
    '--repeat-each=-1',
    '--repeat-each=2.5',
    '--repeat-each=x',
    '--repeat-each=',
    '--repeat-each',
  ])
    assert.throws(
      () => desktopArguments(['--measure', bad], {}),
      /--repeat-each/,
      bad,
    );
  assert.throws(
    () =>
      desktopArguments(['--measure', '--repeat-each=2', '--repeat-each=3'], {}),
    /twice/,
  );
  assert.throws(
    () =>
      desktopArguments(
        ['--update-baselines', '--measure', '--repeat-each=2'],
        {},
        'linux',
      ),
    /cannot be combined/,
  );
  assert.throws(
    () => desktopArguments(['--update-baselines', '--measure'], {}, 'linux'),
    /cannot be combined/,
  );
  const repeated = desktopPlaywrightArguments(
    desktopArguments(['--', '--packaged', '--measure', '--repeat-each=3'], {}),
    '/c.ts',
    ['a.spec.ts'],
  );
  assert.deepEqual(
    repeated.filter((arg) => arg.startsWith('--repeat-each')),
    ['--repeat-each=3'],
  );
  assert.ok(!repeated.some((arg) => arg.startsWith('--retries')));
});

test('measurement mode leaves the default Playwright arguments and timeouts alone', () => {
  const normal = desktopArguments(['--packaged'], {});
  // Default mode keeps its schema: no measurement keys at all.
  assert.ok(!('measure' in normal) && !('repeatEach' in normal));
  assert.equal(measurementGlobalTimeout(normal), null);
  const args = desktopPlaywrightArguments(normal, '/c.ts', ['a.spec.ts']);
  assert.deepEqual(args, [
    'test',
    '--config',
    '/c.ts',
    '--reporter=line,json',
    'a.spec.ts',
  ]);
  const measure = desktopArguments(
    ['--packaged', '--measure', '--repeat-each=5'],
    {},
  );
  assert.equal(measure.measure, true);
  assert.deepEqual(
    requiredDesktopSuites(measure),
    requiredDesktopSuites(normal),
  );
  assert.equal(
    measurementGlobalTimeout(measure),
    MEASURE_GLOBAL_TIMEOUT_CAP_MS,
  );
  assert.equal(MEASURE_GLOBAL_TIMEOUT_CAP_MS, 17_400_000);
  assert.equal(
    measurementGlobalTimeout(
      desktopArguments(['--measure', '--repeat-each=2'], {}),
    ),
    14_400_000,
  );
  assert.ok(
    desktopPlaywrightArguments(measure, '/c.ts', ['a.spec.ts']).includes(
      '--global-timeout=17400000',
    ),
  );
  assert.deepEqual(
    playwrightStats({
      stats: { expected: 1, unexpected: 2, skipped: 0, flaky: 0 },
      suites: [],
    }),
    { expected: 1, unexpected: 2, skipped: 0, flaky: 0 },
  );
  assert.equal(playwrightStats({ stats: { expected: 1 }, suites: [] }), null);
  assert.equal(playwrightStats(null), null);
});

test('the default report check still rejects failures and flaky tests', () => {
  const spec = (id: string, status: string, outcome: string) => ({
    id,
    title: id,
    file: 'tests/desktop/data.spec.ts',
    tests: [
      {
        expectedStatus: 'passed',
        status: outcome,
        results: [{ status }],
      },
    ],
  });
  const report = (stats: Record<string, number>, specs: unknown[]) => ({
    stats: { skipped: 0, ...stats },
    suites: [{ file: 'tests/desktop/data.spec.ts', specs }],
  });
  assert.equal(
    completeDesktopReport(
      report({ expected: 1, unexpected: 0, flaky: 0 }, [
        spec('a', 'passed', 'expected'),
      ]),
      ['data.spec.ts'],
    ),
    true,
  );
  assert.equal(
    completeDesktopReport(
      report({ expected: 0, unexpected: 1, flaky: 0 }, [
        spec('a', 'failed', 'unexpected'),
      ]),
      ['data.spec.ts'],
    ),
    false,
  );
  assert.equal(
    completeDesktopReport(
      report({ expected: 1, unexpected: 0, flaky: 1 }, [
        spec('a', 'passed', 'flaky'),
      ]),
      ['data.spec.ts'],
    ),
    false,
  );
});

test('measurement mode records missing suites as a harness error and stays unvalidated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rdlc-desktop-measure-'));
  try {
    assert.equal(
      await runDesktop(['--probe', '--measure', '--repeat-each=2'], root),
      1,
    );
    const status = JSON.parse(
      await readFile(
        join(root, '.vscode-test/desktop-artifacts/runner-status.json'),
        'utf8',
      ),
    );
    assert.equal(status.validated, false);
    assert.equal(status.mode.measure, true);
    assert.equal(status.measurement.repeatEach, 2);
    assert.equal(status.measurement.testFailures, false);
    assert.match(
      status.measurement.harnessErrors.join(' '),
      /missing mandatory suites/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('measurement mode records failing tests without making the run fail', () => {
  const failing = { expected: 3, unexpected: 2, skipped: 1, flaky: 1 };
  // Failed, flaky and skipped tests with a readable report are data, not errors.
  assert.deepEqual(measurementHarnessErrors(1, 5, [], failing), []);
  assert.deepEqual(measurementHarnessErrors(0, 5, [], failing), []);
  // A suite that cannot run or an unreadable report is a harness error.
  assert.match(
    measurementHarnessErrors(1, 4, ['x.spec.ts'], failing).join(),
    /missing mandatory suites: x\.spec\.ts/,
  );
  assert.match(
    measurementHarnessErrors(1, 5, [], null).join(),
    /no readable Playwright JSON report \(runner exit code 1\)/,
  );
  assert.match(measurementHarnessErrors(1, 0, [], null).join(), /no suite/);
});

test('measurement completeness flags interrupted, never-started and absent suites', () => {
  const spec = (file: string, results: unknown[]) => ({
    file,
    tests: [{ results }],
  });
  const clean = {
    suites: [
      { specs: [spec('tests/desktop/a.spec.ts', [{ status: 'passed' }])] },
    ],
  };
  assert.equal(measurementCompleteness(clean, ['a.spec.ts']).incomplete, false);
  const cut = measurementCompleteness(
    {
      errors: [{ message: 'global timeout' }],
      suites: [
        {
          specs: [spec('a.spec.ts', [{ status: 'interrupted' }])],
          suites: [{ specs: [spec('b.spec.ts', [])] }],
        },
      ],
    },
    ['a.spec.ts', 'b.spec.ts', 'c.spec.ts'],
  );
  assert.deepEqual(cut, {
    interrupted: 1,
    notRun: 1,
    missingFiles: ['c.spec.ts'],
    reportErrors: 1,
    incomplete: true,
  });
  assert.equal(measurementCompleteness(null, ['a.spec.ts']).incomplete, true);
});
