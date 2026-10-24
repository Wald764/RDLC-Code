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
  mergeProbeCapabilities,
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

const FUNCTIONAL = [
  'launch',
  'nativeInput',
  'angular',
  'source',
  'undo',
  'accessibility',
  'securityObserver',
  'cleanup',
];

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
  const missing = deriveSecurityObserverCapability(null);
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
  const unsupported = deriveSecurityObserverCapability({
    validated: false,
    captureComplete: false,
    checks: { nativeHost: 'unsupported' },
    failures: ['Native host process-tree attach is unsupported: win32'],
  });
  assert.equal(unsupported.outcome, 'unsupported');
  assert.match(unsupported.reason ?? '', /win32/);

  const bootstrap = makeProbe(referenceEnvironment);
  // Bootstrap claims a pass; without the security spec result it is overridden.
  const merged = mergeProbeCapabilities(bootstrap, null);
  assert.equal(merged.capabilities.securityObserver, 'unrun');
  assert.equal(completeDriverCapabilities(merged), false);
  assert.equal(
    completeDriverCapabilities(mergeProbeCapabilities(bootstrap, ok)),
    true,
  );
  assert.equal(
    completeDriverCapabilities(
      mergeProbeCapabilities(bootstrap, {
        ...ok,
        validated: false,
        failures: ['x'],
      }),
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
  assert.deepEqual(desktopArguments(['--', '--probe', '--packaged']), {
    probe: true,
    packaged: true,
    visual: false,
    updateBaselines: false,
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
