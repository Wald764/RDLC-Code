import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REFERENCE_ENVIRONMENT,
  referenceEnvironmentReasons,
} from './evidence.js';
import {
  HOST_OBSERVER_PLATFORM,
  HOST_OBSERVER_TESTS,
  hostObserverUnsupported,
  platformSkipAccepted,
} from './host-observer-scope.js';
import { sweepHostBlockingRules } from './security-observer.js';

/** `measure` and `repeatEach` exist only in measurement mode, so default runs keep their schema. */
export interface DesktopMode {
  probe: boolean;
  packaged: boolean;
  visual: boolean;
  updateBaselines: boolean;
  group: DesktopGroup | null;
  measure?: true;
  repeatEach?: number;
}

export function desktopArguments(
  args: readonly string[],
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): DesktopMode {
  let repeatEach: number | null = null;
  const flags = new Set<string>();
  for (const arg of args) {
    if (arg === '--') continue;
    if (arg === '--repeat-each' || arg.startsWith('--repeat-each=')) {
      const value = /^--repeat-each=(\d+)$/.exec(arg)?.[1];
      if (repeatEach !== null) throw new Error('--repeat-each given twice');
      repeatEach = value === undefined ? Number.NaN : Number(value);
      if (
        !Number.isSafeInteger(repeatEach) ||
        repeatEach < MIN_REPEAT_EACH ||
        repeatEach > MAX_REPEAT_EACH
      )
        throw new Error(
          `--repeat-each must be --repeat-each=<n> with an integer from ${MIN_REPEAT_EACH} to ${MAX_REPEAT_EACH}`,
        );
      continue;
    }
    if (
      ![
        '--probe',
        '--packaged',
        '--visual',
        '--update-baselines',
        '--measure',
      ].includes(arg)
    ) {
      throw new Error(`Unknown Desktop argument: ${arg}`);
    }
    flags.add(arg);
  }
  if (flags.has('--probe') && flags.has('--visual')) {
    throw new Error('--probe and --visual cannot be combined');
  }
  if (repeatEach !== null && !flags.has('--measure'))
    throw new Error('--repeat-each requires --measure');
  if (
    flags.has('--update-baselines') &&
    (flags.has('--measure') || repeatEach !== null)
  )
    throw new Error(
      '--update-baselines cannot be combined with --measure or --repeat-each',
    );
  if (flags.has('--update-baselines')) {
    if (flags.size > 1)
      throw new Error('--update-baselines cannot be combined with other modes');
    // CI never refreshes references unless a deliberate opt-in is also set.
    if (
      env['CI'] &&
      !['', '0', 'false'].includes(env['CI'].toLowerCase()) &&
      env['RDLC_ALLOW_CI_BASELINE_UPDATE'] !== '1'
    )
      throw new Error(
        '--update-baselines is refused in CI unless RDLC_ALLOW_CI_BASELINE_UPDATE=1 is set explicitly',
      );
    // Platform and requested version decide the reference before anything launches.
    if (platform !== REFERENCE_ENVIRONMENT.os)
      throw new Error(
        `--update-baselines is refused before launch: platform ${platform} is not the reference environment (${REFERENCE_ENVIRONMENT.os})`,
      );
    const version =
      env['VSCODE_VERSION'] ?? REFERENCE_ENVIRONMENT.vscodeVersion;
    if (version !== REFERENCE_ENVIRONMENT.vscodeVersion)
      throw new Error(
        `--update-baselines is refused before launch: VS Code version ${version} is not the reference ${REFERENCE_ENVIRONMENT.vscodeVersion}`,
      );
  }
  // CI splits the functional journeys into parallel jobs; unset runs them all.
  const group = env['RDLC_DESKTOP_GROUP'] || null;
  if (group !== null && !(group in DESKTOP_GROUPS))
    throw new Error(
      `Unknown RDLC_DESKTOP_GROUP: ${group} (expected ${Object.keys(DESKTOP_GROUPS).join(', ')})`,
    );
  return {
    probe: flags.has('--probe'),
    packaged: flags.has('--packaged'),
    visual: flags.has('--visual'),
    updateBaselines: flags.has('--update-baselines'),
    group: group as DesktopGroup | null,
    ...(flags.has('--measure')
      ? {
          measure: true as const,
          ...(repeatEach !== null ? { repeatEach } : {}),
        }
      : {}),
  };
}

