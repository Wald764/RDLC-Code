/**
 * Assemble the per-cell QA evidence a workflow job uploads (`qa-evidence/`):
 * `cell.json` (candidate SHA, cell identity and the outcome of every step, read
 * from `QA_STEP_<NAME>` variables where `_` stands for `-`) plus, per Desktop
 * run, its `runner-status.json` and `playwright-report.json`. scripts/qa-gate.ts
 * judges them. This file has no local imports on purpose: workflows run it from
 * source (`node scripts/qa-collect.ts`), so it works even when the build failed.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function collectCell(
  env: Record<string, string | undefined>,
  artifactRoot = '.vscode-test/desktop-artifacts',
  out = 'qa-evidence',
): void {
  const steps: Record<string, string> = {};
  for (const [key, value] of Object.entries(env))
    if (key.startsWith('QA_STEP_'))
      steps[key.slice('QA_STEP_'.length).toLowerCase().replaceAll('_', '-')] =
        value ?? '';
  mkdirSync(join(out, 'runs'), { recursive: true });
  const runs = existsSync(artifactRoot)
    ? readdirSync(artifactRoot, { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && /^run-[\w-]+$/.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort()
    : [];
  for (const name of runs) {
    const source = join(artifactRoot, name);
    if (!existsSync(join(source, 'runner-status.json'))) continue;
    const target = join(out, 'runs', name);
    mkdirSync(target, { recursive: true });
    for (const file of ['runner-status.json', 'playwright-report.json'])
      if (existsSync(join(source, file)))
        copyFileSync(join(source, file), join(target, file));
  }
  const cell: Record<string, unknown> = {
    schema: 1,
    candidate: env['QA_CANDIDATE'] ?? '',
    kind: env['QA_KIND'] ?? '',
    os: env['QA_OS'] ?? '',
    vscode: env['QA_VSCODE'] ?? '',
    ...(env['QA_GROUP'] ? { group: env['QA_GROUP'] } : {}),
    ...(env['QA_VSIX_SHA256'] ? { vsixSha256: env['QA_VSIX_SHA256'] } : {}),
    steps,
  };
  writeFileSync(join(out, 'cell.json'), `${JSON.stringify(cell, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  collectCell(process.env);
}
