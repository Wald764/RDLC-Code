/**
 * Single source of truth for the QA gate (scripts/qa-gate.ts): which checks and
 * which Desktop tests may fail without blocking a merge (`informational`) and
 * which always block (`critical`).
 *
 * Fail closed: anything not listed here is critical. Every informational rule
 * carries a written justification. Classification is per test, never per job:
 * a critical assertion inside an informational suite stays blocking.
 */

import {
  HOST_OBSERVER_TESTS,
  hostObserverUnsupported,
  platformSkipAccepted,
} from './host-observer-scope.js';

export type Severity = 'critical' | 'informational';

export interface Classification {
  readonly severity: Severity;
  readonly ruleId?: string;
  readonly justification?: string;
}

export interface InformationalTestRule {
  readonly id: string;
  /** Spec file name (for example `visual.spec.ts`); every test of it matches. */
  readonly file: string;
  /** Exact test titles; empty or absent matches every test of the file. */
  readonly titles?: readonly string[];
  /**
   * Allowlist of failure signatures matched against the Playwright error
   * messages (never the code snippet or stack, which quote neighbouring
   * source). The rule only applies when every recorded error message matches at
   * least one signature; a missing, empty or unknown message is critical (fail
   * closed). Every rule needs one: no informational rule is whole-file.
   */
  readonly failure: readonly RegExp[];
  /**
   * Literals that must still appear in the spec source, so a reworded
   * assertion message cannot silently turn a signature into dead text
   * (enforced by the unit test).
   */
  readonly anchors: readonly string[];
  readonly justification: string;
}

/**
 * A Playwright expect failure: the matcher line with its Expected/Received
 * block, ending right after the received number. `pollTimeout` additionally
 * accepts the `Call Log` that `expect.poll` appends when its own matcher
 * timeout (never the test timeout) ran out.
 */
const expectFailure = (
  matcher: string,
  expected: string,
  pollTimeout = false,
): RegExp =>
  new RegExp(
    `expect\\(received\\)\\.${matcher}\\(expected\\)[^\\n]*\\n\\s*Expected:\\s*${expected}\\s*\\n\\s*Received:\\s*-?[0-9.]+${
      pollTimeout
        ? '(?:\\s*\\n\\s*Call Log:\\s*\\n\\s*- Timeout \\d+ms exceeded while waiting on the predicate)?'
        : ''
    }\\s*$`,
  );

