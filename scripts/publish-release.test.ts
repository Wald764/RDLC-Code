import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createManifest } from './release-artifact.js';
import {
  assetDigest,
  githubObservation,
  marketplaceVersionExists,
  openvsxChecksumUrl,
  previousStableTag,
  verifyHandoff,
} from './publish-release.js';

test('release notes are bounded by the highest published stable version below the tag', () => {
  const releases = [
    { tag_name: 'v2.0.0', draft: true },
    { tag_name: 'v1.1.0', prerelease: true },
    { tag_name: 'v1.0.1' },
    { tag_name: 'v1.0.0' },
    { tag_name: 'v0.9.0', draft: true },
    { tag_name: 'maintenance' },
    { tag_name: 'v1.0.2' },
  ];
  assert.equal(previousStableTag(releases, 'v1.1.0'), 'v1.0.2');
  assert.equal(previousStableTag(releases, 'v2.0.0'), 'v1.0.2');
  assert.equal(previousStableTag([{ tag_name: 'v1.0.0' }], 'v1.0.0'), null);
  assert.equal(previousStableTag([], 'v1.0.0'), null);
  assert.throws(() => previousStableTag(releases, '1.1.0'));
});

test('only a published release with a byte-identified asset completes the GitHub destination', () => {
  const assets = [
    { name: 'rdlc-code-1.2.3.vsix', digest: 'sha256:abc' },
    { name: 'release-manifest.json', digest: 'sha256:def' },
  ];
  assert.equal(assetDigest(assets, 'rdlc-code-1.2.3.vsix'), 'abc');
  assert.equal(assetDigest(assets, 'release-manifest.json'), 'def');
  assert.equal(assetDigest(assets, 'missing.vsix'), undefined);
  assert.equal(assetDigest([{ name: 'x', digest: null }], 'x'), undefined);
  assert.deepEqual(githubObservation(null, assets, 'rdlc-code-1.2.3.vsix'), {
    destination: 'github',
    configured: true,
    exists: false,
  });
  assert.deepEqual(
    githubObservation({ draft: true }, assets, 'rdlc-code-1.2.3.vsix'),
    { destination: 'github', configured: true, exists: false },
  );
  assert.deepEqual(
    githubObservation({ draft: false }, assets, 'rdlc-code-1.2.3.vsix'),
    {
      destination: 'github',
      configured: true,
      exists: true,
      remoteDigest: 'abc',
    },
  );
  assert.deepEqual(
    githubObservation({ draft: false }, [], 'rdlc-code-1.2.3.vsix'),
    { destination: 'github', configured: true, exists: true },
  );
  assert.deepEqual(
    githubObservation(
      { draft: false },
      [{ name: 'rdlc-code-1.2.3.vsix' }],
      'rdlc-code-1.2.3.vsix',
    ),
    { destination: 'github', configured: true, exists: true },
  );
});

test('Marketplace and Open VSX observations reject foreign or unidentifiable registrations', () => {
  const document = {
    results: [
      {
        extensions: [
          {
            extensionName: 'rdlc-code',
            publisher: { publisherName: 'Wald764' },
            versions: [{ version: '1.2.3' }, { version: '1.0.0' }],
          },
        ],
      },
    ],
  };
  assert.equal(
    marketplaceVersionExists(document, 'wald764', 'RDLC-Code', '1.2.3'),
    true,
  );
  assert.equal(
    marketplaceVersionExists(document, 'Wald764', 'rdlc-code', '2.0.0'),
    false,
  );
  assert.equal(
    marketplaceVersionExists({ results: [] }, 'Wald764', 'rdlc-code', '1.2.3'),
    false,
  );
  assert.throws(() =>
    marketplaceVersionExists(document, 'Other', 'rdlc-code', '1.2.3'),
  );
  assert.throws(() =>
    marketplaceVersionExists(document, 'Wald764', 'other', '1.2.3'),
  );
  assert.equal(
    openvsxChecksumUrl({ files: { sha256: 'https://example/sha' } }),
    'https://example/sha',
  );
  assert.equal(openvsxChecksumUrl({ files: {} }), null);
  assert.equal(openvsxChecksumUrl({}), null);
});

test('the handoff verifier binds downloaded bytes to tag, commit, publisher and run', () => {
  mkdirSync('dist', { recursive: true });
  const directory = mkdtempSync(join('dist', 'publish-check-'));
  const identity = {
    tag: 'v1.2.3',
    commit: 'a'.repeat(40),
    version: '1.2.3',
    publisher: 'Wald764',
    name: 'rdlc-code',
  };
  const bytes = Buffer.from('canonical VSIX');
  const manifest = createManifest({
    identity,
    candidate: identity.commit,
    runId: '123',
    tools: { node: '24.22.0' },
    gates: { validation: 'success', quality: 'success' },
    openvsx: 'not-configured',
    lockfile: Buffer.from('lock'),
    evidence: { 'docs/validation/proof.md': Buffer.from('passed') },
    permittedEvidenceChanges: [],
    filename: 'rdlc-code-1.2.3.vsix',
    bytes,
  });
  writeFileSync(
    join(directory, 'release-manifest.json'),
    JSON.stringify(manifest),
  );
  writeFileSync(join(directory, manifest.filename), bytes);
  const previous = { ...process.env };
  Object.assign(process.env, {
    RELEASE_TAG: 'v1.2.3',
    GITHUB_SHA: identity.commit,
    GITHUB_RUN_ID: '123',
    ARTIFACT_ID: '456',
    MARKETPLACE_PUBLISHER: 'Wald764',
  });
  try {
    assert.equal(verifyHandoff(directory).vsixSha256, manifest.vsixSha256);
    process.env.GITHUB_SHA = 'b'.repeat(40);
    assert.throws(() => verifyHandoff(directory), 'Wrong commit accepted');
    process.env.GITHUB_SHA = identity.commit;
    process.env.MARKETPLACE_PUBLISHER = 'Other';
    assert.throws(() => verifyHandoff(directory), 'Wrong publisher accepted');
    process.env.MARKETPLACE_PUBLISHER = 'Wald764';
    process.env.ARTIFACT_ID = '';
    assert.throws(() => verifyHandoff(directory), 'Missing artifact ID');
    process.env.ARTIFACT_ID = '456';
    writeFileSync(join(directory, manifest.filename), Buffer.from('tampered'));
    assert.throws(() => verifyHandoff(directory), 'Tampered VSIX accepted');
  } finally {
    for (const name of [
      'RELEASE_TAG',
      'GITHUB_SHA',
      'GITHUB_RUN_ID',
      'ARTIFACT_ID',
      'MARKETPLACE_PUBLISHER',
    ]) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
