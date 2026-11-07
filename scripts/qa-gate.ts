/**
 * QA gate of the CI `Required checks` job (mode `pr`) and of the release gate
 * (mode `release`). It evaluates the evidence uploaded by the workflow jobs and
 * never rewrites a failed test as passed: the original jobs stay red, only the
 * gate decides what blocks. Severity comes from tests/desktop/qa-classification.ts
 * (anything unlisted is critical). Missing evidence is a critical failure.
 */
import assert from 'node:assert/strict';
import {
  appendFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CANDIDATE_CELL,
  CANDIDATE_CELL_CHECKS,
  DESKTOP_CELL_CHECKS,
  EXPECTED_MATRIX,
  VISUAL_CELL_CHECKS,
  classifyCheck,
  classifyTest,
  exceptionAllowed,
  expectedChecks,
  skipAllowed,
  stripAnsi,
  testId,
  type CellCheck,
} from '../tests/desktop/qa-classification.js';
import {
  DESKTOP_GROUPS,
  requiredDesktopSuites,
  type DesktopGroup,
} from '../tests/desktop/run-tests.js';
import {
  acceptedFailures,
  parseReadiness,
  validateQaExceptions,
  type QaException,
} from './validate-release.js';

export type GateMode = 'pr' | 'release';
export type GateStatus =
  | 'MERGEABLE'
  | 'NOT MERGEABLE'
  | 'PUBLISHABLE'
  | 'FULLY VALIDATED'
  | 'NOT PUBLISHABLE';

export interface Item {
  id: string;
  kind: 'job' | 'check' | 'test' | 'evidence' | 'cell';
  scope?: string;
  detail: string;
  justification?: string;
  /** Release only: where the item was found (`ci` or `candidate`). */
  origin?: string;
  /** Release only: the exception that accepts an informational item. */
  exception?: QaException;
}

export interface QaSummary {
  candidate: string;
  mode: GateMode;
  status: GateStatus;
  blocking: Item[];
  informational: Item[];
  accepted: Item[];
  unvalidated: Item[];
  missing: Item[];
}

export interface CellJson {
  schema: 1;
  candidate: string;
  kind: 'desktop' | 'visual' | 'candidate';
  os: string;
  vscode: string;
  group?: string;
  steps: Record<string, string>;
  vsixSha256?: string;
}

export interface RunEvidence {
  name: string;
  status: unknown;
  report: unknown;
}

export interface CellEvidence {
  cell: CellJson;
  runs: RunEvidence[];
}

type Bucket = Pick<
  QaSummary,
  'blocking' | 'informational' | 'unvalidated' | 'missing'