export const MIN_REPEAT_EACH = 1;
export const MAX_REPEAT_EACH = 10;
const GLOBAL_TIMEOUT_MS = 7_200_000;
/**
 * Measurement runs scale the Playwright global timeout with the repeat count.
 * The cap (290 min) leaves the flake-hunt job (350 min) room for setup and for
 * uploading the results after a truncated run.
 */
export const MEASURE_GLOBAL_TIMEOUT_CAP_MS = 17_400_000;

/** Playwright global timeout (ms) for a measurement run; null leaves the config value. */
export function measurementGlobalTimeout(mode: DesktopMode): number | null {
  if (mode.measure !== true) return null;
  return Math.min(
    GLOBAL_TIMEOUT_MS * (mode.repeatEach ?? 1),
    MEASURE_GLOBAL_TIMEOUT_CAP_MS,
  );
}

/**
 * Measurement mode records failing tests; only these harness problems (a
 * suite that cannot run or a missing report) make the run itself fail.
 */
export function measurementHarnessErrors(
  exitCode: number,
  presentCount: number,
  missing: readonly string[],
  stats: ReturnType<typeof playwrightStats>,
): string[] {
  const errors: string[] = [];
  if (missing.length > 0)
    errors.push(`missing mandatory suites: ${missing.join(', ')}`);
  if (presentCount === 0) errors.push('no suite to run');
  else if (stats === null)
    errors.push(
      `no readable Playwright JSON report (runner exit code ${exitCode})`,
    );
  return errors;
}

/**
 * What a measurement run could not measure: tests that were interrupted or never
 * started (for example cut short by the global timeout), required suite files
 * absent from the report, and report-level errors. Any of them is incomplete.
 */
export function measurementCompleteness(
  value: unknown,
  required: readonly string[],
): {
  interrupted: number;
  notRun: number;
  missingFiles: string[];
  reportErrors: number;
  incomplete: boolean;
} {
  let interrupted = 0;
  let notRun = 0;
  const files = new Set<string>();
  const visit = (suite: unknown, depth: number) => {
    if (!suite || typeof suite !== 'object' || depth > 32) return;
    const node = suite as { specs?: unknown; suites?: unknown };
    for (const spec of Array.isArray(node.specs) ? node.specs : []) {
      const item = spec as { file?: unknown; tests?: unknown };
      if (typeof item?.file === 'string')
        files.add(basename(item.file.replaceAll('\\', '/')));
      for (const test of Array.isArray(item?.tests) ? item.tests : []) {
        const results = (test as { results?: unknown })?.results;
        if (!Array.isArray(results) || results.length === 0) notRun++;
        else if (
          results.some(
            (result) =>
              (result as { status?: unknown } | null)?.status === 'interrupted',
          )
        )
          interrupted++;
      }
    }
    for (const child of Array.isArray(node.suites) ? node.suites : [])
      visit(child, depth + 1);
  };
  const report = (value ?? {}) as { suites?: unknown; errors?: unknown };
  for (const suite of Array.isArray(report.suites) ? report.suites : [])
    visit(suite, 0);
  const missingFiles = required.filter((file) => !files.has(file));
  const reportErrors = Array.isArray(report.errors) ? report.errors.length : 0;
  return {
    interrupted,
    notRun,
    missingFiles,
    reportErrors,
    incomplete:
      interrupted > 0 ||
      notRun > 0 ||
      missingFiles.length > 0 ||
      reportErrors > 0,
  };
}

/**
 * Counts from a Playwright JSON report, or null when it is not one. Measurement
 * mode records these instead of judging them.
 */
export function playwrightStats(value: unknown): {
  expected: number;
  unexpected: number;
  skipped: number;
  flaky: number;
} | null {
  const stats = (value as { stats?: Record<string, unknown> } | null)?.stats;
  const read = (key: string): number | null => {
    const count = stats?.[key];
    return typeof count === 'number' && Number.isSafeInteger(count)
      ? count
      : null;
  };
  const expected = read('expected');
  const unexpected = read('unexpected');
  const skipped = read('skipped');
  const flaky = read('flaky');
  if (
    expected === null ||
    unexpected === null ||
    skipped === null ||
    flaky === null ||
    !Array.isArray((value as { suites?: unknown }).suites)
  )
    return null;
  return { expected, unexpected, skipped, flaky };
}

