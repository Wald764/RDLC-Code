import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { verifyArtifact, type ReleaseManifest } from './release-artifact.js';
import { recoveryPlan, type DestinationInventory } from './verify-release.js';

const MARKETPLACE = 'https://marketplace.visualstudio.com';
const OPENVSX = 'https://open-vsx.org/api';
export const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

export interface GithubRelease {
  draft?: boolean;
  prerelease?: boolean;
  tag_name?: string;
}
export interface GithubAsset {
  name?: string;
  digest?: string | null;
}

function versionParts(tag: string): readonly number[] | null {
  const match = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(
    tag,
  );
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index++)
    if (left[index] !== right[index])
      return left[index]! < right[index]! ? -1 : 1;
  return 0;
}

/**
 * Bounds the release notes on the highest published stable version below this
 * tag, so an older maintenance release is never taken as the previous bound.
 * shortcut: published releases are assumed to come from main-history tags,
 * which the release workflow enforces; re-validate ancestry if that changes.
 */
export function previousStableTag(
  releases: readonly GithubRelease[],
  tag: string,
): string | null {
  const current = versionParts(tag);
  assert.ok(current, 'Expected a canonical stable release tag');
  let previous: { parts: readonly number[]; tag: string } | null = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const name = release.tag_name ?? '';
    const parts = versionParts(name);
    if (!parts || compare(parts, current) >= 0) continue;
    if (!previous || compare(parts, previous.parts) > 0)
      previous = { parts, tag: name };
  }
  return previous?.tag ?? null;
}

/** Release assets are identified by name and, when present, by their digest. */
export function assetDigest(
  assets: readonly GithubAsset[],
  filename: string,
): string | undefined {
  return assets
    .find((asset) => asset.name === filename)
    ?.digest?.replace(/^sha256:/i, '');
}

/** A draft is an unfinished publication, never a completed destination. */
export function githubObservation(
  release: GithubRelease | null,
  assets: readonly GithubAsset[],
  manifest: ReleaseManifest,
  manifestDigest: string,
  complete = false,
): DestinationInventory {
  if (!release)
    return { destination: 'github', configured: true, exists: false };
  assert.equal(
    release.tag_name,
    manifest.identity.tag,
    'Wrong GitHub release tag',
  );
  for (const [name, digest] of [
    [manifest.filename, manifest.vsixSha256],
    ['release-manifest.json', manifestDigest],
  ] as const) {
    const asset = assets.find((entry) => entry.name === name);
    if (asset || complete || !release.draft)
      assert.equal(
        assetDigest(assets, name),
        digest,
        `GitHub asset differs or is missing: ${name}`,
      );
  }
  if (release.draft && !complete)
    return { destination: 'github', configured: true, exists: false };
  return {
    destination: 'github',
    configured: true,
    exists: true,
    remoteDigest: manifest.vsixSha256,
  };
}

export function marketplaceVersionExists(
  document: unknown,
  publisher: string,
  name: string,
  version: string,
): boolean {
  const extension = (
    document as {
      results?: {
        extensions?: {
          extensionName?: string;
          publisher?: { publisherName?: string };
          versions?: { version?: string }[];
        }[];
      }[];
    }
  ).results?.[0]?.extensions?.[0];
  if (!extension) return false;
  assert.equal(
    extension.publisher?.publisherName?.toLowerCase(),
    publisher.toLowerCase(),
    'Unexpected Marketplace publisher',
  );
  assert.equal(
    extension.extensionName?.toLowerCase(),
    name.toLowerCase(),
    'Unexpected Marketplace extension',
  );
  return (extension.versions ?? []).some((entry) => entry.version === version);
}

export function openvsxChecksumUrl(document: unknown): string | null {
  return (document as { files?: { sha256?: string } }).files?.sha256 ?? null;
}

function manifestOf(directory: string): ReleaseManifest {
  return JSON.parse(
    readFileSync(join(directory, 'release-manifest.json'), 'utf8'),
  ) as ReleaseManifest;
}

/**
 * Publisher jobs have no source checkout: the manifest and the compiled
 * verifiers arrive together in the canonical artifact, whose bytes this binds
 * to the tag, the commit, the configured publisher and the run identity.
 */
