import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Aggregates the Playwright JSON reports of a flake hunt (tests/desktop/run-tests.ts
 * `--measure --repeat-each=<n>`) into per-test, per-environment failure rates.
 * Nothing here retries, hides or reclassifies a failure.
 */

export interface Environment {
  os: string;
  vscode: string;
  group: string;
  mode: string;
}

export interface LoadedReport {
  /** Path relative to the input directory, with forward slashes. */
  path: string;
  report: unknown;
  /** Parsed runner-status.json next to the report, when present. */
  status: unknown;
}

export interface FlakeRow {
  title: string;
  file: string;
  environment: Environment;
  runs: number;
  passes: number;
  failures: number;
  timedOut: number;
  interrupted: number;
  skipped: number;
  /** Tests with no recorded result at all (never started). */
  notRun: number;
  /** Every recorded execution of the test, whatever its outcome. */
  executions: number;
  /** Repeats the runner status declares for this environment, when known. */
  repeatEach: number | null;
  failureRate: number | null;
  firstError: string | null;
  skipReasons: string[];
}

export interface FlakeReport {
  schemaVersion: 1;
  repeatEach: number | null;
  reports: number;
  unreadable: string[];
  harnessErrors: { environment: Environment; errors: string[] }[];
  /** Environments whose measurement was cut short or unusable. */
  incomplete: { environment: Environment; reasons: string[] }[];
  /** Expected environments that produced no readable report. */
  missing: Environment[];
  /** False when anything is incomplete, missing or unreadable. */
  complete: boolean;
  rows: FlakeRow[];
  neverRan: FlakeRow[];
}

interface JsonResult {
  status?: string;
  retry?: number;
  error?: { message?: string };
  errors?: { message?: string }[];
  annotations?: { type?: string; description?: string }[];
}

interface JsonTest {
  repeatEachIndex?: number;
  projectName?: string;
  annotations?: { type?: string; description?: string }[];
  results?: JsonResult[];
}

interface JsonSpec {
  title?: string;
  file?: string | undefined;
  tests?: JsonTest[];
}