/** Disjoint partition of the functional journeys; together they are all of them. */
export const DESKTOP_GROUPS = {
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
  ],
  context: ['context.spec.ts'],
} as const;
export type DesktopGroup = keyof typeof DESKTOP_GROUPS;

/** Playwright CLI arguments; reference generation is the only path that updates snapshots. */
export function desktopPlaywrightArguments(
  mode: DesktopMode,
  config: string,
  files: readonly string[],
): string[] {
  return [
    'test',
    '--config',
    config,
    '--reporter=line,json',
    ...(mode.updateBaselines ? ['--update-snapshots=all'] : []),
    // Retries stay 0 in the config: repeats measure instability, they never mask it.
    ...(mode.repeatEach !== undefined
      ? [`--repeat-each=${mode.repeatEach}`]
      : []),
    ...(measurementGlobalTimeout(mode) !== null
      ? [`--global-timeout=${measurementGlobalTimeout(mode)}`]
      : []),
    ...files,
  ];
}

export function requiredDesktopSuites(mode: DesktopMode) {
  if (mode.updateBaselines) return ['bootstrap.spec.ts'];
  if (mode.probe)
    return [
      'bootstrap.spec.ts',
      'security-observer.spec.ts',
      'native-drag.spec.ts',
    ];
  if (mode.visual) return ['visual.spec.ts', 'layout.spec.ts'];
  if (mode.group) return [...DESKTOP_GROUPS[mode.group]];
  return Object.values(DESKTOP_GROUPS).flat();
}

/**
 * Skips are never accepted, with two explicit exceptions (see
 * host-observer-scope.ts): the host-observer journeys on a platform that cannot
 * host the observer, and the platform-scoped PLATFORM_SKIPS allowlist. They are
 * listed in `skippedOut` / `platformSkippedOut` so the run records them as
 * UNVALIDATED.
 */
export function completeDesktopReport(
  value: unknown,
  suites: readonly string[],
  platform: NodeJS.Platform = process.platform,
  skippedOut: string[] = [],
  platformSkippedOut: string[] = [],
): boolean {
  if (!value || typeof value !== 'object') return false;
  const report = value as {
    stats?: Record<string, unknown>;
    suites?: unknown[];
  };
  const stats = report.stats;
  if (
    !stats ||
    !Number.isSafeInteger(stats.expected) ||
    (stats.expected as number) <= 0 ||
    stats.unexpected !== 0 ||
    !Number.isSafeInteger(stats.skipped) ||
    stats.flaky !== 0 ||
    !Array.isArray(report.suites)
  )
    return false;
  const files = new Set<string>();
  const ids = new Set<string>();
  let count = 0;
  const skipped: string[] = [];
  const platformSkipped: string[] = [];
  const visit = (value: unknown, depth: number): boolean => {
    if (!value || typeof value !== 'object' || depth > 32) return false;
    const suite = value as {
      file?: unknown;
      specs?: unknown;
      suites?: unknown;
    };
    if (suite.specs !== undefined) {
      if (!Array.isArray(suite.specs)) return false;
      for (const value of suite.specs) {
        if (!value || typeof value !== 'object') return false;
        const spec = value as {
          id?: unknown;
          title?: unknown;
          file?: unknown;
          tests?: unknown;
        };
        if (
          typeof spec.id !== 'string' ||
          !spec.id ||
          ids.has(spec.id) ||
          typeof spec.file !== 'string' ||
          !Array.isArray(spec.tests) ||
          !spec.tests.length
        )
          return false;
        ids.add(spec.id);
        for (const value of spec.tests) {
          if (!value || typeof value !== 'object') return false;
          const test = value as {
            expectedStatus?: unknown;
            status?: unknown;
            results?: unknown;
          };
          if (
            test.expectedStatus === 'skipped' &&
            test.status === 'skipped' &&
            Array.isArray(test.results) &&
            test.results.length === 1 &&
            test.results[0]?.status === 'skipped' &&
            typeof spec.title === 'string'
          ) {
            if (
              hostObserverUnsupported(platform) &&
              HOST_OBSERVER_TESTS.includes(spec.title)
            ) {
              skipped.push(spec.title);
              continue;
            }
            if (platformSkipAccepted(spec.title, platform)) {
              platformSkipped.push(spec.title);
              continue;
            }
          }
          if (
            test.expectedStatus !== 'passed' ||
            test.status !== 'expected' ||
            !Array.isArray(test.results) ||
            test.results.length !== 1 ||
            test.results[0]?.status !== 'passed'
          )
            return false;
          count++;
        }
        files.add(basename(spec.file.replaceAll('\\', '/')));
      }
    }
    if (
      suite.suites !== undefined &&
      (!Array.isArray(suite.suites) ||
        !suite.suites.every((item) => visit(item, depth + 1)))
    )
      return false;
    return true;
  };
  const complete =
    report.suites.every((suite) => visit(suite, 0)) &&
    count === stats.expected &&
    skipped.length + platformSkipped.length === stats.skipped &&
    suites.every((file) => files.has(file));
  if (complete) {
    skippedOut.push(...skipped);
    platformSkippedOut.push(...platformSkipped);
  }
  return complete;
}

