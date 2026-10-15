import { createVSIX } from '@vscode/vsce';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
};
const extension = JSON.parse(
  readFileSync('apps/vscode-extension/package.json', 'utf8'),
) as { version: string };
if (root.version !== extension.version)
  throw new Error('Root and extension versions differ');
mkdirSync('dist', { recursive: true });
await createVSIX({
  cwd: 'apps/vscode-extension',
  packagePath: resolve(`dist/rdlc-code-${root.version}.vsix`),
  dependencies: false,
  skipLicense: false,
  allowMissingRepository: true,
});
