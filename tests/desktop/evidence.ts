import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const MANIFEST_VERSION = 4;
export const EVIDENCE_SCHEMA_VERSION = 1;

export const MANIFEST_RULES = {
  version: MANIFEST_VERSION,
  included: [
    '.gitignore',
    '.node-version',
    '.prettierignore',
    '.prettierrc.json',
    '.specify/memory/constitution.md',
    'AGENTS.md',
    'CONTRIBUTING.md',
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'tsconfig.base.json',
    'eslint.config.ts',
    'packages/**',
    'apps/**',
    'docs/**',
    'scripts/**',
    'tests/**',
    'specs/**',
    '.github/**',
  ],
  excluded: [
    'generated output roots: root dist/ and build/, packages/*/dist/, apps/*/dist|build/ and .angular caches',
    'dependency/tool roots: node_modules/, .git/, .vscode-test/, .opencode/',
    'feature evidence records: specs/005-native-sidebar-integration/evidence/ (source files remain inputs)',
    'test captures: tests/desktop/artifacts/ (source files remain inputs)',
    'generated artifacts and logs: *.vsix, *.log, *.trace.zip',
    'only checkbox state in specs/**/tasks.md and specs/**/checklists/**/*.md is normalized; all prose and status markers remain hashed',
    'vendor/** read-only Microsoft citations',
  ],
} as const;

const INCLUDED_ROOTS = [
  'packages/',
  'apps/',
  'docs/',
  'scripts/',
  'tests/',
  'specs/',
  '.github/',
];
const INCLUDED_FILES = new Set([
  '.gitignore',
  '.node-version',
  '.prettierignore',
  '.prettierrc.json',
  '.specify/memory/constitution.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  'eslint.config.ts',
]);
const TOOL_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.vscode-test',
  '.opencode',
]);
const EXCLUDED_SUFFIXES = ['.vsix', '.log', '.trace.zip'];
const EXCLUDED_EVIDENCE_ROOTS = [
  'specs/005-native-sidebar-integration/evidence/',
  'tests/desktop/artifacts/',
];
const TOP_LEVEL_DIRECTORIES = new Set([
  'packages',
  'apps',
  'docs',
  'scripts',
  'tests',
  'specs',
  '.github',
  '.specify',
]);

export interface InputFile {
  readonly path: string;
  readonly sha256: string;
}

export interface InputManifest {
  readonly rules: typeof MANIFEST_RULES;
  readonly files: readonly InputFile[];
}

export interface FrozenInputManifest extends InputManifest {
  readonly fingerprint: string;
}

