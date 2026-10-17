import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createManifest } from './release-artifact.js';
import {
  assetDigest,
  githubObservation,
  marketplaceVersionExists,
  openvsxChecksumUrl,
  previousStableTag,
  sha256,
  verifyHandoff,
} from './publish-release.js';

const identity = {
  tag: 'v1.2.3',
  commit: 'a'.repeat(40),
  version: '1.2.3',
  publisher: 'Wald764',
  name: 'rdlc-code',
};
const bytes = Buffer.from('canonical VSIX');
function handoff(
  directory: string,
  openvsx: 'not-configured' | 'pat' | 'oidc' = 'not-configured',
) {
  const manifest = createManifest({
    identity,
    candidate: identity.commit,
    runId: '123',
    tools: { node: '24.22.0' },
    gates: { validation: 'success', quality: 'success' },
    openvsx,
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
  return manifest;
}

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
  const manifest = {
    identity,
    filename: 'rdlc-code-1.2.3.vsix',
    vsixSha256: 'abc',
  } as ReturnType<typeof createManifest>;
  const draft = { draft: true, tag_name: identity.tag };
  const published = { draft: false, tag_name: identity.tag };
  const assets = [
    { name: 'rdlc-code-1.2.3.vsix', digest: 'sha256:abc' },
    { name: 'release-manifest.json', digest: 'sha256:def' },
  ];
  assert.equal(assetDigest(assets, 'rdlc-code-1.2.3.vsix'), 'abc');
  assert.equal(assetDigest(assets, 'release-manifest.json'), 'def');
  assert.equal(assetDigest(assets, 'missing.vsix'), undefined);
  assert.equal(assetDigest([{ name: 'x', digest: null }], 'x'), undefined);
  assert.deepEqual(githubObservation(null, assets, manifest, 'def'), {
    destination: 'github',
    configured: true,
    exists: false,
  });
  assert.deepEqual(githubObservation(draft, assets, manifest, 'def'), {
    destination: 'github',
    configured: true,
    exists: false,
  });
  assert.deepEqual(githubObservation(published, assets, manifest, 'def'), {
    destination: 'github',
    configured: true,
    exists: true,
    remoteDigest: 'abc',
  });
  for (const incomplete of [[], assets.slice(0, 1), assets.slice(1)]) {
    assert.throws(() =>
      githubObservation(published, incomplete, manifest, 'def'),
    );
    assert.throws(() =>
      githubObservation(draft, incomplete, manifest, 'def', true),
    );
    assert.equal(
      githubObservation(draft, incomplete, manifest, 'def').exists,
      false,
    );
  }
  for (const wrong of [
    [{ name: manifest.filename, digest: 'sha256:wrong' }],
    [assets[0]!, { name: 'release-manifest.json', digest: 'sha256:wrong' }],
    [{ name: manifest.filename, digest: null }],
  ]) {
    assert.throws(() => githubObservation(draft, wrong, manifest, 'def'));
    assert.throws(() => githubObservation(published, wrong, manifest, 'def'));
  }
  assert.equal(
    githubObservation(draft, assets, manifest, 'def', true).exists,
    true,
  );
  assert.throws(() =>
    githubObservation(
      { ...published, tag_name: 'v9.0.0' },
      assets,
      manifest,
      'def',
    ),
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
  const manifest = handoff(directory);
  const previous = { ...process.env };
  Object.assign(process.env, {
    RELEASE_TAG: 'v1.2.3',
    GITHUB_SHA: identity.commit,
    GITHUB_RUN_ID: '123',
    ARTIFACT_ID: '456',
    MARKETPLACE_PUBLISHER: 'Wald764',
    OPENVSX_NAMESPACE: '',
    OPENVSX_AUTH_MODE: '',
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
    process.env.OPENVSX_NAMESPACE = 'Other';
    assert.throws(() => verifyHandoff(directory), /Open VSX namespace differs/);
    process.env.OPENVSX_NAMESPACE = '';
    process.env.OPENVSX_AUTH_MODE = 'oidc';
    assert.throws(() => verifyHandoff(directory), /Open VSX mode differs/);
    process.env.OPENVSX_AUTH_MODE = '';
    writeFileSync(join(directory, manifest.filename), Buffer.from('tampered'));
    assert.throws(() => verifyHandoff(directory), 'Tampered VSIX accepted');
  } finally {
    for (const name of [
      'RELEASE_TAG',
      'GITHUB_SHA',
      'GITHUB_RUN_ID',
      'ARTIFACT_ID',
      'MARKETPLACE_PUBLISHER',
      'OPENVSX_NAMESPACE',
      'OPENVSX_AUTH_MODE',
    ]) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('source-free CLI authenticates draft reads, requires both assets and re-inventories a failed-job rerun', () => {
  const directory = mkdtempSync(resolve('dist', 'publish-cli-'));
  const manifest = handoff(directory);
  // Run the same four files shipped in the artifact, outside a source checkout.
  for (const file of [
    'publish-release',
    'release-artifact',
    'validate-release',
    'verify-release',
  ])
    copyFileSync(
      resolve('dist/scripts', `${file}.js`),
      join(directory, `${file}.js`),
    );
  writeFileSync(
    join(directory, 'mock.mjs'),
    `
    import assert from 'node:assert/strict';
    import {readFileSync} from 'node:fs';
    globalThis.fetch = async (url, options) => {
      if (new URL(url).hostname === 'api.github.com')
        assert.equal(options.headers.authorization, 'Bearer test-token');
      const routes = JSON.parse(readFileSync(new URL('./routes.json', import.meta.url)));
      const route = routes[new URL(url).pathname];
      assert.ok(route, 'Unexpected request: ' + url);
      return route.body !== undefined ? new Response(route.body) : Response.json(route.json, {status:route.status || 200});
    };
  `,
  );
  const base = '/repos/Wald764/RDLC-Code';
  const assets = [
    { name: manifest.filename, digest: `sha256:${manifest.vsixSha256}` },
    {
      name: 'release-manifest.json',
      digest: `sha256:${sha256(readFileSync(join(directory, 'release-manifest.json')))}`,
    },
  ];
  const routes: Record<string, unknown> = {
    [`${base}/releases/tags/${identity.tag}`]: { json: null, status: 404 },
    [`${base}/releases`]: {
      json: [{ id: 1, tag_name: identity.tag, draft: true }],
    },
    [`${base}/releases/1/assets`]: { json: assets },
    [`${base}/actions/runs/123`]: {
      json: { created_at: new Date().toISOString(), run_attempt: 2 },
    },
    '/_apis/public/gallery/extensionquery': { json: { results: [] } },
    '/_apis/public/gallery/publishers/Wald764/vsextensions/rdlc-code/1.2.3/vspackage':
      { body: bytes.toString() },
  };
  const env = {
    ...process.env,
    RELEASE_TAG: identity.tag,
    GITHUB_SHA: identity.commit,
    GITHUB_RUN_ID: '123',
    ARTIFACT_ID: '456',
    GITHUB_REPOSITORY: 'Wald764/RDLC-Code',
    MARKETPLACE_PUBLISHER: 'Wald764',
    GH_TOKEN: 'test-token',
    GITHUB_TOKEN: '',
    OPENVSX_NAMESPACE: '',
    OPENVSX_AUTH_MODE: '',
    GITHUB_OUTPUT: join(directory, 'outputs.txt'),
    GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
  };
  const run = (...args: string[]) => {
    writeFileSync(join(directory, 'routes.json'), JSON.stringify(routes));
    writeFileSync(env.GITHUB_OUTPUT, '');
    return spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(join(directory, 'mock.mjs')).href,
        join(directory, 'publish-release.js'),
        ...args,
        '--dir',
        directory,
      ],
      { cwd: directory, env, encoding: 'utf8' },
    );
  };
  try {
    let result = run('recheck', '--destination', 'github');
    assert.equal(result.status, 0, result.stderr);
    routes[`${base}/releases/1/assets`] = { json: assets.slice(0, 1) };
    result = run('recheck', '--destination', 'github');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release-manifest.json/);
    routes[`${base}/releases/1/assets`] = { json: assets };
    result = run('recheck', '--destination', 'github', '--published');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /still a draft/);

    routes[`${base}/releases/tags/${identity.tag}`] = {
      json: { id: 1, tag_name: identity.tag, draft: false },
    };
    result = run('plan');
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(env.GITHUB_OUTPUT, 'utf8'),
      /marketplace=pending/,
    );
    // The upload succeeded but its acknowledgement/check failed: the next job
    // attempt must discover those bytes rather than publish the version again.
    routes['/_apis/public/gallery/extensionquery'] = {
      json: {
        results: [
          {
            extensions: [
              {
                extensionName: identity.name,
                publisher: { publisherName: identity.publisher },
                versions: [{ version: identity.version }],
              },
            ],
          },
        ],
      },
    };
    result = run('plan');
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(env.GITHUB_OUTPUT, 'utf8'),
      /marketplace=succeeded/,
    );
    routes[
      '/_apis/public/gallery/publishers/Wald764/vsextensions/rdlc-code/1.2.3/vspackage'
    ] = { body: 'foreign package' };
    result = run('plan');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Conflict at marketplace/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Open VSX preflight validates PAT and trusted-publisher modes without publishing or disclosing tokens', () => {
  const directory = mkdtempSync(resolve('dist', 'openvsx-auth-'));
  const library = join(directory, 'node_modules', 'ovsx');
  mkdirSync(join(library, 'lib'), { recursive: true });
  writeFileSync(
    join(library, 'package.json'),
    JSON.stringify({ version: '1.3.0' }),
  );
  writeFileSync(
    join(library, 'lib', 'registry.js'),
    `
    const assert = require('node:assert/strict');
    exports.Registry = class {
      async verifyPat(namespace, token) {
        assert.equal(namespace,'Wald764');
        return token === 'test-pat' ? {} : {error:token};
      }
      async getRegistryVersion() { return {trustedPublishingAudience:'test-audience'}; }
      async requestTrustedPublishingToken(namespace,name,token) {
        assert.equal(namespace,'Wald764'); assert.equal(name,'rdlc-code'); assert.equal(token,'test-id-token');
        return {value:'test-short-lived-token'};
      }
    };
  `,
  );
  writeFileSync(
    join(library, 'lib', 'oidc.js'),
    `
    const assert = require('node:assert/strict');
    exports.getIdToken = async audience => { assert.equal(audience,'test-audience'); return 'test-id-token'; };
  `,
  );
  const env = {
    ...process.env,
    RELEASE_TAG: identity.tag,
    GITHUB_SHA: identity.commit,
    GITHUB_RUN_ID: '123',
    ARTIFACT_ID: '456',
    GITHUB_REPOSITORY: 'Wald764/RDLC-Code',
    MARKETPLACE_PUBLISHER: 'Wald764',
    OPENVSX_NAMESPACE: 'Wald764',
    OPENVSX_AUTH_MODE: 'pat',
    OVSX_PAT: 'test-pat',
    GITHUB_OUTPUT: '',
    GITHUB_STEP_SUMMARY: '',
  };
  const run = () =>
    spawnSync(
      process.execPath,
      [
        resolve('dist/scripts/publish-release.js'),
        'openvsx-auth',
        '--dir',
        directory,
        '--tools',
        directory,
      ],
      { env, encoding: 'utf8' },
    );
  try {
    handoff(directory, 'pat');
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    env.OVSX_PAT = 'private-invalid-token';
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Open VSX pat authentication failed/);
    assert.doesNotMatch(result.stderr + result.stdout, /private-invalid-token/);
    env.OVSX_PAT = '';
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing PAT/);
    handoff(directory, 'oidc');
    env.OPENVSX_AUTH_MODE = 'oidc';
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(
      result.stderr + result.stdout,
      /test-id-token|test-short-lived-token/,
    );
    env.OVSX_PAT = 'conflicting-pat';
    assert.notEqual(run().status, 0);
    handoff(directory);
    env.OVSX_PAT = '';
    env.OPENVSX_AUTH_MODE = '';
    env.OPENVSX_NAMESPACE = '';
    result = run();
    assert.equal(result.status, 0, result.stderr);
    env.OVSX_PAT = 'stray-secret';
    assert.notEqual(run().status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
