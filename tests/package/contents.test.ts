import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readVsix, verifyVsix } from '../../scripts/verify-vsix.js';

test('the actual VSIX contains exactly the reviewed production assets and identity', async () => {
  const root = JSON.parse(readFileSync('package.json', 'utf8'));
  const entries = await readVsix(`dist/rdlc-code-${root.version}.vsix`);
  verifyVsix(entries);
  for (const path of [
    'extension/.env',
    'extension/build/key.pem',
    'extension/build/addon.node',
  ]) {
    assert.throws(() =>
      verifyVsix(new Map([...entries, [path, Buffer.from('secret')]])),
    );
  }
  // Desktop tooling must be rejected explicitly, even under reviewed directories.
  for (const path of [
    'extension/tests/desktop/run-tests.js',
    'extension/build/tests/vscode/harness/index.js',
    'extension/build/drag-probe.js',
    'extension/media/drag-probe.svg',
    'extension/node_modules/playwright/index.js',
    'extension/.vscode-test/settings.json',
  ])
    assert.throws(
      () => verifyVsix(new Map([...entries, [path, Buffer.from('x')]])),
      /Desktop tooling/,
      path,
    );
  assert.equal(
    createHash('sha256')
      .update(entries.get('extension/media/rdlc-activity.svg')!)
      .digest('hex'),
    '5edf5dcf6c5155ecde4efc9dbb977aa9421cf28f89e64f7fce17d1aec0bdca9e',
  );
  for (const path of [
    'extension/build/designer/3rdpartylicenses.txt',
    'extension/media/rdlc-logo.png',
    'extension/media/rdlc-activity.svg',
  ]) {
    const missing = new Map(entries);
    missing.delete(path);
    assert.throws(() => verifyVsix(missing));
  }
  const altered = new Map(entries);
  altered.set('extension/media/rdlc-logo.png', Buffer.from('wrong logo'));
  assert.throws(() => verifyVsix(altered));
  const wrong = new Map(entries);
  const metadata = JSON.parse(wrong.get('extension/package.json')!.toString());
  wrong.set(
    'extension/package.json',
    Buffer.from(JSON.stringify({ ...metadata, version: '99.0.0' })),
  );
  assert.throws(() => verifyVsix(wrong));
});
