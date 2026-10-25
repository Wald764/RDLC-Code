import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESKTOP_GROUPS } from '../desktop/run-tests.js';

// T069/T071 gates read this repository's own workflow layout: jobs at indent
// 2, steps at indent 6 (fields inline after "- " or at indent 8, nested values
// at 10). An unexpected layout fails an assertion instead of skipping one.

const CI = readFileSync('.github/workflows/ci.yml', 'utf8');
const RELEASE = readFileSync('.github/workflows/release.yml', 'utf8');
const XVFB = 'xvfb-run -a -s "-screen 0 1440x1000x24"';
const KEY = '^ {6}(?:- | {2})';
const RUN = (pattern: string) => new RegExp(`${KEY}run:.*${pattern}`, 'm');
const UPLOAD = new RegExp(`${KEY}uses: actions/upload-artifact@`, 'm');
const has = (text: string, pattern: RegExp): boolean => pattern.test(text);
const unquote = (value: string) =>
  /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;

/** Split the `jobs:` section into job blocks; anything else is unsupported. */
function jobs(source: string): { [id: string]: string } {
  const lines = source.split('\n');
  const start = lines.indexOf('jobs:');
  assert.notEqual(start, -1, 'workflow must declare a jobs section');
  const blocks: { [id: string]: string } = {};
  let id = '';
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) assert.fail(`unsupported layout after jobs: ${line}`);
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (key) {
      id = key[1]!;
      blocks[id] = '';
    } else if (id) blocks[id] += `${line}\n`;
  }
  return blocks;
}

const steps = (block: string): string[] =>
  block.split(/(?=^ {6}- )/m).filter((chunk) => /^ {6}- /m.test(chunk));

const job = (blocks: { [id: string]: string }, id: string): string => {
  assert.ok(blocks[id], `missing job: ${id}`);
  return blocks[id]!;
};

/** One `key:` value at `indent`; the inline "- key:" step form is accepted. */
function read(text: string, indent: number, key: string): string | null {
  const found = new RegExp(
    `^ {${indent}}(?:- | {2})?${key}:[ \\t]*(\\S.*)$`,
    'm',
  ).exec(text);
  return found ? unquote(found[1]!) : null;
}

const field = (block: string, key: string) => read(block, 4, key);
const env = (block: string, key: string) => read(block, 6, key);
const stepField = (step: string, key: string) =>
  read(step, 8, key) ?? read(step, 6, key);
const nested = (text: string, key: string) => read(text, 10, key);
const needs = (block: string): string[] =>
  has(block, /^ {4}needs:/m)
    ? read(block, 4, 'needs')!
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((part) => part.trim())
    : [];

function matrix(block: string, key: string): string[] {
  const found = new RegExp(`^ {8}${key}:[ \\t]*\\[([^\\]]+)\\]`, 'm').exec(
    block,
  );
  assert.ok(found, `matrix ${key} must stay a flow list`);
  return found[1]!.split(',').map((part) => unquote(part.trim()));
}

/** Every named step must exist and follow the previous one. */
function ordered(
  where: string,
  list: string[],
  sequence: readonly (readonly [string, RegExp])[],
): void {
  let previous = -1;
  for (const [label, pattern] of sequence) {
    const index = list.findIndex((chunk) => pattern.test(chunk));
    assert.notEqual(index, -1, `${where}: no step matches ${label}`);
    assert.ok(index > previous, `${where}: "${label}" runs too early`);
    previous = index;
  }
}

test('the required aggregate depends on quality, the desktop matrix and the visual job', () => {
  const blocks = jobs(CI);
  const required = job(blocks, 'required');
  assert.deepEqual(needs(required), ['quality', 'desktop', 'visual']);
  assert.equal(field(required, 'if'), 'always()');
  const gate = steps(required);
  assert.equal(gate.length, 1, 'one explicit aggregate gate');
  for (const name of ['QUALITY', 'DESKTOP', 'VISUAL']) {
    assert.equal(
      nested(gate[0]!, name),
      `\${{ needs.${name.toLowerCase()}.result }}`,
      `${name} reads a real result`,
    );
    assert.ok(gate[0]!.includes(`test "$${name}" = success`), name);
  }
  const inherited = field(job(jobs(RELEASE), 'quality'), 'uses');
  assert.equal(inherited, './.github/workflows/ci.yml');
});

