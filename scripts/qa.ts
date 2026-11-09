import { execFileSync, spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { delimiter, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// QA levels (see CONTRIBUTING.md): quick (default, changed files only),
// integration (broad batch verification), full (CI equivalent, explicit
// confirmation) and release (critical release checks). This file runs as plain
// TypeScript (`node scripts/qa.ts quick`) before dist exists and is also
// compiled by the repository tsconfig so qa.test.ts runs with the unit tests.

export type QaMode = 'quick' | 'integration' | 'full' | 'release';
export const QA_MODES: readonly QaMode[] = [
  'quick',
  'integration',
  'full',
  'release',
];

export interface QaStep {
  /** Stable identifier, for example `compile` or `node-tests`. */
  id: string;
  /** Program (`node` or `pnpm`) followed by its arguments. */
  command: string[];
  reason: string;
}

export interface QaSelection {
  mode: QaMode;
  steps: QaStep[];
  notes: string[];
}

export interface WorkspaceNode {
  name: string;
  /** Repository-relative directory, for example `packages/report-model`. */
  dir: string;
  /** Workspace directories this workspace depends on. */
  deps: string[];
  /** Names of the scripts declared in its package.json. */
  scripts: string[];
}
export type WorkspaceGraph = Readonly<Record<string, WorkspaceNode>>;

export interface QaSelectOptions {
  /** Repository-relative `*.test.ts` sources; defaults to the real checkout. */
  tests?: readonly string[];
  /** Existence check used to skip deleted files in prettier/eslint. */
  exists?: (path: string) => boolean;
  /** Release tag handed to validate-release for `release`. */
  tag?: string;
}

const WORKSPACE_ROOTS = ['packages', 'apps'];
const NODE_SUITES = [
  'desktop',
  'roundtrip',
  'compatibility',
  'performance',
  'release',
  'package',
] as const;
const ROUNDTRIP_PACKAGES = new Set([
  'packages/xml-parser',
  'packages/xml-serializer',
  'packages/report-model',
]);
const RELEASE_SCRIPT =
  /^(?:validate-release|verify-|release-artifact|publish-release|qa-gate)/;
const CONFIG_FILE =
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json|eslint\.config\.[^/]+|\.prettierrc[^/]*|\.prettierignore|\.npmrc|\.nvmrc|\.node-version)$/;
const DOCS_FILE =
  /(?:\.md$|(?:^|\/)(?:LICENSE[^/]*|\.gitignore|\.gitattributes|\.editorconfig)$)/;
const ROOT_TS =
  /^(?:packages\/.+|apps\/vscode-extension\/src\/.+|scripts\/.+|tests\/.+)\.ts$/;
const LINTABLE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const PLAYWRIGHT_HINT =
  'pnpm exec playwright test --config tests/desktop/playwright.config.ts';
const DEFAULT_SPECS = [
  'workspace.spec.ts',
  'data.spec.ts',
  'components.spec.ts',
  'structure.spec.ts',
];
const PRETTIER = ['node', 'node_modules/prettier/bin/prettier.cjs'];
const ESLINT = ['node', 'node_modules/eslint/bin/eslint.js'];
const VSCODE_HOST = ['node', 'dist/tests/vscode/run-tests.js'];
const DESKTOP_RUNNER = ['node', 'dist/tests/desktop/run-tests.js'];

// ------------------------------------------------------------ headless launch

/** Steps that open a VS Code or Electron window, with the CI screen size. */
const WINDOWED_RUNNERS: ReadonlyMap<string, string> = new Map([
  [VSCODE_HOST[1]!, '1920x1080x24'],
  [DESKTOP_RUNNER[1]!, '1440x1000x24'],
]);
/** Session variables that make Electron open on the user's own display. */
const SESSION_VARIABLES = [
  'WAYLAND_DISPLAY',
  'XDG_SESSION_TYPE',
  'EGL_PLATFORM',
  'XAUTHORITY',
] as const;

export interface HeadlessContext {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** Whether an executable with this name is on PATH. */
  which: (program: string) => boolean;
}

export interface LaunchPlan {
  /** Command to run and print, wrapper included. */
  command: string[];
  /** The `xvfb-run` prefix of `command`; empty when launched natively. */
  wrapper: string[];
  /** Environment for the child, or undefined to inherit the current one. */
  env: Record<string, string | undefined> | undefined;
  /** One-line explanation to print when the launch is not headless. */
  note: string | undefined;
}

/** Whether an executable named `program` is on the PATH of `env`. */
export function isOnPath(
  program: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (env['PATH'] ?? '').split(delimiter).some((directory) => {
    if (!directory) return false;
    try {
      accessSync(resolve(directory, program), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * On Linux, runs the steps that open a VS Code or Electron window under a
 * private Xvfb screen, without the variables that would send the window to the
 * user's own (possibly locked) Wayland session. Other steps, other platforms,
 * CI (which wraps itself with xvfb-run) and `RDLC_QA_DISPLAY=native` keep the
 * command as is.
 */
export function headlessLaunch(
  command: readonly string[],
  context: HeadlessContext = {
    platform: process.platform,
    env: process.env,
    which: (program) => isOnPath(program),
  },
): LaunchPlan {
  const native = (note?: string): LaunchPlan => ({
    command: [...command],
    wrapper: [],
    env: undefined,
    note,
  });
  const screen =
    command[0] === 'node' && command[1] !== undefined
      ? WINDOWED_RUNNERS.get(command[1])
      : undefined;
  const ci = context.env['CI'];
  if (
    !screen ||
    context.platform !== 'linux' ||
    context.env['RDLC_QA_DISPLAY'] === 'native' ||
    (ci !== undefined && ci !== '' && ci !== '0' && ci !== 'false')
  )
    return native();
  if (!context.which('xvfb-run'))
    return native(
      'xvfb-run not found: launching VS Code on the current display (install xvfb to run headless).',
    );
  const wrapper = ['xvfb-run', '-a', '-s', `-screen 0 ${screen}`];
  const env: Record<string, string | undefined> = { ...context.env };
  for (const name of SESSION_VARIABLES) delete env[name];
  return {
    command: [...wrapper, ...command],
    wrapper,
    env,
    note: undefined,
  };
}

// ---------------------------------------------------------------- discovery

/** Reads the workspace graph from the package.json files. */
export function loadGraph(root = process.cwd()): WorkspaceGraph {
  const raw: {
    dir: string;
    name: string;
    deps: string[];
    scripts: string[];
  }[] = [];
  for (const parent of WORKSPACE_ROOTS) {
    const parentDir = resolve(root, parent);
    if (!existsSync(parentDir)) continue;
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      const manifest = resolve(parentDir, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, 'utf8')) as Record<
        string,
        Record<string, string> | string | undefined
      >;
      const names = (key: string) =>
        Object.keys((json[key] as Record<string, string> | undefined) ?? {});
      raw.push({
        dir: `${parent}/${entry.name}`,
        name: String(json['name']),
        deps: [
          ...names('dependencies'),
          ...names('devDependencies'),
          ...names('peerDependencies'),
        ],
        scripts: names('scripts'),
      });
    }
  }
  const byName = new Map(raw.map((node) => [node.name, node.dir]));
  const graph: Record<string, WorkspaceNode> = {};
  for (const node of raw.sort((a, b) => a.dir.localeCompare(b.dir)))
    graph[node.dir] = {
      name: node.name,
      dir: node.dir,
      deps: [
        ...new Set(
          node.deps.flatMap((name) => {
            const dir = byName.get(name);
            return dir && dir !== node.dir ? [dir] : [];
          }),
        ),
      ].sort(),
      scripts: node.scripts,
    };
  return graph;
}

/** Repository-relative `*.test.ts` sources of every node:test suite. */
export function discoverTests(
  root = process.cwd(),
  graph: WorkspaceGraph = loadGraph(root),
): string[] {
  const directories = [
    ...Object.keys(graph)
      .filter(isRootCompiled)
      .map((dir) => `${dir}/src`),
    'scripts',
    ...NODE_SUITES.map((suite) => `tests/${suite}`),
  ];
  const found: string[] = [];
  for (const directory of directories) {
    const absolute = resolve(root, directory);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute, { withFileTypes: true }))
      if (entry.isFile() && entry.name.endsWith('.test.ts'))
        found.push(`${directory}/${entry.name}`);
  }
  return found.sort();
}

/** Workspaces compiled by the root tsconfig (the rest has its own toolchain). */
function isRootCompiled(dir: string): boolean {
  return dir.startsWith('packages/') || dir === 'apps/vscode-extension';
}

/** Compiled JavaScript location of a `*.test.ts` source. */
export function distOfTest(source: string): string {
  const match = /^(packages\/[^/]+)\/src\/(.+)\.ts$/.exec(source);
  return match
    ? `${match[1]}/dist/${match[2]}.js`
    : `dist/${source.replace(/\.ts$/, '.js')}`;
}

/** Transitive reverse dependents of a workspace. */
export function dependentsOf(graph: WorkspaceGraph, dir: string): string[] {
  const result = new Set<string>();
  const queue = [dir];
  while (queue.length) {
    const current = queue.shift()!;
    for (const node of Object.values(graph))
      if (node.deps.includes(current) && !result.has(node.dir)) {
        result.add(node.dir);
        queue.push(node.dir);
      }
  }
  return [...result].sort();
}

// ---------------------------------------------------------------- selection

const nodeTests = (tests: readonly string[]): QaStep['command'] => [
  'node',
  '--test',
  ...[...new Set(tests.map(distOfTest))].sort(),
];

function workspaceScripts(
  graph: WorkspaceGraph,
  dirs: Iterable<string>,
  reason: (dir: string) => string,
): QaStep[] {
  const steps: QaStep[] = [];
  const sorted = [...dirs].sort();
  for (const script of ['typecheck', 'test'])
    for (const dir of sorted) {
      const node = graph[dir];
      if (node?.scripts.includes(script))
        steps.push({
          id: `${script}:${node.name}`,
          command: ['pnpm', '--filter', node.name, script],
          reason: reason(dir),
        });
    }
  return steps;
}

const uncompiled = (graph: WorkspaceGraph) =>
  Object.keys(graph).filter((dir) => !isRootCompiled(dir));

/** Every node:test source except the packaging suite, which needs a VSIX. */
const nonPackageTests = (tests: readonly string[]) =>
  tests.filter((test) => !test.startsWith('tests/package/'));

const COMPILE_STEP = (reason: string): QaStep => ({
  id: 'compile',
  command: ['node', 'scripts/compile.ts'],
  reason: `${reason}; compile runs tsc, so it is the typecheck`,
});

/**
 * Pure selection of the ordered commands of a QA level. `changedFiles` are
 * repository-relative paths (deleted files included).
 */
export function selectQa(
  mode: QaMode,
  changedFiles: readonly string[],
  graph: WorkspaceGraph = loadGraph(),
  options: QaSelectOptions = {},
): QaSelection {
  const tests = options.tests ?? discoverTests(process.cwd(), graph);
  const exists = options.exists ?? existsSync;
  const changed = [
    ...new Set(changedFiles.map((file) => file.replaceAll('\\', '/'))),
  ].sort();
  if (mode === 'quick') return selectQuick(changed, graph, tests, exists);
  if (mode === 'integration') return selectIntegration(changed, graph, tests);
  if (mode === 'full') return selectFull(graph, tests);
  return selectRelease(graph, tests, options.tag);
}

function selectQuick(
  changed: readonly string[],
  graph: WorkspaceGraph,
  tests: readonly string[],
  exists: (path: string) => boolean,
): QaSelection {
  if (changed.length === 0)
    return {
      mode: 'quick',
      steps: [],
      notes: ['No changed files detected: nothing to run.'],
    };
  const testReasons = new Map<string, string>();
  const addTests = (sources: readonly string[], reason: string) => {
    for (const source of sources)
      if (!testReasons.has(source)) testReasons.set(source, reason);
  };
  const inDirectory = (directory: string) =>
    tests.filter((test) => posix.dirname(test) === directory);
  const workspaces = new Map<string, string>();
  const notes = new Set<string>();
  const broad: string[] = [];
  let typeScript = false;
  let hostLevel = false;

  const addWorkspace = (dir: string, why: string) => {
    const name = graph[dir]!.name;
    for (const affected of [dir, ...dependentsOf(graph, dir)]) {
      const reason = affected === dir ? why : `${why} (dependent: ${name})`;
      if (isRootCompiled(affected))
        addTests(inDirectory(`${affected}/src`), reason);
      else if (!workspaces.has(affected)) workspaces.set(affected, reason);
      if (affected === 'apps/vscode-extension') hostLevel = true;
    }
    if (ROUNDTRIP_PACKAGES.has(dir)) {
      addTests(inDirectory('tests/roundtrip'), `${why} (round-trip suite)`);
      addTests(
        inDirectory('tests/compatibility'),
        `${why} (compatibility suite)`,
      );
    }
  };

  for (const file of changed) {
    if (ROOT_TS.test(file)) typeScript = true;
    if (CONFIG_FILE.test(file)) {
      broad.push(file);
      continue;
    }
    if (DOCS_FILE.test(file) || file.startsWith('docs/')) continue;
    if (file.startsWith('.github/workflows/')) {
      addTests(
        [...inDirectory('scripts'), ...inDirectory('tests/release')],
        `workflow change: ${file}`,
      );
      continue;
    }
    if (file.startsWith('.github/')) continue;
    const workspace = Object.keys(graph)
      .filter((dir) => file.startsWith(`${dir}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (workspace) {
      addWorkspace(workspace, `${workspace} changed`);
      continue;
    }
    const scriptMatch = /^scripts\/([^/]+)\.ts$/.exec(file);
    if (scriptMatch) {
      const base = scriptMatch[1]!.replace(/\.test$/, '');
      const own = `scripts/${base}.test.ts`;
      if (tests.includes(own)) addTests([own], `${file} changed`);
      else
        addTests(
          inDirectory('scripts'),
          `${file} changed and has no dedicated test`,
        );
      if (RELEASE_SCRIPT.test(base))
        addTests(inDirectory('tests/release'), `${file} is release-related`);
      continue;
    }
    const suite = /^tests\/([^/]+)\//.exec(file)?.[1];
    if (suite === 'vscode') {
      hostLevel = true;
      continue;
    }
    if (suite === 'package') {
      notes.add(
        'tests/package changes are only typechecked by quick; run pnpm qa:release for the static package tests.',
      );
      continue;
    }
    if (suite === 'browser') {
      notes.add(
        'tests/browser scripts are covered by format and lint only in quick.',
      );
      continue;
    }
    if (
      suite &&
      (NODE_SUITES as readonly string[]).includes(suite) &&
      suite !== 'package'
    ) {
      addTests(inDirectory(`tests/${suite}`), `${file} changed`);
      if (suite === 'desktop') {
        const specs = [
          ...new Set(
            changed
              .map(
                (path) => /^tests\/desktop\/([^/]+\.spec\.ts)$/.exec(path)?.[1],
              )
              .filter((spec): spec is string => !!spec),
          ),
        ];
        notes.add(
          `Desktop E2E is not run by quick. Focused reproduction after pnpm build and pnpm package: ${PLAYWRIGHT_HINT} ${(specs.length ? specs : DEFAULT_SPECS).join(' ')}`,
        );
      }
      continue;
    }
    broad.push(file);
  }

  if (broad.length) {
    addTests(
      nonPackageTests(tests),
      `broadened: unmapped or configuration path(s) ${broad.slice(0, 3).join(', ')}${broad.length > 3 ? ', ...' : ''}`,
    );
    for (const dir of uncompiled(graph))
      workspaces.set(dir, 'broadened: unmapped or configuration path');
    notes.add(
      `Broadened to every non-VS-Code unit suite and designer checks because of: ${broad.join(', ')}`,
    );
    typeScript = true;
  }
  if (hostLevel)
    notes.add(
      'VS Code extension-host tests (test:vscode) are integration level; run pnpm qa:integration for them.',
    );

  const steps: QaStep[] = [];
  const existing = changed.filter((file) => exists(file));
  if (existing.length)
    steps.push({
      id: 'prettier',
      command: [...PRETTIER, '--check', '--ignore-unknown', ...existing],
      reason: `format check of ${existing.length} changed file(s)`,
    });
  const lintable = existing.filter((file) => LINTABLE.test(file));
  if (lintable.length)
    steps.push({
      id: 'eslint',
      command: [...ESLINT, '--no-warn-ignored', ...lintable],
      reason: `lint of ${lintable.length} changed script/source file(s)`,
    });
  if (typeScript || testReasons.size)
    steps.push(
      COMPILE_STEP(
        testReasons.size
          ? 'affected node tests run from dist'
          : 'TypeScript sources changed',
      ),
    );
  if (testReasons.size)
    steps.push({
      id: 'node-tests',
      command: nodeTests([...testReasons.keys()]),
      reason: [...new Set(testReasons.values())].join('; '),
    });
  steps.push(
    ...workspaceScripts(
      graph,
      workspaces.keys(),
      (dir) => workspaces.get(dir)!,
    ),
  );
  return { mode: 'quick', steps, notes: [...notes] };
}

function broadSteps(
  graph: WorkspaceGraph,
  tests: readonly string[],
  scope: string,
): QaStep[] {
  return [
    {
      id: 'prettier',
      command: [...PRETTIER, '--check', '.'],
      reason: `${scope}: format check of the whole repository`,
    },
    {
      id: 'eslint',
      command: [...ESLINT, '.'],
      reason: `${scope}: lint of the whole repository`,
    },
    COMPILE_STEP(`${scope}: single compile`),
    ...workspaceScripts(
      graph,
      uncompiled(graph),
      () => `${scope}: designer typecheck`,
    ).filter((step) => step.id.startsWith('typecheck:')),
    {
      id: 'node-tests',
      command: nodeTests(nonPackageTests(tests)),
      reason: `${scope}: unit, roundtrip, compatibility, acceptance and release suites`,
    },
    ...workspaceScripts(
      graph,
      uncompiled(graph),
      () => `${scope}: designer tests`,
    ).filter((step) => step.id.startsWith('test:')),
    {
      id: 'build',
      command: ['node', 'dist/scripts/build.js'],
      reason: `${scope}: bundle the extension and the designer (compile already ran)`,
    },
  ];
}

function selectIntegration(
  changed: readonly string[],
  graph: WorkspaceGraph,
  tests: readonly string[],
): QaSelection {
  const steps = broadSteps(graph, tests, 'integration');
  const hostAffected = changed.some(
    (file) =>
      file.startsWith('apps/vscode-extension/') ||
      file.startsWith('tests/vscode/') ||
      Object.keys(graph).some(
        (dir) => isRootCompiled(dir) && file.startsWith(`${dir}/`),
      ) ||
      CONFIG_FILE.test(file) ||
      !(
        DOCS_FILE.test(file) ||
        file.startsWith('docs/') ||
        file.startsWith('.github/') ||
        (file.startsWith('scripts/') &&
          !/^scripts\/(?:build|compile)\.ts$/.test(file)) ||
        /^tests\/(?:desktop|roundtrip|compatibility|performance|release|package|browser)\//.test(
          file,
        ) ||
        file.startsWith('apps/designer/')
      ),
  );
  const notes = [
    'Integration never runs Desktop E2E, visual comparisons or packaging.',
  ];
  if (hostAffected)
    steps.push({
      id: 'test:vscode',
      command: [...VSCODE_HOST],
      reason:
        'the extension or a package it depends on is affected: one VS Code host run',
    });
  else
    notes.push(
      'VS Code host tests skipped: the extension and its dependencies are not affected.',
    );
  return { mode: 'integration', steps, notes };
}

function selectFull(
  graph: WorkspaceGraph,
  tests: readonly string[],
): QaSelection {
  const steps = broadSteps(graph, tests, 'full');
  const add = (id: string, command: string[], reason: string) =>
    steps.push({ id, command, reason: `full: ${reason}` });
  add(
    'package',
    ['node', 'dist/scripts/package.js'],
    'build and verify the VSIX',
  );
  add('test:vscode', [...VSCODE_HOST], 'extension-host tests');
  add(
    'test:package',
    [
      'node',
      '--test',
      ...tests
        .filter((test) => test.startsWith('tests/package/'))
        .map(distOfTest)
        .sort(),
    ],
    'static package tests',
  );
  add(
    'test:package:installed',
    [...VSCODE_HOST, '--packaged'],
    'extension-host tests against the installed VSIX',
  );
  add(
    'test:e2e:probe',
    [...DESKTOP_RUNNER, '--probe', '--packaged'],
    'Desktop driver and security probe',
  );
  add(
    'test:e2e',
    [...DESKTOP_RUNNER],
    'Desktop functional journeys, all groups',
  );
  add(
    'test:e2e:installed',
    [...DESKTOP_RUNNER, '--packaged'],
    'Desktop installed journeys, all groups',
  );
  add(
    'test:visual',
    [...DESKTOP_RUNNER, '--visual'],
    'pinned visual references',
  );
  return {
    mode: 'full',
    steps,
    notes: [
      'Full QA is the CI regression suite: it is meant for GitHub Actions. Run it locally only on explicit request.',
    ],
  };
}

function selectRelease(
  graph: WorkspaceGraph,
  tests: readonly string[],
  tag: string | undefined,
): QaSelection {
  void graph;
  const releaseTests = [
    ...tests.filter((test) => test.startsWith('tests/release/')),
    ...tests.filter(
      (test) =>
        test.startsWith('scripts/') &&
        RELEASE_SCRIPT.test(posix.basename(test).replace(/\.test\.ts$/, '')),
    ),
  ];
  const steps: QaStep[] = [
    COMPILE_STEP('release: single compile'),
    {
      id: 'release-tests',
      command: nodeTests(releaseTests),
      reason: 'release: release tests and release script tests',
    },
    {
      id: 'build',
      command: ['node', 'dist/scripts/build.js'],
      reason: 'release: bundle the extension and the designer',
    },
    {
      id: 'package',
      command: ['node', 'dist/scripts/package.js'],
      reason: 'release: build the VSIX; package.ts also verifies its contents',
    },
    {
      id: 'package-tests',
      command: nodeTests(
        tests.filter((test) => test.startsWith('tests/package/')),
      ),
      reason: 'release: static package tests',
    },
  ];
  const notes = [
    'validate-release-config needs the publishing environment (Entra/Open VSX variables) and runs in GitHub Actions only.',
    'Release never runs Desktop E2E.',
  ];
  if (tag)
    steps.push({
      id: 'validate-release',
      command: ['node', 'dist/scripts/validate-release.js', tag],
      reason: `release: validate tag ${tag}`,
    });
  else notes.push('Pass --tag vX.Y.Z to also validate a release tag.');
  return { mode: 'release', steps, notes };
}

// ---------------------------------------------------------------------- CLI

export interface QaOptions {
  mode: QaMode;
  plan: boolean;
  confirmFull: boolean;
  base: string | undefined;
  tag: string | undefined;
}

const SAFE_REF = /^[A-Za-z0-9._/~^@-]+$/;
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Parses the CLI arguments; throws an Error with a usage message. */
export function parseArgs(argv: readonly string[]): QaOptions {
  let mode: QaMode | undefined;
  let plan = false;
  let confirmFull = false;
  let base: string | undefined;
  let tag: string | undefined;
  const list = [...argv];
  const value = (flag: string, inline: string | undefined) => {
    const next = inline ?? list.shift();
    if (!next || next.startsWith('-')) throw new Error(`${flag} needs a value`);
    return next;
  };
  while (list.length) {
    const arg = list.shift()!;
    const [flag, inline] = arg.startsWith('--')
      ? [
          arg.split('=', 1)[0]!,
          arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : undefined,
        ]
      : [arg, undefined];
    if (arg === '--') continue;
    else if (flag === '--plan') plan = true;
    else if (flag === '--confirm-full') confirmFull = true;
    else if (flag === '--base') base = value('--base', inline);
    else if (flag === '--tag') tag = value('--tag', inline);
    else if (!arg.startsWith('-') && !mode && QA_MODES.includes(arg as QaMode))
      mode = arg as QaMode;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!mode) throw new Error(`Expected a mode: ${QA_MODES.join(', ')}`);
  if (
    base !== undefined &&
    (!SAFE_REF.test(base) || base.startsWith('-') || base.includes('..'))
  )
    throw new Error(`Unsafe --base ref: ${base}`);
  if (tag !== undefined && mode !== 'release')
    throw new Error('--tag is only valid with release');
  if (tag !== undefined && !TAG.test(tag))
    throw new Error(`Invalid --tag, expected vX.Y.Z: ${tag}`);
  if (confirmFull && mode !== 'full')
    throw new Error('--confirm-full is only valid with full');
  return { mode, plan, confirmFull, base, tag };
}

/** Message explaining why a run is refused, or undefined when allowed. */
export function refusal(options: QaOptions): string | undefined {
  if (options.mode === 'full' && !options.plan && !options.confirmFull)
    return [
      'Refusing to run full QA locally without --confirm-full.',
      'Full QA (Desktop E2E on every OS/VS Code pairing, visual references, packaging) is the CI regression suite and runs in GitHub Actions.',
      'Use pnpm qa:quick or pnpm qa:integration locally. Run pnpm qa:full --confirm-full only on explicit request (add --plan to preview).',
    ].join('\n');
  return undefined;
}

function git(args: string[]): string[] {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

function tryGit(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Changed files since the merge-base, including staged, unstaged and untracked. */
export function detectChangedFiles(base?: string): {
  base: string;
  files: string[];
} {
  const reference =
    base ??
    tryGit(['merge-base', 'HEAD', 'origin/main']) ??
    tryGit(['merge-base', 'HEAD', 'main']) ??
    'HEAD';
  const resolved = tryGit(['rev-parse', '--verify', `${reference}^{commit}`]);
  if (!resolved) throw new Error(`Cannot resolve base ref: ${reference}`);
  const tracked = git(['diff', '--name-only', '-z', '--no-renames', resolved]);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
  return {
    base: resolved,
    files: [...new Set([...tracked, ...untracked])].sort(),
  };
}

const shorten = (command: readonly string[]) =>
  (command.length > 8
    ? [...command.slice(0, 5), `... (+${command.length - 5} more)`]
    : command
  )
    .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
    .join(' ');

export function formatSelection(selection: QaSelection, full = true): string {
  const lines = [`QA ${selection.mode}: ${selection.steps.length} step(s)`];
  selection.steps.forEach((step, index) => {
    lines.push(
      `${index + 1}. ${full ? step.command.join(' ') : shorten(step.command)}`,
      `   why: ${step.reason}`,
    );
  });
  for (const note of selection.notes) lines.push(`note: ${note}`);
  return lines.join('\n');
}

export function runQa(argv: readonly string[]): number {
  let options: QaOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(
      `${(error as Error).message}\nUsage: node scripts/qa.ts <quick|integration|full|release> [--plan] [--base <ref>] [--tag vX.Y.Z] [--confirm-full]`,
    );
    return 2;
  }
  const refused = refusal(options);
  if (refused) {
    console.error(refused);
    return 2;
  }
  let changed: string[] = [];
  if (options.mode === 'quick' || options.mode === 'integration') {
    const detected = detectChangedFiles(options.base);
    changed = detected.files;
    console.log(
      `Base ${detected.base.slice(0, 12)}; ${changed.length} changed file(s).`,
    );
  }
  const selection = selectQa(
    options.mode,
    changed,
    loadGraph(),
    options.tag ? { tag: options.tag } : {},
  );
  console.log(formatSelection(selection, options.plan));
  if (options.plan || selection.steps.length === 0) return 0;

  const results: { step: QaStep; seconds: number; status: number | null }[] =
    [];
  const started = Date.now();
  let exitCode = 0;
  for (const step of selection.steps) {
    const launch = headlessLaunch(step.command);
    console.log(`\n> ${shorten(launch.command)}`);
    if (launch.note) console.log(`note: ${launch.note}`);
    const begin = Date.now();
    const [program, ...args] = launch.command as [string, ...string[]];
    const run = spawnSync(
      program === 'node' ? process.execPath : program,
      // Under the wrapper, the first `node` after it is the real interpreter.
      launch.wrapper.length
        ? args.map((arg, index) =>
            index === launch.wrapper.length - 1 && arg === 'node'
              ? process.execPath
              : arg,
          )
        : args,
      {
        stdio: 'inherit',
        shell: program === 'pnpm' && process.platform === 'win32',
        ...(launch.env ? { env: launch.env } : {}),
      },
    );
    const status = run.status;
    results.push({ step, seconds: (Date.now() - begin) / 1000, status });
    if (status !== 0) {
      exitCode = status ?? 1;
      break;
    }
  }
  console.log(`\nQA ${options.mode} summary`);
  for (const { step, seconds, status } of results)
    console.log(
      `  ${status === 0 ? 'PASS' : 'FAIL'}  ${shorten(step.command)}  (${seconds.toFixed(1)}s)`,
    );
  const skipped = selection.steps.length - results.length;
  if (skipped)
    console.log(`  SKIPPED  ${skipped} step(s) after the first failure`);
  console.log(
    `${exitCode === 0 ? 'PASS' : 'FAIL'}  ${((Date.now() - started) / 1000).toFixed(1)}s total`,
  );
  return exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = runQa(process.argv.slice(2));