export interface InputManifestDiff {
  readonly added: readonly string[];
  readonly deleted: readonly string[];
  readonly changed: readonly string[];
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isGeneratedBuildPath(path: string): boolean {
  return (
    path.startsWith('dist/') ||
    path.startsWith('build/') ||
    path.startsWith('.angular/') ||
    /^(?:packages|apps)\/[^/]+\/(?:dist|build|\.angular)\//.test(path)
  );
}

function isGeneratedDirectory(path: string): boolean {
  return (
    path === 'dist' ||
    path === 'build' ||
    path === '.angular' ||
    /^(?:packages|apps)\/[^/]+\/(?:dist|build|\.angular)$/.test(path)
  );
}

/** Candidate inputs are the exact bytes whose change can invalidate executed evidence. */
export function isCandidateInput(path: string): boolean {
  const normalized = normalizePath(path);
  const segments = normalized.split('/');
  if (segments.some((segment) => TOOL_SEGMENTS.has(segment))) return false;
  if (isGeneratedBuildPath(normalized)) return false;
  if (
    EXCLUDED_EVIDENCE_ROOTS.some((root) => normalized.startsWith(root)) &&
    !/\.[cm]?[jt]sx?$/i.test(normalized)
  )
    return false;
  if (EXCLUDED_SUFFIXES.some((suffix) => normalized.endsWith(suffix)))
    return false;
  return (
    INCLUDED_FILES.has(normalized) ||
    INCLUDED_ROOTS.some((prefix) => normalized.startsWith(prefix))
  );
}

function isCheckboxDocument(path: string): boolean {
  return (
    path.startsWith('specs/') &&
    (path.endsWith('/tasks.md') || /\/checklists\/.+\.md$/.test(path))
  );
}

/** Normalize task/reviewer completion marks, never requirement or status prose. */
export function normalizeCandidateText(path: string, text: string): string {
  if (!isCheckboxDocument(normalizePath(path))) return text;
  return text.replace(/^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[[xX]\]/gm, '$1[ ]');
}

function candidateInputSha256(root: string, path: string): string {
  const bytes = readFileSync(join(root, path));
  if (!isCheckboxDocument(path)) return sha256Bytes(bytes);
  return sha256Bytes(
    Buffer.from(normalizeCandidateText(path, bytes.toString('utf8')), 'utf8'),
  );
}

function walk(directory: string, prefix: string, output: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (
      entry.isSymbolicLink() &&
      (isCandidateInput(path) ||
        INCLUDED_ROOTS.some((root) => path.startsWith(root)) ||
        (!prefix && TOP_LEVEL_DIRECTORIES.has(entry.name)))
    )
      throw new Error(`Candidate input symlink is not supported: ${path}`);
    if (entry.isDirectory()) {
      if (TOOL_SEGMENTS.has(entry.name)) continue;
      if (!prefix && !TOP_LEVEL_DIRECTORIES.has(entry.name)) continue;
      if (isGeneratedDirectory(path)) continue;
      walk(join(directory, entry.name), path, output);
    } else if (entry.isFile() && isCandidateInput(path)) output.push(path);
  }
}

export function inputManifestFingerprint(manifest: InputManifest): string {
  const canonical = JSON.stringify({
    version: manifest.rules.version,
    included: manifest.rules.included,
    excluded: manifest.rules.excluded,
    files: [...manifest.files]
      .sort(byPath)
      .map((file) => [file.path, file.sha256]),
  });
  return sha256Bytes(Buffer.from(canonical, 'utf8'));
}

