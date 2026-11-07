import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const requiredEvidence = [
  'preservation',
  'compatibility',
  'lifecycle',
  'isolation',
  'keyboard',
  'licenses',
  'cross-os',
  'v1',
  'v2',
  'v3',
  'v4',
  'v5',
  'v6',
  'v7',
  'v8',
  'github-auth',
  'marketplace-auth',
  'recovery',
  'github-actions',
] as const;

/**
 * Evidence tiers. Every id of `requiredEvidence` (and the Open VSX ones) must be
 * `passed`, except the non-critical ids below, which may instead be recorded as
 * `accepted-failure` with a tracking issue and a reason. Everything that touches
 * integrity, security, essential keyboard authoring, lifecycle or the release
 * pipeline stays critical; an accepted failure also forbids "FULLY VALIDATED".
 * - cross-os, v2: cross-platform/matrix breadth beyond the Linux gate.
 * - v7: hosted-runner performance budgets and pinned visual references.
 */
export const nonCriticalEvidence: readonly string[] = ['cross-os', 'v2', 'v7'];
export const isCriticalEvidence = (id: string): boolean =>
  !nonCriticalEvidence.includes(id);

const issuePattern =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/;

export interface QaException {
  /** `<spec file>::<test title>` or an informational check id such as `job:visual`. */
  id: string;
  /** Optional `<os>/<vscode>` restriction. */
  scope?: string;
  issue: string;
  reason: string;
  acceptedBy: string;
  acceptedOn: string;
}

/**
 * Validate the optional `qaExceptions` array of the readiness record. `allowed`
 * decides whether an id names an informational check or test: an exception on a
 * critical check is rejected. The default only rejects evidence ids and
 * structurally invalid ids so this file stays free of local imports (it runs
 * from source in release.yml and ships in the canonical handoff); qa-gate
 * passes the real classification.
 */
export function validateQaExceptions(
  value: unknown,
  allowed: (id: string) => boolean = () => true,
): QaException[] {
  if (value === undefined) return [];
  assert.ok(Array.isArray(value), 'qaExceptions must be an array');
  const seen = new Set<string>();
  return value.map((entry: unknown, index) => {
    assert.ok(
      entry && typeof entry === 'object' && !Array.isArray(entry),
      `qaExceptions[${index}] must be an object`,
    );
    const item = entry as Record<string, unknown>;
    const extra = Object.keys(item).filter(
      (key) =>
        ![
          'id',
          'scope',
          'issue',
          'reason',
          'acceptedBy',
          'acceptedOn',
        ].includes(key),
    );
    assert.deepEqual(extra, [], `qaExceptions[${index}] has unknown fields`);
    const text = (key: string) => {
      const field = item[key];
      assert.ok(
        typeof field === 'string' && field.trim().length > 0,
        `qaExceptions[${index}].${key} is required`,
      );
      return field as string;
    };
    const id = text('id');
    assert.ok(
      /^(job:[a-z][a-z-]*|[A-Za-z0-9._-]+\.spec\.ts::\S.*)$/.test(id),
      `qaExceptions[${index}].id must be a spec test id or an informational job id`,
    );
    assert.ok(
      !(requiredEvidence as readonly string[]).includes(id) && allowed(id),
      `qaExceptions[${index}]: ${id} is a critical check and cannot be excepted`,
    );
    const scope = item['scope'];
    assert.ok(
      scope === undefined ||
        (typeof scope === 'string' &&
          /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(scope)),
      `qaExceptions[${index}].scope must be <os>/<vscode>`,
    );
    const issue = text('issue');
    assert.match(
      issue,
      issuePattern,
      `qaExceptions[${index}].issue must be a GitHub issue URL`,
    );
    const reason = text('reason');
    const acceptedBy = text('acceptedBy');
    const acceptedOn = text('acceptedOn');
    assert.match(
      acceptedOn,
      /^\d{4}-\d{2}-\d{2}$/,
      `qaExceptions[${index}].acceptedOn must be YYYY-MM-DD`,
    );
    const key = `${id}|${scope ?? ''}`;
    assert.ok(!seen.has(key), `Duplicate qaException: ${key}`);
    seen.add(key);
    return {
      id,
      ...(scope === undefined ? {} : { scope: scope as string }),
      issue,
      reason,
      acceptedBy,
      acceptedOn,
    };
  });
}