export function verifyHandoff(directory: string): ReleaseManifest {
  const manifest = manifestOf(directory);
  const tag = process.env.RELEASE_TAG ?? '';
  const commit = process.env.GITHUB_SHA ?? '';
  assert.match(commit, /^[a-f0-9]{40}$/, 'GITHUB_SHA is required');
  const identity = {
    tag,
    commit,
    version: tag.startsWith('v') ? tag.slice(1) : '',
    publisher: process.env.MARKETPLACE_PUBLISHER ?? '',
    name: manifest.identity.name,
  };
  const bytes = readFileSync(join(directory, manifest.filename));
  verifyArtifact(
    manifest,
    {
      runId: process.env.GITHUB_RUN_ID ?? '',
      artifactId: process.env.ARTIFACT_ID ?? '',
      // Informational only: the explicit VSIX digest below decides acceptance.
      ...(process.env.ARCHIVE_DIGEST
        ? { archiveDigest: process.env.ARCHIVE_DIGEST }
        : {}),
    },
    bytes,
    identity,
  );
  assert.equal(sha256(bytes), manifest.vsixSha256);
  const namespace = process.env.OPENVSX_NAMESPACE || null;
  assert.equal(
    namespace,
    manifest.destinations.openvsxNamespace,
    'Open VSX namespace differs from the canonical manifest',
  );
  assert.equal(
    process.env.OPENVSX_AUTH_MODE || (namespace ? 'pat' : 'not-configured'),
    manifest.destinations.openvsxMode,
    'Open VSX mode differs from the canonical manifest',
  );
  return manifest;
}

async function api(path: string): Promise<Response> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function githubInventory(
  manifest: ReleaseManifest,
  repository: string,
  directory: string,
  options: { complete?: boolean; published?: boolean } = {},
): Promise<DestinationInventory> {
  const release = await api(
    `/repos/${repository}/releases/tags/${manifest.identity.tag}`,
  );
  if (release.status === 404)
    return { destination: 'github', configured: true, exists: false };
  assert.ok(release.ok, `GitHub release lookup failed: ${release.status}`);
  const document = (await release.json()) as GithubRelease & { id: number };
  if (options.published)
    assert.equal(document.draft, false, 'GitHub release is still a draft');
  const assets = await api(
    `/repos/${repository}/releases/${document.id}/assets`,
  );
  assert.ok(assets.ok, `GitHub asset lookup failed: ${assets.status}`);
  return githubObservation(
    document,
    (await assets.json()) as GithubAsset[],
    manifest,
    sha256(readFileSync(join(directory, 'release-manifest.json'))),
    options.complete ?? false,
  );
}

async function marketplaceInventory(
  manifest: ReleaseManifest,
  publisher: string,
): Promise<DestinationInventory> {
  const { name, version } = manifest.identity;
  const query = await fetch(
    `${MARKETPLACE}/_apis/public/gallery/extensionquery`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json;api-version=7.2-preview.1',
      },
      body: JSON.stringify({
        filters: [
          { criteria: [{ filterType: 7, value: `${publisher}.${name}` }] },
        ],
        flags: 0x1,
      }),
    },
  );
  assert.ok(query.ok, `Marketplace query failed: ${query.status}`);
  if (!marketplaceVersionExists(await query.json(), publisher, name, version))
    return { destination: 'marketplace', configured: true, exists: false };
  // Published bytes, not the version number, are the association evidence.
  const download = await fetch(
    `${MARKETPLACE}/_apis/public/gallery/publishers/${publisher}/vsextensions/${name}/${version}/vspackage`,
    { headers: { 'accept-encoding': 'identity' } },
  );
  assert.ok(download.ok, `Marketplace download failed: ${download.status}`);
  return {
    destination: 'marketplace',
    configured: true,
    exists: true,
    remoteDigest: sha256(new Uint8Array(await download.arrayBuffer())),
  };
}

