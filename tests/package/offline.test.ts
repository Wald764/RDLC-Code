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

test('US6.4-offline', async () => {
  // Static inspection of the packaged candidate's bundled content only: a
  // static scan is never runtime proof of offline behavior. The installed
  // journeys are observed at runtime by tests/desktop/offline.spec.ts.
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as {
    version: string;
  };
  const entries = await readVsix(`dist/rdlc-code-${version}.vsix`);
  const host = entries.get('extension/build/extension.cjs')!.toString();
  // The bounded inert data inventory ships inside the bundle: definitions are
  // read from the packaged source and never fetched or decoded at runtime.
  for (const label of [
    'Datasets / Fields',
    'Parameters',
    'Embedded Images',
    'Data Sources',
  ])
    assert.ok(
      host.includes(label),
      `the bundled data inventory is missing ${label}`,
    );
  // No dynamic-code, worker, decode or network channel in any packaged asset.
  for (const [path, bytes] of entries) {
    if (!/\.(?:js|cjs|html|css)$/.test(path)) continue;
    const text = bytes.toString();
    assert.doesNotMatch(
      text,
      /\b(?:eval\(|new Function|WebAssembly|importScripts|new Worker|SharedWorker|atob\()/,
      path,
    );
    assert.doesNotMatch(
      text,
      /\b(?:fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\()/,
      path,
    );
    // Hostile fixture payloads are test inputs, never shipped content.
    assert.doesNotMatch(
      text,
      /__RDLC_CANARY|never-fetch|CanaryImage|SECRET_|SELECT untouched|offline-secret/,
      path,
    );
  }
  // No third-party runtime dependency backs those workflows.
  const manifest = JSON.parse(
    entries.get('extension/package.json')!.toString(),
  ) as { dependencies?: Record<string, string> };
  const dependencies = Object.values(manifest.dependencies ?? {});
  assert.ok(dependencies.length > 0, 'the packaged dependencies are missing');
  assert.ok(
    dependencies.every((value) => value === 'workspace:*'),
    `unexpected packaged runtime dependency: ${dependencies.filter((value) => value !== 'workspace:*').join(', ')}`,
  );
});