export const FUNCTIONAL_CAPABILITIES = [
  'launch',
  'nativeInput',
  'angular',
  'geometry',
  'source',
  'undo',
  'accessibility',
  'securityObserver',
  'cleanup',
];

type Outcome = 'passed' | 'failed' | 'unsupported' | 'unrun';

/**
 * The security capability is whatever the security-observer spec proved in this
 * same run; bootstrap cannot claim it.
 */
export function deriveSecurityObserverCapability(
  record: unknown,
  platform: NodeJS.Platform = process.platform,
): {
  outcome: Outcome;
  reason: string | null;
} {
  // Host observation exists on Linux only; elsewhere the spec is skipped and
  // leaves no record. That is an explicit, UNVALIDATED scope, not a pass.
  if (hostObserverUnsupported(platform) && !record)
    return {
      outcome: 'unsupported',
      reason: `Native host observation is supported on ${HOST_OBSERVER_PLATFORM} only; unvalidated on ${platform}.`,
    };
  if (!record || typeof record !== 'object')
    return {
      outcome: 'unrun',
      reason:
        'The security observer spec did not produce a result in this run.',
    };
  const security = record as {
    validated?: unknown;
    captureComplete?: unknown;
    checks?: Record<string, unknown>;
    failures?: unknown;
  };
  const failures = Array.isArray(security.failures)
    ? security.failures.filter(
        (item): item is string => typeof item === 'string',
      )
    : [];
  // On Linux the observer is mandatory: an unsupported capture is a failure.
  if (
    security.checks?.['nativeHost'] === 'unsupported' &&
    hostObserverUnsupported(platform)
  )
    return {
      outcome: 'unsupported',
      reason:
        failures.find((item) => /unsupported/i.test(item)) ??
        'Native host observation is unsupported on this platform.',
    };
  if (security.validated === true && security.captureComplete === true)
    return { outcome: 'passed', reason: null };
  return {
    outcome: 'failed',
    reason:
      [
        ...(security.captureComplete === true
          ? []
          : ['Security observation capture was incomplete.']),
        ...failures.slice(0, 3),
      ].join(' ') || 'Security observation did not validate.',
  };
}

export function mergeProbeCapabilities<
  T extends { capabilities?: Record<string, unknown> },
>(
  bootstrap: T,
  security: unknown,
  platform: NodeJS.Platform = process.platform,
) {
  const derived = deriveSecurityObserverCapability(security, platform);
  return {
    ...bootstrap,
    capabilities: {
      ...bootstrap.capabilities,
      securityObserver: derived.outcome,
    } as Record<string, unknown>,
    securityObserverReason: derived.reason,
  };
}

/**
 * Functional capabilities gate every entry. Pixels gate only the pinned
 * reference environment, where a comparison is mandatory; elsewhere it must be
 * unrun, and a claimed pass is rejected.
 */