async function openvsxInventory(
  manifest: ReleaseManifest,
  namespace: string,
): Promise<DestinationInventory> {
  const { name, version } = manifest.identity;
  const document = await fetch(`${OPENVSX}/${namespace}/${name}/${version}`);
  if (document.status === 404)
    return { destination: 'openvsx', configured: true, exists: false };
  assert.ok(document.ok, `Open VSX query failed: ${document.status}`);
  const metadata = await document.json();
  assert.equal(
    (metadata as { version?: string }).version,
    version,
    'Unexpected Open VSX version',
  );
  const checksum = openvsxChecksumUrl(metadata);
  if (!checksum)
    return { destination: 'openvsx', configured: true, exists: true };
  const declared = await fetch(checksum);
  assert.ok(declared.ok, `Open VSX checksum lookup failed: ${declared.status}`);
  return {
    destination: 'openvsx',
    configured: true,
    exists: true,
    remoteDigest: (await declared.text()).trim().toLowerCase(),
  };
}

async function inventory(
  manifest: ReleaseManifest,
  repository: string,
  directory: string,
): Promise<readonly DestinationInventory[]> {
  return Promise.all(
    (['github', 'marketplace', 'openvsx'] as const).map((destination) =>
      destinationInventory(destination, manifest, repository, directory),
    ),
  );
}

async function destinationInventory(
  destination: 'github' | 'marketplace' | 'openvsx',
  manifest: ReleaseManifest,
  repository: string,
  directory: string,
): Promise<DestinationInventory> {
  if (destination === 'github')
    return githubInventory(manifest, repository, directory);
  if (destination === 'marketplace')
    return marketplaceInventory(
      manifest,
      process.env.MARKETPLACE_PUBLISHER ?? '',
    );
  const namespace = process.env.OPENVSX_NAMESPACE;
  if (!namespace)
    return { destination: 'openvsx', configured: false, exists: false };
  return openvsxInventory(manifest, namespace);
}

/** Use the pinned Open VSX client for its supported token exchange; never log tokens. */
export async function verifyOpenvsxAuth(
  directory: string,
  tools: string,
): Promise<void> {
  const manifest = verifyHandoff(directory);
  const mode = manifest.destinations.openvsxMode;
  const namespace = process.env.OPENVSX_NAMESPACE;
  const pat = process.env.OVSX_PAT;
  if (mode === 'not-configured') {
    assert.ok(
      !namespace && !process.env.OPENVSX_AUTH_MODE && !pat,
      'Unexpected Open VSX configuration',
    );
    summarize('Open VSX authentication: not-configured.');
    return;
  }
  assert.equal(
    namespace,
    manifest.identity.publisher,
    'Open VSX namespace differs',
  );
  assert.equal(
    process.env.OPENVSX_AUTH_MODE || (pat ? 'pat' : ''),
    mode,
    'Open VSX mode differs from the canonical manifest',
  );
  assert.ok(
    mode === 'pat' ? !!pat?.trim() : !pat,
    'Missing PAT or conflicting PAT/OIDC configuration',
  );
  const require = createRequire(join(tools, 'package.json'));
  assert.equal(
    (require('ovsx/package.json') as { version: string }).version,
    '1.3.0',
  );
  const { Registry } = require('ovsx/lib/registry') as {
    Registry: new () => {
      verifyPat(namespace: string, token: string): Promise<{ error?: string }>;
      getRegistryVersion(): Promise<{ trustedPublishingAudience?: string }>;
      requestTrustedPublishingToken(
        namespace: string,
        name: string,
        token: string,
      ): Promise<{ value?: string; error?: string }>;
    };
  };
  try {
    const registry = new Registry();
    if (mode === 'pat') {
      const result = await registry.verifyPat(namespace!, pat!);
      assert.ok(!result.error);
    } else {
      const { getIdToken } = require('ovsx/lib/oidc') as {
        getIdToken(audience: string, options: object): Promise<string>;
      };
      const version = await registry.getRegistryVersion();
      const idToken = await getIdToken(
        version.trustedPublishingAudience || 'https://open-vsx.org',
        {},
      );
      const result = await registry.requestTrustedPublishingToken(
        namespace!,
        manifest.identity.name,
        idToken,
      );
      assert.ok(result.value && !result.error);
    }
  } catch {
    throw new Error(
      `Open VSX ${mode} authentication failed; verify the namespace credential or trusted publisher registration`,
    );
  }
  summarize(`Open VSX ${mode} authentication verified before publication.`);
}