test('the desktop job keeps the six-entry OS and minimum/stable matrix', () => {
  const block = job(jobs(CI), 'desktop');
  const os = matrix(block, 'os');
  const vscode = matrix(block, 'vscode');
  assert.deepEqual(needs(block), ['quality']);
  assert.equal(field(block, 'runs-on'), '${{ matrix.os }}');
  assert.deepEqual(os, ['ubuntu-24.04', 'windows-2022', 'macos-14']);
  assert.deepEqual(vscode, ['1.142.0', 'stable']);
  assert.equal(os.length * vscode.length, 6, 'six matrix entries');
  assert.equal(env(block, 'VSCODE_VERSION'), '${{ matrix.vscode }}');
  // Every entry runs every disjoint Desktop slice, each within a bounded job.
  assert.deepEqual(matrix(block, 'group'), Object.keys(DESKTOP_GROUPS));
  assert.equal(env(block, 'RDLC_DESKTOP_GROUP'), '${{ matrix.group }}');
  assert.equal(field(block, 'timeout-minutes'), '120');
  ordered('desktop', steps(block), [
    ['frozen install', RUN('pnpm install --frozen-lockfile')],
    ['build', RUN('pnpm build')],
    ['package', RUN('pnpm package')],
    ['host tests', RUN('pnpm test:package')],
    ['provisioning', /apt-get install/],
    ['probe', RUN('--probe')],
    ['functional', RUN('pnpm test:e2e$')],
    ['installed', RUN('pnpm test:e2e --packaged$')],
    ['upload', UPLOAD],
  ]);
});

test('every matrix entry runs the functional and installed journeys fail-closed', () => {
  const all = steps(job(jobs(CI), 'desktop'));
  const groups = {
    probe: all.filter((step) => RUN('--probe').test(step)),
    functional: all.filter((step) => RUN('pnpm test:e2e$').test(step)),
    installed: all.filter((step) =>
      RUN('pnpm test:e2e --packaged$').test(step),
    ),
  };
  for (const [label, group] of Object.entries(groups)) {
    assert.equal(group.length, 2, `${label} must run on both OS families`);
    // The capability probe runs once per OS/version, in the core slice.
    const only = label === 'probe' ? " && matrix.group == 'core'" : '';
    const linux = group.find(
      (s) => stepField(s, 'if') === `runner.os == 'Linux'${only}`,
    );
    const other = group.find(
      (s) => stepField(s, 'if') === `runner.os != 'Linux'${only}`,
    );
    assert.ok(linux && other, `${label} must branch on the operating system`);
    assert.ok(
      RUN(XVFB).test(linux),
      `${label} on Linux uses the fixed display`,
    );
    assert.equal(nested(linux, 'TZ'), 'UTC', `${label} records UTC`);
    assert.equal(nested(linux, 'LANG'), 'en_US.UTF-8', `${label} records en`);
  }
});

test('the visual job compares only the minimum binary on the fixed display', () => {
  const block = job(jobs(CI), 'visual');
  const all = steps(block);
  const comparison = all.filter((step) => RUN('pnpm test:visual').test(step));
  assert.deepEqual(needs(block), ['quality']);
  assert.equal(field(block, 'runs-on'), 'ubuntu-24.04');
  assert.equal(has(block, /^ {4}strategy:/m), false, 'not part of a matrix');
  assert.equal(env(block, 'VSCODE_VERSION'), '1.142.0', 'minimum version only');
  assert.equal(env(block, 'TZ'), 'UTC');
  assert.match(env(block, 'LANG')!, /^en_US/);
  assert.equal(comparison.length, 1, 'one pinned comparison step');
  assert.equal(stepField(comparison[0]!, 'if'), null, 'cannot be skipped');
  assert.ok(
    RUN(`${XVFB} pnpm test:visual$`).test(comparison[0]!),
    'runs on the 1440x1000 display',
  );
  ordered('visual', all, [
    ['frozen install', RUN('pnpm install --frozen-lockfile')],
    ['build', RUN('pnpm build')],
    ['environment record', /reference-environment\.txt/],
    ['visual comparison', RUN('pnpm test:visual')],
    ['upload', UPLOAD],
  ]);
});

