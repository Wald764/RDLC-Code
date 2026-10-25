import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Reuse the pinned packaging tool's ZIP reader; no second archive dependency.
const { readZip } = createRequire(import.meta.url)(
  '@vscode/vsce/out/zip.js',
) as {
  readZip(
    path: string,
    filter: (path: string) => boolean,
  ): Promise<Map<string, Buffer>>;
};
export const readVsix = (path: string) => readZip(path, () => true);

// Desktop validation tooling is development-only and must never ship.
const desktopTooling =
  /(?:^|\/)(?:tests\/(?:desktop|vscode)|harness|drag-probe|playwright|\.vscode-test)(?:[/.-]|$)/i;

export function verifyVsix(entries: ReadonlyMap<string, Buffer>): void {
  const root = JSON.parse(readFileSync('package.json', 'utf8'));
  const expected = JSON.parse(
    readFileSync('apps/vscode-extension/package.json', 'utf8'),
  );
  const embedded = JSON.parse(
    entries.get('extension/package.json')?.toString() ?? 'null',
  );
  assert.ok(embedded, 'Missing embedded package.json');
  assert.equal(
    root.version,
    expected.version,
    'Root/extension version mismatch',
  );
  assert.deepEqual(embedded, expected, 'Embedded extension metadata mismatch');
  const xml = entries.get('extension.vsixmanifest')?.toString() ?? '';
  for (const [attribute, value] of Object.entries({
    Id: expected.name,
    Version: root.version,
    Publisher: expected.publisher,
  })) {
    assert.ok(
      xml.includes(`${attribute}="${value}"`),
      `VSIX identity mismatch: ${attribute}`,
    );
  }
  assert.doesNotMatch(xml, /TargetPlatform=/, 'Package must be universal');
  for (const path of entries.keys())
    assert.doesNotMatch(
      path,
      desktopTooling,
      `Desktop tooling in package: ${path}`,
    );
  const allowed = new Map<string, Buffer>();
  const add = (source: string, target: string) => {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const path = join(source, entry.name);
      const name = `${target}/${entry.name}`;
      assert.ok(!entry.isSymbolicLink(), `Symlink in package: ${path}`);
      if (entry.isDirectory()) add(path, name);
      else {
        assert.ok(
          /\.(?:cjs|js|css|html|txt|png|svg)$/.test(name),
          `Unexpected production asset: ${name}`,
        );
        allowed.set(name.toLowerCase(), readFileSync(path));
      }
    }
  };
  add('apps/vscode-extension/build', 'extension/build');
  add('apps/vscode-extension/media', 'extension/media');
  allowed.set('extension/license.txt', readFileSync('LICENSE'));
  allowed.set(
    'extension/third_party_notices.md',
    readFileSync('THIRD_PARTY_NOTICES.md'),
  );
  allowed.set('extension/package.json', entries.get('extension/package.json')!);
  const readme = entries.get('extension/readme.md');
  if (readme)
    allowed.set(
      'extension/readme.md',
      readFileSync('apps/vscode-extension/README.md'),
    );
  for (const required of [
    `extension/${expected.icon}`,
    'extension/media/rdlc-activity.svg',
    'extension/build/extension.cjs',
    'extension/build/designer/index.html',
    'extension/build/designer/3rdpartylicenses.txt',
  ])
    assert.ok(
      allowed.has(required) && entries.has(required),
      `Missing ${required}`,
    );
  for (const [path, bytes] of entries) {
    if (path === '[content_types].xml' || path === 'extension.vsixmanifest')
      continue;
    assert.ok(allowed.has(path), `Unreviewed package content: ${path}`);
    assert.deepEqual(
      bytes,
      allowed.get(path),
      `Production bytes differ: ${path}`,
    );
  }
  for (const path of allowed.keys())
    assert.ok(entries.has(path), `Missing production asset: ${path}`);
  assert.ok([...entries.keys()].some((path) => /designer\/.*\.js$/.test(path)));
  assert.ok(
    [...entries.keys()].some((path) => /designer\/.*\.css$/.test(path)),
  );
}