export const INFORMATIONAL_TEST_RULES: readonly InformationalTestRule[] = [
  {
    id: 'visual-references',
    file: 'visual.spec.ts',
    failure: [
      // toHaveScreenshot: pixel-ratio and image-size differences.
      /Screenshot comparison failed:/,
      /\d+ pixels? \(ratio [0-9.]+ of all image pixels\) are different/,
      // expectContrast: a measured contrast below the minimum, or a glyph
      // colour that could not be proven, so the measurement fails closed.
      /composited contrast [0-9.]+:1 .* must reach [0-9.]+:1/,
      /unvalidated painted foreground/,
      /no painted foreground was proven/,
      /no painted cluster matches the expected/,
      /the measured region must contain rendered pixels/,
      // The pinned reference environment no longer describes the runner.
      /the actual observed driver environment must match the pinned reference/,
      /reference metadata (?:os|osImage|vscodeVersion|vscodeBuild|locale|timezone|fonts|display\.(?:width|height|dpr))\b/,
    ],
    anchors: [
      'toHaveScreenshot(',
      'composited contrast',
      'unvalidated painted foreground',
      'no painted foreground was proven',
      'no painted cluster matches the expected',
      'the measured region must contain rendered pixels',
      'the actual observed driver environment must match the pinned reference',
      '`reference metadata ${name}`',
    ],
    justification:
      'Pixel and contrast comparisons against pinned references: a rendering difference has no data-integrity or security impact. Only the comparison and measurement failures are informational; source-preservation (byte equality), missing baselines, timeouts and crashes stay critical.',
  },
  {
    id: 'layout-rendering',
    file: 'layout.spec.ts',
    failure: [
      // Canvas origin drift budgets (US6.3, SC-007, FR-029).
      /unintended canvas origin drift (?:within budget|across 100 interactions)/,
      /the canvas origin does not move/,
      // Interface scaling measurements (FR-028, US6.2).
      /the interface scale returns to the launched baseline/,
      /the viewport and the device pixel ratio agree on the observed scale/,
      /coverage gap: the driver cannot reach exactly/,
      expectFailure('toBeLessThanOrEqual', '<=\\s*0\\.005'),
    ],
    anchors: [
      'unintended canvas origin drift within budget',
      'unintended canvas origin drift across 100 interactions',
      'the canvas origin does not move',
      'the interface scale returns to the launched baseline',
      'the viewport and the device pixel ratio agree on the observed scale',
      'coverage gap: the driver cannot reach exactly',
      '.toBeLessThanOrEqual(0.005)',
    ],
    justification:
      'Scaling and canvas-drift measurements of the rendered canvas: layout differences without data or security impact. Source-preservation, no-edit and no-commit assertions in the same tests, timeouts and crashes stay critical.',
  },
  {
    id: 'native-drag-unavailable',
    file: 'native-drag.spec.ts',
    failure: [expectFailure('toBeGreaterThanOrEqual', '>=\\s*1', true)],
    anchors: ['.toBeGreaterThanOrEqual(1)'],
    justification:
      'Only the documented capability-unavailable outcome is informational: the public TreeView handleDrag never ran because the driver cannot start a native drag on this runner (recorded as unavailable-with-evidence). A drop after cancel, a modified source, a timeout or a crash stays critical.',
  },
  {
    id: 'selection-timing-budget',
    file: 'structure.spec.ts',
    titles: ['SC-003-timing'],
    failure: [expectFailure('toBeGreaterThanOrEqual', '>=\\s*95')],
    anchors: ['.toBeGreaterThanOrEqual(95)'],
    justification:
      'Only the hosted-runner latency budget (95 of 100 selection samples within 200 ms) is informational; any other assertion failure in this test (selection correctness, source bytes, spinbutton) stays critical.',
  },
];

/**
 * Tests that are critical by decision (essential keyboard operability, data
 * and security journeys). No informational rule may ever match them; the unit
 * test enforces it.
 */
export const PINNED_CRITICAL_TESTS: readonly {
  readonly file: string;
  readonly title: string;
  readonly reason: string;
}[] = [
  {
    file: 'accessibility.spec.ts',
    title: 'US6.1-keyboard-journey',
    reason: 'essential keyboard authoring',
  },
  {
    file: 'accessibility.spec.ts',
    title: 'FR-027-keyboard',
    reason: 'essential keyboard authoring',
  },
  {
    file: 'accessibility.spec.ts',
    title: 'SC-006-keyboard-themes',
    reason: 'keyboard operability in every theme',
  },
  {
    file: 'components.spec.ts',
    title: 'FR-017-keyboard',
    reason: 'keyboard creation of components',
  },
  {
    file: 'context.spec.ts',
    title: 'SC-005-switch-races',
    reason: 'correctness race, not a timing budget',
  },
  {
    file: 'security-observer.spec.ts',
    title:
      'security observer: real trust states, host tree and webview attempts fail closed',
    reason: 'security observation',
  },
  {
    file: 'offline.spec.ts',
    title: 'SC-009-monitored-offline',
    reason: 'offline and no-network security guarantee',
  },
];

/**
 * Spec file of every test the platform skip allowlists of
 * tests/desktop/host-observer-scope.ts may skip. The gate checks a skip as
 * file + title + platform; the unit test keeps this map in sync with the specs
 * and with those allowlists.
 */
export const SKIPPABLE_TEST_FILES: Readonly<Record<string, string>> = {
  'security observer: real trust states, host tree and webview attempts fail closed':
    'security-observer.spec.ts',
  'FR-030-trust': 'offline.spec.ts',
  'SC-009-monitored-offline': 'offline.spec.ts',
  'FR-014-no-fetch': 'offline.spec.ts',
  'EDGE-05-inert': 'offline.spec.ts',
  'US6.4-trusted-restricted': 'offline.spec.ts',
  'US5.3-two-views': 'context.spec.ts',
  'US5.1-switches': 'context.spec.ts',
  'SC-005-switch-races': 'context.spec.ts',
  'SC-003-timing': 'structure.spec.ts',
};

export interface TestIdentity {
  readonly file: string;
  readonly title: string;
}