function emit(values: Record<string, string>): void {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${Object.entries(values)
        .map(([name, value]) => `${name}=${value}`)
        .join('\n')}\n`,
    );
}
function summarize(text: string): void {
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const command = args[0] ?? '';
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? '') : '';
  };
  const directory = option('--dir') || 'canonical';
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  assert.match(repository, /^[^/]+\/[^/]+$/, 'GITHUB_REPOSITORY is required');

  if (command === 'manifest') {
    const manifest = manifestOf(directory);
    emit({
      node: manifest.tools.node ?? '',
      vsce: manifest.tools.vsce ?? '',
      version: manifest.identity.version,
      filename: manifest.filename,
      vsix: manifest.vsixSha256,
    });
    console.log(manifest.vsixSha256);
  } else if (command === 'verify') {
    const manifest = verifyHandoff(directory);
    emit({ vsix: manifest.vsixSha256, filename: manifest.filename });
    summarize(
      `Verified \`${manifest.filename}\` SHA-256 \`${manifest.vsixSha256}\` for ${manifest.identity.tag}.`,
    );
  } else if (command === 'openvsx-auth') {
    await verifyOpenvsxAuth(directory, option('--tools'));
  } else if (command === 'plan') {
    const manifest = verifyHandoff(directory);
    const run = await api(
      `/repos/${repository}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`,
    );
    assert.ok(run.ok, `Run lookup failed: ${run.status}`);
    const document = (await run.json()) as {
      created_at: string;
      run_attempt: number;
    };
    const ageDays = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(document.created_at)) / 86_400_000),
    );
    const statuses = recoveryPlan(
      await inventory(manifest, repository, directory),
      {
        digest: manifest.vsixSha256,
        ageDays,
        attempt: document.run_attempt,
        provenanceAvailable: true,
        artifactAvailable: existsSync(join(directory, manifest.filename)),
      },
    );
    const state = Object.fromEntries(
      statuses.map((entry) => [entry.destination, entry.status]),
    );
    emit({ vsix: manifest.vsixSha256, filename: manifest.filename, ...state });
    summarize(
      [
        `### ${manifest.identity.tag} handoff`,
        '',
        `- Candidate \`${manifest.candidate}\`; run \`${process.env.GITHUB_RUN_ID}\` attempt ${document.run_attempt}; age ${ageDays} day(s)`,
        `- Canonical \`${manifest.filename}\` SHA-256 \`${manifest.vsixSha256}\``,
        `- Publisher \`${manifest.destinations.marketplacePublisher}\`; Open VSX \`${manifest.destinations.openvsxMode}\``,
        '',
        '| Destination | State |',
        '| --- | --- |',
        ...statuses.map(
          (entry) => `| ${entry.destination} | ${entry.status} |`,
        ),
      ].join('\n'),
    );
    console.log(JSON.stringify(state));
  } else if (command === 'recheck') {
    const manifest = verifyHandoff(directory);
    const destination = option('--destination');
    assert.ok(
      ['github', 'marketplace', 'openvsx'].includes(destination),
      'Unknown destination',
    );
    if (destination === 'github') {
      const entry = await githubInventory(manifest, repository, directory, {
        complete: true,
        published: args.includes('--published'),
      });
      assert.ok(entry.exists, 'GitHub release is missing');
    } else {
      const registry = destination as 'marketplace' | 'openvsx';
      let entry = await destinationInventory(
        registry,
        manifest,
        repository,
        directory,
      );
      // Marketplace processing is asynchronous; wait before declaring a conflict.
      for (
        let wait = 0;
        destination === 'marketplace' && !entry.exists && wait < 10;
        wait++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        entry = await destinationInventory(
          registry,
          manifest,
          repository,
          directory,
        );
      }
      assert.ok(entry.exists, `${destination} has no published version`);
      assert.equal(
        entry.remoteDigest,
        manifest.vsixSha256,
        `${destination} bytes differ from the canonical VSIX`,
      );
    }
    summarize(
      `${destination} carries canonical SHA-256 \`${manifest.vsixSha256}\`.`,
    );
    console.log(`${destination} verified`);
  } else if (command === 'previous') {
    const releases = await api(`/repos/${repository}/releases?per_page=100`);
    assert.ok(releases.ok, `Release list failed: ${releases.status}`);
    console.log(
      previousStableTag(
        (await releases.json()) as GithubRelease[],
        option('--tag'),
      ) ?? '',
    );
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}
