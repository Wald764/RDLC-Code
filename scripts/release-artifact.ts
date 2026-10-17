import assert from 'node:assert/strict';
import { sha256, stableVersion } from './validate-release.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface ReleaseIdentity {
  tag: string;
  commit: string;
  version: string;
  publisher: string;
  name: string;
}
export function artifactVersion(tag: string, name: string): string {
  // Only the inert probe may use the reserved test tag suffix; registry versions stay numeric.
  const stableTag =
    name === 'rdlc-code-auth-test' ? tag.replace(/-publishing-test$/, '') : tag;
  return stableVersion(stableTag, stableTag.slice(1), stableTag.slice(1));
}
export interface ReleaseManifest {
  identity: ReleaseIdentity;
  candidate: string;
  runId: string;
  tools: Record<string, string>;
  gates: { validation: string; quality: string };
  destinations: {
    marketplacePublisher: string;
    openvsxNamespace: string | null;
    openvsxMode: string;
  };
  lockfileSha256: string;
  evidence: Record<string, string>;
  permittedEvidenceChanges: readonly string[];
  filename: string;
  vsixSha256: string;
}
export function createManifest(input: {
  identity: ReleaseIdentity;
  candidate: string;
  runId: string;
  tools: Record<string, string>;
  gates: { validation: string; quality: string };
  openvsx: string;
  lockfile: Buffer;
  evidence: Record<string, Buffer>;
  permittedEvidenceChanges: readonly string[];
  filename: string;
  bytes: Buffer;
}): ReleaseManifest {
  assert.equal(
    artifactVersion(input.identity.tag, input.identity.name),
    input.identity.version,
  );
  assert.match(input.identity.commit, /^[a-f0-9]{40}$/);
  assert.match(input.candidate, /^[a-f0-9]{40}$/);
  assert.match(input.runId, /^[1-9][0-9]*$/);
  assert.match(input.identity.publisher, /^[a-z0-9][a-z0-9-]*$/i);
  assert.match(input.identity.name, /^[a-z0-9][a-z0-9-]*$/i);
  assert.ok(
    ['not-configured', 'pat', 'oidc'].includes(input.openvsx),
    'Invalid manifest Open VSX mode',
  );
  assert.deepEqual(
    input.gates,
    { validation: 'success', quality: 'success' },
    'Every required workflow must pass before handoff',
  );
  assert.ok(input.bytes.length > 0 && input.lockfile.length > 0);
  assert.ok(
    Object.keys(input.tools).every((name) =>
      ['node', 'pnpm', 'typescript', 'angular', 'vsce'].includes(name),
    ),
    'Only declared tool versions belong in the manifest',
  );
  assert.ok(
    Object.values(input.tools).every((version) =>
      /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version),
    ),
    'Invalid manifest tool version',
  );
  assert.equal(
    input.filename,
    `${input.identity.name}-${input.identity.version}.vsix`,
  );
  assert.ok(
    Object.keys(input.evidence).length > 0,
    'Accepted evidence is required',
  );
  assert.ok(
    Object.keys(input.evidence).every((path) =>
      /^docs\/validation\/[a-z0-9-]+\.md$/.test(path),
    ),
    'Only validation evidence belongs in the manifest',
  );
  assert.ok(
    input.permittedEvidenceChanges.every((path) =>
      /^docs\/validation\/[a-z0-9-]+\.md$/.test(path),
    ),
  );
  return Object.freeze({
    identity: Object.freeze({ ...input.identity }),
    candidate: input.candidate,
    runId: input.runId,
    tools: Object.freeze({ ...input.tools }),
    gates: Object.freeze({ ...input.gates }),
    destinations: Object.freeze({
      marketplacePublisher: input.identity.publisher,
      openvsxNamespace:
        input.openvsx === 'not-configured' ? null : input.identity.publisher,
      openvsxMode: input.openvsx,
    }),
    lockfileSha256: sha256(input.lockfile),
    evidence: Object.freeze(
      Object.fromEntries(
        Object.entries(input.evidence).map(([path, bytes]) => [
          path,
          sha256(bytes),
        ]),
      ),
    ),
    permittedEvidenceChanges: Object.freeze([
      ...input.permittedEvidenceChanges,
    ]),
    filename: input.filename,
    vsixSha256: sha256(input.bytes),
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const tag = process.env.RELEASE_TAG ?? '';
  const validated = JSON.parse(
    execFileSync(
      process.execPath,
      ['scripts/validate-release.ts', tag, 'origin/main'],
      { encoding: 'utf8' },
    ),
  ) as {
    tag: string;
    commit: string;
    version: string;
    candidate: string;
    tools: Record<string, string>;
    openvsx: string;
    evidence: Record<string, string>;
    permittedEvidenceChanges: string[];
  };
  const { readVsix, verifyVsix } = await import('./verify-vsix.js');
  const filename = `rdlc-code-${validated.version}.vsix`;
  const path = `dist/${filename}`;
  verifyVsix(await readVsix(path));
  const metadata = JSON.parse(
    readFileSync('apps/vscode-extension/package.json', 'utf8'),
  );
  const read = (path: string) =>
    execFileSync('git', ['show', `${validated.commit}:${path}`]);
  const evidence = Object.fromEntries(
    Object.entries(validated.evidence).map(([path, digest]) => {
      const bytes = read(path);
      assert.equal(sha256(bytes), digest, `Evidence changed: ${path}`);
      return [path, bytes];
    }),
  );
  const bytes = readFileSync(path);
  const manifest = createManifest({
    identity: {
      tag,
      commit: validated.commit,
      version: validated.version,
      publisher: metadata.publisher,
      name: metadata.name,
    },
    candidate: validated.candidate,
    runId: process.env.GITHUB_RUN_ID ?? '',
    tools: validated.tools,
    openvsx: validated.openvsx,
    gates: {
      validation: process.env.RELEASE_VALIDATION_RESULT ?? '',
      quality: process.env.RELEASE_QUALITY_RESULT ?? '',
    },
    lockfile: read('pnpm-lock.yaml'),
    evidence,
    permittedEvidenceChanges: validated.permittedEvidenceChanges,
    filename,
    bytes,
  });
  mkdirSync('dist/canonical');
  writeFileSync(`dist/canonical/${filename}`, bytes, { flag: 'wx' });
  writeFileSync(
    'dist/canonical/release-manifest.json',
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(`Canonical ${filename}: ${manifest.vsixSha256}`);
}
export function verifyArtifact(
  manifest: ReleaseManifest,
  reference: { runId: string; artifactId: string; archiveDigest?: string },
  bytes: Buffer,
  identity: ReleaseIdentity,
): void {
  assert.match(
    reference.artifactId,
    /^[1-9][0-9]*$/,
    'An immutable artifact ID is required',
  );
  assert.equal(reference.runId, manifest.runId, 'Wrong original workflow run');
  assert.equal(artifactVersion(identity.tag, identity.name), identity.version);
  assert.deepEqual(manifest.identity, identity, 'Artifact identity differs');
  assert.equal(manifest.filename, `${identity.name}-${identity.version}.vsix`);
  assert.match(manifest.vsixSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    sha256(bytes),
    manifest.vsixSha256,
    'Explicit VSIX SHA-256 mismatch',
  );
}
