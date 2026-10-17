import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  packageAuthTest,
  readAuthVsix,
  verifyAuthVsix,
  authFilename,
} from './package-auth-test.js';

test('the authentication probe packages only the fixed inert test identity and binds its bytes to the run', async () => {
  mkdirSync('dist', { recursive: true });
  const directory = mkdtempSync(resolve('dist/auth-probe-check-'));
  try {
    const context = { commit: 'a'.repeat(40), runId: '123' };
    const record = await packageAuthTest(directory, context);
    assert.equal(record.identity, 'Wald764.rdlc-code-auth-test');
    assert.equal(record.version, '0.0.1');
    assert.equal(record.commit, context.commit);
    assert.equal(record.runId, context.runId);
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
    const entries = await readAuthVsix(resolve(directory, authFilename));
    verifyAuthVsix(entries);
    for (const path of [
      'extension/main.js',
      'extension/.env',
      'extension/extra.json',
    ]) {
      assert.throws(() =>
        verifyAuthVsix(
          new Map([...entries, [path, Buffer.from('unexpected')]]),
        ),
      );
    }
    for (const change of [
      { name: 'rdlc-code' },
      { publisher: 'Other' },
      { version: '0.1.0' },
      { main: 'main.js' },
    ]) {
      const tampered = new Map(entries);
      const metadata = JSON.parse(
        tampered.get('extension/package.json')!.toString(),
      );
      tampered.set(
        'extension/package.json',
        Buffer.from(JSON.stringify({ ...metadata, ...change })),
      );
      assert.throws(() => verifyAuthVsix(tampered));
    }
    const missing = new Map(entries);
    missing.delete('extension/theme.json');
    assert.throws(() => verifyAuthVsix(missing));
    assert.deepEqual(
      JSON.parse(readFileSync(resolve(directory, 'auth-test.json'), 'utf8')),
      record,
    );
    await assert.rejects(() =>
      packageAuthTest(directory, { ...context, commit: 'not-a-sha' }),
    );
    await assert.rejects(() =>
      packageAuthTest(directory, { ...context, runId: '../other-run' }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
