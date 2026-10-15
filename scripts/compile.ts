import { execFileSync } from 'node:child_process';
import { cpSync, readdirSync, rmSync } from 'node:fs';

for (const directory of ['packages', 'apps', 'tests', 'scripts'])
  rmSync(`dist/${directory}`, { recursive: true, force: true });
execFileSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
  { stdio: 'inherit' },
);
for (const name of readdirSync('packages')) {
  rmSync(`packages/${name}/dist`, { recursive: true, force: true });
  cpSync(`dist/packages/${name}/src`, `packages/${name}/dist`, {
    recursive: true,
  });
}