const basename = (file: string): string => file.split(/[\\/]/).pop() ?? file;

/** The informational rule covering a test, ignoring any failure-text condition. */
export function matchInformationalRule(
  file: string,
  title: string,
): InformationalTestRule | null {
  const name = basename(file);
  if (PINNED_CRITICAL_TESTS.some((p) => p.file === name && p.title === title))
    return null;
  return (
    INFORMATIONAL_TEST_RULES.find(
      (rule) =>
        rule.file === name &&
        (!rule.titles || rule.titles.length === 0
          ? true
          : rule.titles.includes(title)),
    ) ?? null
  );
}

/** Remove ANSI colour codes Playwright adds to error messages. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Severity of a failed test. `failureMessages` are the recorded Playwright
 * error messages (one string, or one entry per error); the informational rule
 * only applies when every message matches one of its signatures.
 */
export function classifyTest(
  file: string,
  title: string,
  failureMessages?: string | readonly string[],
): Classification {
  const rule = matchInformationalRule(file, title);
  if (!rule) return { severity: 'critical' };
  const messages =
    failureMessages === undefined
      ? []
      : typeof failureMessages === 'string'
        ? [failureMessages]
        : failureMessages;
  if (
    messages.length === 0 ||
    !messages.every((message) =>
      rule.failure.some((signature) => signature.test(stripAnsi(message))),
    )
  )
    return { severity: 'critical' };
  return {
    severity: 'informational',
    ruleId: rule.id,
    justification: rule.justification,
  };
}

/** Identifier used by release exceptions for a test. */
export const testId = (file: string, title: string): string =>
  `${basename(file)}::${title}`;

export interface InformationalCheckRule {
  readonly id: string;
  readonly justification: string;
}

/**
 * CI jobs whose failure is visible but not blocking. `changed-specs` is
 * critical (its failure means the stability evidence is missing) and
 * `stability` is judged per test from the flake-hunt reports (scripts/qa-gate.ts),
 * never as a whole job.
 */
export const INFORMATIONAL_CHECKS: readonly InformationalCheckRule[] = [
  {
    id: 'job:visual',
    justification:
      'Pinned visual references run in one reference environment; rendering differences have no data or security impact. Failing critical tests inside it are still blocking.',
  },
];

/** Severity of a check id (`job:<id>` or `cell:<check>`); unknown ids are critical. */
export function classifyCheck(id: string): Classification {
  const rule = INFORMATIONAL_CHECKS.find((r) => r.id === id);
  return rule
    ? {
        severity: 'informational',
        ruleId: rule.id,
        justification: rule.justification,
      }
    : { severity: 'critical' };
}

/** Whether a release exception may name this id (informational only). */
export function exceptionAllowed(id: string): boolean {
  if (INFORMATIONAL_CHECKS.some((r) => r.id === id)) return true;
  const separator = id.indexOf('::');
  if (separator <= 0) return false;
  return (
    matchInformationalRule(id.slice(0, separator), id.slice(separator + 2)) !==
    null
  );
}

// ---------------------------------------------------------------------------
// Expected evidence

/** Axes of the `desktop` job of ci.yml (a test keeps the workflow in sync). */
export const EXPECTED_MATRIX = {
  os: ['ubuntu-24.04', 'windows-2022', 'macos-15'],
  vscode: ['1.142.0', 'stable'],
  group: ['core', 'authoring', 'context'],
} as const;

export const CANDIDATE_CELL = {
  os: 'ubuntu-24.04',
  vscode: '1.142.0',
} as const;

export type OsFamily = 'linux' | 'windows' | 'macos';

export function osFamily(os: string): OsFamily {
  if (os.startsWith('windows')) return 'windows';
  if (os.startsWith('macos')) return 'macos';
  return 'linux';
}

const NODE_PLATFORM: Record<OsFamily, NodeJS.Platform> = {
  linux: 'linux',
  windows: 'win32',
  macos: 'darwin',
};

/**
 * Whether a skipped test is an allowlisted platform skip, checked here
 * independently of what the runner reported: the file, the title and the
 * platform of the runner OS must all match tests/desktop/host-observer-scope.ts.
 * Any other skip is a failure.
 */