export function completeDriverCapabilities(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const probe = value as {
    validated?: unknown;
    capabilities?: Record<string, unknown>;
    identity?: Record<string, unknown>;
    environment?: Parameters<typeof referenceEnvironmentReasons>[0];
  };
  const identity = probe.identity;
  if (
    probe.validated !== true ||
    !identity ||
    typeof identity.version !== 'string' ||
    !/^\d+\.\d+\.\d+/.test(identity.version) ||
    typeof identity.build !== 'string' ||
    !/^[a-f0-9]{40}$/.test(identity.build) ||
    typeof identity.executableSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(identity.executableSha256) ||
    !probe.environment ||
    typeof probe.environment !== 'object'
  )
    return false;
  const reference = referenceEnvironmentReasons(probe.environment).length === 0;
  return (
    FUNCTIONAL_CAPABILITIES.every(
      (key) =>
        probe.capabilities?.[key] === 'passed' ||
        // Unsupported host observation is recorded, not failed, off Linux only.
        (key === 'securityObserver' &&
          probe.capabilities?.[key] === 'unsupported' &&
          typeof probe.environment?.os === 'string' &&
          hostObserverUnsupported(probe.environment.os as NodeJS.Platform)),
    ) &&
    probe.capabilities?.['screenshotComparison'] ===
      (reference ? 'passed' : 'unrun')
  );
}

/**
 * Once the Playwright child is gone, remove host-blocking rules a killed or
 * crashed run may have left behind. Best effort (root or `sudo -n`): the result
 * is logged and returned, and nothing here can change the run's exit status.
 */
