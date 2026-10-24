import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  createInputManifest,
  createScopedPatchDigest,
  diffInputManifests,
  incompatibleReasons,
  inputManifestFingerprint,
  isCandidateInput,
  MANIFEST_RULES,
  normalizeCandidateText,
  referenceEnvironmentReasons,
  REFERENCE_ENVIRONMENT,
  environmentFromDriver,
  sha256Bytes,
  validateEvidence,
  verifyArtifacts,
  type ArtifactRef,
  type CoverageRef,
  type EnvironmentIdentity,
  type EvidenceAssertion,
  type EvidenceRecord,
  type FixtureRef,
  type FrozenInputManifest,
} from './evidence.js';

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'rdlc-evidence-'));
}

function put(root: string, entries: Record<string, string>): void {
  for (const [path, content] of Object.entries(entries)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const digest = (text: string): string => sha256Bytes(Buffer.from(text));

const BASE_FILES: Record<string, string> = {
  '.gitignore': 'dist/\n',
  '.prettierignore': 'dist\n',
  '.prettierrc.json': '{ "singleQuote": true }\n',
  '.specify/memory/constitution.md': 'governance rules\n',
  'CONTRIBUTING.md': 'contributor guidance\n',
  'README.md': 'project overview\n',
  'docs/guide.md': 'usage guidance\n',
  'package.json': '{"name":"candidate"}',
  'apps/vscode-extension/src/extension.ts': 'export const activate = 1;',
  'tests/desktop/evidence.test.ts': 'assertion source',
  'tests/desktop/coverage.json': '{"rows":[]}',
  'tests/fixtures/sidebar/structure.rdlc': '<Report/>',
  'tests/desktop/baselines/workspace/shell.png': 'png',
  'specs/005-native-sidebar-integration/spec.md': 'normative spec',
  'specs/005-native-sidebar-integration/contracts/desktop-validation.md':
    'contract',
  'specs/005-native-sidebar-integration/tasks.md':
    '- [ ] T001 normative task text\n',
  'specs/005-native-sidebar-integration/checklists/requirements.md':
    '- [ ] normative checklist text\n',
};

function candidate(): string {
  const root = workspace();
  put(root, BASE_FILES);
  return root;
}

const environment: EnvironmentIdentity = {
  os: 'linux',
  osImage: 'ubuntu-24.04',
  vscodeVersion: '1.142.0',
  vscodeBuild: REFERENCE_ENVIRONMENT.vscodeBuild,
  vscodeHash: 'reference-executable-hash',
  driverVersion: 'playwright@1.64.1',
  locale: 'en',
  timezone: 'UTC',
  theme: 'Default High Contrast',
  fonts: 'Ubuntu 24.04 reference fonts',
  display: {
    width: 1440,
    height: 1000,
    dpr: 1,
    interfaceScale: 100,
    reportZoom: 100,
  },
};

const fixtures: FixtureRef[] = [
  { id: 'local-blank', sha256: digest('fixture bytes') },
];

function emptyManifest(): FrozenInputManifest {
  const manifest = { rules: MANIFEST_RULES, files: [] };
  return { ...manifest, fingerprint: inputManifestFingerprint(manifest) };
}

function makeRecord(
  root: string,
  assertions: EvidenceAssertion[],
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  return {
    schemaVersion: 1,
    feature: '005-native-sidebar-integration',
    provenance: {
      commit: 'b'.repeat(40),
      dirty: false,
      patchDigest: null,
      manifest: createInputManifest(root),
    },
    artifact: { name: 'rdlc-code-0.2.0.vsix', sha256: digest('vsix bytes') },
    fixtures,
    environment,
    assertions,
    artifacts: [],
    ...overrides,
  };
}

interface CandidateOverride {
  readonly vsixSha256?: string;
  readonly environment?: EnvironmentIdentity;
  readonly fixtures?: readonly FixtureRef[];
}

function validate(
  record: EvidenceRecord,
  coverage: CoverageRef,
  root: string,
  overrides: CandidateOverride = {},
) {
  return validateEvidence(record, coverage, {
    root,
    vsixSha256: overrides.vsixSha256 ?? record.artifact?.sha256 ?? '',
    environment: overrides.environment ?? record.environment,
    fixtures: overrides.fixtures ?? record.fixtures,
  });
}

function putArtifact(
  root: string,
  id: string,
  path: string,
  content: string,
): ArtifactRef {
  put(root, { [path]: content });
  return { id, path, sha256: digest(content) };
}

const coverage: CoverageRef = {
  rows: [
    {
      id: 'US1.1',
      fixtures: ['local-blank'],
      oracle: 'Independent expected workspace container and views.',
      tests: ['workspace::entry', 'workspace::views'],
    },
    {
      id: 'FR-001',
      fixtures: ['local-blank'],
      oracle: 'Independent expected package container contribution.',
      tests: ['package::container'],
    },
  ],
};

const passed = (): EvidenceAssertion[] => [
  { id: 'workspace::entry', outcome: 'passed' },
  { id: 'workspace::views', outcome: 'passed' },
  { id: 'package::container', outcome: 'passed' },
];

test('evidence rejects unknown outcomes and unverified or unresolved artifact references', () => {
  const root = candidate();
  try {
    const invalid = passed();
    invalid[0] = {
      id: 'workspace::entry',
      outcome: 'skipped' as EvidenceAssertion['outcome'],
    };
    assert.equal(
      validate(makeRecord(root, invalid), coverage, root).validated,
      false,
    );

    const unresolved = passed();
    unresolved[0] = { ...unresolved[0]!, artifacts: ['absent-trace'] };
    assert.equal(
      validate(makeRecord(root, unresolved), coverage, root).validated,
      false,
    );

    const artifacts = [
      { id: 'trace', path: 'traces/trace.zip', sha256: digest('trace') },
    ];
    assert.equal(
      validate(makeRecord(root, passed(), { artifacts }), coverage, root)
        .validated,
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed JSON evidence and coverage return an unvalidated result', () => {
  const root = candidate();
  try {
    for (const value of [
      null,
      {},
      { provenance: null },
      { ...makeRecord(root, passed()), assertions: [null] },
    ]) {
      const result = validate(
        value as unknown as EvidenceRecord,
        coverage,
        root,
        { vsixSha256: digest('vsix bytes'), environment, fixtures },
      );
      assert.equal(result.validated, false);
    }
    const record = makeRecord(root, passed());
    for (const value of [
      {},
      { rows: null },
      { rows: [null] },
      { ...coverage, unavailableExceptions: [null] },
    ]) {
      assert.equal(
        validate(record, value as unknown as CoverageRef, root).validated,
        false,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('input manifest freezes exact owned roots and keeps authored fixtures/baselines', () => {
  const root = workspace();
  try {
    put(root, {
      ...BASE_FILES,
      'packages/report-model/src/index.ts': 'export const model = 1;',
      'pnpm-lock.yaml': 'lockfile',
      'tests/fixtures/sidebar/structure-actual.rdlc': '<Report/>',
      'tests/desktop/baselines/workspace/shell-diff.png': 'png',
      '.github/workflows/ci.yml': 'jobs: {}',
      'README.md': 'narrative',
      'docs/guide.md': 'narrative',
      'vendor/format.md': 'citation',
      'dist/apps/vscode-extension/extension.js': 'build output',
      'packages/report-model/dist/index.js': 'package build output',
      'apps/vscode-extension/build/extension.cjs': 'generated bundle',
      'apps/designer/.angular/cache/hash': 'generated Angular cache',
      'node_modules/pkg/index.js': 'dependency',
      '.opencode/opencode.json': 'user config',
      'specs/005-native-sidebar-integration/tasks.md': '- [x] T001',
      'specs/005-native-sidebar-integration/checklists/requirements.md':
        'checklist',
      'specs/005-native-sidebar-integration/evidence/us1.json':
        '{"outcome":"passed"}',
      'tests/desktop/artifacts/workspace-actual.png': 'capture',
      'release/rdlc-code-0.2.0.vsix': 'artifact',
      'run.log': 'log',
      'tests/desktop/traces/desktop.trace.zip': 'trace',
    });

    const manifest = createInputManifest(root);
    assert.deepEqual(
      manifest.files.map((file) => file.path),
      [
        '.github/workflows/ci.yml',
        '.gitignore',
        '.prettierignore',
        '.prettierrc.json',
        '.specify/memory/constitution.md',
        'CONTRIBUTING.md',
        'README.md',
        'apps/vscode-extension/src/extension.ts',
        'docs/guide.md',
        'package.json',
        'packages/report-model/src/index.ts',
        'pnpm-lock.yaml',
        'specs/005-native-sidebar-integration/checklists/requirements.md',
        'specs/005-native-sidebar-integration/contracts/desktop-validation.md',
        'specs/005-native-sidebar-integration/spec.md',
        'specs/005-native-sidebar-integration/tasks.md',
        'tests/desktop/baselines/workspace/shell-diff.png',
        'tests/desktop/baselines/workspace/shell.png',
        'tests/desktop/coverage.json',
        'tests/desktop/evidence.test.ts',
        'tests/fixtures/sidebar/structure-actual.rdlc',
        'tests/fixtures/sidebar/structure.rdlc',
      ],
    );
    assert.equal(manifest.fingerprint, inputManifestFingerprint(manifest));
    assert.match(manifest.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(isCandidateInput('tests/desktop/evidence.ts'), true);
    assert.equal(
      isCandidateInput('specs/005-native-sidebar-integration/tasks.md'),
      true,
    );
    assert.equal(
      isCandidateInput(
        'specs/005-native-sidebar-integration/checklists/requirements.md',
      ),
      true,
    );
    assert.equal(isCandidateInput('README.md'), true);
    assert.equal(isCandidateInput('CONTRIBUTING.md'), true);
    assert.equal(isCandidateInput('AGENTS.md'), true);
    assert.equal(isCandidateInput('LICENSE'), true);
    assert.equal(isCandidateInput('THIRD_PARTY_NOTICES.md'), true);
    assert.equal(isCandidateInput('docs/guide.md'), true);
    assert.equal(isCandidateInput('.specify/memory/constitution.md'), true);
    assert.equal(
      isCandidateInput('.specify/templates/spec-template.md'),
      false,
    );
    assert.equal(isCandidateInput('vendor/format.md'), false);
    assert.equal(
      isCandidateInput('tests/fixtures/sidebar/structure-actual.rdlc'),
      true,
    );
    assert.equal(
      isCandidateInput('tests/desktop/baselines/workspace/shell-diff.png'),
      true,
    );
    assert.equal(
      isCandidateInput(
        'specs/005-native-sidebar-integration/evidence/us1.json',
      ),
      false,
    );
    assert.equal(
      isCandidateInput('tests/desktop/artifacts/workspace-actual.png'),
      false,
    );
    assert.equal(
      isCandidateInput('packages/report-model/dist/index.js'),
      false,
    );
    assert.equal(isCandidateInput('apps/designer/.angular/cache/hash'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fingerprint detects input changes, additions and deletions but ignores generated output', () => {
  const root = workspace();
  try {
    put(root, BASE_FILES);
    const before = createInputManifest(root);

    writeFileSync(join(root, 'package.json'), 'candidate two');
    put(root, { 'tests/fixtures/sidebar/data.rdlc': '<Report/>' });
    rmSync(join(root, 'apps/vscode-extension/src/extension.ts'));
    const after = createInputManifest(root);
    assert.deepEqual(diffInputManifests(before, after), {
      added: ['tests/fixtures/sidebar/data.rdlc'],
      deleted: ['apps/vscode-extension/src/extension.ts'],
      changed: ['package.json'],
    });
    assert.notEqual(before.fingerprint, after.fingerprint);

    put(root, {
      'specs/005-native-sidebar-integration/evidence/us1.json':
        '{"outcome":"passed"}',
      'tests/desktop/artifacts/run-actual.png': 'capture',
      'dist/scripts/build.js': 'build output',
      'apps/designer/.angular/cache/hash': 'cache',
      'release/candidate.vsix': 'artifact',
    });
    const afterEvidence = createInputManifest(root);
    assert.deepEqual(diffInputManifests(after, afterEvidence), {
      added: [],
      deleted: [],
      changed: [],
    });
    assert.equal(afterEvidence.fingerprint, after.fingerprint);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('only task and checklist checkbox state is normalized; status markers and normative checkboxes are hashed', () => {
  const root = workspace();
  const tasks = 'specs/005-native-sidebar-integration/tasks.md';
  const checklist =
    'specs/005-native-sidebar-integration/checklists/requirements.md';
  const nestedChecklist =
    'specs/005-native-sidebar-integration/checklists/nested/quality.md';
  const spec = 'specs/005-native-sidebar-integration/spec.md';
  const contract =
    'specs/005-native-sidebar-integration/contracts/desktop-validation.md';
  const markers = [
    '<!-- evidence-status:begin -->',
    'All tasks complete.',
    '<!-- evidence-status:end -->',
    '',
  ].join('\n');
  const baseline = [
    '# Tasks',
    '',
    '- [ ] T001 Add native sidebar.',
    '- [x] T002 Document it.',
    '',
    markers,
  ].join('\n');
  const bookkeepingOnly = [
    '# Tasks',
    '',
    '- [x] T001 Add native sidebar.',
    '- [ ] T002 Document it.',
    '',
    markers,
  ].join('\n');
  const specBaseline =
    '- [x] Requirement checkbox.\nRequirement: the sidebar must exist.\n';
  const contractBaseline = '- [x] Contract checkbox.\nContract rules.\n';
  try {
    put(root, {
      ...BASE_FILES,
      [tasks]: baseline,
      [checklist]: '- [x] Checklist criterion.\n',
      [nestedChecklist]: '- [ ] Nested checklist criterion.\n',
      [spec]: specBaseline,
      [contract]: contractBaseline,
    });
    const before = createInputManifest(root);

    assert.equal(
      normalizeCandidateText(tasks, '- [X] T001 Add native sidebar.'),
      '- [ ] T001 Add native sidebar.',
    );
    assert.equal(
      normalizeCandidateText(checklist, '- [X] Checklist criterion.'),
      '- [ ] Checklist criterion.',
    );
    assert.equal(
      normalizeCandidateText(nestedChecklist, '- [X] Nested criterion.'),
      '- [ ] Nested criterion.',
    );
    for (const path of [spec, contract, 'README.md']) {
      const text = '- [X] Requirement checkbox.';
      assert.equal(
        normalizeCandidateText(path, text),
        text,
        `${path} must not normalize checkboxes`,
      );
    }
    assert.equal(
      normalizeCandidateText(tasks, markers),
      markers,
      'status markers and prose must stay literal',
    );

    writeFileSync(join(root, tasks), bookkeepingOnly);
    writeFileSync(join(root, checklist), '- [ ] Checklist criterion.\n');
    writeFileSync(
      join(root, nestedChecklist),
      '- [x] Nested checklist criterion.\n',
    );
    const bookkeeping = createInputManifest(root);
    assert.equal(bookkeeping.fingerprint, before.fingerprint);

    writeFileSync(
      join(root, tasks),
      baseline.replace('All tasks complete.', 'All tasks complete; validated.'),
    );
    const statusChanged = createInputManifest(root);
    assert.notEqual(statusChanged.fingerprint, before.fingerprint);
    assert.deepEqual(diffInputManifests(before, statusChanged).changed, [
      tasks,
    ]);

    writeFileSync(join(root, tasks), baseline);
    writeFileSync(join(root, checklist), '- [x] Checklist criterion.\n');
    writeFileSync(
      join(root, nestedChecklist),
      '- [ ] Nested checklist criterion.\n',
    );
    writeFileSync(join(root, spec), specBaseline.replace('- [x]', '- [ ]'));
    const specCheckbox = createInputManifest(root);
    assert.notEqual(specCheckbox.fingerprint, before.fingerprint);
    assert.deepEqual(diffInputManifests(before, specCheckbox).changed, [spec]);

    writeFileSync(join(root, spec), specBaseline);
    writeFileSync(
      join(root, contract),
      contractBaseline.replace('- [x]', '- [ ]'),
    );
    const contractCheckbox = createInputManifest(root);
    assert.notEqual(contractCheckbox.fingerprint, before.fingerprint);
    assert.deepEqual(diffInputManifests(before, contractCheckbox).changed, [
      contract,
    ]);

    writeFileSync(join(root, contract), contractBaseline);
    writeFileSync(
      join(root, tasks),
      baseline.replace('Add native sidebar.', 'Add native sidebar panel.'),
    );
    const taskTextChanged = createInputManifest(root);
    assert.notEqual(taskTextChanged.fingerprint, before.fingerprint);
    assert.deepEqual(diffInputManifests(before, taskTextChanged).changed, [
      tasks,
    ]);

    writeFileSync(join(root, tasks), baseline);
    writeFileSync(
      join(root, checklist),
      '- [x] Checklist criterion changed.\n',
    );
    const checklistChanged = createInputManifest(root);
    assert.notEqual(checklistChanged.fingerprint, before.fingerprint);
    assert.deepEqual(diffInputManifests(before, checklistChanged).changed, [
      checklist,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('README, CONTRIBUTING, docs and constitution changes invalidate candidate inputs', () => {
  const areas: ReadonlyArray<readonly [string, string]> = [
    ['README.md', 'changed project overview\n'],
    ['CONTRIBUTING.md', 'changed contributor guidance\n'],
    ['docs/guide.md', 'changed usage guidance\n'],
    ['.specify/memory/constitution.md', 'changed governance rules\n'],
  ];
  for (const [path, content] of areas) {
    const root = candidate();
    try {
      const before = createInputManifest(root);
      assert.equal(isCandidateInput(path), true, path);
      writeFileSync(join(root, path), content);
      const changed = createInputManifest(root);
      assert.notEqual(changed.fingerprint, before.fingerprint, path);
      assert.deepEqual(diffInputManifests(before, changed).changed, [path]);

      rmSync(join(root, path));
      const deleted = createInputManifest(root);
      assert.notEqual(deleted.fingerprint, before.fingerprint, path);
      assert.deepEqual(diffInputManifests(before, deleted).deleted, [path]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const root = candidate();
  try {
    const before = createInputManifest(root);
    put(root, { 'docs/added.md': 'new normative guidance\n' });
    const added = createInputManifest(root);
    assert.notEqual(added.fingerprint, before.fingerprint);
    assert.deepEqual(diffInputManifests(before, added).added, [
      'docs/added.md',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('normative text inside status markers and executable files in output directories stay candidate inputs', () => {
  const root = candidate();
  const contract =
    'specs/005-native-sidebar-integration/contracts/desktop-validation.md';
  try {
    put(root, {
      [contract]:
        '<!-- evidence-status:begin -->\nMUST retain exact source.\n<!-- evidence-status:end -->\n',
    });
    const before = createInputManifest(root);
    put(root, {
      [contract]:
        '<!-- evidence-status:begin -->\nMUST rewrite all source.\n<!-- evidence-status:end -->\n',
    });
    const changed = createInputManifest(root);
    assert.notEqual(changed.fingerprint, before.fingerprint);
    for (const path of [
      'tests/desktop/artifacts/helper.ts',
      'tests/desktop/artifacts/nested/assertion.mjs',
      'specs/005-native-sidebar-integration/evidence/oracle.cjs',
    ]) {
      assert.equal(isCandidateInput(path), true);
      const previous = createInputManifest(root);
      put(root, { [path]: 'export const assertion = true;' });
      const current = createInputManifest(root);
      assert.deepEqual(diffInputManifests(previous, current).added, [path]);
      assert.notEqual(previous.fingerprint, current.fingerprint);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('candidate symlink directories fail closed instead of hiding importable source', () => {
  const root = candidate();
  const target = workspace();
  try {
    put(target, { 'helper.ts': 'export const assertion = true;' });
    mkdirSync(join(root, 'apps'), { recursive: true });
    symlinkSync(
      target,
      join(root, 'apps', 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(() => createInputManifest(root), /Candidate input symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

test('scoped patch digest records current bytes and explicit deletion states', () => {
  const root = workspace();
  try {
    put(root, BASE_FILES);
    const cleanManifest = createInputManifest(root);
    const clean = createScopedPatchDigest(cleanManifest, cleanManifest);
    assert.equal(clean, digest(''));

    writeFileSync(join(root, 'package.json'), 'candidate two');
    const changedManifest = createInputManifest(root);
    const changed = createScopedPatchDigest(cleanManifest, changedManifest);
    assert.equal(
      changed,
      sha256Bytes(
        Buffer.from(`package.json\t${digest('candidate two')}`, 'utf8'),
      ),
    );
    assert.notEqual(changed, clean);

    writeFileSync(join(root, 'package.json'), 'candidate three');
    const changedAgain = createScopedPatchDigest(
      cleanManifest,
      createInputManifest(root),
    );
    assert.notEqual(changedAgain, changed);

    const deletionBase = createInputManifest(root);
    rmSync(join(root, 'package.json'));
    const afterDeletion = createInputManifest(root);
    const deleted = createScopedPatchDigest(deletionBase, afterDeletion);
    assert.equal(
      deleted,
      sha256Bytes(Buffer.from('package.json\tnull', 'utf8')),
    );

    writeFileSync(join(root, 'package.json'), '');
    const afterEmpty = createInputManifest(root);
    assert.notEqual(createScopedPatchDigest(deletionBase, afterEmpty), deleted);

    put(root, { 'tests/fixtures/sidebar/data.rdlc': '<Report/>' });
    const afterAdd = createInputManifest(root);
    assert.notEqual(createScopedPatchDigest(deletionBase, afterAdd), deleted);
    put(root, {
      'specs/005-native-sidebar-integration/evidence/run.json': '{"done":true}',
      'tests/desktop/artifacts/run-actual.png': 'capture',
      'dist/scripts/build.js': 'build output',
    });
    assert.equal(
      createScopedPatchDigest(deletionBase, createInputManifest(root)),
      createScopedPatchDigest(deletionBase, afterAdd),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validation requires a freshly recomputed current candidate and rejects fabricated manifests', () => {
  const root = candidate();
  try {
    const record = makeRecord(root, passed());
    const current = validate(record, coverage, root);
    assert.equal(current.validated, true, current.reasons.join('; '));

    const fabricated = makeRecord(root, passed(), {
      provenance: {
        commit: 'b'.repeat(40),
        dirty: false,
        patchDigest: null,
        manifest: emptyManifest(),
      },
    });
    const fabricatedResult = validate(fabricated, coverage, root);
    assert.equal(fabricatedResult.validated, false);
    assert.ok(
      fabricatedResult.reasons.some((reason) =>
        reason.includes('malformed or empty'),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const emptyRoot = workspace();
  try {
    const emptyRecord = makeRecord(emptyRoot, passed());
    const result = validate(emptyRecord, coverage, emptyRoot);
    assert.equal(result.validated, false);
    assert.ok(
      result.reasons.some((reason) =>
        reason.includes('no included input files'),
      ),
    );
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }
});

test('input additions, changes and deletions in every owned area invalidate recorded evidence', () => {
  const areas = [
    {
      label: 'production source',
      file: 'apps/vscode-extension/src/extension.ts',
      added: 'apps/vscode-extension/src/sidebar.ts',
    },
    {
      label: 'test assertion',
      file: 'tests/desktop/evidence.test.ts',
      added: 'tests/desktop/runner-probe.ts',
    },
    {
      label: 'fixture',
      file: 'tests/fixtures/sidebar/structure.rdlc',
      added: 'tests/fixtures/sidebar/data.rdlc',
    },
    {
      label: 'baseline',
      file: 'tests/desktop/baselines/workspace/shell.png',
      added: 'tests/desktop/baselines/workspace/shell-focus.png',
    },
    {
      label: 'coverage mapping',
      file: 'tests/desktop/coverage.json',
      added: 'tests/desktop/coverage-extra.json',
    },
    {
      label: 'validation contract',
      file: 'specs/005-native-sidebar-integration/contracts/desktop-validation.md',
      added:
        'specs/005-native-sidebar-integration/contracts/native-workspace.md',
    },
  ];
  for (const area of areas) {
    for (const mutation of ['change', 'delete', 'add'] as const) {
      const root = candidate();
      try {
        const record = makeRecord(root, passed());
        assert.equal(
          validate(record, coverage, root).validated,
          true,
          `${area.label} baseline`,
        );
        if (mutation === 'change')
          writeFileSync(join(root, area.file), 'mutated candidate input');
        if (mutation === 'delete') rmSync(join(root, area.file));
        if (mutation === 'add')
          put(root, { [area.added]: 'new candidate input' });
        const result = validate(record, coverage, root);
        assert.equal(
          result.validated,
          false,
          `${area.label} ${mutation} was not rejected`,
        );
        assert.ok(
          result.reasons.some((reason) =>
            reason.includes('Current candidate inputs differ'),
          ),
          `${area.label} ${mutation} missing current-input reason`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('manifest rules, duplicate entries and duplicate paths are rejected', () => {
  const root = candidate();
  try {
    const record = makeRecord(root, passed());
    const manifest = record.provenance.manifest;

    const rulesManifest = {
      ...manifest,
      rules: {
        ...MANIFEST_RULES,
        included: [...MANIFEST_RULES.included, 'vendor/**'],
      } as unknown as typeof MANIFEST_RULES,
    };
    const rulesResult = validate(
      makeRecord(root, passed(), {
        provenance: { ...record.provenance, manifest: rulesManifest },
      }),
      coverage,
      root,
    );
    assert.equal(rulesResult.validated, false);
    assert.ok(
      rulesResult.reasons.some((reason) => reason.includes('rules differ')),
    );

    const first = manifest.files[0];
    assert.ok(first);
    const duplicateFiles = [...manifest.files, first];
    const duplicateResult = validate(
      makeRecord(root, passed(), {
        provenance: {
          ...record.provenance,
          manifest: {
            ...manifest,
            files: duplicateFiles,
            fingerprint: inputManifestFingerprint({
              rules: manifest.rules,
              files: duplicateFiles,
            }),
          },
        },
      }),
      coverage,
      root,
    );
    assert.equal(duplicateResult.validated, false);
    assert.ok(
      duplicateResult.reasons.some((reason) =>
        reason.includes('duplicate paths'),
      ),
    );

    const duplicateRules = {
      ...manifest.rules,
      included: [...manifest.rules.included, manifest.rules.included[0]!],
    } as unknown as typeof MANIFEST_RULES;
    const duplicateRulesResult = validate(
      makeRecord(root, passed(), {
        provenance: {
          ...record.provenance,
          manifest: {
            ...manifest,
            rules: duplicateRules,
            fingerprint: inputManifestFingerprint({
              rules: duplicateRules,
              files: manifest.files,
            }),
          },
        },
      }),
      coverage,
      root,
    );
    assert.equal(duplicateRulesResult.validated, false);
    assert.ok(
      duplicateRulesResult.reasons.some((reason) =>
        reason.includes('rules contain duplicates'),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dirty provenance requires a SHA-256 patch digest and clean provenance forbids one', () => {
  const root = candidate();
  try {
    const record = makeRecord(root, passed());
    for (const patchDigest of [null, '', 'not-a-digest']) {
      const result = validate(
        makeRecord(root, passed(), {
          provenance: { ...record.provenance, dirty: true, patchDigest },
        }),
        coverage,
        root,
      );
      assert.equal(result.validated, false);
      assert.ok(
        result.reasons.some((reason) =>
          reason.includes('Dirty candidate requires'),
        ),
      );
    }
    assert.equal(
      validate(
        makeRecord(root, passed(), {
          provenance: {
            ...record.provenance,
            dirty: true,
            patchDigest: 'f'.repeat(64),
          },
        }),
        coverage,
        root,
      ).validated,
      true,
    );
    const cleanWithDigest = validate(
      makeRecord(root, passed(), {
        provenance: {
          ...record.provenance,
          dirty: false,
          patchDigest: 'f'.repeat(64),
        },
      }),
      coverage,
      root,
    );
    assert.equal(cleanWithDigest.validated, false);
    assert.ok(
      cleanWithDigest.reasons.some((reason) =>
        reason.includes('must not record a patch digest'),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mandatory coverage rows cannot opt out and empty rows are rejected', () => {
  const root = candidate();
  try {
    const record = makeRecord(root, passed());
    const optOut = {
      rows: [
        {
          id: 'US1.1',
          fixtures: ['local-blank'],
          oracle: 'Independent expected workspace container.',
          tests: ['workspace::entry', 'workspace::views'],
          mandatory: false,
        },
      ],
    } as unknown as CoverageRef;
    const optOutResult = validate(record, optOut, root);
    assert.equal(optOutResult.validated, false);
    assert.ok(
      optOutResult.reasons.some((reason) =>
        reason.includes('unsupported mandatory flag'),
      ),
    );

    const emptyRow = validate(
      record,
      {
        rows: [
          {
            id: 'US1.1',
            fixtures: ['local-blank'],
            oracle: 'Independent expected workspace container.',
            tests: [],
          },
        ],
      },
      root,
    );
    assert.equal(emptyRow.validated, false);
    assert.ok(
      emptyRow.reasons.some((reason) => reason.includes('has no assertions')),
    );

    const noRows = validate(record, { rows: [] }, root);
    assert.equal(noRows.validated, false);
    assert.ok(
      noRows.reasons.some((reason) =>
        reason.includes('no mandatory assertions'),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('evidence validation stays unvalidated for absent, unrun and failed assertions', () => {
  const root = candidate();
  try {
    const valid = validate(makeRecord(root, passed()), coverage, root);
    assert.equal(valid.validated, true);
    assert.deepEqual(valid.reasons, []);

    const missing = validate(
      makeRecord(
        root,
        passed().filter((assertion) => assertion.id !== 'workspace::views'),
      ),
      coverage,
      root,
    );
    assert.equal(missing.validated, false);
    assert.deepEqual(missing.missing, ['workspace::views']);

    const unrun = validate(
      makeRecord(root, [
        { id: 'workspace::entry', outcome: 'passed' },
        { id: 'workspace::views', outcome: 'unrun' },
        { id: 'package::container', outcome: 'passed' },
      ]),
      coverage,
      root,
    );
    assert.equal(unrun.validated, false);
    assert.deepEqual(unrun.unrun, ['workspace::views']);

    const failed = validate(
      makeRecord(root, [
        { id: 'workspace::entry', outcome: 'passed' },
        { id: 'workspace::views', outcome: 'passed' },
        { id: 'package::container', outcome: 'failed' },
      ]),
      coverage,
      root,
    );
    assert.equal(failed.validated, false);
    assert.deepEqual(failed.failed, ['package::container']);

    const plainUnavailable = validate(
      makeRecord(root, [
        { id: 'workspace::entry', outcome: 'unavailable' },
        { id: 'workspace::views', outcome: 'passed' },
        { id: 'package::container', outcome: 'passed' },
      ]),
      coverage,
      root,
    );
    assert.equal(plainUnavailable.validated, false);
    assert.deepEqual(plainUnavailable.blocked, ['workspace::entry']);

    const duplicate = validate(
      makeRecord(root, [
        ...passed(),
        { id: 'workspace::views', outcome: 'failed' },
      ]),
      coverage,
      root,
    );
    assert.equal(duplicate.validated, false);
    assert.ok(
      duplicate.reasons.some((reason) =>
        reason.includes('Duplicate assertion'),
      ),
    );

    const noArtifact = validate(
      makeRecord(root, passed(), { artifact: null }),
      coverage,
      root,
    );
    assert.equal(noArtifact.validated, false);
    assert.ok(
      noArtifact.reasons.some((reason) =>
        reason.includes('VSIX digest is missing'),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage rows bind current fixture hashes and require declared oracle text', () => {
  const root = candidate();
  try {
    const record = makeRecord(root, passed());
    const row = {
      id: 'US1.1',
      fixtures: ['local-blank'],
      oracle: 'Independent expected workspace container and views.',
      tests: ['workspace::entry', 'workspace::views'],
    };
    const accepted = validate(record, { rows: [row] }, root);
    assert.equal(accepted.validated, true, accepted.reasons.join('; '));

    const noFixtures = validate(
      record,
      { rows: [{ ...row, fixtures: [] }] },
      root,
    );
    assert.equal(noFixtures.validated, false);
    assert.ok(
      noFixtures.reasons.some((reason) => reason.includes('has no fixtures')),
    );

    const undeclaredFixtures = validate(
      record,
      {
        rows: [
          {
            id: row.id,
            oracle: row.oracle,
            tests: row.tests,
          } as unknown as (typeof coverage.rows)[number],
        ],
      },
      root,
    );
    assert.equal(undeclaredFixtures.validated, false);
    assert.ok(
      undeclaredFixtures.reasons.some((reason) =>
        reason.includes('has no fixtures'),
      ),
    );

    const unknownFixture = validate(
      record,
      { rows: [{ ...row, fixtures: ['unknown-fixture'] }] },
      root,
    );
    assert.equal(unknownFixture.validated, false);
    assert.ok(
      unknownFixture.reasons.some((reason) =>
        reason.includes('unknown candidate fixture'),
      ),
    );

    const emptyFixture = validate(
      record,
      { rows: [{ ...row, fixtures: [''] }] },
      root,
    );
    assert.equal(emptyFixture.validated, false);
    assert.ok(
      emptyFixture.reasons.some((reason) =>
        reason.includes('empty fixture id'),
      ),
    );

    const duplicateFixture = validate(
      record,
      { rows: [{ ...row, fixtures: ['local-blank', 'local-blank'] }] },
      root,
    );
    assert.equal(duplicateFixture.validated, false);
    assert.ok(
      duplicateFixture.reasons.some((reason) =>
        reason.includes('repeats fixture'),
      ),
    );

    const noOracle = validate(
      record,
      {
        rows: [
          {
            id: row.id,
            fixtures: row.fixtures,
            tests: row.tests,
          } as unknown as (typeof coverage.rows)[number],
        ],
      },
      root,
    );
    assert.equal(noOracle.validated, false);
    assert.ok(
      noOracle.reasons.some((reason) => reason.includes('no declared oracle')),
    );

    const blankOracle = validate(
      record,
      { rows: [{ ...row, oracle: '   ' }] },
      root,
    );
    assert.equal(blankOracle.validated, false);
    assert.ok(
      blankOracle.reasons.some((reason) =>
        reason.includes('no declared oracle'),
      ),
    );

    const malformedFixture = makeRecord(root, passed(), {
      fixtures: [{ id: 'local-blank', sha256: 'not-a-sha256' }],
    });
    const malformed = validate(malformedFixture, { rows: [row] }, root);
    assert.equal(malformed.validated, false);
    assert.ok(
      malformed.reasons.some((reason) => reason.includes('valid SHA-256')),
    );

    const changedCorpus = validate(record, { rows: [row] }, root, {
      fixtures: [{ id: 'local-blank', sha256: digest('changed corpus') }],
    });
    assert.equal(changedCorpus.validated, false);
    assert.ok(
      changedCorpus.reasons.some((reason) =>
        reason.includes('Fixture hashes differ'),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('required artifacts are declared, referenced and verified for acceptance proof', () => {
  const root = candidate();
  const outside = workspace();
  try {
    const visualCoverage: CoverageRef = {
      rows: [
        {
          id: 'US6.2',
          fixtures: ['local-blank'],
          oracle: 'Independent expected visual comparison result.',
          tests: ['visual::compare'],
          requiredArtifacts: ['visual-actual'],
        },
      ],
    };
    const artifact = putArtifact(
      root,
      'visual-actual',
      'tests/desktop/artifacts/visual-actual.png',
      'pixels',
    );
    const passing = [
      {
        id: 'visual::compare',
        outcome: 'passed' as const,
        artifacts: ['visual-actual'],
      },
    ];
    const valid = validate(
      makeRecord(root, passing, { artifacts: [artifact] }),
      visualCoverage,
      root,
    );
    assert.equal(valid.validated, true, valid.reasons.join('; '));

    const absent = validate(makeRecord(root, passing), visualCoverage, root);
    assert.equal(absent.validated, false);
    assert.ok(
      absent.reasons.some((reason) =>
        reason.includes('Missing required evidence artifact'),
      ),
    );

    const unreferenced = validate(
      makeRecord(root, [{ id: 'visual::compare', outcome: 'passed' }], {
        artifacts: [artifact],
      }),
      visualCoverage,
      root,
    );
    assert.equal(unreferenced.validated, false);
    assert.ok(
      unreferenced.reasons.some((reason) =>
        reason.includes('not referenced by an accepted'),
      ),
    );

    writeFileSync(
      join(root, 'tests/desktop/artifacts/visual-actual.png'),
      'tampered pixels',
    );
    const altered = validate(
      makeRecord(root, passing, { artifacts: [artifact] }),
      visualCoverage,
      root,
    );
    assert.equal(altered.validated, false);
    assert.ok(
      altered.reasons.some((reason) =>
        reason.includes('Altered evidence artifacts'),
      ),
    );

    rmSync(join(root, 'tests/desktop/artifacts/visual-actual.png'));
    const missing = validate(
      makeRecord(root, passing, { artifacts: [artifact] }),
      visualCoverage,
      root,
    );
    assert.equal(missing.validated, false);
    assert.ok(
      missing.reasons.some((reason) =>
        reason.includes('Missing evidence artifacts'),
      ),
    );

    put(root, { 'tests/desktop/artifacts/visual-actual.png': 'pixels' });
    const traversal = validate(
      makeRecord(root, passing, {
        artifacts: [{ ...artifact, path: '../outside.png' }],
      }),
      visualCoverage,
      root,
    );
    assert.equal(traversal.validated, false);
    assert.ok(
      traversal.reasons.some((reason) =>
        reason.includes('Altered evidence artifacts'),
      ),
    );

    put(outside, { 'escape.txt': 'outside bytes' });
    const link = join(root, 'linked');
    let linked = false;
    try {
      symlinkSync(
        outside,
        link,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      linked = true;
    } catch {
      linked = false;
    }
    assert.ok(linked, 'directory symlink/junction could not be created');
    const escaped: ArtifactRef = {
      id: 'escape',
      path: 'linked/escape.txt',
      sha256: digest('outside bytes'),
    };
    assert.deepEqual(verifyArtifacts(root, [escaped]).mismatched, [
      'linked/escape.txt',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('only native drag may be unavailable with verified probe and passing fallback', () => {
  const root = candidate();
  try {
    const dragCoverage: CoverageRef = {
      rows: [
        {
          id: 'US4.6',
          fixtures: ['local-blank'],
          oracle: 'Independent expected drag probe and activation fallback.',
          tests: ['probe::drag', 'components::fallback'],
          requiredArtifacts: ['drag-probe'],
        },
      ],
      unavailableExceptions: [
        {
          capability: 'native-drag',
          rowId: 'US4.6',
          assertions: ['probe::drag'],
          requiredPassing: ['components::fallback'],
          requiredArtifacts: ['drag-probe'],
        },
      ],
    };
    const artifact = putArtifact(
      root,
      'drag-probe',
      'tests/desktop/artifacts/native-drag-probe.json',
      '{"publicApi":"unsupported"}',
    );
    const probe: EvidenceAssertion = {
      id: 'probe::drag',
      outcome: 'unavailable',
      artifacts: ['drag-probe'],
    };
    const fallback: EvidenceAssertion = {
      id: 'components::fallback',
      outcome: 'passed',
    };
    const record = makeRecord(root, [probe, fallback], {
      artifacts: [artifact],
    });
    const allowed = validate(record, dragCoverage, root);
    assert.equal(allowed.validated, true, allowed.reasons.join('; '));
    assert.deepEqual(allowed.blocked, []);

    const withoutProbe = validate(
      makeRecord(root, [probe, fallback]),
      dragCoverage,
      root,
    );
    assert.equal(withoutProbe.validated, false);
    assert.ok(
      withoutProbe.reasons.some((reason) =>
        reason.includes('Missing required evidence artifact'),
      ),
    );

    const failedFallback = validate(
      makeRecord(root, [probe, { ...fallback, outcome: 'failed' }], {
        artifacts: [artifact],
      }),
      dragCoverage,
      root,
    );
    assert.equal(failedFallback.validated, false);
    assert.ok(
      failedFallback.reasons.some((reason) =>
        reason.includes('Failed mandatory assertions'),
      ),
    );

    const unboundProbe = validate(
      makeRecord(
        root,
        [
          { ...probe, artifacts: [] },
          { ...fallback, artifacts: ['drag-probe'] },
        ],
        { artifacts: [artifact] },
      ),
      dragCoverage,
      root,
    );
    assert.equal(unboundProbe.validated, false);
    assert.ok(
      unboundProbe.reasons.some((reason) =>
        reason.includes('not referenced by its probe assertion'),
      ),
    );

    const unsupported = validate(
      record,
      {
        ...dragCoverage,
        unavailableExceptions: [
          { ...dragCoverage.unavailableExceptions![0]!, capability: 'visual' },
        ],
      },
      root,
    );
    assert.equal(unsupported.validated, false);
    assert.ok(
      unsupported.reasons.some((reason) =>
        reason.includes('Unsupported unavailable exception'),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('changed environment identity prevents reusing recorded evidence', () => {
  const root = candidate();
  try {
    const record = makeRecord(root, passed());
    const changed = validate(record, coverage, root, {
      environment: { ...environment, fonts: 'different reference fonts' },
    });
    assert.equal(changed.validated, false);
    assert.ok(
      changed.reasons.some((reason) =>
        reason.includes('environment identity differs'),
      ),
    );
    const hash = validate(record, coverage, root, {
      environment: { ...environment, vscodeHash: 'different executable' },
    });
    assert.equal(hash.validated, false);
    assert.ok(
      hash.reasons.some((reason) =>
        reason.includes('environment identity differs'),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('changed fingerprint, VSIX bytes, environment or fixture corpus cannot reuse evidence', () => {
  const root = candidate();
  try {
    const record = makeRecord(root, passed());
    const candidateIdentity = {
      inputFingerprint: record.provenance.manifest.fingerprint,
      vsixSha256: record.artifact?.sha256 ?? '',
      environment,
      fixtures,
    };
    assert.deepEqual(incompatibleReasons(record, candidateIdentity), []);
    assert.notEqual(
      record.artifact?.sha256,
      record.provenance.manifest.fingerprint,
    );
    assert.equal(record.fixtures[0]?.sha256, digest('fixture bytes'));

    const fingerprint = incompatibleReasons(record, {
      ...candidateIdentity,
      inputFingerprint: digest('changed input'),
    });
    assert.ok(
      fingerprint.some((reason) => reason.includes('input fingerprint')),
    );

    const vsix = incompatibleReasons(record, {
      ...candidateIdentity,
      vsixSha256: digest('rebuilt vsix'),
    });
    assert.ok(vsix.some((reason) => reason.includes('VSIX SHA-256')));

    const theme = incompatibleReasons(record, {
      ...candidateIdentity,
      environment: { ...environment, theme: 'Default Light+' },
    });
    assert.ok(theme.some((reason) => reason.includes('environment identity')));

    const fixturesChanged = incompatibleReasons(record, {
      ...candidateIdentity,
      fixtures: [{ id: 'local-blank', sha256: digest('changed fixture') }],
    });
    assert.ok(
      fixturesChanged.some((reason) => reason.includes('Fixture hashes')),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage.json maps every required identifier and declares only native-drag unavailability', () => {
  const root = process.cwd();
  const coveragePath = resolve(root, 'tests/desktop/coverage.json');
  assert.ok(existsSync(coveragePath), 'run tests from the repository root');
  const mapped = JSON.parse(readFileSync(coveragePath, 'utf8')) as {
    feature: string;
    automationAreas: Record<string, string>;
    unavailableExceptions?: Array<{
      capability: string;
      rowId: string;
      assertions: string[];
      requiredPassing: string[];
      requiredArtifacts: string[];
    }>;
    rows: Array<{
      id: string;
      kind: string;
      areas: string[];
      fixtures: string[];
      oracle: string;
      tests: string[];
      requiredArtifacts?: string[];
      mandatory?: unknown;
    }>;
  };
  const fixturePaths = new Map(
    (
      JSON.parse(
        readFileSync(resolve(root, 'tests/fixtures/manifest.json'), 'utf8'),
      ) as {
        fixtures: Array<{ id: string; path: string }>;
      }
    ).fixtures.map((fixture) => [fixture.id, fixture.path]),
  );
  const ids = mapped.rows.map((row) => row.id);
  assert.equal(mapped.feature, '005-native-sidebar-integration');
  assert.equal(ids.length, 93);
  assert.equal(new Set(ids).size, 93);
  for (const id of [
    ...Array.from(
      { length: 34 },
      (_, index) => `FR-${String(index + 1).padStart(3, '0')}`,
    ),
    ...Array.from(
      { length: 11 },
      (_, index) => `EDGE-${String(index + 1).padStart(2, '0')}`,
    ),
    ...Array.from(
      { length: 10 },
      (_, index) => `SC-${String(index + 1).padStart(3, '0')}`,
    ),
    ...Array.from(
      { length: 6 },
      (_, index) => `REG-${String(index + 1).padStart(2, '0')}`,
    ),
    ...['US1', 'US2', 'US3', 'US4', 'US5', 'US6'].flatMap((story) => {
      const count =
        story === 'US5'
          ? 7
          : ['US2', 'US4'].includes(story)
            ? 6
            : story === 'US3'
              ? 5
              : 4;
      return Array.from(
        { length: count },
        (_, index) => `${story}.${index + 1}`,
      );
    }),
  ])
    assert.ok(ids.includes(id), `coverage is missing ${id}`);
  for (const row of mapped.rows) {
    assert.ok(!('mandatory' in row), `${row.id} declares a mandatory flag`);
    assert.ok(row.areas.length > 0, `${row.id} has no automation area`);
    for (const area of row.areas)
      assert.ok(
        area in mapped.automationAreas,
        `${row.id} uses unknown area ${area}`,
      );
    assert.ok(row.fixtures.length > 0, `${row.id} has no fixture`);
    assert.equal(
      new Set(row.fixtures).size,
      row.fixtures.length,
      `${row.id} repeats a fixture`,
    );
    for (const fixture of row.fixtures) {
      const fixturePath = fixturePaths.get(fixture);
      assert.ok(fixturePath, `${row.id} uses unknown fixture ${fixture}`);
      assert.match(
        sha256Bytes(readFileSync(resolve(root, 'tests/fixtures', fixturePath))),
        /^[0-9a-f]{64}$/,
        `${row.id} fixture ${fixture} has no current hash`,
      );
    }
    assert.ok(row.oracle.trim().length > 0, `${row.id} has no declared oracle`);
    assert.ok(row.tests.length > 0, `${row.id} has no planned test`);
    for (const id of row.tests)
      assert.match(
        id,
        /::/,
        `${row.id} test id ${id} lacks an executable assertion id`,
      );
    for (const id of row.requiredArtifacts ?? [])
      assert.ok(id.length > 0, `${row.id} declares an empty artifact id`);
  }
  const artifactRows = mapped.rows.filter(
    (row) => (row.requiredArtifacts ?? []).length > 0,
  );
  assert.ok(artifactRows.length > 0, 'no row requires acceptance artifacts');
  assert.deepEqual(
    (mapped.unavailableExceptions ?? []).map(
      (exception) => exception.capability,
    ),
    ['native-drag'],
  );
  for (const exception of mapped.unavailableExceptions ?? []) {
    const row = mapped.rows.find((entry) => entry.id === exception.rowId);
    assert.ok(row, `exception row ${exception.rowId} is missing`);
    assert.equal(exception.rowId, 'US4.6');
    assert.ok(exception.requiredPassing.length > 0);
    for (const id of exception.assertions)
      assert.ok(
        row.tests.includes(id),
        `exception assertion ${id} is undeclared`,
      );
    for (const id of exception.requiredPassing)
      assert.ok(
        row.tests.includes(id),
        `exception passing assertion ${id} is undeclared`,
      );
    for (const id of exception.requiredArtifacts)
      assert.ok(
        (row.requiredArtifacts ?? []).includes(id),
        `exception artifact ${id} is undeclared`,
      );
  }
});

test('pixel references exist only for the pinned reference environment', () => {
  // The VS Code product commit is shared by every platform artifact of 1.142.0.
  assert.equal(
    REFERENCE_ENVIRONMENT.vscodeBuild,
    '6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1',
  );
  assert.deepEqual(referenceEnvironmentReasons(environment), []);
  const deviations: [string, EnvironmentIdentity][] = [
    ['os', { ...environment, os: 'win32' }],
    ['osImage', { ...environment, osImage: 'ubuntu-22.04' }],
    ['vscodeVersion', { ...environment, vscodeVersion: '1.143.1' }],
    ['vscodeBuild', { ...environment, vscodeBuild: 'f'.repeat(40) }],
    ['locale', { ...environment, locale: 'fr-FR' }],
    ['timezone', { ...environment, timezone: 'Europe/Paris' }],
    [
      'width',
      { ...environment, display: { ...environment.display, width: 1920 } },
    ],
    [
      'height',
      { ...environment, display: { ...environment.display, height: 900 } },
    ],
    ['dpr', { ...environment, display: { ...environment.display, dpr: 2 } }],
  ];
  for (const [name, changed] of deviations)
    assert.ok(
      referenceEnvironmentReasons(changed).some((reason) =>
        reason.includes(name),
      ),
      name,
    );
  assert.deepEqual(
    referenceEnvironmentReasons({
      ...environment,
      locale: 'en-US',
      timezone: 'Etc/UTC',
    }),
    [],
  );
});

test('functional evidence stays valid on non-reference entries but records visual as unvalidated', () => {
  const root = candidate();
  try {
    const reference = validate(makeRecord(root, passed()), coverage, root);
    assert.equal(reference.validated, true);
    assert.equal(reference.visualEligible, true);
    assert.deepEqual(reference.visualReasons, []);

    const stable: EnvironmentIdentity = {
      ...environment,
      vscodeVersion: '1.143.1',
    };
    const functional = validate(
      makeRecord(root, passed(), { environment: stable }),
      coverage,
      root,
    );
    assert.equal(functional.validated, true);
    assert.equal(functional.visualEligible, false);
    assert.ok(
      functional.visualReasons.some((reason) =>
        reason.includes('non-reference environment'),
      ),
    );
    assert.ok(
      functional.visualReasons.some((reason) =>
        reason.includes('vscodeVersion'),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('driver identity maps to the recorded environment identity', () => {
  const identity = {
    version: '1.142.0',
    build: REFERENCE_ENVIRONMENT.vscodeBuild,
    executableSha256: 'd'.repeat(64),
    driver: 'playwright@1.64.1',
    environment: {
      platform: 'linux',
      observed: {
        locale: 'en-US',
        timezone: 'UTC',
        display: { width: 1440, height: 1000, dpr: 1 },
        theme: 'monaco-workbench vs-dark linux',
      },
    },
  };
  const mapped = environmentFromDriver(
    identity,
    'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\n',
    'fonts-dejavu-core 2.37',
  );
  assert.equal(mapped.os, 'linux');
  assert.equal(mapped.osImage, 'ubuntu-24.04');
  assert.equal(mapped.vscodeVersion, '1.142.0');
  assert.equal(mapped.vscodeBuild, REFERENCE_ENVIRONMENT.vscodeBuild);
  assert.equal(mapped.vscodeHash, 'd'.repeat(64));
  assert.equal(mapped.driverVersion, 'playwright@1.64.1');
  assert.equal(mapped.fonts, 'fonts-dejavu-core 2.37');
  assert.deepEqual(mapped.display, {
    width: 1440,
    height: 1000,
    dpr: 1,
    interfaceScale: 100,
    reportZoom: 100,
  });
  assert.deepEqual(referenceEnvironmentReasons(mapped), []);
  // Missing observations never default to reference values.
  const unknown = environmentFromDriver({ version: '1.142.0' }, '', '');
  assert.ok(referenceEnvironmentReasons(unknown).length >= 4);
});
