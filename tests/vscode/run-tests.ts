import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const version = process.env.VSCODE_VERSION ?? 'stable';
const executable = await downloadAndUnzipVSCode(version);
const packaged = process.argv.includes('--packaged');
const profile = resolve(
  '.vscode-test',
  `profile-${version}-${packaged ? 'packaged' : 'development'}-${process.pid}`,
);
const extensions = resolve(profile, 'extensions');
if (packaged) {
  const { version: packageVersion } = JSON.parse(
    readFileSync('package.json', 'utf8'),
  );
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(executable);
  if (!cli) throw new Error('VS Code CLI not found');
  execFileSync(
    cli,
    [
      ...args,
      '--user-data-dir',
      profile,
      '--extensions-dir',
      extensions,
      '--install-extension',
      resolve(`dist/rdlc-code-${packageVersion}.vsix`),
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
}
await runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: resolve(
    packaged ? 'tests/vscode/harness' : 'apps/vscode-extension',
  ),
  extensionTestsPath: resolve('dist/tests/vscode/suite.cjs'),
  launchArgs: [
    '--user-data-dir',
    profile,
    '--extensions-dir',
    extensions,
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--no-sandbox',
  ],
});