export function sweepAfterRun(
  platform: NodeJS.Platform,
  sweep: typeof sweepHostBlockingRules = sweepHostBlockingRules,
  log: (message: string) => void = console.log,
): string {
  let outcome: string;
  if (platform !== 'linux') outcome = `skipped: not linux (${platform})`;
  else
    try {
      outcome = `removed ${sweep({ platform }).removed} leftover tagged rule(s)`;
    } catch (error) {
      outcome = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  log(`Host blocking sweep: ${outcome}`);
  return outcome;
}

export async function runDesktop(
  args: readonly string[],
  root = process.cwd(),
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  sweep: typeof sweepHostBlockingRules = sweepHostBlockingRules,
) {
  const mode = desktopArguments(args, env, platform);
  const artifactRoot = resolve(root, '.vscode-test/desktop-artifacts');
  const artifactDir = resolve(artifactRoot, `run-${randomUUID()}`);
  await mkdir(artifactDir, { recursive: true });
  const required = requiredDesktopSuites(mode);
  const present = required.filter((file) =>
    existsSync(resolve(root, 'tests/desktop', file)),
  );
  const missing = required.filter((file) => !present.includes(file));
  const reportPath = resolve(artifactDir, 'playwright-report.json');
  await rm(reportPath, { force: true });
  // Run available assertions too: missing later suites must not hide bootstrap diagnostics.
  let exitCode = 1;
  let hostBlockingSweep: string | null = null;
  if (present.length > 0) {
    const require = createRequire(import.meta.url);
    const cli = resolve(
      dirname(require.resolve('playwright/package.json')),
      'cli.js',
    );
    exitCode = await new Promise<number>((done, reject) => {
      const child = spawn(
        process.execPath,
        [
          cli,
          ...desktopPlaywrightArguments(
            mode,
            resolve(root, 'tests/desktop/playwright.config.ts'),
            present,
          ),
        ],
        {
          cwd: root,
          stdio: 'inherit',
          env: {
            ...process.env,
            RDLC_DESKTOP_ROOT: root,
            RDLC_DESKTOP_ARTIFACT_DIR: artifactDir,
            RDLC_DESKTOP_PACKAGED: String(mode.packaged),
            RDLC_DESKTOP_PROBE: String(mode.probe),
            RDLC_DESKTOP_UPDATE_BASELINES: String(mode.updateBaselines),
            PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
            VSCODE_VERSION: process.env.VSCODE_VERSION ?? '1.142.0',
          },
        },
      );
      child.once('error', reject);
      child.once('exit', (code) => done(code ?? 1));
    });
    if (
      present.some((file) =>
        ['security-observer.spec.ts', 'offline.spec.ts'].includes(file),
      )
    )
      hostBlockingSweep = sweepAfterRun(platform, sweep);
  }
  let reportComplete = false;
  const unvalidatedSkips: string[] = [];
  const unvalidatedPlatformSkips: string[] = [];
  let probeComplete = !mode.probe;
  let visual: { eligible: boolean; reasons: string[] } | null = null;
  let measuredStats: ReturnType<typeof playwrightStats> = null;
  let completeness: ReturnType<typeof measurementCompleteness> | null = null;
  try {
    const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
    measuredStats = playwrightStats(report);
    completeness = measurementCompleteness(report, required);
    reportComplete = completeDesktopReport(
      report,
      required,
      platform,
      unvalidatedSkips,
      unvalidatedPlatformSkips,
    );
  } catch {
    // Missing or malformed execution evidence cannot certify a suite.
  }
  if (mode.probe) {
    const readJson = async (file: string): Promise<unknown> => {
      try {
        return JSON.parse(await readFile(resolve(artifactDir, file), 'utf8'));
      } catch {
        return null;
      }
    };
    const bootstrap = await readJson('bootstrap/probe.json');
    if (bootstrap && typeof bootstrap === 'object') {
      // Merge the same-run security result; bootstrap cannot claim it.
      const merged = mergeProbeCapabilities(
        bootstrap as { capabilities?: Record<string, unknown> },
        await readJson('security-observer/probe.json'),
        platform,
      );
      probeComplete = completeDriverCapabilities(merged);
      const reasons = referenceEnvironmentReasons(
        (
          merged as {
            environment?: Parameters<typeof referenceEnvironmentReasons>[0];
          }
        ).environment ??
          ({} as Parameters<typeof referenceEnvironmentReasons>[0]),
      );
      visual = {
        eligible:
          reasons.length === 0 &&
          merged.capabilities['screenshotComparison'] === 'passed',
        reasons: reasons.length
          ? [
              'non-reference environment: visual acceptance is unvalidated',
              ...reasons,
            ]
          : [],
      };
      // Missing capability records fail even when a test runner exits successfully.
      await writeFile(
        resolve(artifactDir, 'driver-capabilities.json'),
        `${JSON.stringify({ ...merged, visual, accepted: probeComplete }, null, 2)}\n`,
      );
    }
  }
  const harnessErrors =
    mode.measure === true
      ? measurementHarnessErrors(
          exitCode,
          present.length,
          missing,
          measuredStats,
        )
      : [];
  const status = {
    schemaVersion: 1,
    artifactDir,
    mode,
    version: process.env.VSCODE_VERSION ?? '1.142.0',
    required,
    missing,
    runnerExitCode: exitCode,
    hostBlockingSweep,
    // Host-observer cases skipped off Linux: explicitly UNVALIDATED, not passed.
    unvalidatedHostObserver: {
      platform,
      supported: !hostObserverUnsupported(platform),
      skipped: unvalidatedSkips,
    },
    // Other platform-scoped skips (PLATFORM_SKIPS): also UNVALIDATED, not passed.
    unvalidatedPlatformSkips: {
      platform,
      skipped: unvalidatedPlatformSkips,
    },
    reportComplete,
    probeComplete,
    visual,
    ...(mode.measure === true
      ? {
          measurement: {
            repeatEach: mode.repeatEach ?? 1,
            stats: measuredStats,
            // Interrupted or never-started tests: the aggregate job fails on these.
            ...(completeness ?? {
              interrupted: 0,
              notRun: 0,
              missingFiles: [...required],
              reportErrors: 0,
              incomplete: true,
            }),
            testFailures:
              exitCode !== 0 &&
              measuredStats !== null &&
              harnessErrors.length === 0,
            harnessErrors,
          },
        }
      : {}),
    // Reference generation and measurement are never acceptance evidence.
    validated:
      !mode.updateBaselines &&
      mode.measure !== true &&
      exitCode === 0 &&
      missing.length === 0 &&
      reportComplete &&
      probeComplete,
  };
  await writeFile(
    resolve(artifactDir, 'runner-status.json'),
    `${JSON.stringify(status, null, 2)}\n`,
  );
  await writeFile(
    resolve(artifactRoot, 'runner-status.json'),
    `${JSON.stringify(status, null, 2)}\n`,
  );
  if (missing.length > 0) {
    console.error(`Missing mandatory Desktop suites: ${missing.join(', ')}`);
  }
  if (mode.measure === true) {
    for (const error of harnessErrors)
      console.error(`Measurement harness error: ${error}`);
    return harnessErrors.length === 0 ? 0 : 1;
  }
  if (mode.updateBaselines)
    return exitCode === 0 && missing.length === 0 && reportComplete ? 0 : 1;
  return status.validated ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runDesktop(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