function byPath(
  left: { readonly path: string },
  right: { readonly path: string },
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function freeze(files: InputFile[]): FrozenInputManifest {
  const manifest: InputManifest = {
    rules: MANIFEST_RULES,
    files: [...files].sort(byPath),
  };
  return { ...manifest, fingerprint: inputManifestFingerprint(manifest) };
}

/** Freeze sorted repository-relative inputs; evidence, build output and logs are excluded. */
export function createInputManifest(root: string): FrozenInputManifest {
  const paths: string[] = [];
  walk(root, '', paths);
  return freeze(
    paths.map((path) => ({ path, sha256: candidateInputSha256(root, path) })),
  );
}

export function diffInputManifests(
  before: InputManifest,
  after: InputManifest,
): InputManifestDiff {
  const previous = new Map(
    before.files.map((file) => [file.path, file.sha256]),
  );
  const current = new Map(after.files.map((file) => [file.path, file.sha256]));
  return {
    added: [...current.keys()].filter((path) => !previous.has(path)).sort(),
    deleted: [...previous.keys()].filter((path) => !current.has(path)).sort(),
    changed: [...current.keys()]
      .filter(
        (path) =>
          previous.has(path) && previous.get(path) !== current.get(path),
      )
      .sort(),
  };
}

/**
 * Digest the exact dirty input boundary from frozen before/current manifests.
 * Deleted inputs are recorded explicitly by state; old bytes are never reused.
 */
export function createScopedPatchDigest(
  before: InputManifest,
  after: InputManifest,
): string {
  const current = new Map(after.files.map((file) => [file.path, file.sha256]));
  const difference = diffInputManifests(before, after);
  const currentSha = (path: string): string => {
    const sha256 = current.get(path);
    if (!sha256)
      throw new Error(`Input ${path} is missing from the current manifest`);
    return sha256;
  };
  const entries = [
    ...difference.added.map((path) => `${path}\t${currentSha(path)}`),
    ...difference.changed.map((path) => `${path}\t${currentSha(path)}`),
    ...difference.deleted.map((path) => `${path}\tnull`),
  ].sort();
  return sha256Bytes(Buffer.from(entries.join('\n'), 'utf8'));
}

export type Outcome = 'passed' | 'failed' | 'unavailable' | 'unrun';

const OUTCOMES = new Set<Outcome>(['passed', 'failed', 'unavailable', 'unrun']);

export interface EvidenceAssertion {
  readonly id: string;
  readonly outcome: Outcome;
  readonly detail?: string;
  readonly artifacts?: readonly string[];
}

export interface FixtureRef {
  readonly id: string;
  readonly sha256: string;
}

export interface ArtifactRef {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
}

export interface EnvironmentIdentity {
  readonly os: string;
  readonly osImage: string;
  readonly vscodeVersion: string;
  readonly vscodeBuild: string;
  readonly vscodeHash: string;
  readonly driverVersion: string;
  readonly locale: string;
  readonly timezone: string;
  readonly theme: string;
  readonly fonts: string;
  readonly display: {
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
    readonly interfaceScale: number;
    readonly reportZoom: number;
  };
}

/** The only environment for which committed pixel references exist (contract: Reference environment and CI). */
export const REFERENCE_ENVIRONMENT = {
  os: 'linux',
  osImage: 'ubuntu-24.04',
  vscodeVersion: '1.142.0',
  /** Product commit of 1.142.0; one release commit covers every platform artifact (observed on win32). */
  vscodeBuild: '6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1',
  width: 1440,
  height: 1000,
  dpr: 1,
} as const;

/** Why an environment cannot take part in pixel comparison; empty means reference. */
export function referenceEnvironmentReasons(
  environment: EnvironmentIdentity,
): string[] {
  const expected = REFERENCE_ENVIRONMENT;
  const reasons: string[] = [];
  const need = (name: string, actual: unknown, wanted: unknown) => {
    if (actual !== wanted)
      reasons.push(
        `${name} is ${JSON.stringify(actual)}, reference is ${JSON.stringify(wanted)}`,
      );
  };
  need('os', environment.os, expected.os);
  need('osImage', environment.osImage, expected.osImage);
  need('vscodeVersion', environment.vscodeVersion, expected.vscodeVersion);
  need('vscodeBuild', environment.vscodeBuild, expected.vscodeBuild);
  need('width', environment.display?.width, expected.width);
  need('height', environment.display?.height, expected.height);
  need('dpr', environment.display?.dpr, expected.dpr);
  if (!/^en(?:[-_]|$)/i.test(environment.locale ?? ''))
    reasons.push(
      `locale is ${JSON.stringify(environment.locale)}, reference is en`,
    );
  if (!['UTC', 'Etc/UTC'].includes(environment.timezone))
    reasons.push(
      `timezone is ${JSON.stringify(environment.timezone)}, reference is UTC`,
    );
  return reasons;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

/** Map the driver's recorded identity to the evidence environment; absent observations stay empty. */
export function environmentFromDriver(
  identity: Record<string, unknown>,
  osReleaseText: string,
  fonts: string,
): EnvironmentIdentity {
  const environment = fields(identity['environment']);
  const observed = fields(environment['observed']);
  const display = fields(observed['display']);
  const release = (name: string) =>
    new RegExp(`^${name}="?([^"\\r\\n]*)"?\\s*$`, 'm').exec(osReleaseText)?.[1];
  const id = release('ID');
  const versionId = release('VERSION_ID');
  return {
    os: text(environment['platform']),
    osImage: id && versionId ? `${id}-${versionId}` : '',
    vscodeVersion: text(identity['version']),
    vscodeBuild: text(identity['build']),
    vscodeHash: text(identity['executableSha256']),
    driverVersion: text(identity['driver']),
    locale: text(observed['locale']),
    timezone: text(observed['timezone']),
    theme: text(observed['theme']),
    fonts,
    display: {
      width: Number(display['width']),
      height: Number(display['height']),
      dpr: Number(display['dpr']),
      interfaceScale: 100,
      reportZoom: 100,
    },
  };
}

export interface EvidenceRecord {
  readonly schemaVersion: number;
  readonly feature: string;
  readonly provenance: {
    readonly commit: string;
    readonly dirty: boolean;
    readonly patchDigest: string | null;
    readonly manifest: FrozenInputManifest;
  };
  readonly artifact: { readonly name: string; readonly sha256: string } | null;
  readonly fixtures: readonly FixtureRef[];
  readonly environment: EnvironmentIdentity;
  readonly assertions: readonly EvidenceAssertion[];
  readonly artifacts: readonly ArtifactRef[];
}

export interface CoverageRowRef {
  readonly id: string;
  readonly fixtures: readonly string[];
  /** Expected oracle text; only presence is enforced until executable oracle binding lands (T072). */
  readonly oracle: string;
  readonly tests: readonly string[];
  readonly requiredArtifacts?: readonly string[];
}

/** The only permitted unavailable capability is the conditionally probed native drag. */
export interface UnavailableException {
  readonly capability: string;
  readonly rowId: string;
  readonly assertions: readonly string[];
  readonly requiredPassing: readonly string[];
  readonly requiredArtifacts: readonly string[];
}

export interface CoverageRef {
  readonly rows: readonly CoverageRowRef[];
  readonly unavailableExceptions?: readonly UnavailableException[];
}

export interface CandidateBinding {
  /** Repository root of the candidate being validated; the manifest is recomputed here. */
  readonly root: string;
  readonly vsixSha256: string;
  readonly environment: EnvironmentIdentity;
  readonly fixtures: readonly FixtureRef[];
}

export interface ArtifactVerification {
  readonly missing: readonly string[];
  readonly mismatched: readonly string[];
}

export interface EvidenceValidation {
  readonly validated: boolean;
  /** Pixel acceptance exists only on the reference environment; `validated` is functional-only elsewhere. */
  readonly visualEligible: boolean;
  readonly visualReasons: readonly string[];
  readonly reasons: readonly string[];
  readonly missing: readonly string[];
  readonly unrun: readonly string[];
  readonly blocked: readonly string[];
  readonly failed: readonly string[];
}

export interface CandidateIdentity {
  readonly inputFingerprint: string;
  readonly vsixSha256: string;
  readonly environment: EnvironmentIdentity;
  readonly fixtures: readonly FixtureRef[];
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function manifestRulesAreWellFormed(manifest: FrozenInputManifest): boolean {
  const rules = manifest.rules as {
    version?: unknown;
    included?: unknown;
    excluded?: unknown;
  };
  return (
    rules.version === MANIFEST_VERSION &&
    Array.isArray(rules.included) &&
    rules.included.every((rule) => typeof rule === 'string') &&
    Array.isArray(rules.excluded) &&
    rules.excluded.every((rule) => typeof rule === 'string')
  );
}

function manifestFilesAreWellFormed(manifest: FrozenInputManifest): boolean {
  return (
    Array.isArray(manifest.files) &&
    manifest.files.length > 0 &&
    manifest.files.every(
      (file) =>
        typeof file.path === 'string' &&
        isCandidateInput(file.path) &&
        typeof file.sha256 === 'string' &&
        isSha256(file.sha256),
    )
  );
}

function fixtureHashes(
  fixtures: readonly FixtureRef[] | undefined,
  label: string,
  reasons: string[],
): Map<string, string> {
  const hashes = new Map<string, string>();
  if (!Array.isArray(fixtures)) {
    reasons.push(`${label} fixtures are missing`);
    return hashes;
  }
  for (const fixture of fixtures) {
    if (typeof fixture?.id !== 'string' || fixture.id.length === 0) {
      reasons.push(`${label} fixture id is empty`);
      continue;
    }
    if (hashes.has(fixture.id))
      reasons.push(`Duplicate ${label} fixture: ${fixture.id}`);
    if (typeof fixture.sha256 !== 'string' || !isSha256(fixture.sha256))
      reasons.push(`${label} fixture ${fixture.id} has no valid SHA-256`);
    hashes.set(fixture.id, fixture.sha256);
  }
  return hashes;
}

function uniqueOutcomes(assertions: readonly EvidenceAssertion[]): {
  outcomes: Map<string, Outcome>;
  duplicates: string[];
} {
  const outcomes = new Map<string, Outcome>();
  const duplicates: string[] = [];
  for (const assertion of assertions) {
    if (outcomes.has(assertion.id)) duplicates.push(assertion.id);
    outcomes.set(assertion.id, assertion.outcome);
  }
  return { outcomes, duplicates };
}

/**
 * Fail closed against a freshly recomputed candidate. Recorded output never
 * proves itself: inputs, VSIX bytes, fixtures, environment and artifacts must
 * still bind to the current candidate.
 */
export function validateEvidence(
  record: EvidenceRecord,
  coverage: CoverageRef,
  candidate: CandidateBinding,
): EvidenceValidation {
  try {
    const reasons: string[] = [];
    if (record.schemaVersion !== EVIDENCE_SCHEMA_VERSION)
      reasons.push(`Unsupported evidence schema ${record.schemaVersion}`);
    if (!record.provenance.commit)
      reasons.push('Candidate provenance commit is missing');
    if (record.provenance.dirty) {
      if (
        !record.provenance.patchDigest ||
        !isSha256(record.provenance.patchDigest)
      )
        reasons.push('Dirty candidate requires a SHA-256 scoped patch digest');
    } else if (record.provenance.patchDigest !== null) {
      reasons.push('Clean candidate must not record a patch digest');
    }

    const currentFixtures = fixtureHashes(
      candidate.fixtures,
      'Current',
      reasons,
    );
    const recordedFixtures = fixtureHashes(
      record.fixtures,
      'Recorded',
      reasons,
    );

    const rowIds = new Set<string>();
    const required = new Set<string>();
    for (const row of coverage.rows) {
      if (rowIds.has(row.id)) reasons.push(`Duplicate coverage row: ${row.id}`);
      rowIds.add(row.id);
      if ('mandatory' in row)
        reasons.push(
          `Coverage row ${row.id} declares an unsupported mandatory flag`,
        );
      if (row.tests.length === 0)
        reasons.push(`Coverage row ${row.id} has no assertions`);
      for (const id of row.tests) required.add(id);
      const fixtures = (row as { readonly fixtures?: unknown }).fixtures;
      if (!Array.isArray(fixtures) || fixtures.length === 0)
        reasons.push(`Coverage row ${row.id} has no fixtures`);
      else {
        const seen = new Set<string>();
        for (const id of fixtures) {
          if (typeof id !== 'string' || id.length === 0) {
            reasons.push(`Coverage row ${row.id} declares an empty fixture id`);
            continue;
          }
          if (seen.has(id))
            reasons.push(`Coverage row ${row.id} repeats fixture ${id}`);
          seen.add(id);
          if (!currentFixtures.has(id))
            reasons.push(
              `Coverage row ${row.id} references unknown candidate fixture ${id}`,
            );
          if (!recordedFixtures.has(id))
            reasons.push(
              `Coverage row ${row.id} fixture ${id} is not recorded by the evidence`,
            );
        }
      }
      // shortcut: oracle independence is not executed here, only nonblank presence; executable oracle binding remains T072.
      const oracle = (row as { readonly oracle?: unknown }).oracle;
      if (typeof oracle !== 'string' || oracle.trim().length === 0)
        reasons.push(`Coverage row ${row.id} has no declared oracle`);
      for (const id of row.requiredArtifacts ?? [])
        if (typeof id !== 'string' || id.length === 0)
          reasons.push(`Coverage row ${row.id} declares an empty artifact id`);
    }
    if (required.size === 0)
      reasons.push('Coverage declares no mandatory assertions');

    const { outcomes, duplicates } = uniqueOutcomes(record.assertions);
    for (const id of duplicates)
      reasons.push(`Duplicate assertion outcome: ${id}`);
    for (const assertion of record.assertions)
      if (!OUTCOMES.has(assertion.outcome))
        reasons.push(`Unknown assertion outcome: ${assertion.id}`);

    const exceptions = coverage.unavailableExceptions ?? [];
    if (exceptions.length > 1)
      reasons.push('Only one unavailable capability exception is supported');
    const allowedUnavailable = new Map<string, UnavailableException>();
    for (const exception of exceptions) {
      if (exception.capability !== 'native-drag')
        reasons.push(
          `Unsupported unavailable exception capability: ${exception.capability}`,
        );
      if (exception.rowId !== 'US4.6')
        reasons.push(
          `Unavailable exception must be owned by US4.6, received ${exception.rowId}`,
        );
      const row = coverage.rows.find((entry) => entry.id === exception.rowId);
      if (!row) {
        reasons.push(
          `Unavailable exception row ${exception.rowId} does not exist`,
        );
        continue;
      }
      if (exception.assertions.length === 0)
        reasons.push('Unavailable exception declares no probe assertion');
      if (exception.requiredPassing.length === 0)
        reasons.push(
          'Unavailable exception declares no required passing assertion',
        );
      if (exception.requiredArtifacts.length === 0)
        reasons.push('Unavailable exception declares no probe artifact');
      for (const id of exception.assertions) {
        if (!row.tests.includes(id))
          reasons.push(
            `Unavailable exception assertion ${id} is not declared by ${row.id}`,
          );
        else allowedUnavailable.set(id, exception);
      }
      for (const id of exception.requiredPassing)
        if (!row.tests.includes(id))
          reasons.push(
            `Unavailable exception passing assertion ${id} is not declared by ${row.id}`,
          );
      for (const id of exception.requiredArtifacts)
        if (!(row.requiredArtifacts ?? []).includes(id))
          reasons.push(
            `Unavailable exception artifact ${id} is not declared by ${row.id}`,
          );
      for (const id of exception.requiredArtifacts)
        if (
          !record.assertions.some(
            (assertion) =>
              exception.assertions.includes(assertion.id) &&
              (assertion.artifacts ?? []).includes(id),
          )
        )
          reasons.push(
            `Unavailable exception artifact ${id} is not referenced by its probe assertion`,
          );
    }

    const missing = [...required].filter((id) => !outcomes.has(id)).sort();
    const unrun = [...required]
      .filter((id) => outcomes.get(id) === 'unrun')
      .sort();
    const failed = [...required]
      .filter((id) => outcomes.get(id) === 'failed')
      .sort();
    if (missing.length)
      reasons.push(`Missing mandatory assertions: ${missing.join(', ')}`);
    if (unrun.length)
      reasons.push(`Unrun mandatory assertions: ${unrun.join(', ')}`);
    if (failed.length)
      reasons.push(`Failed mandatory assertions: ${failed.join(', ')}`);

    const artifactIds = new Set<string>();
    for (const artifact of record.artifacts) {
      if (artifactIds.has(artifact.id))
        reasons.push(`Duplicate evidence artifact: ${artifact.id}`);
      artifactIds.add(artifact.id);
    }
    for (const assertion of record.assertions)
      for (const id of assertion.artifacts ?? [])
        if (!artifactIds.has(id))
          reasons.push(`Missing artifact reference: ${id}`);

    const blocked = [...required]
      .filter((id) => outcomes.get(id) === 'unavailable')
      .filter((id) => {
        const exception = allowedUnavailable.get(id);
        if (!exception) return true;
        return (
          exception.requiredPassing.some(
            (passingId) => outcomes.get(passingId) !== 'passed',
          ) ||
          exception.requiredArtifacts.some(
            (artifactId) => !artifactIds.has(artifactId),
          )
        );
      })
      .sort();
    if (blocked.length)
      reasons.push(`Unavailable mandatory assertions: ${blocked.join(', ')}`);

    for (const row of coverage.rows)
      for (const id of row.requiredArtifacts ?? []) {
        if (!artifactIds.has(id)) {
          reasons.push(`Missing required evidence artifact: ${id} (${row.id})`);
          continue;
        }
        const referenced = record.assertions.some(
          (assertion) =>
            row.tests.includes(assertion.id) &&
            (assertion.artifacts ?? []).includes(id) &&
            (assertion.outcome === 'passed' ||
              (assertion.outcome === 'unavailable' &&
                allowedUnavailable.has(assertion.id))),
        );
        if (!referenced)
          reasons.push(
            `Required evidence artifact ${id} is not referenced by an accepted ${row.id} assertion`,
          );
      }

    const verification = verifyArtifacts(candidate.root, record.artifacts);
    if (verification.missing.length)
      reasons.push(
        `Missing evidence artifacts: ${verification.missing.join(', ')}`,
      );
    if (verification.mismatched.length)
      reasons.push(
        `Altered evidence artifacts: ${verification.mismatched.join(', ')}`,
      );

    const recorded = record.provenance.manifest;
    const current = createInputManifest(candidate.root);
    if (current.files.length === 0)
      reasons.push('Current candidate has no included input files');
    if (!manifestRulesAreWellFormed(recorded)) {
      reasons.push('Candidate manifest rules are malformed');
    } else {
      if (JSON.stringify(recorded.rules) !== JSON.stringify(MANIFEST_RULES))
        reasons.push('Candidate manifest rules differ from the current rules');
      for (const [name, values] of [
        ['included', recorded.rules.included],
        ['excluded', recorded.rules.excluded],
      ] as const)
        if (new Set(values).size !== values.length)
          reasons.push(`Candidate manifest ${name} rules contain duplicates`);
    }
    if (!manifestFilesAreWellFormed(recorded)) {
      reasons.push('Candidate manifest files are malformed or empty');
    } else {
      const paths = recorded.files.map((file) => file.path);
      if (new Set(paths).size !== paths.length)
        reasons.push('Candidate manifest files contain duplicate paths');
      const sorted = [...paths].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      );
      if (paths.join('\n') !== sorted.join('\n'))
        reasons.push('Candidate manifest files are not sorted');
      if (!isSha256(recorded.fingerprint)) {
        reasons.push('Candidate input fingerprint is not a SHA-256');
      } else {
        if (recorded.fingerprint !== inputManifestFingerprint(recorded))
          reasons.push(
            'Candidate input manifest fingerprint does not match its files',
          );
        if (recorded.fingerprint !== current.fingerprint) {
          const difference = diffInputManifests(recorded, current);
          reasons.push(
            `Current candidate inputs differ: added [${difference.added.join(', ')}], deleted [${difference.deleted.join(', ')}], changed [${difference.changed.join(', ')}]`,
          );
        }
      }
    }

    if (!record.artifact) reasons.push('Candidate VSIX digest is missing');
    else {
      if (!isSha256(record.artifact.sha256))
        reasons.push('Candidate VSIX digest is not a SHA-256');
      if (!isSha256(candidate.vsixSha256))
        reasons.push('Current candidate VSIX digest is not a SHA-256');
      else if (record.artifact.sha256 !== candidate.vsixSha256)
        reasons.push('Current candidate VSIX SHA-256 differs from the record');
    }
    if (
      environmentIdentity(record.environment) !==
      environmentIdentity(candidate.environment)
    )
      reasons.push(
        'Desktop/driver/display/theme/fonts environment identity differs',
      );
    if (
      fixtureIdentity(record.fixtures) !== fixtureIdentity(candidate.fixtures)
    )
      reasons.push('Fixture hashes differ from the current corpus');

    const visualReasons = referenceEnvironmentReasons(record.environment);
    if (visualReasons.length)
      visualReasons.unshift(
        'non-reference environment: visual acceptance is unvalidated',
      );
    return {
      validated: reasons.length === 0,
      visualEligible: visualReasons.length === 0,
      visualReasons,
      reasons,
      missing,
      unrun,
      blocked,
      failed,
    };
  } catch {
    return {
      validated: false,
      visualEligible: false,
      visualReasons: ['Malformed evidence: visual acceptance is unvalidated'],
      reasons: [
        'Malformed evidence or coverage, or unreadable candidate inputs',
      ],
      missing: [],
      unrun: [],
      blocked: [],
      failed: [],
    };
  }
}

function isInside(root: string, target: string): boolean {
  const scoped = relative(root, target);
  return scoped.length > 0 && !scoped.startsWith('..') && !isAbsolute(scoped);
}

/** Artifact digests are recorded outside the artifact; missing, altered or escaped bytes invalidate them. */
export function verifyArtifacts(
  root: string,
  artifacts: readonly ArtifactRef[],
): ArtifactVerification {
  const missing: string[] = [];
  const mismatched: string[] = [];
  const realRoot = realpathSync(root);
  for (const artifact of artifacts) {
    const resolved = resolve(realRoot, artifact.path);
    if (!isInside(realRoot, resolved)) {
      mismatched.push(artifact.path);
      continue;
    }
    let real: string;
    try {
      real = realpathSync(resolved);
    } catch {
      missing.push(artifact.path);
      continue;
    }
    if (!isInside(realRoot, real)) {
      mismatched.push(artifact.path);
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(real);
    } catch {
      missing.push(artifact.path);
      continue;
    }
    if (sha256Bytes(bytes) !== artifact.sha256) mismatched.push(artifact.path);
  }
  return { missing, mismatched };
}

function environmentIdentity(environment: EnvironmentIdentity): string {
  return JSON.stringify([
    environment.os,
    environment.osImage,
    environment.vscodeVersion,
    environment.vscodeBuild,
    environment.vscodeHash,
    environment.driverVersion,
    environment.locale,
    environment.timezone,
    environment.theme,
    environment.fonts,
    environment.display.width,
    environment.display.height,
    environment.display.dpr,
    environment.display.interfaceScale,
    environment.display.reportZoom,
  ]);
}

function fixtureIdentity(fixtures: readonly FixtureRef[]): string {
  return JSON.stringify(
    [...fixtures]
      .sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      )
      .map((fixture) => [fixture.id, fixture.sha256]),
  );
}

/** A different candidate, VSIX byte set, fixture corpus or environment cannot reuse evidence. */
export function incompatibleReasons(
  record: EvidenceRecord,
  candidate: CandidateIdentity,
): readonly string[] {
  const reasons: string[] = [];
  if (record.provenance.manifest.fingerprint !== candidate.inputFingerprint)
    reasons.push(
      'Candidate input fingerprint differs from the recorded manifest',
    );
  if (record.artifact?.sha256 !== candidate.vsixSha256)
    reasons.push('VSIX SHA-256 differs from the recorded artifact');
  if (
    environmentIdentity(record.environment) !==
    environmentIdentity(candidate.environment)
  )
    reasons.push(
      'Desktop/driver/display/theme/fonts environment identity differs',
    );
  if (fixtureIdentity(record.fixtures) !== fixtureIdentity(candidate.fixtures))
    reasons.push('Fixture hashes differ from the recorded corpus');
  return reasons;
}
