import { test } from 'node:test';
import assert from 'node:assert/strict';
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
