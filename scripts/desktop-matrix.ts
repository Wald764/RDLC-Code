import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DESKTOP_GROUPS,
  requiredDesktopSuites,
  type DesktopGroup,
  type DesktopMode,
} from '../tests/desktop/run-tests.js';

/**
 * Matrix planning for the Desktop measurement workflow (flake-hunt.yml) and
 * changed-spec detection for the stability gate of ci.yml. The spec to group and
 * mode assignment is derived from `requiredDesktopSuites` / `DESKTOP_GROUPS` in
 * tests/desktop/run-tests.ts, the single source CI also runs.
 */

export const DESKTOP_OSES = ['ubuntu-24.04', 'windows-2022', 'macos-14'];
export const DESKTOP_VSCODES = ['1.142.0', 'stable'];
export const DESKTOP_GROUP_NAMES = Object.keys(
  DESKTOP_GROUPS,
) as DesktopGroup[];

/** Same axes as the `desktop` job of ci.yml, one job per run mode. */
export const DESKTOP_MODES = [
  { mode: 'probe-packaged', args: '--probe --packaged' },
  { mode: 'functional', args: '' },
  { mode: 'packaged', args: '--packaged' },
] as const;

export interface MatrixEntry {
  os: string;
  vscode: string;
  group: DesktopGroup;
  mode: string;
  args: string;
  /** Comma-separated spec files restricting the run; empty runs the whole group. */
  specs: string;
}

export interface MatrixPlan {
  include: MatrixEntry[];
  /**
   * Requested specs that no group or mode of the measurement matrix runs and the
   * pinned visual job of ci.yml does not cover either: nothing would exercise them.
   */
  unplanned: string[];
  /** Requested specs only the pinned visual job of ci.yml runs (reference environment). */
  visualOnly: string[];
}

/** Value of a comma-separated filter among the allowed ones, in allowed order. */
export function pick<T extends string>(
  name: string,
  raw: string,
  allowed: readonly T[],
): T[] {
  const wanted = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = wanted.filter(
    (item) => !(allowed as readonly string[]).includes(item),
  );
  if (unknown.length)
    throw new Error(
      `Unknown ${name}: ${unknown.join(', ')} (expected ${allowed.join(', ')})`,
    );
  return wanted.length
    ? allowed.filter((item) => wanted.includes(item))
    : [...allowed];
}

export function parseRepeat(raw: string): number {
  const repeat = Number(raw);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10)
    throw new Error(`repeat must be an integer from 1 to 10, got "${raw}"`);
  return repeat;
}

/** Spec file names (basenames) from a list of repository paths, sorted and unique. */
export function changedDesktopSpecs(paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths
        .map((path) => path.trim().replaceAll('\\', '/'))
        .filter((path) => /^tests\/desktop\/[^/]+\.spec\.ts$/.test(path))
        .map((path) => basename(path)),
    ),
  ].sort();
}

/** Git arguments listing added or modified specs against the pull request base. */
export function changedSpecsGitArguments(base: string): string[] {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(base) || base.includes('..'))
    throw new Error(`Unusable base branch name: "${base}"`);
  return [
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    `origin/${base}...HEAD`,
    '--',
    'tests/desktop/*.spec.ts',
  ];
}

/**
 * The specs to measure: restricted to the given file names and to the entries
 * that run them. Without `specs`, every group runs whole.
 */
export function planMatrix(options: {
  os?: readonly string[];
  groups?: readonly DesktopGroup[];
  specs?: readonly string[];
  /** Gate calls: no spec means nothing to measure, instead of the whole matrix. */
  specsRequired?: boolean;
}): MatrixPlan {
  const oses = options.os ?? DESKTOP_OSES;
  const groups = options.groups ?? DESKTOP_GROUP_NAMES;
  const specs = options.specs ?? [];
  const include: MatrixEntry[] = [];
  if (options.specsRequired === true && specs.length === 0)
    return { include, unplanned: [], visualOnly: [] };
  const planned = new Set<string>();
  for (const os of oses)
    for (const vscode of DESKTOP_VSCODES)
      for (const group of groups)
        for (const { mode, args } of DESKTOP_MODES) {
          // The capability probe runs once per OS/version, in core.
          if (mode === 'probe-packaged' && group !== 'core') continue;
          const suites = requiredDesktopSuites({
            probe: mode === 'probe-packaged',
            packaged: args.includes('--packaged'),
            visual: false,
            updateBaselines: false,
            group,
          } satisfies DesktopMode);
          const applicable =
            specs.length > 0
              ? suites.filter((file) => specs.includes(file))
              : suites;
          if (applicable.length === 0) continue;
          for (const file of applicable) planned.add(file);
          include.push({
            os,
            vscode,
            group,
            mode,
            args,
            specs: specs.length > 0 ? applicable.join(',') : '',
          });
        }
  const visual = requiredDesktopSuites({
    probe: false,
    packaged: false,
    visual: true,
    updateBaselines: false,
    group: null,
  });
  const left = specs.filter((file) => !planned.has(file));
  return {
    include,
    unplanned: left.filter((file) => !visual.includes(file)),
    visualOnly: left.filter((file) => visual.includes(file)),
  };
}

/** Added, copied, modified or renamed specs (a renamed and edited spec is gated too). */
export function listChangedSpecs(base: string, cwd?: string): string[] {
  const git = (args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', ...(cwd ? { cwd } : {}) });
  let output: string;
  try {
    output = git(changedSpecsGitArguments(base));
  } catch {
    // The checkout was shallow or lacked the base: fetch it, then diff again.
    git([
      'fetch',
      '--no-tags',
      'origin',
      `+refs/heads/${base}:refs/remotes/origin/${base}`,
    ]);
    output = git(changedSpecsGitArguments(base));
  }
  return changedDesktopSpecs(output.split('\n'));
}

function setOutputs(values: Record<string, string>) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  if (process.env['GITHUB_OUTPUT'])
    appendFileSync(process.env['GITHUB_OUTPUT'], `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const env = process.env;
  try {
    if (process.argv[2] === 'changed') {
      // Only pull requests are gated; other events and calls have no base.
      const base = env['BASE_REF'] ?? '';
      const specs = base ? listChangedSpecs(base) : [];
      setOutputs({ specs: specs.join(',') });
    } else if (process.argv[2] === 'plan') {
      const repeat = parseRepeat(env['REPEAT'] ?? '');
      const specs = (env['SPECS'] ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const plan = planMatrix({
        os: pick('os', env['OS_FILTER'] ?? '', DESKTOP_OSES),
        groups: pick('groups', env['GROUPS_FILTER'] ?? '', DESKTOP_GROUP_NAMES),
        specs,
        specsRequired: env['SPECS_REQUIRED'] === 'true',
      });
      // A spec in no group of run-tests.ts would never run in CI: fail, do not skip it.
      if (plan.unplanned.length > 0)
        throw new Error(
          `No Desktop group or mode runs: ${plan.unplanned.join(', ')}. Add the spec to DESKTOP_GROUPS in tests/desktop/run-tests.ts.`,
        );
      for (const file of plan.visualOnly)
        console.log(
          `::notice::${file} runs only in the pinned visual job of ci.yml (reference environment), not in the repeated matrix.`,
        );
      setOutputs({
        repeat: String(repeat),
        count: String(plan.include.length),
        matrix: JSON.stringify({ include: plan.include }),
      });
    } else {
      throw new Error('Usage: desktop-matrix <changed|plan>');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