/** Evidence ids recorded as accepted failures (never FULLY VALIDATED). */
export function acceptedFailures(
  record: Pick<Readiness, 'evidence'>,
): { id: string; issue: string; reason: string }[] {
  return Object.entries(record.evidence)
    .filter(([, evidence]) => evidence.status === 'accepted-failure')
    .map(([id, evidence]) => ({
      id,
      issue: evidence.issue ?? '',
      reason: evidence.reason ?? '',
    }));
}

/** The single JSON record of docs/validation/release-readiness.md. */
export function parseReadiness(markdown: string): Readiness {
  const blocks = [...markdown.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length, 1, 'Readiness requires exactly one JSON record');
  return JSON.parse(blocks[0]![1]!) as Readiness;
}
export const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export function stableVersion(
  tag: string,
  root: string,
  extension: string,
): string {
  assert.ok(
    /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag) &&
      !/[\r\n]/.test(tag),
    'Expected canonical stable vMAJOR.MINOR.PATCH',
  );
  const version = tag.slice(1);
  assert.equal(root, version, 'Root version differs from tag');
  assert.equal(extension, version, 'Extension version differs from tag');
  return version;
}

function git(args: string[], cwd = process.cwd()): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
export function resolveRelease(
  tag: string,
  main = 'origin/main',
  cwd = process.cwd(),
): string {
  stableVersion(tag, tag.slice(1), tag.slice(1));
  const commit = git(
    ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`],
    cwd,
  );
  assert.match(commit, /^[a-f0-9]{40}$/);
  git(['merge-base', '--is-ancestor', commit, main], cwd);
  return commit;
}

export interface Readiness {
  candidate: string;
  version: string;
  tools: Record<string, string>;
  openvsx: string;
  permittedEvidenceChanges: string[];
  evidence: Record<
    string,
    {
      status: string;
      path: string;
      candidate: string;
      issue?: string;
      reason?: string;
    }
  >;
  qaExceptions?: QaException[];
}
export function validateEvidence(
  record: Readiness,
  context: {
    version: string;
    candidate: string;
    tools: Record<string, string>;
    openvsx: string;
    changedPaths: string[];
    read: (path: string) => Buffer;
  },
): Record<string, string> {
  assert.match(record.candidate, /^[a-f0-9]{40}$/);
  assert.equal(record.candidate, context.candidate, 'Stale candidate');
  assert.equal(record.version, context.version, 'Stale evidence version');
  assert.deepEqual(record.tools, context.tools, 'Stale toolchain evidence');
  assert.equal(record.openvsx, context.openvsx, 'Stale Open VSX mode');
  assert.ok(
    ['not-configured', 'pat', 'oidc'].includes(record.openvsx),
    'Invalid Open VSX mode',
  );
  const evidencePath = (path: string) =>
    /^docs\/validation\/[a-z0-9][a-z0-9-]*\.md$/.test(path);
  assert.ok(Array.isArray(record.permittedEvidenceChanges));
  assert.equal(
    new Set(record.permittedEvidenceChanges).size,
    record.permittedEvidenceChanges.length,
  );
  assert.ok(
    record.permittedEvidenceChanges.every(evidencePath),
    'Only validation-evidence Markdown may differ',
  );
  validateQaExceptions(record.qaExceptions);
  const accepted = new Map<string, string>();
  const ids = [
    ...requiredEvidence,
    ...(record.openvsx === 'not-configured'
      ? []
      : [`openvsx-${record.openvsx}-auth`, 'openvsx-recovery']),
  ];
  for (const id of ids) {
    const evidence = record.evidence[id];
    assert.ok(evidence, `Missing mandatory evidence: ${id}`);
    if (evidence.status === 'accepted-failure') {
      assert.ok(
        !isCriticalEvidence(id),
        `Critical evidence cannot be an accepted failure: ${id}`,
      );
      assert.match(
        evidence.issue ?? '',
        issuePattern,
        `Accepted failure needs a GitHub issue URL: ${id}`,
      );
      assert.ok(
        typeof evidence.reason === 'string' &&
          evidence.reason.trim().length > 0,
        `Accepted failure needs a reason: ${id}`,
      );
    } else
      assert.equal(
        evidence.status,
        'passed',
        `Mandatory evidence not passed: ${id}`,
      );
    assert.equal(evidence.candidate, record.candidate, `Stale evidence: ${id}`);
    assert.ok(evidencePath(evidence.path), `Invalid evidence path: ${id}`);
    const bytes = context.read(evidence.path);
    assert.ok(bytes.length > 0, `Empty evidence: ${id}`);
    accepted.set(evidence.path, sha256(bytes));
  }
  for (const path of context.changedPaths) {
    assert.ok(
      record.permittedEvidenceChanges.includes(path) && evidencePath(path),
      `Candidate changed outside listed evidence: ${path}`,
    );
    assert.ok(
      path === 'docs/validation/release-readiness.md' || accepted.has(path),
      `Diff is not accepted evidence: ${path}`,
    );
  }
  return Object.fromEntries(accepted);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const tag = process.argv[2] ?? '';
  const commit = resolveRelease(tag, process.argv[3] ?? 'origin/main');
  assert.equal(
    git(['rev-parse', 'HEAD']),
    commit,
    'Check out the exact detached tag commit',
  );
  assert.equal(
    spawnSync('git', ['symbolic-ref', '-q', 'HEAD']).status,
    1,
    'Release validation requires a detached HEAD',
  );
  const read = (path: string) =>
    execFileSync('git', ['show', `${commit}:${path}`]);
  const root = JSON.parse(read('package.json').toString());
  const extension = JSON.parse(
    read('apps/vscode-extension/package.json').toString(),
  );
  const version = stableVersion(tag, root.version, extension.version);
  const markdown = read('docs/validation/release-readiness.md').toString();
  const record = parseReadiness(markdown);
  assert.match(record.candidate, /^[a-f0-9]{40}$/);
  git(['merge-base', '--is-ancestor', record.candidate, commit]);
  const diff = execFileSync(
    'git',
    ['diff', '--name-only', '-z', record.candidate, commit],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const namespace = process.env.OPENVSX_NAMESPACE;
  const openvsx = namespace
    ? process.env.OPENVSX_AUTH_MODE || 'pat'
    : 'not-configured';
  assert.equal(
    process.env.MARKETPLACE_PUBLISHER,
    extension.publisher,
    'Configured Marketplace publisher differs',
  );
  if (namespace)
    assert.equal(
      namespace,
      extension.publisher,
      'Configured Open VSX namespace differs',
    );
  else
    assert.ok(
      !process.env.OPENVSX_AUTH_MODE && !process.env.OVSX_PAT,
      'Incomplete Open VSX configuration',
    );
  const tools = {
    node: read('.node-version').toString().trim(),
    pnpm: root.packageManager.replace(/^pnpm@/, ''),
    typescript: root.devDependencies.typescript,
    angular: JSON.parse(read('apps/designer/package.json').toString())
      .dependencies['@angular/core'],
    vsce: root.devDependencies['@vscode/vsce'],
  };
  const evidence = validateEvidence(record, {
    candidate: record.candidate,
    version,
    tools,
    openvsx,
    changedPaths: diff,
    read,
  });
  evidence['docs/validation/release-readiness.md'] = sha256(
    Buffer.from(markdown),
  );
  console.log(
    JSON.stringify({
      tag,
      commit,
      version,
      candidate: record.candidate,
      tools,
      evidence,
      openvsx,
      permittedEvidenceChanges: diff,
    }),
  );
}
