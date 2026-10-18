import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVsix } from '../../scripts/verify-vsix.js';
import { renderWebviewHtml } from '../../apps/vscode-extension/src/webview.js';
import { parse } from '@rdlc/xml-parser/parser';

test('packaged webview has nonce-bound local assets and denies network and executable resources', async () => {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const entries = await readVsix(`dist/rdlc-code-${version}.vsix`);
  const index = entries.get('extension/build/designer/index.html')!.toString();
  const html = renderWebviewHtml({
    index,
    assetsBase: 'https://local.vscode-resource.test/designer',
    nonce: 'test-nonce',
    cspSource: 'https://local.vscode-resource.test',
  });
  for (const directive of [
    "default-src 'none'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ])
    assert.ok(html.includes(directive));
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|<base\b/);
  for (const script of html.matchAll(/<script\b[^>]*>/g))
    assert.match(script[0], /nonce="test-nonce"/);
  for (const asset of html.matchAll(/(?:src|href)="([^"]+)"/g))
    assert.ok(
      asset[1]!.startsWith('https://local.vscode-resource.test/designer/'),
      asset[1],
    );
  for (const [path, bytes] of entries) {
    if (!/\.(?:js|css|html)$/.test(path)) continue;
    const text = bytes.toString();
    assert.doesNotMatch(
      text,
      /sourceMappingURL|@import\s+["']https?:|url\(\s*["']?https?:/i,
      path,
    );
    assert.doesNotMatch(
      text,
      /https?:\/\/[^\s"'`<>]+\.(?:woff2?|ttf|otf)(?:[?"']|$)/i,
      path,
    );
  }
});

test('packaged interactive workflows have no network, storage or code-execution channel', async () => {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const entries = await readVsix(`dist/rdlc-code-${version}.vsix`);
  const manifest = JSON.parse(
    entries.get('extension/package.json')!.toString(),
  );
  // Untrusted local workspaces stay supported; virtual/remote ones are not claimed.
  assert.deepEqual(manifest.capabilities, {
    untrustedWorkspaces: { supported: true },
    virtualWorkspaces: false,
  });
  const host = entries.get('extension/build/extension.cjs')!.toString();
  assert.deepEqual(
    [
      ...new Set([...host.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])),
    ].sort(),
    ['node:crypto', 'node:fs', 'vscode'],
  );
  for (const [path, bytes] of entries) {
    if (!/\.(?:js|cjs)$/.test(path)) continue;
    assert.doesNotMatch(
      bytes.toString(),
      /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|\beval\(|new Function\b|window\.open|navigator\.clipboard|localStorage|indexedDB/,
      path,
    );
  }
});

test('malicious local and remote entity declarations are rejected without source loss', () => {
  for (const file of ['external-local.rdlc', 'external-remote.rdlc']) {
    const source = readFileSync(`tests/fixtures/security/${file}`, 'utf8');
    const parsed = parse({ uri: file, version: 1, source, eol: '\n' });
    assert.equal(parsed.status, 'source-only');
    assert.equal(parsed.snapshot.source, source);
  }
});
