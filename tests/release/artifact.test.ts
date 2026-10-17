import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createManifest,
  verifyArtifact,
} from '../../scripts/release-artifact.js';

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