test('CI evidence uploads always run and cover Desktop and visual artifacts', () => {
  const blocks = jobs(CI);
  const uploads = Object.values(blocks).flatMap((block) =>
    steps(block).filter((step) => has(step, UPLOAD)),
  );
  assert.ok(uploads.length >= 3, 'desktop evidence, logs and visual evidence');
  for (const upload of uploads)
    assert.match(
      stepField(upload, 'if') ?? '',
      /always\(\)|failure\(\)/,
      'evidence must upload even when the gate fails',
    );
  const runner = uploads.filter(
    (upload) => nested(upload, 'path') === '.vscode-test/desktop-artifacts/**',
  );
  assert.ok(runner.length >= 2, 'desktop and visual publish runner evidence');
  ordered('desktop', steps(job(blocks, 'desktop')), [
    ['installed journeys', RUN('pnpm test:e2e --packaged$')],
    ['upload', UPLOAD],
  ]);
  ordered('visual', steps(job(blocks, 'visual')), [
    ['visual comparison', RUN('pnpm test:visual')],
    ['upload', UPLOAD],
  ]);
});

test('both workflows keep least permissions and the pinned action revisions', () => {
  for (const source of [CI, RELEASE])
    assert.match(source, /^permissions:\n {2}contents: read$/m);
  for (const [id, block] of Object.entries(jobs(CI)))
    assert.equal(has(block, /^ {4}permissions:/m), false, `${id} read-only`);
  for (const [id, block] of Object.entries(jobs(RELEASE)))
    assert.equal(has(block, /^ {4}permissions:/m), id === 'publish', id);
  const pinned: { [key: string]: string } = {
    'actions/checkout': '34e114876b0b11c390a56381ad16ebd13914f8d5',
    'actions/setup-node': '49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02',
    'pnpm/action-setup': '9fd676a19091d4595eefd76e4bd31c97133911f1',
  };
  for (const source of [CI, RELEASE]) {
    const references = [...source.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    assert.ok(references.length > 0, 'both workflows pin their actions');
    for (const reference of references) {
      if (reference.startsWith('./'))
        assert.match(reference, /^\.\/\.github\/workflows\/[\w.-]+\.yml$/);
      else {
        const match = /^([^/@]+\/[^/@]+)@([0-9a-f]{40})$/.exec(reference);
        assert.ok(match, `unpinned action: ${reference}`);
        assert.equal(pinned[match[1]!], match[2], `changed ${match[1]}`);
      }
    }
  }
});

test('the canonical job certifies its own packaged bytes before release-artifact.js', () => {
  const block = job(jobs(RELEASE), 'canonical');
  const all = steps(block);
  assert.equal(env(block, 'VSCODE_VERSION'), '1.142.0', 'exact pinned binary');
  assert.equal(env(block, 'TZ'), 'UTC');
  assert.equal(env(block, 'LANG'), 'en_US.UTF-8');
  assert.equal(needs(block).length, 2, 'validation and quality gates');
  assert.equal(has(block, /^ {4}strategy:/m), false, 'not a matrix entry');
  ordered('canonical', all, [
    ['frozen install', RUN('pnpm install --frozen-lockfile')],
    ['build', RUN('pnpm build')],
    ['package', RUN('pnpm package')],
    ['host tests', RUN('pnpm test:package')],
    ['provisioning', /apt-get install/],
    ['installed', RUN('pnpm test:e2e --packaged$')],
    ['security', RUN('pnpm test:e2e --probe --packaged')],
    ['visual', RUN('pnpm test:visual --packaged')],
    ['binding', RUN('release-artifact\\.js')],
    ['manifest', RUN('publish-release\\.js manifest')],
    ['canonical upload', /dist\/canonical\/\*/],
  ]);
  const certify = all.filter((step) =>
    RUN('pnpm test:(e2e|visual)').test(step),
  );
  assert.equal(certify.length, 3, 'installed, security and visual all certify');
  for (const step of certify) {
    assert.ok(RUN('--packaged').test(step), 'must install the canonical VSIX');
    assert.equal(stepField(step, 'if'), null, 'cannot be skipped');
    assert.ok(RUN(`${XVFB} pnpm`).test(step), 'fixed display');
  }
  assert.ok(
    !has(block, /actions\/download-artifact@/),
    'no substitute artifact',
  );
});

test('the canonical handoff stays exact while diagnostics upload separately', () => {
  const block = job(jobs(RELEASE), 'canonical');
  const uploads = steps(block).filter((step) => has(step, UPLOAD));
  const canonical = uploads.find(
    (u) => nested(u, 'path') === 'dist/canonical/*',
  );
  const diagnostics = uploads.find(
    (u) => nested(u, 'path') === '.vscode-test/desktop-artifacts/**',
  );
  assert.equal(uploads.length, 2, 'diagnostics and handoff stay separate');
  assert.ok(canonical && diagnostics, 'both uploads must exist');
  assert.equal(
    stepField(canonical, 'if'),
    null,
    'only verified bytes hand off',
  );
  assert.equal(stepField(diagnostics, 'if'), 'always()', 'diagnostics always');
  assert.equal(
    nested(canonical, 'name'),
    'canonical-${{ github.ref_name }}-${{ github.run_id }}',
  );
  for (const [key, value] of Object.entries({
    'if-no-files-found': 'error',
    overwrite: 'false',
    'retention-days': '90',
  }))
    assert.equal(nested(canonical, key), value, `canonical ${key}`);
  assert.equal(nested(diagnostics, 'if-no-files-found'), 'ignore');
  assert.equal(nested(diagnostics, 'retention-days'), '7');
  for (const [key, source] of Object.entries({
    'artifact-id': 'steps.canonical.outputs.artifact-id',
    'archive-digest': 'steps.canonical.outputs.artifact-digest',
    node: 'steps.manifest.outputs.node',
    vsce: 'steps.manifest.outputs.vsce',
  }))
    assert.ok(block.includes(`${key}: \${{ ${source} }}`), `output ${key}`);
  const release = jobs(RELEASE);
  const publish = job(release, 'publish');
  assert.deepEqual(needs(job(release, 'validation')), []);
  assert.deepEqual(needs(job(release, 'quality')), ['validation']);
  assert.deepEqual(needs(publish), ['canonical']);
  assert.equal(field(publish, 'uses'), './.github/workflows/publish.yml');
  for (const key of ['artifact-id', 'archive-digest', 'node', 'vsce'])
    assert.ok(
      publish.includes(`${key}: \${{ needs.canonical.outputs.${key} }}`),
      `publish must receive the canonical ${key} unchanged`,
    );
});

test('both workflows install frozen and never weaken a required gate', () => {
  for (const [path, source] of [
    ['ci.yml', CI],
    ['release.yml', RELEASE],
  ] as const) {
    for (const forbidden of [
      'continue-on-error',
      '--update-baselines',
      'RDLC_ALLOW_CI_BASELINE_UPDATE',
    ])
      assert.ok(!source.includes(forbidden), `${path}: ${forbidden}`);
    const blocks = jobs(source);
    const installs = Object.values(blocks).flatMap((block) =>
      steps(block).filter((step) => RUN('pnpm install').test(step)),
    );
    assert.ok(installs.length > 0, `${path} installs dependencies`);
    for (const step of installs)
      assert.ok(
        RUN('pnpm install --frozen-lockfile').test(step),
        `${path} frozen`,
      );
    for (const [id, block] of Object.entries(blocks)) {
      const aggregate = path === 'ci.yml' && id === 'required';
      assert.equal(
        field(block, 'if'),
        aggregate ? 'always()' : null,
        `${path} ${id}`,
      );
    }
  }
  for (const step of steps(job(jobs(RELEASE), 'canonical')))
    if (RUN('pnpm test:').test(step))
      assert.equal(
        stepField(step, 'if'),
        null,
        'release checks cannot be conditional',
      );
});