export function skipAllowed(file: string, title: string, os: string): boolean {
  if (
    !Object.prototype.hasOwnProperty.call(SKIPPABLE_TEST_FILES, title) ||
    SKIPPABLE_TEST_FILES[title] !== basename(file)
  )
    return false;
  const platform = NODE_PLATFORM[osFamily(os)];
  return (
    platformSkipAccepted(title, platform) ||
    (HOST_OBSERVER_TESTS.includes(title) && hostObserverUnsupported(platform))
  );
}

export type RunMode = 'probe' | 'functional' | 'installed' | 'visual';

export interface CellCheck {
  /** Logical check id, reported as `cell:<id>`. */
  readonly id: string;
  /** Step id (in cell.json `steps`) per OS family; a missing family means n/a. */
  readonly steps: Partial<Record<OsFamily, string>>;
  /** Only these groups run the check; absent means every group. */
  readonly groups?: readonly string[];
  /** Test-bearing checks are judged through the per-test reports of this mode. */
  readonly run?: RunMode;
}

const both = (step: string): CellCheck['steps'] => ({
  linux: step,
  windows: step,
  macos: step,
});
const linuxOrOther = (linux: string, other: string): CellCheck['steps'] => ({
  linux,
  windows: other,
  macos: other,
});

/** Critical steps of one cell of the `desktop` job. */
export const DESKTOP_CELL_CHECKS: readonly CellCheck[] = [
  { id: 'install', steps: both('install') },
  { id: 'build', steps: both('build') },
  { id: 'package', steps: both('package') },
  { id: 'vscode-provisioning', steps: both('download-vscode') },
  { id: 'display-windows', steps: { windows: 'display-windows' } },
  { id: 'display-macos', steps: { macos: 'display-macos' } },
  {
    id: 'vscode-host',
    steps: linuxOrOther('vscode-linux', 'vscode-other'),
    groups: ['core'],
  },
  {
    id: 'linux-resources',
    steps: { linux: 'resources' },
    groups: ['core'],
  },
  {
    id: 'package-tests',
    steps: linuxOrOther('package-tests-linux', 'package-tests-other'),
    groups: ['core'],
  },
  { id: 'linux-environment', steps: { linux: 'prepare-linux' } },
  {
    id: 'probe',
    steps: linuxOrOther('probe-linux', 'probe-other'),
    groups: ['core'],
    run: 'probe',
  },
  {
    id: 'e2e-functional',
    steps: linuxOrOther('e2e-linux', 'e2e-other'),
    run: 'functional',
  },
  {
    id: 'e2e-installed',
    steps: linuxOrOther('installed-linux', 'installed-other'),
    run: 'installed',
  },
];

/** Steps of the pinned `visual` job of ci.yml (Linux, minimum VS Code). */
export const VISUAL_CELL_CHECKS: readonly CellCheck[] = [
  { id: 'install', steps: both('install') },
  { id: 'build', steps: both('build') },
  { id: 'linux-environment', steps: { linux: 'provision' } },
  { id: 'visual', steps: { linux: 'visual' }, run: 'visual' },
];

/** Steps of the release `candidate-qa` job: the exact canonical bytes. */
export const CANDIDATE_CELL_CHECKS: readonly CellCheck[] = [
  { id: 'install', steps: both('install') },
  { id: 'compile', steps: both('compile') },
  { id: 'canonical-bytes', steps: both('bind') },
  { id: 'linux-environment', steps: { linux: 'provision' } },
  { id: 'vscode-provisioning', steps: both('download-vscode') },
  { id: 'probe', steps: { linux: 'probe' }, run: 'probe' },
  { id: 'e2e-installed', steps: { linux: 'installed' }, run: 'installed' },
  { id: 'visual', steps: { linux: 'visual' }, run: 'visual' },
];

/** The steps one cell must have run successfully, per check, for its OS and group. */
export function expectedChecks(
  checks: readonly CellCheck[],
  os: string,
  group: string | null,
): { check: CellCheck; step: string }[] {
  const family = osFamily(os);
  const expected: { check: CellCheck; step: string }[] = [];
  for (const check of checks) {
    if (check.groups && (group === null || !check.groups.includes(group)))
      continue;
    const step = check.steps[family];
    if (step) expected.push({ check, step });
  }
  return expected;
}