>;
const bucket = (): Bucket => ({
  blocking: [],
  informational: [],
  unvalidated: [],
  missing: [],
});
const merge = (into: Bucket, from: Bucket): void => {
  into.blocking.push(...from.blocking);
  into.informational.push(...from.informational);
  into.unvalidated.push(...from.unvalidated);
  into.missing.push(...from.missing);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const firstLine = (text: string): string =>
  stripAnsi(text)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? '';

// ---------------------------------------------------------------------------
// Per-test report parsing

export interface ReportedTest {
  file: string;
  title: string;
  passed: boolean;
  skipped: boolean;
  status: string;
  /** Number of recorded attempts (retries are disabled: exactly one). */
  resultCount: number;
  /** Status of the last attempt, '' when none was recorded. */
  finalStatus: string;
  /** Error messages of every attempt (never snippets or stacks), deduplicated. */
  errorMessages: string[];
  /** The messages joined, for display. */
  errorText: string;
}

/** Every test of a Playwright JSON report; null when the report is malformed. */
export function collectTests(report: unknown): ReportedTest[] | null {
  if (!isObject(report) || !Array.isArray(report['suites'])) return null;
  const tests: ReportedTest[] = [];
  let valid = true;
  const visit = (value: unknown, depth: number): void => {
    if (!isObject(value) || depth > 32) {
      valid = false;
      return;
    }
    for (const spec of Array.isArray(value['specs']) ? value['specs'] : []) {
      if (
        !isObject(spec) ||
        typeof spec['title'] !== 'string' ||
        typeof spec['file'] !== 'string' ||
        !Array.isArray(spec['tests'])
      ) {
        valid = false;
        continue;
      }
      for (const test of spec['tests']) {
        if (!isObject(test)) {
          valid = false;
          continue;
        }
        const results = Array.isArray(test['results']) ? test['results'] : [];
        const last = results.at(-1);
        const lastStatus = isObject(last) ? String(last['status']) : '';
        // Only `message`: the snippet and the stack quote neighbouring source
        // lines, which must never decide the severity of a failure.
        const errors = [
          ...new Set(
            results.flatMap((result) => {
              if (!isObject(result)) return [];
              const list = [
                result['error'],
                ...(Array.isArray(result['errors']) ? result['errors'] : []),
              ];
              return list.flatMap((error) =>
                isObject(error) && typeof error['message'] === 'string'
                  ? [error['message']]
                  : [],
              );
            }),
          ),
        ];
        const status = String(test['status']);
        tests.push({
          file: basename(spec['file']),
          title: spec['title'],
          status,
          resultCount: results.length,
          finalStatus: lastStatus,
          skipped: status === 'skipped',
          passed:
            test['expectedStatus'] === 'passed' &&
            status === 'expected' &&
            results.length >= 1 &&
            lastStatus === 'passed',
          errorMessages: errors,
          errorText: errors.join('\n'),
        });
      }
    }
    for (const child of Array.isArray(value['suites']) ? value['suites'] : [])
      visit(child, depth + 1);
  };
  for (const suite of report['suites']) visit(suite, 0);
  return valid ? tests : null;
}

type RunKind = 'probe' | 'functional' | 'installed' | 'visual';
function runKind(status: unknown): RunKind | null {
  if (!isObject(status) || !isObject(status['mode'])) return null;
  const mode = status['mode'];
  if (mode['updateBaselines'] === true) return null;
  if (mode['probe'] === true) return 'probe';
  if (mode['visual'] === true) return 'visual';
  return mode['packaged'] === true ? 'installed' : 'functional';
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

// ---------------------------------------------------------------------------
// Cell evaluation

const cellScope = (cell: CellJson): string =>
  cell.group
    ? `${cell.os}/${cell.vscode}/${cell.group}`
    : `${cell.os}/${cell.vscode}`;

/**
 * What runner-status.json says beyond the per-test results: a non-zero runner
 * exit with no failing test, an incomplete report or a run the runner itself
 * did not validate is never silently accepted. `validated` is only meaningful
 * outside measurement runs (the flake hunt never validates).
 */
export function runnerStatusIssues(
  status: Record<string, unknown>,
  failingTests: number,
  checkValidated: boolean,
): { missing: boolean; detail: string }[] {
  const issues: { missing: boolean; detail: string }[] = [];
  const exit = status['runnerExitCode'];
  if (typeof exit !== 'number')
    issues.push({
      missing: true,
      detail: 'the runner status records no runnerExitCode',
    });
  else if (exit !== 0 && failingTests === 0)
    issues.push({
      missing: false,
      detail: `the runner exited with code ${exit} but no test failed in the report`,
    });
  // The runner clears reportComplete as soon as one test fails: failing tests
  // are judged one by one, and completeness is verified from the report itself
  // (completenessIssues), so the flag only matters when nothing failed.
  const complete = status['reportComplete'] === true;
  if (!complete && failingTests === 0)
    issues.push({
      missing: true,
      detail: 'the runner status reports an incomplete Playwright report',
    });
  else if (
    checkValidated &&
    complete &&
    status['validated'] !== true &&
    failingTests === 0 &&
    typeof exit === 'number' &&
    exit === 0
  )
    issues.push({
      missing: false,
      detail: 'the runner did not validate this run (validated is not true)',
    });
  return issues;
}

/** Spec files the run must contain, derived from its mode and the cell group. */
function expectedSuites(
  status: Record<string, unknown>,
  group?: string,
  stability = false,
) {
  const mode = status['mode'];
  if (!isObject(mode)) return [];
  const known = (value: unknown): DesktopGroup | null =>
    typeof value === 'string' && value in DESKTOP_GROUPS
      ? (value as DesktopGroup)
      : null;
  const probe = mode['probe'] === true;
  const visual = mode['visual'] === true;
  // Probe and visual runs have fixed suites; a cell's functional and installed
  // runs cover exactly the group of the matrix cell.
  const cellGroup = probe || visual ? null : known(group);
  // Only the stability evaluation honours a measurement run restricted to the
  // changed specs; a cell or candidate run always owes its full suites.
  const measure = stability && mode['measure'] === true;
  return requiredDesktopSuites({
    probe,
    packaged: mode['packaged'] === true,
    visual,
    updateBaselines: false,
    group: cellGroup ?? known(mode['group']),
    ...(measure && Array.isArray(mode['specs'])
      ? { specs: stringList(mode['specs']) }
      : {}),
  });
}

/**
 * Completeness checked from the report, independently of the runner's own
 * flags: every spec file of the mode (and cell group) is present, and every
 * test ended with exactly one final result (passed, failed or timed out; an
 * allowed skip is judged separately). A failing test cannot hide an absent
 * suite or a test that never ran.
 */
export function completenessIssues(
  tests: readonly ReportedTest[],
  status: Record<string, unknown>,
  group?: string,
  stability = false,
): string[] {
  const issues: string[] = [];
  const files = new Set(tests.map((test) => test.file));
  const absent = [
    ...new Set([
      ...expectedSuites(status, group, stability),
      ...stringList(status['required']),
    ]),
  ].filter((file) => !files.has(file));
  if (absent.length > 0)
    issues.push(`spec files absent from the report: ${absent.join(', ')}`);
  for (const test of tests.filter(unaccounted))
    issues.push(
      `${testId(test.file, test.title)} has no single final result (${test.resultCount} attempt(s), last status ${test.finalStatus || 'none'})`,
    );
  return issues;
}

/** A test that neither passed, nor failed or timed out once, nor was skipped. */
const unaccounted = (test: ReportedTest): boolean =>
  !test.passed &&
  !test.skipped &&
  (test.resultCount !== 1 ||
    !['failed', 'timedOut'].includes(test.finalStatus));

function evaluateRuns(
  check: CellCheck,
  outcome: string | undefined,
  evidence: CellEvidence,
  downgrade: boolean,
): Bucket {
  const result = bucket();
  const scope = cellScope(evidence.cell);
  const id = `cell:${check.id}`;
  const severity = downgrade ? 'informational' : 'critical';
  const note = downgrade
    ? classifyCheck('job:visual').justification
    : undefined;
  const lack = (detail: string): void => {
    const item: Item = {
      id,
      kind: 'check',
      scope,
      detail,
      ...(note ? { justification: note } : {}),
    };
    (severity === 'critical' ? result.missing : result.informational).push(
      item,
    );
  };
  const fail = (item: Item): void => {
    (severity === 'critical' ? result.blocking : result.informational).push(
      downgrade && note ? { ...item, justification: note } : item,
    );
  };
  const step = outcome ?? 'missing';
  const runs = evidence.runs.filter((run) => runKind(run.status) === check.run);
  if (runs.length === 0) {
    lack(
      `no Desktop run report for mode "${check.run}" (step outcome: ${step})`,
    );
    return result;
  }
  for (const run of runs) {
    const where = `${check.id}/${run.name}`;
    const tests = collectTests(run.report);
    const status = isObject(run.status) ? run.status : {};
    if (!tests || tests.length === 0) {
      lack(`${where}: the Playwright report is missing or malformed`);
      continue;
    }
    for (const gap of completenessIssues(tests, status, evidence.cell.group))
      lack(`${where}: ${gap}`);
    const runMissing = stringList(status['missing']);
    if (runMissing.length > 0)
      lack(`${where}: mandatory suites missing: ${runMissing.join(', ')}`);
    let failures = 0;
    for (const test of tests) {
      if (test.passed) continue;
      // The skip allowlist is verified here (file, title and platform of the
      // runner OS), never taken from what the runner reported.
      if (
        test.skipped &&
        skipAllowed(test.file, test.title, evidence.cell.os)
      ) {
        result.unvalidated.push({
          id: testId(test.file, test.title),
          kind: 'test',
          scope,
          detail: `UNVALIDATED: skipped on this platform (${where})`,
        });
        continue;
      }
      // Reported as missing evidence by completenessIssues, not as a failure.
      if (unaccounted(test)) continue;
      failures++;
      const classification = classifyTest(
        test.file,
        test.title,
        test.errorMessages,
      );
      const item: Item = {
        id: testId(test.file, test.title),
        kind: 'test',
        scope,
        detail: `${where}: ${
          test.skipped
            ? 'unexpectedly skipped (not an allowlisted platform skip)'
            : test.status
        }${test.errorText ? ` - ${firstLine(test.errorText)}` : ''}`,
        ...(classification.justification
          ? { justification: classification.justification }
          : {}),
      };
      if (classification.severity === 'critical') result.blocking.push(item);
      else result.informational.push(item);
    }
    for (const issue of runnerStatusIssues(status, failures, true)) {
      const detail = `${where}: ${issue.detail}`;
      if (issue.missing) lack(detail);
      else fail({ id, kind: 'check', scope, detail });
    }
    if (outcome === 'success' && failures > 0)
      fail({
        id,
        kind: 'check',
        scope,
        detail: `${where}: step succeeded but the report lists ${failures} failing test(s)`,
      });
    else if (outcome !== 'success' && failures === 0)
      fail({
        id,
        kind: 'check',
        scope,
        detail: `${where}: step ${step} but no test failed in the report`,
      });
    else if (
      failures > 0 &&
      check.run === 'probe' &&
      status['probeComplete'] !== true
    )
      fail({
        id,
        kind: 'check',
        scope,
        detail: `${where}: driver capability probe incomplete`,
      });
  }
  return result;
}

/** Judge one cell against the expected steps of its kind. */
export function evaluateCell(
  evidence: CellEvidence,
  checks: readonly CellCheck[],
  downgrade = false,
): Bucket {
  const result = bucket();
  const { cell } = evidence;
  const scope = cellScope(cell);
  for (const { check, step } of expectedChecks(
    checks,
    cell.os,
    cell.group ?? null,
  )) {
    const outcome = cell.steps[step];
    if (check.run) {
      merge(result, evaluateRuns(check, outcome, evidence, downgrade));
      continue;
    }
    if (outcome === 'success') continue;
    const id = `cell:${check.id}`;
    const item: Item = {
      id,
      kind: 'check',
      scope,
      detail: `step "${step}" ${outcome ?? 'has no recorded outcome'}`,
    };
    const severity = downgrade
      ? classifyCheck('job:visual')
      : classifyCheck(id);
    if (severity.severity === 'critical')
      (outcome === undefined ? result.missing : result.blocking).push(item);
    else
      result.informational.push({
        ...item,
        ...(severity.justification
          ? { justification: severity.justification }
          : {}),
      });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Evidence loading

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

function findFiles(directory: string, name: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === name) found.push(path);
    }
  };
  walk(directory);
  return found.sort();
}

/** Load every cell evidence found below `directory`. */
export function loadCells(directory: string): {
  cells: CellEvidence[];
  errors: string[];
} {
  const cells: CellEvidence[] = [];
  const errors: string[] = [];
  for (const path of findFiles(directory, 'cell.json')) {
    const value = readJson(path);
    if (
      !isObject(value) ||
      value['schema'] !== 1 ||
      typeof value['candidate'] !== 'string' ||
      !['desktop', 'visual', 'candidate'].includes(String(value['kind'])) ||
      typeof value['os'] !== 'string' ||
      typeof value['vscode'] !== 'string' ||
      !isObject(value['steps'])
    ) {
      errors.push(`${path}: unreadable cell evidence`);
      continue;
    }
    const base = join(path, '..', 'runs');
    const runs: RunEvidence[] = [];
    let names: string[] = [];
    try {
      names = readdirSync(base).sort();
    } catch {
      names = [];
    }
    for (const name of names)
      runs.push({
        name,
        status: readJson(join(base, name, 'runner-status.json')),
        report: readJson(join(base, name, 'playwright-report.json')),
      });
    cells.push({ cell: value as unknown as CellJson, runs });
  }
  return { cells, errors };
}

export function loadCiSummaries(directory: string): {
  path: string;
  summary: unknown;
}[] {
  return findFiles(directory, 'qa-summary.json').map((path) => ({
    path,
    summary: readJson(path),
  }));
}

export interface StabilityRun {
  /** Path of the report relative to the stability evidence directory. */
  name: string;
  /** Runner OS from the artifact name (`flake-results-<os>-...`), or ''. */
  os: string;
  status: unknown;
  report: unknown;
}

/** Load every flake-hunt run (`flake-results-*` artifacts) below `directory`. */
export function loadStability(directory: string): StabilityRun[] {
  return findFiles(directory, 'playwright-report.json').map((path) => {
    const relative = path.slice(directory.length).replace(/^[\\/]+/, '');
    const artifact = relative.split(/[\\/]/)[0] ?? '';
    return {
      name: relative.replaceAll('\\', '/'),
      os:
        /^flake-results-((?:ubuntu|windows|macos)-[0-9.]+)-/.exec(
          artifact,
        )?.[1] ?? '',
      status: readJson(join(path, '..', 'runner-status.json')),
      report: readJson(path),
    };
  });
}

/** Whether a bucket holds a failure, a missing item or an informational item. */
const explains = (items: Bucket): boolean =>
  items.blocking.length + items.missing.length + items.informational.length > 0;

const unexplainedFailure = (id: string, detail: string): Item => ({
  id,
  kind: 'job',
  detail: `unexplained job failure: ${detail}`,
});

/**
 * The changed-spec stability gate, judged per test: a critical test that
 * failed under the strict repeat blocks, an informational-only failure is
 * informational. A failed job with no per-test evidence blocks (fail closed);
 * no changed spec and a skipped job is not missing evidence.
 */
export function evaluateStability(input: {
  result: string | undefined;
  changedSpecsResult: string | undefined;
  changedSpecs: string | undefined;
  runs: readonly StabilityRun[];
}): Bucket {
  const result = bucket();
  const id = 'job:stability';
  for (const run of input.runs) {
    const status = isObject(run.status) ? run.status : {};
    const tests = collectTests(run.report);
    const where = `stability/${run.name}`;
    const scope = run.os ? `${run.os}/stability` : 'stability';
    if (!tests || tests.length === 0) {
      result.missing.push({
        id,
        kind: 'check',
        scope,
        detail: `${where}: the Playwright report is missing or malformed`,
      });
      continue;
    }
    for (const gap of completenessIssues(tests, status, undefined, true))
      result.missing.push({
        id,
        kind: 'check',
        scope,
        detail: `${where}: ${gap}`,
      });
    let failures = 0;
    for (const test of tests) {
      if (test.passed) continue;
      if (test.skipped && skipAllowed(test.file, test.title, run.os)) {
        result.unvalidated.push({
          id: testId(test.file, test.title),
          kind: 'test',
          scope,
          detail: `UNVALIDATED: skipped on this platform (${where})`,
        });
        continue;
      }
      if (unaccounted(test)) continue;
      failures++;
      const classification = classifyTest(
        test.file,
        test.title,
        test.errorMessages,
      );
      const item: Item = {
        id: testId(test.file, test.title),
        kind: 'test',
        scope,
        detail: `${where}: ${
          test.skipped ? 'unexpectedly skipped' : test.status
        } under the strict repeat${test.errorText ? ` - ${firstLine(test.errorText)}` : ''}`,
        ...(classification.justification
          ? { justification: classification.justification }
          : {}),
      };
      if (classification.severity === 'critical') result.blocking.push(item);
      else result.informational.push(item);
    }
    for (const issue of runnerStatusIssues(status, failures, false)) {
      const item: Item = {
        id,
        kind: 'check',
        scope,
        detail: `${where}: ${issue.detail}`,
      };
      (issue.missing ? result.missing : result.blocking).push(item);
    }
  }
  // Whether per-test evidence explains a failed job (before the coverage gaps).
  const explained = explains(result);
  // Changed specs the repeated matrix must have covered (a spec only the
  // pinned visual job runs is not part of it).
  const functional: readonly string[] = Object.values(DESKTOP_GROUPS).flat();
  const owed = (input.changedSpecs ?? '')
    .split(',')
    .map((file) => file.trim())
    .filter((file) => functional.includes(file));
  if (
    owed.length > 0 &&
    input.result !== undefined &&
    input.result !== 'skipped'
  ) {
    const evidenceGap = (detail: string): void => {
      result.missing.push({ id, kind: 'check', scope: 'stability', detail });
    };
    if (input.runs.length === 0)
      evidenceGap(`no flake-results run was uploaded for ${owed.join(', ')}`);
    for (const run of input.runs)
      if (!isObject(isObject(run.status) ? run.status['mode'] : undefined))
        evidenceGap(`stability/${run.name}: the runner status has no mode`);
    const reported = new Set(
      input.runs.flatMap((run) =>
        (collectTests(run.report) ?? []).map((test) => test.file),
      ),
    );
    const uncovered = owed.filter((file) => !reported.has(file));
    if (input.runs.length > 0 && uncovered.length > 0)
      evidenceGap(
        `the stability reports do not cover the changed specs: ${uncovered.join(', ')}`,
      );
  }
  result.blocking = dedupe(result.blocking);
  result.informational = dedupe(result.informational);
  switch (input.result) {
    case undefined:
    case 'success':
      break;
    case 'skipped':
      // Nothing changed, or the detection already failed (blocking there).
      if (
        input.changedSpecsResult === 'success' &&
        (input.changedSpecs === undefined || input.changedSpecs.trim() !== '')
      )
        result.missing.push({
          id,
          kind: 'job',
          detail: 'the stability gate was skipped although specs changed',
        });
      break;
    case 'failure':
      if (!explained)
        result.blocking.push(
          unexplainedFailure(id, 'no per-test stability evidence was uploaded'),
        );
      break;
    default:
      result.blocking.push({
        id,
        kind: 'job',
        detail: `job result: ${input.result || 'unknown'}`,
      });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Evaluation

export interface JobResults {
  [job: string]: string;
}

const find = (
  cells: readonly CellEvidence[],
  kind: CellJson['kind'],
  os: string,
  vscode: string,
  group?: string,
): CellEvidence | undefined =>
  cells.find(
    (entry) =>
      entry.cell.kind === kind &&
      entry.cell.os === os &&
      entry.cell.vscode === vscode &&
      (group === undefined || entry.cell.group === group),
  );

function candidateMismatch(
  evidence: CellEvidence,
  candidate: string,
): Item | null {
  return evidence.cell.candidate === candidate
    ? null
    : {
        id: 'candidate-sha',
        kind: 'cell',
        scope: cellScope(evidence.cell),
        detail: `evidence candidate ${evidence.cell.candidate} differs from ${candidate}`,
      };
}

function evaluateJobs(
  jobs: JobResults,
  derived: readonly string[],
  required: readonly string[],
  result: Bucket,
): void {
  for (const id of required)
    if (!(id in jobs))
      result.missing.push({
        id: `job:${id}`,
        kind: 'job',
        detail: 'job result not provided',
      });
  for (const [id, outcome] of Object.entries(jobs)) {
    if (derived.includes(id) || outcome === 'success') continue;
    const classification = classifyCheck(`job:${id}`);
    const item: Item = {
      id: `job:${id}`,
      kind: 'job',
      detail: `job result: ${outcome || 'unknown'}`,
      ...(classification.justification
        ? { justification: classification.justification }
        : {}),
    };
    (classification.severity === 'critical'
      ? result.blocking
      : result.informational
    ).push(item);
  }
}

/** Evaluate a CI run (mode `pr`). */
export function evaluatePr(input: {
  candidate: string;
  jobs: JobResults;
  cells: readonly CellEvidence[];
  loadErrors?: readonly string[];
  /** Flake-hunt runs of the stability gate (`flake-results-*` artifacts). */
  stability?: readonly StabilityRun[];
  /** Output `specs` of the `changed-specs` job; undefined when unknown. */
  changedSpecs?: string;
}): QaSummary {
  const result = bucket();
  const desktopResult = bucket();
  for (const error of input.loadErrors ?? [])
    result.blocking.push({ id: 'evidence', kind: 'cell', detail: error });
  evaluateJobs(
    input.jobs,
    ['desktop', 'stability'],
    ['quality', 'desktop'],
    result,
  );
  const desktop = input.jobs['desktop'];
  if (desktop === 'cancelled')
    result.blocking.push({
      id: 'job:desktop',
      kind: 'job',
      detail: 'job result: cancelled',
    });
  if (desktop === 'skipped')
    result.missing.push({
      id: 'job:desktop',
      kind: 'job',
      detail: 'no Desktop evidence: the job was skipped',
    });
  else if (desktop !== undefined)
    for (const os of EXPECTED_MATRIX.os)
      for (const vscode of EXPECTED_MATRIX.vscode)
        for (const group of EXPECTED_MATRIX.group) {
          const evidence = find(input.cells, 'desktop', os, vscode, group);
          if (!evidence) {
            result.missing.push({
              id: 'cell:evidence',
              kind: 'cell',
              scope: `${os}/${vscode}/${group}`,
              detail: 'no evidence uploaded for this matrix cell',
            });
            continue;
          }
          const mismatch = candidateMismatch(evidence, input.candidate);
          if (mismatch) desktopResult.blocking.push(mismatch);
          merge(desktopResult, evaluateCell(evidence, DESKTOP_CELL_CHECKS));
        }
  merge(result, desktopResult);
  if (desktop === 'failure' && !explains(desktopResult))
    result.blocking.push(
      unexplainedFailure(
        'job:desktop',
        'no failing test, step or missing evidence explains it',
      ),
    );
  const visual = input.cells.find((entry) => entry.cell.kind === 'visual');
  if (visual) {
    const mismatch = candidateMismatch(visual, input.candidate);
    if (mismatch) result.blocking.push(mismatch);
    merge(result, evaluateCell(visual, VISUAL_CELL_CHECKS, true));
    // A critical test inside the informational visual job still blocks.
  } else if (
    input.jobs['visual'] !== undefined &&
    input.jobs['visual'] !== 'skipped'
  )
    result.informational.push({
      id: 'job:visual',
      kind: 'job',
      detail: 'no per-test evidence was uploaded',
      justification: classifyCheck('job:visual').justification ?? '',
    });
  merge(
    result,
    evaluateStability({
      result: input.jobs['stability'],
      changedSpecsResult: input.jobs['changed-specs'],
      changedSpecs: input.changedSpecs,
      runs: input.stability ?? [],
    }),
  );
  const failed = result.blocking.length > 0 || result.missing.length > 0;
  return {
    candidate: input.candidate,
    mode: 'pr',
    status: failed ? 'NOT MERGEABLE' : 'MERGEABLE',
    blocking: result.blocking,
    informational: result.informational,
    accepted: [],
    unvalidated: dedupe(result.unvalidated),
    missing: result.missing,
  };
}

function dedupe(items: Item[]): Item[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.id}|${item.scope ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const exceptionMatches = (exception: QaException, item: Item): boolean =>
  exception.id === item.id &&
  (exception.scope === undefined ||
    item.scope === exception.scope ||
    (item.scope ?? '').startsWith(`${exception.scope}/`));

/** Evaluate a release candidate (mode `release`). */
export function evaluateRelease(input: {
  candidate: string;
  jobs: JobResults;
  cells: readonly CellEvidence[];
  loadErrors?: readonly string[];
  ciSummaries: readonly { path: string; summary: unknown }[];
  readinessMarkdown: string | null;
  vsixSha256?: string;
}): QaSummary {
  const result = bucket();
  const accepted: Item[] = [];
  let exceptions: QaException[] = [];
  let acceptedEvidence: { id: string; issue: string; reason: string }[] = [];
  for (const error of input.loadErrors ?? [])
    result.blocking.push({ id: 'evidence', kind: 'cell', detail: error });
  evaluateJobs(
    input.jobs,
    ['candidate-qa', 'quality'],
    ['validation', 'canonical', 'candidate-qa'],
    result,
  );

  // Release-readiness record: exceptions and accepted-failure evidence.
  try {
    assert.ok(
      input.readinessMarkdown !== null,
      'readiness record not provided',
    );
    const record = parseReadiness(input.readinessMarkdown);
    exceptions = validateQaExceptions(record.qaExceptions, exceptionAllowed);
    acceptedEvidence = acceptedFailures(record);
  } catch (error) {
    result.blocking.push({
      id: 'release-readiness',
      kind: 'evidence',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // CI result for the exact tag commit.
  const named = input.ciSummaries.find(
    (entry) =>
      basename(join(entry.path, '..')) === `qa-summary-${input.candidate}`,
  );
  const ci = named ?? input.ciSummaries[0];
  const summary = ci?.summary;
  if (!ci || !isObject(summary))
    result.missing.push({
      id: 'ci:qa-summary',
      kind: 'evidence',
      detail: 'the CI qa-summary of this candidate is missing or unreadable',
    });
  else {
    const list = (key: string): Item[] =>
      Array.isArray(summary[key]) ? (summary[key] as Item[]) : [];
    if (summary['candidate'] !== input.candidate || !named)
      result.blocking.push({
        id: 'ci:candidate-sha',
        kind: 'evidence',
        detail: `CI qa-summary candidate ${String(summary['candidate'])} (${ci.path}) is not ${input.candidate}`,
      });
    if (summary['mode'] !== 'pr' || summary['status'] !== 'MERGEABLE')
      result.blocking.push({
        id: 'ci:status',
        kind: 'evidence',
        detail: `CI qa-summary status is ${String(summary['status'])}, not MERGEABLE`,
      });
    for (const item of list('blocking'))
      result.blocking.push({ ...item, origin: 'ci' });
    for (const item of list('missing'))
      result.missing.push({ ...item, origin: 'ci' });
    for (const item of list('informational'))
      result.informational.push({ ...item, origin: 'ci' });
    for (const item of list('unvalidated'))
      result.unvalidated.push({ ...item, origin: 'ci' });
  }
  // `quality` is the whole ci.yml run, judged through its qa-summary above.
  if (
    input.jobs['quality'] === 'failure' &&
    ![...result.blocking, ...result.missing, ...result.informational].some(
      (item) => item.origin === 'ci' || item.id.startsWith('ci:'),
    )
  )
    result.blocking.push(
      unexplainedFailure(
        'job:quality',
        'the CI qa-summary lists nothing that explains it',
      ),
    );

  // Candidate QA on the exact canonical bytes.
  const candidate = find(
    input.cells,
    'candidate',
    CANDIDATE_CELL.os,
    CANDIDATE_CELL.vscode,
  );
  const candidateJob = input.jobs['candidate-qa'];
  if (
    candidateJob !== undefined &&
    !['success', 'failure'].includes(candidateJob)
  )
    result.blocking.push({
      id: 'job:candidate-qa',
      kind: 'job',
      detail: `job result: ${candidateJob || 'unknown'}`,
    });
  if (!candidate)
    result.missing.push({
      id: 'cell:evidence',
      kind: 'cell',
      scope: `${CANDIDATE_CELL.os}/${CANDIDATE_CELL.vscode}`,
      detail: 'no candidate QA evidence for the canonical bytes',
    });
  else {
    const mismatch = candidateMismatch(candidate, input.candidate);
    if (mismatch) result.blocking.push(mismatch);
    if (!input.vsixSha256 || !/^[a-f0-9]{64}$/.test(input.vsixSha256))
      result.blocking.push({
        id: 'canonical:vsix-sha256',
        kind: 'evidence',
        detail: 'the canonical VSIX digest was not provided',
      });
    else if (candidate.cell.vsixSha256 !== input.vsixSha256)
      result.blocking.push({
        id: 'canonical:vsix-sha256',
        kind: 'evidence',
        scope: cellScope(candidate.cell),
        detail: `candidate QA tested ${candidate.cell.vsixSha256 ?? 'unknown bytes'}, not the canonical ${input.vsixSha256}`,
      });
    const own = evaluateCell(candidate, CANDIDATE_CELL_CHECKS);
    for (const list of [own.blocking, own.informational, own.unvalidated])
      for (const item of list) item.origin = 'candidate';
    for (const item of own.missing) item.origin = 'candidate';
    merge(result, own);
    if (candidateJob === 'failure' && !explains(own))
      result.blocking.push(
        unexplainedFailure(
          'job:candidate-qa',
          'no failing test, step or missing evidence explains it',
        ),
      );
  }

  // Informational failures need a documented exception.
  const unaccepted: Item[] = [];
  for (const item of result.informational) {
    const exception = exceptions.find((entry) => exceptionMatches(entry, item));
    if (exception) accepted.push({ ...item, exception });
    else unaccepted.push(item);
  }
  for (const entry of acceptedEvidence)
    accepted.push({
      id: `evidence:${entry.id}`,
      kind: 'evidence',
      detail: `accepted failure (${entry.issue}): ${entry.reason}`,
    });
  const unvalidated = dedupe(result.unvalidated);
  const failed =
    result.blocking.length > 0 ||
    result.missing.length > 0 ||
    unaccepted.length > 0;
  const status: GateStatus = failed
    ? 'NOT PUBLISHABLE'
    : accepted.length === 0 && unvalidated.length === 0
      ? 'FULLY VALIDATED'
      : 'PUBLISHABLE';
  return {
    candidate: input.candidate,
    mode: 'release',
    status,
    blocking: result.blocking,
    informational: unaccepted,
    accepted,
    unvalidated,
    missing: result.missing,
  };
}

export const gateFailed = (summary: QaSummary): boolean =>
  summary.status === 'NOT MERGEABLE' || summary.status === 'NOT PUBLISHABLE';

// ---------------------------------------------------------------------------
// Rendering

export function renderMarkdown(summary: QaSummary): string {
  const lines = [
    `## QA gate (${summary.mode}): ${summary.status}`,
    '',
    `Candidate: \`${summary.candidate}\``,
    '',
  ];
  const section = (title: string, items: Item[]): void => {
    lines.push(`### ${title} (${items.length})`, '');
    if (items.length === 0) lines.push('None.', '');
    for (const item of items) {
      const scope = item.scope ? ` [${item.scope}]` : '';
      const origin = item.origin ? ` (${item.origin})` : '';
      lines.push(`- \`${item.id}\`${scope}${origin}: ${item.detail}`);
      if (item.exception)
        lines.push(
          `  - exception: ${item.exception.issue} (${item.exception.reason}; accepted by ${item.exception.acceptedBy} on ${item.exception.acceptedOn})`,
        );
      if (item.justification) lines.push(`  - why: ${item.justification}`);
    }
    if (items.length > 0) lines.push('');
  };
  section('Blocking', summary.blocking);
  section('Missing critical evidence', summary.missing);
  section(
    summary.mode === 'release'
      ? 'Informational failures without exception'
      : 'Informational failures (not blocking)',
    summary.informational,
  );
  if (summary.mode === 'release')
    section('Accepted (documented exceptions)', summary.accepted);
  section('UNVALIDATED (platform skips)', summary.unvalidated);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// CLI

function needsFromEnvironment(): {
  jobs: JobResults;
  changedSpecs: string | undefined;
} {
  const raw = process.env['QA_NEEDS'];
  assert.ok(raw, 'QA_NEEDS (toJSON(needs)) is required');
  const value: unknown = JSON.parse(raw);
  assert.ok(isObject(value), 'QA_NEEDS must be a JSON object');
  const changed = value['changed-specs'];
  const outputs = isObject(changed) ? changed['outputs'] : undefined;
  const specs = isObject(outputs) ? outputs['specs'] : undefined;
  return {
    jobs: Object.fromEntries(
      Object.entries(value).map(([id, job]) => [
        id,
        isObject(job) ? String(job['result'] ?? '') : '',
      ]),
    ),
    changedSpecs: typeof specs === 'string' ? specs : undefined,
  };
}

export function runCli(args: readonly string[]): number {
  const mode = args[0];
  assert.ok(mode === 'pr' || mode === 'release', 'Usage: qa-gate pr|release');
  const option = (name: string): string => {
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? '') : '';
  };
  const candidate = option('--candidate');
  assert.match(candidate, /^[a-f0-9]{40}$/, '--candidate must be a full SHA');
  const { cells, errors } = loadCells(option('--evidence') || 'qa-evidence');
  const { jobs, changedSpecs } = needsFromEnvironment();
  const summary =
    mode === 'pr'
      ? evaluatePr({
          candidate,
          jobs,
          cells,
          loadErrors: errors,
          stability: loadStability(option('--stability') || 'qa-stability'),
          ...(changedSpecs === undefined ? {} : { changedSpecs }),
        })
      : evaluateRelease({
          candidate,
          jobs,
          cells,
          loadErrors: errors,
          ciSummaries: loadCiSummaries(option('--ci-summary') || 'qa-ci'),
          readinessMarkdown: (() => {
            try {
              return readFileSync(
                option('--readiness') || 'docs/validation/release-readiness.md',
                'utf8',
              );
            } catch {
              return null;
            }
          })(),
          vsixSha256: option('--vsix-sha256'),
        });
  writeFileSync(
    option('--out') || 'qa-summary.json',
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const markdown = renderMarkdown(summary);
  console.log(markdown);
  if (process.env['GITHUB_STEP_SUMMARY'])
    appendFileSync(process.env['GITHUB_STEP_SUMMARY'], markdown);
  if (process.env['GITHUB_OUTPUT'])
    appendFileSync(process.env['GITHUB_OUTPUT'], `status=${summary.status}\n`);
  return gateFailed(summary) ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
