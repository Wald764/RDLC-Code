import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';

execFileSync(
  process.execPath,
  [
    'node_modules/@angular/cli/bin/ng.js',
    'build',
    '--configuration',
    'production',
  ],
  { cwd: process.cwd() + '/apps/designer', stdio: 'inherit' },
);
rmSync('apps/vscode-extension/build', { recursive: true, force: true });
await build({
  entryPoints: ['apps/vscode-extension/src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'apps/vscode-extension/build/extension.cjs',
  legalComments: 'eof',
});
for (const file of readdirSync('tests/vscode').filter(
  (file) => file.endsWith('.test.ts') || file === 'suite.ts',
)) {
  await build({
    entryPoints: [`tests/vscode/${file}`],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['vscode'],
    outfile: `dist/tests/vscode/${file.replace(/\.ts$/, '.cjs')}`,
  });
}
mkdirSync('apps/vscode-extension/build/designer', { recursive: true });
cpSync('dist/designer/browser', 'apps/vscode-extension/build/designer', {
  recursive: true,
});
cpSync(
  'dist/designer/3rdpartylicenses.txt',
  'apps/vscode-extension/build/designer/3rdpartylicenses.txt',
);
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
  cpSync(file, `apps/vscode-extension/${file}`);
