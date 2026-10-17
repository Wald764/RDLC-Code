import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createVSIX } from '@vscode/vsce';

const fixture = 'tests/fixtures/publishing-auth';
export const authFilename = 'rdlc-code-auth-test-0.0.1.vsix';
// Reuse the ZIP reader from the pinned packaging tool, as in production verification.
const { readZip } = createRequire(import.meta.url)(
  '@vscode/vsce/out/zip.js',
) as {
  readZip(
    path: string,
    filter: (path: string) => boolean,
  ): Promise<Map<string, Buffer>>;
};
export const readAuthVsix = (path: string) => readZip(path, () => true);

function authMetadata() {
  const metadata = JSON.parse(readFileSync(`${fixture}/package.json`, 'utf8'));
  assert.equal(metadata.publisher, 'Wald764');
  assert.equal(metadata.name, 'rdlc-code-auth-test');
  assert.equal(metadata.version, '0.0.1');
  assert.equal(
    metadata.scripts,
    undefined,
    'Authentication probe must not run lifecycle scripts',
  );
  assert.equal(
    metadata.main,
    undefined,
    'Authentication probe must not execute extension code',
  );
  assert.equal(metadata.browser, undefined);
  assert.deepEqual(metadata.contributes, {
    themes: [
      {
        label: 'RDLC Code Authentication Test',
        uiTheme: 'vs',
        path: './theme.json',
      },
    ],
  });
  return metadata;
}

export function verifyAuthVsix(entries: ReadonlyMap<string, Buffer>): void {
  const expected = authMetadata();
  assert.deepEqual(
    JSON.parse(entries.get('extension/package.json')?.toString() ?? 'null'),
    expected,
  );
  const files = new Map([
    ['extension/readme.md', readFileSync(`${fixture}/README.md`)],
    ['extension/theme.json', readFileSync(`${fixture}/theme.json`)],
    ['extension/license.txt', readFileSync('LICENSE')],
  ]);
  for (const [path, bytes] of files)
    assert.deepEqual(
      entries.get(path),
      bytes,
      `Missing or changed probe asset: ${path}`,
    );
  assert.deepEqual(
    [...entries.keys()].sort(),
    [
      ...files.keys(),
      'extension/package.json',
      'extension.vsixmanifest',
      '[content_types].xml',
    ].sort(),
    'Only the inert authentication fixture may be published',
  );
  const xml = entries.get('extension.vsixmanifest')!.toString();
  for (const [attribute, value] of Object.entries({
    Id: expected.name,
    Version: expected.version,
    Publisher: expected.publisher,
  }))
    assert.ok(
      xml.includes(`${attribute}="${value}"`),
      `Incorrect probe identity: ${attribute}`,
    );
}

export async function packageAuthTest(
  directory: string,
  context: { commit: string; runId: string },
) {
  assert.match(context.commit, /^[a-f0-9]{40}$/);
  assert.match(context.runId, /^[1-9][0-9]*$/);
  authMetadata();
  const node = readFileSync('.node-version', 'utf8').trim();
  assert.equal(process.versions.node, node, 'Use the pinned build Node');
  assert.equal(
    JSON.parse(
      readFileSync(
        createRequire(import.meta.url).resolve('@vscode/vsce/package.json'),
        'utf8',
      ),
    ).version,
    '3.7.1',
  );
  mkdirSync(directory, { recursive: true });
  const source = mkdtempSync(join(directory, 'source-'));
  const path = resolve(directory, authFilename);
  try {
    cpSync(fixture, source, { recursive: true });
    copyFileSync('LICENSE', join(source, 'LICENSE'));
    await createVSIX({
      cwd: source,
      packagePath: path,
      dependencies: false,
      skipLicense: false,
    });
    verifyAuthVsix(await readAuthVsix(path));
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
  const record = {
    identity: 'Wald764.rdlc-code-auth-test',
    version: '0.0.1',
    ...context,
    filename: authFilename,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    tools: { node, vsce: '3.7.1', ovsx: '1.3.0' },
  };
  writeFileSync(
    join(directory, 'auth-test.json'),
    JSON.stringify(record, null, 2) + '\n',
  );
  return record;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.equal(
    process.env.MARKETPLACE_PUBLISHER,
    'Wald764',
    'Set MARKETPLACE_PUBLISHER to the approved test publisher',
  );
  assert.equal(
    process.env.OPENVSX_NAMESPACE,
    'Wald764',
    'Set OPENVSX_NAMESPACE to the approved test publisher',
  );
  assert.equal(
    process.env.OPENVSX_AUTH_MODE,
    'pat',
    'This probe validates the Open VSX bootstrap PAT mode',
  );
  const record = await packageAuthTest(resolve('dist/publishing-auth'), {
    commit: process.env.GITHUB_SHA ?? '',
    runId: process.env.GITHUB_RUN_ID ?? '',
  });
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `sha256=${record.sha256}\nnode=${record.tools.node}\n`,
    );
  console.log(JSON.stringify(record));
}
