import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// The official Electron harness loads this entry as bundled CommonJS, including on 1.110.
export async function run(): Promise<void> {
  const load = createRequire(__filename);
  const files = readdirSync(__dirname)
    .filter((file) => file.endsWith('.test.cjs'))
    .sort();
  assert.ok(files.length > 0, 'No Electron test suites discovered');
  for (const file of files) {
    const suite = load(join(__dirname, file)) as { run?: () => Promise<void> };
    assert.equal(typeof suite.run, 'function', `${file} must export run()`);
    await suite.run!();
    console.log(`PASS ${file}`);
  }
}