interface JsonSuite {
  file?: string | undefined;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

const REPORT_FILE = 'playwright-report.json';
const STATUS_FILE = 'runner-status.json';
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

/** The first non-empty line of an error message, without terminal colors. */
export function firstErrorLine(message: string | undefined): string | null {
  const line = (message ?? '')
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return null;
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

export function modeLabel(status: unknown): string {
  const mode = object(object(status)['mode']);
  if (typeof mode['probe'] !== 'boolean') return 'unknown';
  if (mode['visual'] === true) return 'visual';
  if (mode['probe'] === true)
    return mode['packaged'] === true ? 'probe-packaged' : 'probe';
  return mode['packaged'] === true ? 'packaged' : 'functional';
}

const PLATFORM_OS: Record<string, string> = {
  linux: 'linux',
  win32: 'windows',
  darwin: 'macos',
};

/**
 * Matrix coordinates. The artifact folder name is the matrix entry itself, so it
 * wins; the runner status labels reports that were not downloaded per artifact.
 */
export function environmentOf(path: string, status: unknown): Environment {
  const record = object(status);
  const folder =
    /^flake-results-(.+)-(stable|\d+\.\d+\.\d+)-(core|authoring|context)-(probe-packaged|functional|packaged)\//.exec(
      path,
    );
  const platform = object(record['unvalidatedHostObserver'])['platform'];
  const group = object(record['mode'])['group'];
  return {
    os:
      folder?.[1] ??
      (typeof platform === 'string'
        ? (PLATFORM_OS[platform] ?? platform)
        : 'unknown'),
    vscode:
      folder?.[2] ??
      (typeof record['version'] === 'string' ? record['version'] : 'unknown'),
    group: folder?.[3] ?? (typeof group === 'string' ? group : 'unknown'),
    mode: folder?.[4] ?? modeLabel(status),
  };
}

function environmentKey(environment: Environment): string {
  return [
    environment.os,
    environment.vscode,
    environment.group,
    environment.mode,
  ].join('\u0000');
}

/** Every report under `directory`, with the runner status next to it. */
export async function loadReports(
  directory: string,
): Promise<{ loaded: LoadedReport[]; unreadable: string[] }> {
  const loaded: LoadedReport[] = [];
  const unreadable: string[] = [];
  const entries = (await readdir(directory, { recursive: true }))
    .map((entry) => entry.replaceAll('\\', '/'))
    .filter((entry) => basename(entry) === REPORT_FILE)
    .sort();
  for (const entry of entries) {
    try {
      const report: unknown = JSON.parse(
        await readFile(join(directory, entry), 'utf8'),
      );
      let status: unknown = null;
      try {
        status = JSON.parse(
          await readFile(join(directory, dirname(entry), STATUS_FILE), 'utf8'),
        );
      } catch {
        // The status only labels the environment; the report still counts.
      }
      loaded.push({ path: entry, report, status });
    } catch {
      unreadable.push(entry);
    }
  }
  return { loaded, unreadable };
}

function skipReason(test: JsonTest, result: JsonResult | undefined): string {
  const annotation = [
    ...(result?.annotations ?? []),
    ...(test.annotations ?? []),
  ].find((item) => item.type === 'skip' && item.description);
  return annotation?.description ?? 'skipped without a recorded reason';
}

function collectSpecs(
  suite: JsonSuite,
  into: JsonSpec[],
  file: string | undefined,
  depth = 0,
): JsonSpec[] {
  if (depth > 32) return into;
  const here = suite.file ?? file;
  for (const spec of suite.specs ?? [])
    into.push(spec.file === undefined ? { ...spec, file: here } : spec);
  for (const child of suite.suites ?? [])
    collectSpecs(child, into, here, depth + 1);
  return into;
}

/** Pure aggregation of loaded reports; `repeatEachIndex` is positional when absent. */
export function analyze(
  loaded: readonly LoadedReport[],
  unreadable: readonly string[] = [],
  expected: readonly Environment[] = [],
): FlakeReport {
  const reasons = new Map<
    string,
    { environment: Environment; reasons: string[] }
  >();
  const flag = (environment: Environment, reason: string) => {
    const key = environmentKey(environment);
    const entry = reasons.get(key) ?? { environment, reasons: [] };
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    reasons.set(key, entry);
  };
  const seen = new Set<string>();
  const envOf = new Map<string, Environment>();
  const tally = new Map<string, { interrupted: number; notRun: number }>();
  const rows = new Map<string, FlakeRow>();
  const harnessErrors: FlakeReport['harnessErrors'] = [];
  let repeatEach: number | null = null;
  for (const { path, report, status } of loaded) {
    const environment = environmentOf(path, status);
    seen.add(environmentKey(environment));
    envOf.set(environmentKey(environment), environment);
    const measurement = object(object(status)['measurement']);
    if (typeof measurement['repeatEach'] === 'number')
      repeatEach = Math.max(repeatEach ?? 0, measurement['repeatEach']);
    const environmentRepeat =
      typeof measurement['repeatEach'] === 'number'
        ? measurement['repeatEach']
        : null;
    const errors = measurement['harnessErrors'];
    if (Array.isArray(errors) && errors.length)
      harnessErrors.push({
        environment,
        errors: errors.filter(
          (item): item is string => typeof item === 'string',
        ),
      });
    if (Array.isArray(errors) && errors.length)
      flag(environment, `harness error: ${String(errors[0])}`);
    if (measurement['incomplete'] === true)
      flag(environment, 'runner flagged the measurement incomplete');
    const reportErrors = object(report)['errors'];
    if (Array.isArray(reportErrors) && reportErrors.length)
      flag(
        environment,
        `Playwright reported ${reportErrors.length} run-level error(s): ${firstErrorLine(object(reportErrors[0])['message'] as string | undefined) ?? 'no message'}`,
      );
    const suites = object(report)['suites'];
    const specs: JsonSpec[] = [];
    if (Array.isArray(suites))
      for (const suite of suites)
        collectSpecs(object(suite) as JsonSuite, specs, undefined);
    for (const spec of specs) {
      const title = typeof spec.title === 'string' ? spec.title : '(untitled)';
      const file = basename((spec.file ?? '').replaceAll('\\', '/'));
      const key = `${environmentKey(environment)}\u0000${file}\u0000${title}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          title,
          file,
          environment,
          runs: 0,
          passes: 0,
          failures: 0,
          timedOut: 0,
          interrupted: 0,
          skipped: 0,
          notRun: 0,
          executions: 0,
          repeatEach: environmentRepeat,
          failureRate: null,
          firstError: null,
          skipReasons: [],
        };
        rows.set(key, row);
      }
      const count = tally.get(environmentKey(environment)) ?? {
        interrupted: 0,
        notRun: 0,
      };
      tally.set(environmentKey(environment), count);
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const result = results.find((item) => item.retry === 0) ?? results[0];
        row.executions++;
        switch (result?.status) {
          case 'passed':
            row.runs++;
            row.passes++;
            break;
          case 'failed':
          case 'timedOut':
            row.runs++;
            row.failures++;
            if (result.status === 'timedOut') row.timedOut++;
            row.firstError ??= firstErrorLine(
              result.error?.message ?? result.errors?.[0]?.message ?? '',
            );
            row.firstError ??= result.status;
            break;
          case 'interrupted':
            row.interrupted++;
            count.interrupted++;
            break;
          default: {
            row.skipped++;
            if (!result) {
              row.notRun++;
              count.notRun++;
            }
            const reason = result
              ? skipReason(test, result)
              : 'not run (no result recorded)';
            if (!row.skipReasons.includes(reason)) row.skipReasons.push(reason);
          }
        }
      }
    }
  }
  const all = [...rows.values()];
  for (const row of all) {
    row.failureRate = row.runs > 0 ? row.failures / row.runs : null;
  }
  for (const [key, count] of tally) {
    const environment = envOf.get(key)!;
    if (count.interrupted > 0)
      flag(environment, `${count.interrupted} interrupted execution(s)`);
    if (count.notRun > 0)
      flag(environment, `${count.notRun} test(s) never started`);
  }
  const missing = expected.filter(
    (environment) => !seen.has(environmentKey(environment)),
  );
  const incomplete = [...reasons.values()];
  const compare = (a: FlakeRow, b: FlakeRow) =>
    (b.failureRate ?? -1) - (a.failureRate ?? -1) ||
    b.failures - a.failures ||
    a.title.localeCompare(b.title) ||
    environmentKey(a.environment).localeCompare(environmentKey(b.environment));
  return {
    schemaVersion: 1,
    repeatEach,
    reports: loaded.length,
    unreadable: [...unreadable],
    harnessErrors,
    incomplete,
    missing,
    complete:
      incomplete.length === 0 &&
      missing.length === 0 &&
      unreadable.length === 0,
    rows: all.filter((row) => row.runs > 0).sort(compare),
    neverRan: all.filter((row) => row.runs === 0).sort(compare),
  };
}

/**
 * Rows with at least one failed or timed out execution. A plain flake hunt records
 * them; the stability gate (`--strict`) fails on any.
 */
export function failingRows(report: FlakeReport): FlakeRow[] {
  return report.rows.filter((row) => row.failures > 0);
}

/** The skip reasons that the UNVALIDATED platform skips of host-observer-scope.ts record. */
const ALLOWED_SKIP_REASON = /^UNVALIDATED\b/;

/**
 * Why a strict gate must not accept the report, beyond failing tests: tests that
 * ran fewer (or not a whole number of) times than the declared repeats, and skips
 * whose recorded reason is not one of the documented UNVALIDATED platform skips.
 */
export function strictProblems(report: FlakeReport): string[] {
  const problems: string[] = [];
  for (const row of [...report.rows, ...report.neverRan]) {
    const where = `${row.title} (${label(row.environment)})`;
    const repeat = row.repeatEach;
    if (
      repeat !== null &&
      (row.executions < repeat || row.executions % repeat !== 0)
    )
      problems.push(
        `${where}: ${row.executions} execution(s) for ${repeat} repeat(s)`,
      );
    const rogue = row.skipReasons.filter(
      (reason) => !ALLOWED_SKIP_REASON.test(reason),
    );
    if (rogue.length > 0)
      problems.push(
        `${where}: skipped outside the documented skips: ${rogue.join('; ')}`,
      );
  }
  return problems;
}

const cell = (value: string) =>
  value.replaceAll('|', '\\|').replaceAll('\n', ' ');
const percent = (rate: number | null) =>
  rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
const environmentCells = (environment: Environment) =>
  `${cell(environment.os)} | ${cell(environment.vscode)} | ${cell(environment.group)} | ${cell(environment.mode)}`;
const label = (environment: Environment) =>
  [
    environment.os,
    environment.vscode,
    environment.group,
    environment.mode,
  ].join(' / ');

function incompleteLines(report: FlakeReport): string[] {
  if (report.complete) return [];
  const lines = [
    '> **INCOMPLETE MEASUREMENT.** Rates below miss tests that were interrupted or never ran, or whole environments. Do not read a missing row as a pass.',
    '',
  ];
  for (const item of report.incomplete)
    lines.push(`- ${label(item.environment)}: ${item.reasons.join('; ')}`);
  for (const environment of report.missing)
    lines.push(`- ${label(environment)}: no report (job failed before upload)`);
  for (const path of report.unreadable)
    lines.push(`- \`${path}\`: unreadable report`);
  lines.push('');
  return lines;
}

const headline = (report: FlakeReport) =>
  `Reports read: ${report.reports}. Repeats per test: ${report.repeatEach ?? 'unknown'}. Test rows: ${report.rows.length}. Rows with at least one failure: ${report.rows.filter((row) => row.failures > 0).length}. Retries are disabled, so every failure counts.`;

export function renderMarkdown(report: FlakeReport): string {
  const incompleteKeys = new Set(
    report.incomplete.map((item) => environmentKey(item.environment)),
  );
  const state = (environment: Environment) =>
    incompleteKeys.has(environmentKey(environment)) ? 'INCOMPLETE' : '';
  const lines = [
    '# Desktop flake hunt',
    '',
    ...incompleteLines(report),
    headline(report),
    '',
  ];
  if (report.harnessErrors.length) {
    lines.push('## Harness errors', '');
    for (const item of report.harnessErrors)
      lines.push(`- ${label(item.environment)}: ${item.errors.join('; ')}`);
    lines.push('');
  }
  lines.push(
    '## Failure rate per test and environment',
    '',
    'Sorted by failure rate. Runs exclude interrupted and skipped executions.',
    '',
    '| Test | OS | VS Code | Group | Mode | Runs | Passes | Failures | Failure rate | First error | Environment |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
  );
  for (const row of report.rows)
    lines.push(
      `| ${cell(row.title)} | ${environmentCells(row.environment)} | ${row.runs} | ${row.passes} | ${row.failures} | ${percent(row.failureRate)} | ${row.firstError ? cell(row.firstError) : ''} | ${state(row.environment)} |`,
    );
  if (!report.rows.length)
    lines.push('| _no executed test_ | | | | | 0 | 0 | 0 | n/a | | |');
  lines.push('', '## Tests that never ran', '');
  if (!report.neverRan.length) lines.push('None.');
  else {
    lines.push(
      '| Test | OS | VS Code | Group | Mode | Skipped | Interrupted | Reason | Environment |',
      '| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |',
    );
    for (const row of report.neverRan)
      lines.push(
        `| ${cell(row.title)} | ${environmentCells(row.environment)} | ${row.skipped} | ${row.interrupted} | ${cell(
          row.skipReasons.join('; ') ||
            (row.interrupted
              ? 'interrupted before completion (global timeout or crash)'
              : ''),
        )} | ${state(row.environment)} |`,
      );
  }
  lines.push('');
  return lines.join('\n');
}

/** GitHub caps a step summary at 1 MiB; this one stays far below it. */
export const SUMMARY_TOP_ROWS = 25;
const SUMMARY_MAX_BYTES = 800_000;

export function renderSummary(
  report: FlakeReport,
  artifactName = 'flake-report',
): string {
  const unstable = report.rows.filter((row) => row.failures > 0);
  const lines = [
    '# Desktop flake hunt',
    '',
    ...incompleteLines(report),
    headline(report),
    '',
    `## Most unstable tests (top ${Math.min(SUMMARY_TOP_ROWS, unstable.length)} of ${unstable.length})`,
    '',
  ];
  if (!unstable.length) lines.push('No test failed in any complete run.');
  else {
    lines.push(
      '| Test | Environment | Runs | Failures | Failure rate | First error |',
      '| --- | --- | ---: | ---: | ---: | --- |',
    );
    for (const row of unstable.slice(0, SUMMARY_TOP_ROWS))
      lines.push(
        `| ${cell(row.title)} | ${cell(label(row.environment))} | ${row.runs} | ${row.failures} | ${percent(row.failureRate)} | ${row.firstError ? cell(row.firstError) : ''} |`,
      );
  }
  lines.push(
    '',
    `${report.neverRan.length} test row(s) never ran. The full report (every test and environment, never-ran reasons) is in the \`${artifactName}\` artifact of this run: \`flake-report.md\` and \`flake-report.json\`.`,
    '',
  );
  const text = lines.join('\n');
  return Buffer.byteLength(text) > SUMMARY_MAX_BYTES
    ? `${text.slice(0, SUMMARY_MAX_BYTES / 4)}\n\n_Summary truncated; see the \`${artifactName}\` artifact._\n`
    : text;
}

export async function writeFlakeReport(
  inputDirectory: string,
  outputDirectory: string,
  expected: readonly Environment[] = [],
): Promise<FlakeReport> {
  const { loaded, unreadable } = await loadReports(inputDirectory);
  const report = analyze(loaded, unreadable, expected);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, 'flake-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    join(outputDirectory, 'flake-report.md'),
    renderMarkdown(report),
  );
  await writeFile(
    join(outputDirectory, 'flake-summary.md'),
    renderSummary(report),
  );
  return report;
}

/** Matrix entries (`{include: [{os, vscode, group, mode}]}`) the run must produce. */
export function parseExpected(value: unknown): Environment[] {
  const include = object(value)['include'];
  if (!Array.isArray(include))
    throw new Error('Expected a matrix with include');
  return include.map((item) => {
    const entry = object(item);
    const read = (key: string) => {
      const field = entry[key];
      if (typeof field !== 'string' || !field)
        throw new Error(`Matrix entry without ${key}`);
      return field;
    };
    return {
      os: read('os'),
      vscode: read('vscode'),
      group: read('group'),
      mode: read('mode'),
    };
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const strictFlag = args.indexOf('--strict');
  const strict = strictFlag >= 0;
  if (strict) args.splice(strictFlag, 1);
  const flag = args.indexOf('--expected');
  const expectedFile = flag >= 0 ? args[flag + 1] : undefined;
  if (flag >= 0) args.splice(flag, 2);
  const [input, output] = args;
  if (!input || !output || (flag >= 0 && !expectedFile)) {
    console.error(
      'Usage: flake-report <reports-directory> <output-directory> [--expected <matrix.json>] [--strict]',
    );
    process.exitCode = 2;
  } else {
    (async () => {
      const expected = expectedFile
        ? parseExpected(
            JSON.parse(await readFile(resolve(expectedFile), 'utf8')),
          )
        : [];
      return writeFlakeReport(resolve(input), resolve(output), expected);
    })().then(
      (report) => {
        console.log(
          `Flake report: ${report.reports} report(s), ${report.rows.length} test row(s), ${report.neverRan.length} never ran, ${report.incomplete.length} incomplete and ${report.missing.length} missing environment(s).`,
        );
        // Test failures are data; an incomplete or missing measurement is not.
        if (!report.complete) process.exitCode = 3;
        // The stability gate also fails on any test failure.
        else if (strict) {
          const problems = strictProblems(report);
          const failed = failingRows(report).length;
          if (failed > 0)
            console.error(
              `Strict: ${failed} test row(s) failed at least once.`,
            );
          for (const problem of problems) console.error(`Strict: ${problem}`);
          if (failed > 0 || problems.length > 0) process.exitCode = 4;
        }
      },
      (error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      },
    );
  }
}
