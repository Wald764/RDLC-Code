import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Static regression tests of the QA/release policy in the workflows. They read
// the workflow text (no YAML dependency): jobs at indent 2, job fields at
// indent 4, steps at indent 6. An unexpected layout fails an assertion.

const read = (name: string) =>
  readFileSync(`.github/workflows/${name}`, 'utf8');
const CI = read('ci.yml');
const RELEASE = read('release.yml');
const PUBLISH = read('publish.yml');

function jobs(source: string): { [id: string]: string } {
  const lines = source.split('\n');
  const start = lines.indexOf('jobs:');
  assert.notEqual(start, -1, 'jobs section');
  const blocks: { [id: string]: string } = {};
  let id = '';
  for (const line of lines.slice(start + 1)) {
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (key) {
      id = key[1]!;
      blocks[id] = '';
    } else if (id) blocks[id] += `${line}\n`;
  }
  return blocks;
}

const field = (block: string, key: string): string | null => {
  const found = new RegExp(`^ {4}${key}:[ \\t]*(\\S.*)$`, 'm').exec(block);
  return found ? found[1]!.replace(/^(['"])(.*)\1$/, '$2') : null;
};
const needs = (block: string): string[] => {
  const value = field(block, 'needs');
  if (value === null) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
};
const steps = (block: string): string[] =>
  block.split(/(?=^ {6}- )/m).filter((chunk) => /^ {6}- /m.test(chunk));
const stepIf = (step: string): string | null => {
  const found = /^ {6}(?:- | {2})if:[ \t]*(\S.*)$/m.exec(step);
  return found ? found[1]! : null;
};
const uploads = (block: string): string[] =>
  steps(block).filter((step) => /uses: actions\/upload-artifact@/.test(step));
const uploadName = (step: string): string =>
  /^ {10}name:[ \t]*(\S.*)$/m.exec(step)?.[1] ?? '';

/** Every job a job depends on, directly or not. */
function closure(blocks: { [id: string]: string }, id: string): Set<string> {
  const seen = new Set<string>();
  const visit = (current: string) => {
    for (const dependency of needs(blocks[current] ?? '')) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      visit(dependency);
    }
  };
  visit(id);
  return seen;
}

// `changed-specs` is critical and `stability` is judged per test by the gate;
// only `visual` is informational as a job.
const INFORMATIONAL_CI_JOBS = ['visual'];
const GATE_JUDGED_CI_JOBS = ['changed-specs', 'stability'];

test('ci.yml keeps the single required job: id, name, always() and every other job as input', () => {
  const blocks = jobs(CI);
  const required = blocks['required'];
  assert.ok(required, 'job id "required"');
  assert.equal(field(required, 'name'), 'Required checks');
  assert.equal(field(required, 'if'), 'always()');
  assert.deepEqual(
    needs(required).sort(),
    Object.keys(blocks)
      .filter((id) => id !== 'required')
      .sort(),
    'a new job must feed the gate',
  );
  assert.equal(
    Object.entries(blocks).filter(([, block]) =>
      /name: Required checks/.test(block),
    ).length,
    1,
  );
  const gate = steps(required).filter((step) =>
    /node dist\/scripts\/qa-gate\.js pr\b/.test(step),
  );
  assert.equal(gate.length, 1, 'one gate step');
  assert.equal(stepIf(gate[0]!), null, 'the gate itself cannot be skipped');
  // Evidence in, summary out.
  assert.match(required, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(required, /pattern: qa-cell-\*/);
  // The per-test stability measurements are judged by the gate, not per job.
  assert.match(required, /pattern: flake-results-\*/);
  assert.match(required, /path: qa-stability/);
  assert.match(gate[0]!, /--stability qa-stability/);
  assert.match(gate[0]!, /QA_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(required, /name: qa-summary-\$\{\{ github\.sha \}\}/);
  const summary = uploads(required).find((step) =>
    uploadName(step).startsWith('qa-summary-'),
  );
  assert.ok(summary);
  assert.equal(stepIf(summary), 'always()');
});

test('informational CI jobs never gate other jobs; the gate decides through classification', () => {
  const blocks = jobs(CI);
  for (const [id, block] of Object.entries(blocks)) {
    if (id === 'required' || INFORMATIONAL_CI_JOBS.includes(id)) continue;
    for (const dependency of needs(block))
      assert.ok(
        !INFORMATIONAL_CI_JOBS.includes(dependency),
        `${id} must not need informational ${dependency}`,
      );
  }
  assert.deepEqual(needs(blocks['desktop']!), ['quality']);
  for (const id of [...INFORMATIONAL_CI_JOBS, ...GATE_JUDGED_CI_JOBS])
    assert.ok(blocks[id], `${id} stays visible`);
  assert.deepEqual(needs(blocks['stability']!), ['changed-specs']);
});

test('release.yml: canonical depends on validation only, never on informational or QA jobs', () => {
  const blocks = jobs(RELEASE);
  assert.deepEqual(needs(blocks['canonical']!), ['validation']);
  assert.deepEqual(
    [...closure(blocks, 'canonical')],
    ['validation'],
    'no transitive dependency',
  );
  const quality = blocks['quality']!;
  assert.equal(field(quality, 'uses'), './.github/workflows/ci.yml');
  assert.deepEqual(needs(quality), ['validation']);
  assert.deepEqual(needs(blocks['candidate-qa']!), ['canonical']);
  // Nothing in the release needs the informational CI jobs by name.
  for (const block of Object.values(blocks))
    for (const id of INFORMATIONAL_CI_JOBS)
      assert.ok(!needs(block).includes(id));
});

test('release-gate runs whenever validation and canonical succeeded, whatever informational jobs did', () => {
  const gate = jobs(RELEASE)['release-gate'];
  assert.ok(gate, 'release-gate job');
  assert.deepEqual(needs(gate).sort(), [
    'candidate-qa',
    'canonical',
    'quality',
    'validation',
  ]);
  const condition = field(gate, 'if') ?? '';
  assert.match(condition, /^\$\{\{ !cancelled\(\) && /);
  assert.ok(condition.includes("needs.validation.result == 'success'"));
  assert.ok(condition.includes("needs.canonical.result == 'success'"));
  assert.ok(
    !/needs\.(quality|candidate-qa)\.result/.test(condition),
    'a failed informational job must not skip the gate',
  );
  assert.match(gate, /node dist\/scripts\/qa-gate\.js release\b/);
  assert.match(gate, /--ci-summary qa-ci/);
  assert.match(gate, /--readiness docs\/validation\/release-readiness\.md/);
  assert.match(gate, /--vsix-sha256 "\$CANONICAL_VSIX"/);
  assert.match(gate, /QA_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(gate, /status: \$\{\{ steps\.gate\.outputs\.status \}\}/);
  const summary = uploads(gate).find((step) =>
    uploadName(step).startsWith('release-qa-'),
  );
  assert.ok(summary, 'the release QA summary is kept');
  assert.equal(stepIf(summary), 'always()');
});

test('publish depends on canonical and release-gate and runs only when both succeeded', () => {
  const publish = jobs(RELEASE)['publish'];
  assert.ok(publish);
  assert.deepEqual(needs(publish).sort(), ['canonical', 'release-gate']);
  const condition = field(publish, 'if') ?? '';
  assert.match(condition, /^\$\{\{ !cancelled\(\) && /);
  assert.ok(condition.includes("needs.canonical.result == 'success'"));
  assert.ok(condition.includes("needs.release-gate.result == 'success'"));
  assert.ok(!/always\(\)|failure\(\)/.test(condition));
  assert.equal(field(publish, 'uses'), './.github/workflows/publish.yml');
  assert.equal(field(publish, 'secrets'), 'inherit');
  assert.match(
    publish,
    /qa-status: \$\{\{ needs\.release-gate\.outputs\.status \}\}/,
  );
  // Only publish may ask for write or identity permissions.
  for (const [id, block] of Object.entries(jobs(RELEASE)))
    assert.equal(/^ {4}permissions:/m.test(block), id === 'publish', id);
  assert.match(PUBLISH, /^ {6}qa-status:/m);
  assert.match(PUBLISH, /QA gate outcome/);
});

test('publish.yml enforces qa-status before any credential, environment or write', () => {
  const inputs = /^ {6}qa-status:\n(?: {8}.*\n)+/m.exec(PUBLISH)?.[0] ?? '';
  assert.match(inputs, /^ {8}required: true$/m, 'the input is required');
  assert.ok(!/default:/.test(inputs), 'no default status');
  const blocks = jobs(PUBLISH);
  const gate = blocks['qa-status'];
  assert.ok(gate, 'a dedicated QA status job');
  // No credential, environment, secret or permission in the gate itself.
  assert.ok(!/environment:|secrets\.|vars\.|azure\/login/.test(gate));
  assert.match(gate, /^ {4}permissions: \{\}$/m);
  assert.deepEqual(needs(gate), []);
  assert.match(gate, /^ {6}QA_STATUS: \$\{\{ inputs\.qa-status \}\}$/m);
  assert.ok(!/\$\{\{ inputs\./.test(gate.replace(/^ {6}QA_STATUS: .*$/m, '')));
  assert.match(gate, /'PUBLISHABLE' \| 'FULLY VALIDATED'\) ;;/);
  assert.match(
    gate,
    /\[ "\$GITHUB_REF" != 'refs\/tags\/v0\.0\.4-publishing-test' \]/,
  );
  assert.match(gate, /exit 1/);
  assert.ok(!/continue-on-error/.test(gate));
  // Every job that touches an environment or a credential waits for it, directly
  // or through preflight.
  assert.deepEqual(needs(blocks['preflight']!), ['qa-status']);
  for (const id of Object.keys(blocks))
    if (id !== 'qa-status' && id !== 'summary')
      assert.ok(
        id === 'preflight' || closure(blocks, id).has('qa-status'),
        `${id} depends on the QA status check`,
      );
  // The status only ever reaches a script through env, never inline.
  for (const line of PUBLISH.split('\n'))
    if (line.includes('inputs.qa-status'))
      assert.match(line, /^ +QA_STATUS: \$\{\{ inputs\.qa-status \}\}$/);
});

test('the only other caller of publish.yml passes the narrow AUTH-TEST status', () => {
  const auth = read('publishing-auth-test.yml');
  assert.match(auth, /^ {6}qa-status: AUTH-TEST$/m);
  assert.match(auth, /tags: \['v\*-publishing-test'\]/);
  assert.ok(
    auth.includes("if: github.ref == 'refs/tags/v0.0.4-publishing-test'"),
  );
  for (const name of readdirSync('.github/workflows')) {
    if (!/\.ya?ml$/.test(name) || name === 'publish.yml') continue;
    const source = read(name);
    if (!source.includes('./.github/workflows/publish.yml')) continue;
    assert.match(
      source,
      /qa-status: (?:AUTH-TEST|\$\{\{ needs\.release-gate\.outputs\.status \}\})$/m,
      `${name} passes a qa-status`,
    );
  }
});

test('publication credentials and environments stay in publish.yml', () => {
  assert.ok(!/secrets\./.test(CI), 'ci.yml reads no secret');
  assert.ok(!/secrets\./.test(RELEASE), 'release.yml reads no secret');
  assert.ok(!/^\s+environment:/m.test(CI + RELEASE));
  for (const environment of ['marketplace', 'openvsx'])
    assert.match(PUBLISH, new RegExp(`environment: ${environment}`));
  assert.match(PUBLISH, /secrets\.OVSX_PAT/);
});

test('ci.yml and release.yml never continue on error and publish.yml keeps its gates', () => {
  for (const [name, source] of [
    ['ci.yml', CI],
    ['release.yml', RELEASE],
    ['publish.yml', PUBLISH],
  ] as const)
    assert.ok(!source.includes('continue-on-error'), name);
});

test('no workflow uses pull_request_target and every workflow declares permissions', () => {
  const names = readdirSync('.github/workflows').filter((file) =>
    /\.ya?ml$/.test(file),
  );
  assert.ok(names.length >= 8);
  for (const name of names) {
    const source = read(name);
    assert.ok(!source.includes('pull_request_target'), name);
    assert.match(source, /^permissions:/m, `${name}: top-level permissions`);
  }
  for (const source of [CI, RELEASE])
    assert.match(source, /^permissions:\n {2}contents: read$/m);
  for (const [id, block] of Object.entries(jobs(CI)))
    assert.ok(
      !/^ {4}permissions:/m.test(block),
      `ci.yml ${id} stays read-only`,
    );
});

test('evidence uploads always run and their names cannot collide', () => {
  const names = new Set<string>();
  for (const [file, source] of [
    ['ci.yml', CI],
    ['release.yml', RELEASE],
  ] as const)
    for (const [id, block] of Object.entries(jobs(source)))
      for (const upload of uploads(block)) {
        const name = uploadName(upload);
        assert.ok(name, `${file} ${id}: upload name`);
        // The canonical handoff is the only upload tied to a verified build.
        if (name.startsWith('canonical-'))
          assert.equal(stepIf(upload), null, 'only verified bytes hand off');
        else if (name.startsWith('vscode-logs-'))
          assert.equal(stepIf(upload), 'failure()', name);
        else assert.equal(stepIf(upload), 'always()', `${file} ${id}: ${name}`);
        if (name.startsWith('qa-') || name.startsWith('release-qa-'))
          assert.match(upload, /^ {10}overwrite: true$/m, name);
        assert.ok(
          !names.has(`${id}:${name}`),
          `${file}: duplicate upload ${name}`,
        );
        names.add(`${id}:${name}`);
      }
  const cell = uploads(jobs(CI)['desktop']!).find((u) =>
    uploadName(u).startsWith('qa-cell-'),
  );
  assert.ok(cell, 'every Desktop cell uploads its evidence');
  assert.match(
    uploadName(cell),
    /qa-cell-\$\{\{ matrix\.os \}\}-\$\{\{ matrix\.vscode \}\}-\$\{\{ matrix\.group \}\}/,
  );
});

test('desktop suites run independently on their own prerequisites', () => {
  const desktop = steps(jobs(CI)['desktop']!);
  const suites = desktop.filter((step) =>
    /^ {8}run: .*pnpm test:(e2e|vscode|package)/m.test(step),
  );
  assert.equal(
    suites.length,
    10,
    'host, package, probe, functional, installed x2 OS families',
  );
  for (const step of suites) {
    const condition = stepIf(step) ?? '';
    assert.match(condition, /^\$\{\{ !cancelled\(\) && /, step.slice(0, 80));
    assert.match(condition, /steps\.[a-z-]+\.outcome == 'success'/);
    assert.match(
      step,
      /^ {6}- id: [a-z0-9-]+$|^ {8}id: [a-z0-9-]+$/m,
      'step ids feed the evidence',
    );
  }
  const collect = desktop.find((step) => /qa-collect\.ts/.test(step));
  assert.ok(collect);
  assert.equal(stepIf(collect), 'always()');
  assert.match(collect, /QA_CANDIDATE: \$\{\{ github\.sha \}\}/);
  // The same step ids the gate expects are recorded.
  for (const id of [
    'install',
    'build',
    'package',
    'download-vscode',
    'vscode-linux',
    'package-tests-other',
    'probe-linux',
    'e2e-other',
    'installed-linux',
  ])
    assert.ok(
      collect.includes(
        `QA_STEP_${id.toUpperCase().replaceAll('-', '_')}: \${{ steps.${id}.outcome }}`,
      ),
      id,
    );
});
