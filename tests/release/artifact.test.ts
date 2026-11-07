import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  artifactVersion,
  createManifest,
  verifyArtifact,
} from '../../scripts/release-artifact.js';
import { verifyVsix } from '../../scripts/verify-vsix.js';

test('reserved publishing-test tags bind only to the inert probe and never relax stable releases', () => {
  assert.equal(
    artifactVersion('v0.0.2-publishing-test', 'rdlc-code-auth-test'),
    '0.0.2',
  );
  for (const tag of ['v0.0.2-publishing-test', 'v0.0.2-alpha.1', 'v00.0.2'])
    assert.throws(() => artifactVersion(tag, 'rdlc-code'));
  assert.throws(() => artifactVersion('v0.0.2-alpha.1', 'rdlc-code-auth-test'));
  const identity = {
    tag: 'v0.0.2-publishing-test',
    commit: 'a'.repeat(40),
    version: '0.0.2',
    publisher: 'Wald764',
    name: 'rdlc-code-auth-test',
  };
  const bytes = Buffer.from('inert probe');
  const manifest = createManifest({
    identity,
    candidate: identity.commit,
    runId: '123',
    tools: { node: '24.22.0' },
    gates: { validation: 'success', quality: 'success' },
    openvsx: 'pat',
    lockfile: Buffer.from('lock'),
    evidence: {
      'docs/validation/publishing-auth.md': Buffer.from('probe record'),
    },
    permittedEvidenceChanges: [],
    filename: 'rdlc-code-auth-test-0.0.2.vsix',
    bytes,
  });
  assert.doesNotThrow(() =>
    verifyArtifact(
      manifest,
      { runId: '123', artifactId: '456' },
      bytes,
      identity,
    ),
  );
  assert.throws(() =>
    verifyArtifact(manifest, { runId: '123', artifactId: '456' }, bytes, {
      ...identity,
      name: 'rdlc-code',
    }),
  );
});

test('immutable artifact identity and explicit VSIX digest override archive digest warnings', () => {
  const bytes = Buffer.from('canonical VSIX');
  const identity = {
    tag: 'v1.2.3',
    commit: 'a'.repeat(40),
    version: '1.2.3',
    publisher: 'example',
    name: 'rdlc-code',
  };
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
  const reference = {
    runId: '123',
    artifactId: '456',
    archiveDigest: 'warning-only',
  };
  assert.doesNotThrow(() =>
    verifyArtifact(manifest, reference, bytes, identity),
  );
  assert.throws(() =>
    verifyArtifact(manifest, reference, Buffer.from('tampered'), identity),
  );
  assert.throws(() =>
    verifyArtifact(manifest, { ...reference, artifactId: '' }, bytes, identity),
  );
  assert.throws(() =>
    verifyArtifact(manifest, { ...reference, runId: '124' }, bytes, identity),
  );
  assert.throws(() =>
    verifyArtifact(manifest, reference, bytes, {
      ...identity,
      commit: 'b'.repeat(40),
    }),
  );
  for (const result of ['failed', 'cancelled', 'skipped', '']) {
    assert.throws(() =>
      createManifest({
        identity,
        candidate: identity.commit,
        runId: '123',
        tools: { node: '24.22.0' },
        gates: { validation: 'success', quality: result },
        openvsx: 'not-configured',
        lockfile: Buffer.from('lock'),
        evidence: { 'docs/validation/proof.md': Buffer.from('passed') },
        permittedEvidenceChanges: [],
        filename: 'rdlc-code-1.2.3.vsix',
        bytes,
      }),
    );
  }
});

test('quality may be enforced by the release gate, any other gate state is refused', () => {
  const bytes = Buffer.from('canonical VSIX');
  const identity = {
    tag: 'v1.2.3',
    commit: 'a'.repeat(40),
    version: '1.2.3',
    publisher: 'example',
    name: 'rdlc-code',
  };
  const manifest = (validation: string, quality: string) =>
    createManifest({
      identity,
      candidate: identity.commit,
      runId: '123',
      tools: { node: '24.22.0' },
      gates: { validation, quality },
      openvsx: 'not-configured',
      lockfile: Buffer.from('lock'),
      evidence: { 'docs/validation/proof.md': Buffer.from('passed') },
      permittedEvidenceChanges: [],
      filename: 'rdlc-code-1.2.3.vsix',
      bytes,
    });
  assert.equal(
    manifest('success', 'release-gate').gates.quality,
    'release-gate',
  );
  assert.equal(manifest('success', 'success').gates.quality, 'success');
  for (const quality of [
    'failure',
    'failed',
    'cancelled',
    'skipped',
    '',
    'deferred',
  ])
    assert.throws(() => manifest('success', quality), /Quality/, quality);
  for (const validation of [
    'failure',
    'cancelled',
    'skipped',
    '',
    'release-gate',
  ])
    assert.throws(() => manifest(validation, 'release-gate'), /validation/i);
});

test('a VSIX without the reviewed identity is rejected and any byte change breaks the digest', () => {
  assert.throws(() => verifyVsix(new Map()), /Missing embedded package.json/);
  assert.throws(() =>
    verifyVsix(
      new Map([
        ['extension/package.json', Buffer.from('{"name":"other"}')],
        ['extension.vsixmanifest', Buffer.from('<PackageManifest/>')],
      ]),
    ),
  );
  const bytes = Buffer.from('canonical VSIX');
  const identity = {
    tag: 'v1.2.3',
    commit: 'a'.repeat(40),
    version: '1.2.3',
    publisher: 'example',
    name: 'rdlc-code',
  };
  const manifest = createManifest({
    identity,
    candidate: identity.commit,
    runId: '123',
    tools: { node: '24.22.0' },
    gates: { validation: 'success', quality: 'release-gate' },
    openvsx: 'not-configured',
    lockfile: Buffer.from('lock'),
    evidence: { 'docs/validation/proof.md': Buffer.from('passed') },
    permittedEvidenceChanges: [],
    filename: 'rdlc-code-1.2.3.vsix',
    bytes,
  });
  const reference = { runId: '123', artifactId: '456' };
  assert.doesNotThrow(() =>
    verifyArtifact(manifest, reference, bytes, identity),
  );
  for (const tampered of [
    Buffer.from('canonical VSIy'),
    Buffer.concat([bytes, Buffer.from('\0')]),
    Buffer.alloc(0),
  ])
    assert.throws(
      () => verifyArtifact(manifest, reference, tampered, identity),
      /SHA-256 mismatch/,
    );
});
