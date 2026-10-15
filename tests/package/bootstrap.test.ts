import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('production scaffold includes a bundled host and static Angular assets', () => {
  const manifest = JSON.parse(
    readFileSync('apps/vscode-extension/package.json', 'utf8'),
  );
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, true);
  assert.equal(
    manifest.contributes.customEditors[0].viewType,
    'rdlcCode.designer',
  );
  assert.ok(
    readFileSync('apps/vscode-extension/build/extension.cjs', 'utf8').includes(
      'rdlcCode.openSource',
    ),
  );
  const files = readdirSync('apps/vscode-extension/build/designer');
  assert.ok(files.includes('index.html'));
  assert.ok(files.some((f) => f.endsWith('.js')));
  assert.ok(files.some((f) => f.endsWith('.css')));
  assert.ok(files.includes('3rdpartylicenses.txt'));
});
